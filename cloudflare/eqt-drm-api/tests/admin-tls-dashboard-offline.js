/**
 * Offline Tests for Admin LAN-TLS Telemetry Dashboard and Reversible Reset
 *
 * Backed by real in-memory SQLite (node:sqlite) to guarantee:
 *  1. Zero object-reference fixture pollution (physical rows re-queried via SQL)
 *  2. True unforgeable audit logging and snapshot fidelity
 *  3. Strict isolation (R39-3 reverse case: resetting Key A never touches Key B)
 *  4. Robust authentication and fail-closed security
 */

const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const compiledAdminPath = path.join(__dirname, 'compiled', 'admin-tls.js');
if (!fs.existsSync(compiledAdminPath)) {
  console.error("Compiled admin-tls handler not found. Run esbuild first.");
  process.exit(1);
}

const { handleAdminRoutes } = require(compiledAdminPath);

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
    const schemaSql = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf-8');
    this.db.exec(schemaSql);
  }

  _mk(sql, binds) {
    return {
      all: async () => {
        try {
          const stmt = this.db.prepare(sql);
          return { results: stmt.all(...(binds || [])) };
        } catch (e) {
          return { results: [] };
        }
      },
      first: async () => {
        try {
          const stmt = this.db.prepare(sql);
          const row = stmt.get(...(binds || []));
          return row || null;
        } catch (e) {
          return null;
        }
      },
      run: async () => {
        const stmt = this.db.prepare(sql);
        const res = stmt.run(...(binds || []));
        return { success: true, meta: { changes: res.changes, last_row_id: Number(res.lastInsertRowid) } };
      }
    };
  }

  prepare(sql) {
    return {
      bind: (...args) => this._mk(sql, args),
      all: async () => this._mk(sql, []).all(),
      first: async () => this._mk(sql, []).first(),
      run: async () => this._mk(sql, []).run(),
    };
  }

  async batch(statements) {
    const results = [];
    for (const stmt of statements) {
      results.push(await stmt.run());
    }
    return results;
  }
}

