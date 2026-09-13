/**
 * Offline Unit Tests for Circuit Breaker and Token Bucket Rate Limiter
 */

const path = require('path');
const fs = require('fs');

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

function makeMockDb() {
  const circuitBreakers = new Map();
  const tokenBuckets = new Map();

  return {
    _circuitBreakers: circuitBreakers,
    _tokenBuckets: tokenBuckets,
    prepare(sql) {
      return {
        _binds: [],
        bind(...args) {
          this._binds = args;
          return this;
        },
        async first() {
          if (sql.includes('FROM circuit_breakers')) {
            const name = this._binds[0];
            return circuitBreakers.get(name) || null;
          }
          if (sql.includes('FROM token_buckets')) {
            const key = this._binds[0];
            return tokenBuckets.get(key) || null;
          }
          return null;
        },
        async run() {
          if (sql.includes('INSERT INTO circuit_breakers') || sql.includes('INSERT OR REPLACE INTO circuit_breakers')) {
            const name = this._binds[0];
            const state = this._binds[1];
            const failureCount = this._binds[2];
            let successCount = 0;
            let lastFailureTime = null;
            let cooldownUntil = null;
            let lastRetryAfter = 0;
            let updatedAt = new Date().toISOString();

            if (this._binds.length === 8) {
              lastFailureTime = this._binds[4];
              cooldownUntil = this._binds[5];
              lastRetryAfter = this._binds[6];
              updatedAt = this._binds[7];
            } else if (this._binds.length === 7) {
              successCount = this._binds[3];
              cooldownUntil = this._binds[4];
              lastRetryAfter = this._binds[5];
              updatedAt = this._binds[6];
            } else if (this._binds.length === 4) {
              updatedAt = this._binds[3];
            }

            circuitBreakers.set(name, {
              name,
              state,
              failure_count: failureCount,
              success_count: successCount,
              last_failure_time: lastFailureTime,
              cooldown_until: cooldownUntil,
              last_retry_after: lastRetryAfter,
              updated_at: updatedAt
            });
            return { meta: { changes: 1 } };
          }
          if (sql.includes('UPDATE circuit_breakers')) {
            if (sql.includes("SET state = 'HALF_OPEN'")) {
              const updatedAt = this._binds[0];
              const name = this._binds[1];
              const row = circuitBreakers.get(name);
              if (row) {
                row.state = 'HALF_OPEN';
                row.updated_at = updatedAt;
              }
            } else if (sql.includes("SET state = 'CLOSED'") || sql.includes("SET state = ?")) {
              const state = this._binds.length === 4 ? this._binds[0] : 'CLOSED';
              const failureCount = this._binds.length === 4 ? this._binds[1] : 0;
              const updatedAt = this._binds.length === 4 ? this._binds[2] : this._binds[0];
              const name = this._binds.length === 4 ? this._binds[3] : this._binds[1];
              const row = circuitBreakers.get(name);
              if (row) {
                row.state = state;
                row.failure_count = failureCount;
                row.success_count = (row.success_count || 0) + 1;
                row.cooldown_until = null;
                row.last_retry_after = 0;
                row.updated_at = updatedAt;
              }
            }

            return { meta: { changes: 1 } };
          }
          if (sql.includes('INSERT OR REPLACE INTO token_buckets')) {
            const key = this._binds[0];
            const tokens = this._binds[1];
            const lastRefill = this._binds[2];
            const capacity = this._binds[3];
            const refillRate = this._binds[4];
            tokenBuckets.set(key, { key, tokens, last_refill: lastRefill, capacity, refill_rate: refillRate });
            return { meta: { changes: 1 } };
          }
          if (sql.includes('UPDATE token_buckets')) {
            const tokens = this._binds[0];
            const lastRefill = this._binds[1];
            const capacity = this._binds[2];
            const refillRate = this._binds[3];
            const key = this._binds[4];
            tokenBuckets.set(key, { key, tokens, last_refill: lastRefill, capacity, refill_rate: refillRate });
            return { meta: { changes: 1 } };
          }
          return { meta: { changes: 0 } };
        }
      };
    }
  };
}

async function runTests() {
  console.log('Running Circuit Breaker & Token Bucket Offline Tests...\n');

  const db = makeMockDb();
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
  db._circuitBreakers.get('test_cb').cooldown_until = pastIso;

  const probeCheck = await canExecuteCircuit(env, 'test_cb');
  assert(probeCheck.allowed === true && probeCheck.state === 'HALF_OPEN', 'T4: Cooldown expiration transitions circuit to HALF_OPEN and allows probe request');

  // --- Test 5: Probe success heals circuit to CLOSED ---
  await recordCircuitSuccess(env, 'test_cb');
  const healedStatus = await getCircuitBreakerStatus(env, 'test_cb');
  assert(healedStatus.state === 'CLOSED' && healedStatus.failure_count === 0, 'T5: Successful probe heals circuit back to CLOSED with 0 failure count');

  // --- Test 6: Probe failure in HALF_OPEN trips back to OPEN with backoff ---
  // Force back to HALF_OPEN
  db._circuitBreakers.get('test_cb').state = 'HALF_OPEN';
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
  assert(tb1.allowed === true && tb1.currentTokens === 2, 'T8: Token bucket initial consumption succeeds with capacity-1 tokens remaining');

  // --- Test 9: Rapid depletion of Token Bucket ---
  const tb2 = await consumeToken(env, tbKey, 3, 1);
  const tb3 = await consumeToken(env, tbKey, 3, 1);
  const tbExhausted = await consumeToken(env, tbKey, 3, 1);
  assert(tb2.allowed && tb3.allowed && !tbExhausted.allowed && tbExhausted.retryAfter > 0, 'T9: Consuming beyond burst capacity rejects request with positive retryAfter');

  // --- Test 10: Token Bucket refill after time elapsed ---
  // Simulate 3 seconds elapsed
  const tbEntry = db._tokenBuckets.get(tbKey);
  tbEntry.last_refill = new Date(Date.now() - 3000).toISOString();
  const tbRefilled = await consumeToken(env, tbKey, 3, 1);
  assert(tbRefilled.allowed === true, 'T10: Token bucket refills tokens after elapsed time and allows subsequent requests');

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

runTests().catch(err => {
  console.error('Unhandled test error:', err);
  process.exit(1);
});
