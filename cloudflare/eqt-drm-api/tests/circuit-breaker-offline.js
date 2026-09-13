/**
 * Offline Unit Tests for Circuit Breaker and Token Bucket Rate Limiter
 * Backed by real in-memory SQLite (node:sqlite) to rigorously test atomicity and concurrency.
 */

const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const compiledCbPath = path.join(__dirname, 'compiled', 'circuit-breaker.js');
const compiledTbPath = path.join(__dirname, 'compiled', 'token-bucket.js');

if (!fs.existsSync(compiledCbPath) || !fs.existsSync(compiledTbPath)) {
  console.error("Compiled modules not found. Run esbuild first.");
  process.exit(1);
}

const {
  canExecuteCircuit,
  recordCircuitSuccess,
  recordCircuitFailure,
  resetCircuitBreaker,
  getCircuitBreakerStatus
} = require(compiledCbPath);

const { consumeToken } = require(compiledTbPath);

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${label}`);
  }
}

class SqliteD1Mock {
  constructor() {
    this.db = new DatabaseSync(':memory:');
    this.db.exec('PRAGMA foreign_keys = OFF');
  }

  _mk(sql, binds) {
    return {
      all: async () => {
        const stmt = this.db.prepare(sql);
        return { results: stmt.all(...(binds || [])) };
      },
      first: async () => {
        const stmt = this.db.prepare(sql);
        const row = stmt.get(...(binds || []));
        return row || null;
      },
      run: async () => {
        const stmt = this.db.prepare(sql);
        const res = stmt.run(...(binds || []));
        return { success: true, meta: { changes: res.changes, last_row_id: res.lastInsertRowid } };
      },
      bind: (...args) => this._mk(sql, args)
    };
  }

  prepare(sql) {
    return this._mk(sql, []);
  }
}

async function runTests() {
  console.log('Running Circuit Breaker & Token Bucket Offline Tests (SQLite-backed)...\n');

  const db = new SqliteD1Mock();
  const env = { DB: db };

  // --- Test 1: Initial State is CLOSED ---
  const initial = await canExecuteCircuit(env, 'test_cb');
  assert(initial.allowed === true && initial.state === 'CLOSED', 'T1: Initial circuit state is CLOSED and allows requests');

  // --- Test 2: Rate limit failure (429) immediately trips circuit to OPEN with specific Retry-After ---
  await recordCircuitFailure(env, 'test_cb', 90, true);
  const statusAfterTrip = await getCircuitBreakerStatus(env, 'test_cb');
  assert(statusAfterTrip.state === 'OPEN' && statusAfterTrip.last_retry_after === 90, 'T2: Upstream 429 trips circuit to OPEN with requested 90s Retry-After');

  // --- Test 3: Requests rejected while OPEN ---
  const blockedCheck = await canExecuteCircuit(env, 'test_cb');
  assert(blockedCheck.allowed === false && blockedCheck.state === 'OPEN' && blockedCheck.retryAfter > 0, 'T3: Request rejected while circuit is OPEN with positive retryAfter');

  // --- Test 4: Transition to HALF_OPEN after cooldown elapsed ---
  // Simulate time passing: set cooldown_until 1 second in the past
  const pastIso = new Date(Date.now() - 1000).toISOString();
  db.db.prepare("UPDATE circuit_breakers SET cooldown_until = ? WHERE name = 'test_cb'").run(pastIso);

  const probeCheck = await canExecuteCircuit(env, 'test_cb');
  assert(probeCheck.allowed === true && probeCheck.state === 'HALF_OPEN', 'T4: Cooldown expiration transitions circuit to HALF_OPEN and allows probe request');

  // --- Test 5: Probe success heals circuit to CLOSED ---
  await recordCircuitSuccess(env, 'test_cb');
  const healedStatus = await getCircuitBreakerStatus(env, 'test_cb');
  assert(healedStatus.state === 'CLOSED' && healedStatus.failure_count === 0, 'T5: Successful probe heals circuit back to CLOSED with 0 failure count');

  // --- Test 6: Probe failure in HALF_OPEN trips back to OPEN with backoff ---
  // Force back to HALF_OPEN
  db.db.prepare("UPDATE circuit_breakers SET state = 'HALF_OPEN' WHERE name = 'test_cb'").run();
  await recordCircuitFailure(env, 'test_cb', undefined, false);
  const reOpenStatus = await getCircuitBreakerStatus(env, 'test_cb');
  assert(reOpenStatus.state === 'OPEN' && reOpenStatus.cooldown_until != null, 'T6: Failure during HALF_OPEN probe immediately trips back to OPEN with backoff');

  // --- Test 7: Admin manual reset forces CLOSED ---
  await resetCircuitBreaker(env, 'test_cb');
  const resetStatus = await getCircuitBreakerStatus(env, 'test_cb');
  assert(resetStatus.state === 'CLOSED' && resetStatus.cooldown_until === null, 'T7: resetCircuitBreaker restores CLOSED state unconditionally');

  // --- Test 8: Token Bucket initial consumption ---
  const tbKey = 'tb_test_key';
  const tb1 = await consumeToken(env, tbKey, 3, 1); // capacity 3, 1 token/sec
  assert(tb1.allowed === true && Math.round(tb1.currentTokens) === 2, 'T8: Token bucket initial consumption succeeds with capacity-1 tokens remaining');

  // --- Test 9: Rapid depletion of Token Bucket ---
  const tb2 = await consumeToken(env, tbKey, 3, 1);
  const tb3 = await consumeToken(env, tbKey, 3, 1);
  const tbExhausted = await consumeToken(env, tbKey, 3, 1);
  assert(tb2.allowed && tb3.allowed && !tbExhausted.allowed && tbExhausted.retryAfter > 0, 'T9: Consuming beyond burst capacity rejects request with positive retryAfter');

  // --- Test 10: Token Bucket refill after time elapsed ---
  // Simulate 3 seconds elapsed
  const past3sIso = new Date(Date.now() - 3000).toISOString();
  db.db.prepare("UPDATE token_buckets SET last_refill = ? WHERE key = ?").run(past3sIso, tbKey);
  const tbRefilled = await consumeToken(env, tbKey, 3, 1);
  assert(tbRefilled.allowed === true, 'T10: Token bucket refills tokens after elapsed time and allows subsequent requests');

  // --- Test 11: HALF_OPEN Single Probe Gate Concurrency (R39-5 / E5) ---
  // Setup circuit in OPEN with expired cooldown
  const cbConcKey = 'cb_concurrent_test';
  await recordCircuitFailure(env, cbConcKey, 60, true);
  db.db.prepare("UPDATE circuit_breakers SET cooldown_until = ? WHERE name = ?").run(pastIso, cbConcKey);

  // Fire 20 concurrent probe requests
  const probeResults = await Promise.all(
    Array.from({ length: 20 }, () => canExecuteCircuit(env, cbConcKey))
  );
  const allowedProbes = probeResults.filter(r => r.allowed && r.state === 'HALF_OPEN');
  const blockedProbes = probeResults.filter(r => !r.allowed && r.state === 'HALF_OPEN');
  assert(
    allowedProbes.length === 1 && blockedProbes.length === 19,
    `T11: Concurrency gate allows exactly 1 probe (got ${allowedProbes.length}) and blocks 19 during HALF_OPEN`
  );

  // --- Test 12: Token Bucket Burst Concurrency (R39-2 / E2) ---
  // Setup bucket with capacity 5, refill rate 10/60
  const tbConcKey = 'tb_concurrent_test';
  // Fire 10 concurrent requests at fresh bucket of capacity 5
  const tbResults = await Promise.all(
    Array.from({ length: 10 }, () => consumeToken(env, tbConcKey, 5, 10 / 60))
  );
  const allowedTb = tbResults.filter(r => r.allowed);
  const blockedTb = tbResults.filter(r => !r.allowed && r.retryAfter > 0);
  assert(
    allowedTb.length === 5 && blockedTb.length === 5,
    `T12: Token bucket burst concurrency allows exactly capacity=5 (got ${allowedTb.length}) and rejects 5 with retryAfter`
  );

  // --- Test 13: HALF_OPEN Probe Lease Enforcement and Dynamic retryAfter (R39-15 / E11 / R40-3 / R42-5) ---
  // Strict lower bound at 179s (< 180s):
  // Set updated_at to now - 179s. In-flight probe must still block callers with retryAfter <= 2.
  const nearExpiryProbeIso = new Date(Date.now() - 179000).toISOString();
  db.db.prepare("UPDATE circuit_breakers SET updated_at = ? WHERE name = ?").run(nearExpiryProbeIso, cbConcKey);
  const midLeaseProbe = await canExecuteCircuit(env, cbConcKey);
  assert(
    !midLeaseProbe.allowed &&
    midLeaseProbe.state === 'HALF_OPEN' &&
    midLeaseProbe.retryAfter > 0 &&
    midLeaseProbe.retryAfter <= 2,
    `T13: In-flight HALF_OPEN probe at 179s (<180s) blocks callers with dynamic retryAfter (${midLeaseProbe.retryAfter}s)`
  );

  // --- Test 14: HALF_OPEN Probe Crash / Lease Expiry Self-Healing (R39-15 / E11 / R40-3 / R42-5) ---
  // Strict upper bound at 181s (> 180s):
  // Simulate probe crash/loss: updated_at expired at 181s beyond 180s lease
  const expiredProbeIso = new Date(Date.now() - 181000).toISOString();
  db.db.prepare("UPDATE circuit_breakers SET updated_at = ? WHERE name = ?").run(expiredProbeIso, cbConcKey);

  // Next caller must succeed in reclaiming the probe slot (deadlock broken)
  const reclaimedProbe = await canExecuteCircuit(env, cbConcKey);
  assert(
    reclaimedProbe.allowed && reclaimedProbe.state === 'HALF_OPEN',
    'T14: Expired HALF_OPEN probe lease at 181s (>180s) allows next caller to reclaim probe (absorptive deadlock eliminated)'
  );
  const reclaimedRow = db.db.prepare("SELECT updated_at FROM circuit_breakers WHERE name = ?").get(cbConcKey);
  const refreshedAt = new Date(reclaimedRow.updated_at).getTime();
  assert(
    Date.now() - refreshedAt < 5000,
    'T14: Reclaiming expired probe refreshed updated_at timestamp'
  );

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

runTests().catch(err => {
  console.error('Unhandled test error:', err);
  process.exit(1);
});