async function runTests() {
  console.log('Running Admin LAN-TLS Dashboard & Reset Offline Tests (SQLite-backed)...\n');

  const d1 = new SqliteD1Mock();
  const env = {
    DB: d1,
    CF_ACCESS_TEAM_DOMAIN: 'local.dev',
    CF_ACCESS_AUD: 'local-dev',
    CF_ACCESS_ALLOWED_EMAILS: '*'
  };
  const ctx = { waitUntil: (p) => Promise.resolve(p) };
  const corsHeaders = { 'Access-Control-Allow-Origin': '*' };

  const validAuthHeader = {
    'Cf-Access-Jwt-Assertion': 'local.admin@eqt.net.im',
    'CF-Connecting-IP': '198.51.100.99'
  };

  // ── Group 1: Authentication & Authorization Fail-Closed Security ──
  {
    console.log('--- Group 1: Authentication & Authorization Fail-Closed ---');

    // T1.1: Unauthenticated GET /api/v1/admin/tls/circuit-status returns 401
    const reqStatusUnauth = new Request('http://api.test/api/v1/admin/tls/circuit-status', {
      method: 'GET'
    });
    const respStatusUnauth = await handleAdminRoutes(reqStatusUnauth, env, ctx, new URL(reqStatusUnauth.url), corsHeaders);
    assert(respStatusUnauth && respStatusUnauth.status === 401, 'T1.1: Unauthenticated GET /circuit-status is rejected with 401');

    // T1.2: Unauthenticated POST /api/v1/admin/tls/reset-rate-limit returns 401 and creates ZERO audit rows
    const reqResetUnauth = new Request('http://api.test/api/v1/admin/tls/reset-rate-limit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: 'circuit_breaker' })
    });
    const respResetUnauth = await handleAdminRoutes(reqResetUnauth, env, ctx, new URL(reqResetUnauth.url), corsHeaders);
    assert(respResetUnauth && respResetUnauth.status === 401, 'T1.2a: Unauthenticated POST /reset-rate-limit is rejected with 401');

    const auditCountUnauth = d1.db.prepare('SELECT COUNT(*) as count FROM admin_audit_logs').get().count;
    assert(auditCountUnauth === 0, 'T1.2b: Rejected unauthenticated request writes exactly ZERO admin audit rows');
  }

  // ── Group 2: Dashboard Telemetry & Metric Attribution (GET /circuit-status) ──
  {
    console.log('\n--- Group 2: Telemetry Dashboard & Attribution Metrics ---');

    const nowIso = new Date().toISOString();
    const probeUpdatedAt = new Date(Date.now() - 60000).toISOString(); // 60s ago

    // Seed circuit breaker in HALF_OPEN state (Primary GTS and Backup LE)
    d1.db.prepare(`
      INSERT INTO circuit_breakers (name, state, failure_count, success_count, cooldown_until, last_retry_after, updated_at)
      VALUES ('gts_ca', 'HALF_OPEN', 1, 42, NULL, 60, ?)
    `).run(probeUpdatedAt);
    d1.db.prepare(`
      INSERT INTO circuit_breakers (name, state, failure_count, success_count, cooldown_until, last_retry_after, updated_at)
      VALUES ('letsencrypt_ca', 'CLOSED', 0, 10, NULL, 0, ?)
    `).run(probeUpdatedAt);

    // Seed token bucket with 3.5 tokens
    d1.db.prepare(`
      INSERT INTO token_buckets (key, tokens, last_refill, capacity, refill_rate)
      VALUES ('cert_provision:acme_smoothing', 3.5, ?, 5.0, 0.1667)
    `).run(nowIso);

    // Seed 2 successful provisions with duration 120ms and 80ms (one GTS, one Let's Encrypt)
    d1.db.prepare(`
      INSERT INTO device_cert_provisions (node_id, common_name, expires_at, provisioned_at, duration_ms, ca_provider)
      VALUES ('node_001', 'node_001.direct.eqt.net.im', ?, ?, 120, 'gts')
    `).run(nowIso, nowIso);
    d1.db.prepare(`
      INSERT INTO device_cert_provisions (node_id, common_name, expires_at, provisioned_at, duration_ms, ca_provider)
      VALUES ('node_002', 'node_002.direct.eqt.net.im', ?, ?, 80, 'letsencrypt')
    `).run(nowIso, nowIso);

    // Seed system_error_logs: 1 ca_rate_limited (429) + 1 ca_5xx_error (502) + 1 other CERT_PROVISION_ERROR + 1 rate_limit hit + 1 failover
    d1.db.prepare(`
      INSERT INTO system_error_logs (category, error_message, context_json, created_at)
      VALUES ('CERT_PROVISION_ERROR', 'HTTP 429', ?, ?)
    `).run(JSON.stringify({ reason_key: 'ca_rate_limited', retry_after: 90 }), nowIso);

    d1.db.prepare(`
      INSERT INTO system_error_logs (category, error_message, context_json, created_at)
      VALUES ('CERT_PROVISION_ERROR', 'HTTP 502', ?, ?)
    `).run(JSON.stringify({ reason_key: 'ca_5xx_error', status_code: 502 }), nowIso);

    d1.db.prepare(`
      INSERT INTO system_error_logs (category, error_message, context_json, created_at)
      VALUES ('CERT_PROVISION_ERROR', 'Internal error', ?, ?)
    `).run(JSON.stringify({ reason_key: 'internal_error', error: 'crypto error' }), nowIso);

    d1.db.prepare(`
      INSERT INTO system_error_logs (category, error_message, context_json, created_at)
      VALUES ('RATE_LIMIT_CERT_PROVISION', 'Rate limit hit', ?, ?)
    `).run(JSON.stringify({ node_id: 'node_blocked' }), nowIso);

    d1.db.prepare(`
      INSERT INTO system_error_logs (category, error_message, context_json, created_at)
      VALUES ('CERT_PROVISION_FAILOVER', 'Pre-flight failover', ?, ?)
    `).run(JSON.stringify({ trigger: 'preflight_circuit_open', from_ca: 'gts_ca', to_ca: 'letsencrypt_ca' }), nowIso);

    // Query status endpoint with admin auth
    const reqStatus = new Request('http://api.test/api/v1/admin/tls/circuit-status', {
      method: 'GET',
      headers: validAuthHeader
    });
    const respStatus = await handleAdminRoutes(reqStatus, env, ctx, new URL(reqStatus.url), corsHeaders);
    assert(respStatus && respStatus.status === 200, 'T2.1: Authenticated GET /circuit-status returns 200 OK');

    const data = await respStatus.json();
    assert(data.ok === true, 'T2.2a: Dashboard payload reports ok: true');
    assert(data.circuit_breaker && data.circuit_breaker.state === 'HALF_OPEN', 'T2.2b: Circuit breaker reports current state HALF_OPEN');
    assert(data.backup_circuit_breaker && data.backup_circuit_breaker.name === 'letsencrypt_ca' && data.backup_circuit_breaker.success_count === 10, 'T2.2b2: Backup circuit breaker reports letsencrypt_ca in CLOSED state with success_count=10');
    assert(data.token_bucket && data.token_bucket.tokens === 3.5, 'T2.2c: Token bucket accurately reflects available tokens (3.5)');

    // Verify 24h Metrics & Attribution
    const m = data.metrics_24h;
    assert(m && m.provisions_success === 2, `T2.3a: 24h successful provisions count matches D1 records (expected 2, got ${m.provisions_success})`);
    assert(m && m.avg_duration_ms === 100, `T2.3b: 24h average issuance duration accurately calculated (expected 100ms, got ${m.avg_duration_ms}ms)`);
    assert(m && m.trip_reasons.ca_rate_limited === 1, `T2.3c: Trip attribution tracks exactly 1 ca_rate_limited`);
    assert(m && m.trip_reasons.ca_5xx_error === 1, `T2.3d: Trip attribution tracks exactly 1 ca_5xx_error (distinguished from internal_error)`);
    assert(m && m.trip_reasons.other_cert_errors === 1, `T2.3d2: Trip attribution tracks exactly 1 other_cert_errors`);
    assert(m && m.total_attempts === 5, `T2.3e1: Total attempts matches sum of provisions and all trip reasons (expected 5, got ${m.total_attempts})`);
    assert(
      m.total_attempts === m.provisions_success + m.trip_reasons.ca_rate_limited + m.trip_reasons.ca_5xx_error + m.trip_reasons.other_cert_errors,
      'T2.3e2: Strict reconciliation: total_attempts equals provisions_success + all trip reasons'
    );
    assert(m && m.success_rate === 0.4, `T2.3e3: Accurate success rate calculation 2/5 = 0.4 (got ${m.success_rate})`);
    assert(m && m.rate_limit_hits === 1, `T2.3f: Rate limit hits tracked accurately (1)`);
    assert(m && m.failover_events === 1, `T2.3g: Failover events tracked accurately (1)`);
    assert(m && m.by_ca_provider && m.by_ca_provider.gts === 1 && m.by_ca_provider.letsencrypt === 1, `T2.3h: 24h provisions accurately grouped by ca_provider (gts: 1, letsencrypt: 1)`);

    // T2.4: Empty database baseline returns null success_rate instead of false 100% (R44-9)
    const emptyD1 = new SqliteD1Mock();
    const reqEmpty = new Request('http://api.test/api/v1/admin/tls/circuit-status', {
      method: 'GET',
      headers: validAuthHeader
    });
    const respEmpty = await handleAdminRoutes(reqEmpty, { ...env, DB: emptyD1 }, ctx, new URL(reqEmpty.url), corsHeaders);
    const dataEmpty = await respEmpty.json();
    assert(dataEmpty.metrics_24h.total_attempts === 0, 'T2.4a: Zero attempts when no records exist');
    assert(dataEmpty.metrics_24h.success_rate === null, 'T2.4b: success_rate falls back to null when total_attempts is 0 (prevents false 100% green)');
    assert(dataEmpty.metrics_24h.avg_duration_ms === null, 'T2.4c: avg_duration_ms falls back to null when no provisions exist');
  }

  // ── Group 3: Reversible Break-Glass Circuit Breaker Reset & Audit ──
  {
    console.log('\n--- Group 3: Reversible Break-Glass Circuit Breaker Reset ---');

    // Force circuit into tripped OPEN state with failure_count=3 and cooldown_until in the future
    const futureIso = new Date(Date.now() + 300000).toISOString();
    d1.db.prepare(`
      UPDATE circuit_breakers
      SET state = 'OPEN', failure_count = 3, cooldown_until = ?, last_retry_after = 90
      WHERE name = 'gts_ca'
    `).run(futureIso);

    const auditCountBefore = d1.db.prepare('SELECT COUNT(*) as count FROM admin_audit_logs').get().count;

    // Send reset request
    const reqResetCb = new Request('http://api.test/api/v1/admin/tls/reset-rate-limit', {
      method: 'POST',
      headers: { ...validAuthHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: 'circuit_breaker' })
    });
    const respResetCb = await handleAdminRoutes(reqResetCb, env, ctx, new URL(reqResetCb.url), corsHeaders);
    assert(respResetCb && respResetCb.status === 200, 'T3.1: Admin POST /reset-rate-limit for circuit_breaker returns 200 OK');

    // Physical verification: re-query SQLite directly (NO object-reference fixtures!)
    const freshCbRow = d1.db.prepare(
      'SELECT state, failure_count, cooldown_until, last_retry_after FROM circuit_breakers WHERE name = ?'
    ).get('gts_ca');

    assert(
      freshCbRow &&
      freshCbRow.state === 'CLOSED' &&
      freshCbRow.failure_count === 0 &&
      freshCbRow.cooldown_until === null &&
      freshCbRow.last_retry_after === 0,
      'T3.2: Circuit breaker physically restored to pristine CLOSED state (failure_count=0, cooldown=NULL)'
    );

    // Audit verification: verify exactly 1 new audit log with complete previous state snapshot
    const auditRows = d1.db.prepare(
      'SELECT * FROM admin_audit_logs ORDER BY id DESC LIMIT 1'
    ).all();
    const auditCountAfter = d1.db.prepare('SELECT COUNT(*) as count FROM admin_audit_logs').get().count;

    assert(auditCountAfter === auditCountBefore + 1, 'T3.3a: Exactly 1 audit record written to admin_audit_logs');
    const auditEntry = auditRows[0];
    assert(
      auditEntry &&
      auditEntry.action === 'RESET_CIRCUIT_BREAKER' &&
      auditEntry.target_type === 'TLS_CIRCUIT' &&
      auditEntry.target_id === 'gts_ca' &&
      auditEntry.operator_ip === '198.51.100.99',
      'T3.3b: Audit entry contains correct action, target_type, target_id, and operator_ip'
    );
    const auditDetails = JSON.parse(auditEntry.details_json);
    assert(
      auditDetails.previous_state === 'OPEN' &&
      auditDetails.previous_failure_count === 3 &&
      auditDetails.new_state === 'CLOSED',
      'T3.3c: Audit details captured full forensic snapshot of previous state and transition'
    );
  }

  // ── Group 4: Rate Limit Reset & Strict Isolation (R39-3 Reverse Test) ──
  {
    console.log('\n--- Group 4: Rate Limit Reset & Strict Isolation (R39-3 Reverse) ---');

    const nowIso = new Date().toISOString();

    // Pre-seed rate limits:
    // Node A (full 3/24h), Node B (full 3/24h), IP X (full 10/24h)
    d1.db.prepare(`
      INSERT INTO rate_limits (key, count, window_start) VALUES
      ('cert_provision:aa0000000001', 3, ?),
      ('cert_provision:aa0000000002', 3, ?),
      ('cert_provision:ip:203.0.113.50', 10, ?)
    `).run(nowIso, nowIso, nowIso);

    // Reset only Node A
    const reqResetNodeA = new Request('http://api.test/api/v1/admin/tls/reset-rate-limit', {
      method: 'POST',
      headers: { ...validAuthHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: 'node_rate_limit', key: 'aa0000000001' })
    });
    const respResetNodeA = await handleAdminRoutes(reqResetNodeA, env, ctx, new URL(reqResetNodeA.url), corsHeaders);
    assert(respResetNodeA && respResetNodeA.status === 200, 'T4.1: Reset node rate limit for aa0000000001 returns 200 OK');

    // Physical row verification: Node A deleted
    const rowNodeA = d1.db.prepare("SELECT * FROM rate_limits WHERE key = 'cert_provision:aa0000000001'").get();
    assert(rowNodeA === undefined, 'T4.2: Rate limit row for aa0000000001 physically deleted (resets to 0 count)');

    // Strict Isolation Verification (R39-3 Reverse Test):
    // Node B must NOT be modified (count remains 3)
    const rowNodeB = d1.db.prepare("SELECT count FROM rate_limits WHERE key = 'cert_provision:aa0000000002'").get();
    assert(rowNodeB && rowNodeB.count === 3, 'T4.3a: R39-3 Strict Isolation: Unrelated aa0000000002 count is strictly preserved at 3');

    // IP X must NOT be modified (count remains 10)
    const rowIp = d1.db.prepare("SELECT count FROM rate_limits WHERE key = 'cert_provision:ip:203.0.113.50'").get();
    assert(rowIp && rowIp.count === 10, 'T4.3b: R39-3 Strict Isolation: Unrelated IP limit is strictly preserved at 10');

    // Reset IP limit for 203.0.113.50
    const reqResetIp = new Request('http://api.test/api/v1/admin/tls/reset-rate-limit', {
      method: 'POST',
      headers: { ...validAuthHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: 'ip_rate_limit', key: '203.0.113.50' })
    });
    const respResetIp = await handleAdminRoutes(reqResetIp, env, ctx, new URL(reqResetIp.url), corsHeaders);
    assert(respResetIp && respResetIp.status === 200, 'T4.4: Reset IP rate limit for 203.0.113.50 returns 200 OK');

    const rowIpAfter = d1.db.prepare("SELECT * FROM rate_limits WHERE key = 'cert_provision:ip:203.0.113.50'").get();
    assert(rowIpAfter === undefined, 'T4.5: IP rate limit physically cleared from D1');

    // T4.6: Reset non-existent key returns existed:false and clear message (R44-7)
    const reqResetNonExistent = new Request('http://api.test/api/v1/admin/tls/reset-rate-limit', {
      method: 'POST',
      headers: { ...validAuthHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: 'node_rate_limit', key: 'ee0000000000' })
    });
    const respResetNonExistent = await handleAdminRoutes(reqResetNonExistent, env, ctx, new URL(reqResetNonExistent.url), corsHeaders);
    assert(respResetNonExistent && respResetNonExistent.status === 200, 'T4.6a: Reset non-existent key returns 200 OK');
    const dataNonExistent = await respResetNonExistent.json();
    assert(dataNonExistent.existed === false, 'T4.6b: Non-existent key reports existed: false');
    assert(
      dataNonExistent.message && dataNonExistent.message.includes('was not active (already clear)'),
      'T4.6c: Message accurately describes key was not active instead of misleading successfully reset'
    );
    const auditNonExistent = d1.db.prepare("SELECT details_json FROM admin_audit_logs WHERE target_id = 'cert_provision:ee0000000000'").get();
    assert(
      auditNonExistent && JSON.parse(auditNonExistent.details_json).existed === false,
      'T4.6d: Audit log records existed: false snapshot for non-existent key reset'
    );

    // T4.7: F1 Reverse Proof: Reset with UPPERCASE node ID must clear lowercase D1 row and report existed: true
    d1.db.prepare(`
      INSERT INTO rate_limits (key, count, window_start) VALUES
      ('cert_provision:bb0000000001', 3, ?)
    `).run(nowIso);

    const reqUppercaseNode = new Request('http://api.test/api/v1/admin/tls/reset-rate-limit', {
      method: 'POST',
      headers: { ...validAuthHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: 'node_rate_limit', key: 'BB0000000001' })
    });
    const respUppercaseNode = await handleAdminRoutes(reqUppercaseNode, env, ctx, new URL(reqUppercaseNode.url), corsHeaders);
    assert(respUppercaseNode && respUppercaseNode.status === 200, 'T4.7a: Reset with uppercase Node ID returns 200 OK');
    const dataUppercase = await respUppercaseNode.json();
    assert(dataUppercase.existed === true, 'T4.7b: Uppercase Node ID reset successfully clears existing lowercase row (existed: true)');

    const rowUppercaseCleared = d1.db.prepare("SELECT * FROM rate_limits WHERE key = 'cert_provision:bb0000000001'").get();
    assert(rowUppercaseCleared === undefined, 'T4.7c: Physical row cert_provision:bb0000000001 confirmed deleted from D1');

    const auditUppercase = d1.db.prepare("SELECT details_json FROM admin_audit_logs WHERE target_id = 'cert_provision:bb0000000001' ORDER BY id DESC LIMIT 1").get();
    assert(
      auditUppercase && JSON.parse(auditUppercase.details_json).target_node_id === 'bb0000000001',
      'T4.7d: Audit log normalizes target_node_id to lowercase bb0000000001'
    );
  }

  // ── Group 5: Parameter Validation & Guardrails ──
  {
    console.log('\n--- Group 5: Parameter Validation & Edge Guardrails ---');

    // T5.1: Missing target
    const reqNoTarget = new Request('http://api.test/api/v1/admin/tls/reset-rate-limit', {
      method: 'POST',
      headers: { ...validAuthHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    const respNoTarget = await handleAdminRoutes(reqNoTarget, env, ctx, new URL(reqNoTarget.url), corsHeaders);
    assert(respNoTarget && respNoTarget.status === 400, 'T5.1: POST /reset-rate-limit without target returns 400 Bad Request');

    // T5.2: node_rate_limit without key
    const reqNoKey = new Request('http://api.test/api/v1/admin/tls/reset-rate-limit', {
      method: 'POST',
      headers: { ...validAuthHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: 'node_rate_limit' })
    });
    const respNoKey = await handleAdminRoutes(reqNoKey, env, ctx, new URL(reqNoKey.url), corsHeaders);
    assert(respNoKey && respNoKey.status === 400, 'T5.2: POST /reset-rate-limit with node_rate_limit but no key returns 400 Bad Request');

    // T5.3: F2 Guardrail: circuit_breaker with unknown/residual name returns 400 and creates NO rows
    const reqBadCircuit = new Request('http://api.test/api/v1/admin/tls/reset-rate-limit', {
      method: 'POST',
      headers: { ...validAuthHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: 'circuit_breaker', key: 'bb0000000001' })
    });
    const respBadCircuit = await handleAdminRoutes(reqBadCircuit, env, ctx, new URL(reqBadCircuit.url), corsHeaders);
    assert(respBadCircuit && respBadCircuit.status === 400, 'T5.3a: Reset circuit_breaker with unknown name is rejected with 400');
    const ghostRow = d1.db.prepare("SELECT * FROM circuit_breakers WHERE name = 'bb0000000001'").get();
    assert(ghostRow === undefined, 'T5.3b: No ghost circuit breaker row created for invalid name');

    // T5.4: F4 Guardrail: ip_rate_limit with invalid IPv4 (octet > 255) returns 400
    const reqBadIpV4 = new Request('http://api.test/api/v1/admin/tls/reset-rate-limit', {
      method: 'POST',
      headers: { ...validAuthHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: 'ip_rate_limit', key: '999.999.999.999' })
    });
    const respBadIpV4 = await handleAdminRoutes(reqBadIpV4, env, ctx, new URL(reqBadIpV4.url), corsHeaders);
    assert(respBadIpV4 && respBadIpV4.status === 400, 'T5.4: Reset IP rate limit with invalid IPv4 999.999.999.999 returns 400');

    // T5.5: F4 Guardrail: ip_rate_limit with invalid IPv6 (:::) returns 400
    const reqBadIpV6 = new Request('http://api.test/api/v1/admin/tls/reset-rate-limit', {
      method: 'POST',
      headers: { ...validAuthHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: 'ip_rate_limit', key: ':::' })
    });
    const respBadIpV6 = await handleAdminRoutes(reqBadIpV6, env, ctx, new URL(reqBadIpV6.url), corsHeaders);
    assert(respBadIpV6 && respBadIpV6.status === 400, 'T5.5: Reset IP rate limit with invalid IPv6 ::: returns 400');

    // T5.6: Invalid node_id format (non-12 hex) returns 400
    const reqBadNodeId = new Request('http://api.test/api/v1/admin/tls/reset-rate-limit', {
      method: 'POST',
      headers: { ...validAuthHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: 'node_rate_limit', key: 'not_a_valid_hex' })
    });
    const respBadNodeId = await handleAdminRoutes(reqBadNodeId, env, ctx, new URL(reqBadNodeId.url), corsHeaders);
    assert(respBadNodeId && respBadNodeId.status === 400, 'T5.6: Reset node rate limit with invalid non-hex key returns 400');
  }

  console.log(`\n============================================================`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log(`============================================================`);

  if (failed > 0) process.exit(1);
}

runTests().catch(err => {
  console.error('Unhandled test execution error:', err);
  process.exit(1);
});
