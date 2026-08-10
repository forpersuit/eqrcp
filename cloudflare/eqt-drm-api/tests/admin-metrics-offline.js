/**
 * Offline tests for admin metrics and prune endpoints.
 *
 * Tests:
 *   - GET /api/v1/admin/metrics returns 5 metric fields
 *   - Metrics graceful degradation on query failure
 *   - POST /api/v1/admin/system/prune deletion counts
 *
 * Build:
 *   npx esbuild src/routes/admin.ts --bundle --alias:cloudflare:sockets=./tests/mocks/cloudflare-sockets-stub.js --outfile=tests/compiled/admin-metrics.js --platform=node --format=cjs
 * Run:
 *   node tests/admin-metrics-offline.js
 */
const path = require('path');
const fs = require('fs');

const compiledPath = path.join(__dirname, 'compiled', 'admin-metrics.js');
if (!fs.existsSync(compiledPath)) {
  console.error("Compiled admin handler not found. Build with esbuild first:");
  console.error("  npx esbuild src/routes/admin.ts --bundle --alias:cloudflare:sockets=./tests/mocks/cloudflare-sockets-stub.js --outfile=tests/compiled/admin-metrics.js --platform=node --format=cjs");
  process.exit(1);
}

const { handleAdminRoutes } = require(compiledPath);

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) { passed++; console.log(`  ✓ ${msg}`); }
  else { failed++; console.error(`  ✗ ${msg}`); }
}

function assertEqual(actual, expected, msg) {
  if (actual === expected) { passed++; console.log(`  ✓ ${msg}`); }
  else { failed++; console.error(`  ✗ ${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); }
}

// --- SQL-pattern-matching D1 mock ---
// Returns configured values for matching SQL patterns, defaults for setup calls.
class MockD1 {
  constructor(rules) {
    // rules: [{ sqlMatch: string, first?: any, all?: any, run?: any }]
    this.rules = rules || [];
  }

  async batch() { return []; }

  prepare(sql) {
    const rule = this.rules.find(r => sql.includes(r.sqlMatch));
    const stmt = {
      bind: (...binds) => ({
        first: async () => {
          if (rule && rule.first !== undefined) return rule.first;
          return { count: 0 };
        },
        all: async () => {
          if (rule && rule.all !== undefined) return rule.all;
          return { results: [] };
        },
        run: async () => {
          if (rule && rule.run !== undefined) return rule.run;
          return { meta: { changes: 0 } };
        },
      }),
    };
    stmt.first = async () => { if (rule && rule.first !== undefined) return rule.first; return { count: 0 }; };
    stmt.all = async () => { if (rule && rule.all !== undefined) return rule.all; return { results: [] }; };
    stmt.run = async () => { if (rule && rule.run !== undefined) return rule.run; return { meta: { changes: 0 } }; };
    return stmt;
  }
}

// --- Mock ExecutionContext ---
function mockCtx() {
  return { waitUntil: (p) => p.catch(() => {}) };
}

// --- Mock Env ---
function makeEnv(db, overrides = {}) {
  return {
    DB: db,
    CF_ACCESS_TEAM_DOMAIN: 'local.dev',
    CF_ACCESS_AUD: 'local-dev',
    ...overrides,
  };
}

const AUTH_HEADERS = {
  'Cf-Access-Jwt-Assertion': 'local.admin@eqt.net.im',
};

// ============================================================
// Test Suite: GET /api/v1/admin/metrics
// ============================================================
console.log('\n=== GET /api/v1/admin/metrics ===');

(async () => {
  // Test 1: Returns 5 metric fields with correct types
  {
    const db = new MockD1([
      { sqlMatch: 'device_registry WHERE last_seen_at', first: { count: 42 } },
      { sqlMatch: 'FROM activations WHERE activated_at', first: { count: 100 } },
      { sqlMatch: 'JOIN device_registry', first: { count: 75 } },
      { sqlMatch: 'FROM licenses GROUP BY tier', all: { results: [{ tier: 'PLUS', count: 10 }, { tier: 'PRO', count: 5 }] } },
      { sqlMatch: "category = 'DESKTOP_CRASH'", all: { results: [{ date: '2026-08-01', count: 3 }, { date: '2026-08-02', count: 1 }] } },
      { sqlMatch: "LIKE 'RATE_LIMIT_%'", first: { count: 5 } },
    ]);
    const env = makeEnv(db);
    const request = new Request('https://lic.eqt.net.im/api/v1/admin/metrics', {
      method: 'GET',
      headers: { ...AUTH_HEADERS },
    });
    const url = new URL(request.url);
    const response = await handleAdminRoutes(request, env, mockCtx(), url, {});
    assert(!!response, 'Response is not null');
    if (response) {
      assertEqual(response.status, 200, 'Status is 200');
      const data = JSON.parse(await response.text());
      assert(data.success, 'success is true');
      assert(!!data.metrics, 'response has metrics field');
      assert(typeof data.metrics.daily_active_devices === 'number', 'daily_active_devices is number');
      assert(typeof data.metrics.activation_success_rate === 'number', 'activation_success_rate is number');
      assert(Array.isArray(data.metrics.tier_distribution), 'tier_distribution is array');
      assert(Array.isArray(data.metrics.crash_trend), 'crash_trend is array');
      assert(typeof data.metrics.rate_limit_hits_24h === 'number', 'rate_limit_hits_24h is number');
      assertEqual(data.metrics.daily_active_devices, 42, 'daily_active_devices = 42');
      assertEqual(data.metrics.activation_success_rate, 75, 'activation_success_rate = 75%');
      assertEqual(data.metrics.tier_distribution.length, 2, 'tier_distribution has 2 entries');
      assertEqual(data.metrics.crash_trend.length, 2, 'crash_trend has 2 entries');
      assertEqual(data.metrics.rate_limit_hits_24h, 5, 'rate_limit_hits_24h = 5');
    }
  }

  // Test 2: Returns partial data on query failure (graceful degradation)
  {
    // Mock that throws on the first metrics query
    const throwFirst = { count: 0 };
    const db = new MockD1([
      { sqlMatch: 'device_registry WHERE last_seen_at', first: throwFirst },
    ]);
    // Override prepare to throw when the metrics query is matched
    const origPrepare = db.prepare.bind(db);
    db.prepare = function(sql) {
      const stmt = origPrepare(sql);
      if (sql.includes('device_registry WHERE last_seen_at')) {
        const origBind = stmt.bind.bind(stmt);
        stmt.bind = (...binds) => {
          const res = origBind(...binds);
          res.first = async () => { throw new Error('D1 connection failed'); };
          return res;
        };
      }
      return stmt;
    };
    const env = makeEnv(db);
    const request = new Request('https://lic.eqt.net.im/api/v1/admin/metrics', {
      method: 'GET',
      headers: { ...AUTH_HEADERS },
    });
    const url = new URL(request.url);
    const response = await handleAdminRoutes(request, env, mockCtx(), url, {});
    assert(!!response, 'Response is not null on query failure');
    if (response) {
      assertEqual(response.status, 200, 'Status is 200 on query failure');
      const data = JSON.parse(await response.text());
      assert(data.success, 'success is true on query failure');
      assert(typeof data.metrics.daily_active_devices === 'number', 'daily_active_devices is number (degraded)');
      assertEqual(data.metrics.daily_active_devices, 0, 'daily_active_devices = 0 (degraded)');
      assert(data.metrics.activation_success_rate === null, 'activation_success_rate = null (degraded)');
      assert(Array.isArray(data.metrics.tier_distribution), 'tier_distribution is array (degraded)');
      assert(Array.isArray(data.metrics.crash_trend), 'crash_trend is array (degraded)');
      assertEqual(data.metrics.rate_limit_hits_24h, 0, 'rate_limit_hits_24h = 0 (degraded)');
    }
  }

  // ============================================================
  // Test Suite: POST /api/v1/admin/system/prune
  // ============================================================
  console.log('\n=== POST /api/v1/admin/system/prune ===');

  // Test 3: Deletes old logs and returns counts
  {
    const db = new MockD1([
      { sqlMatch: 'DELETE FROM system_error_logs', run: { meta: { changes: 5 } } },
      { sqlMatch: 'DELETE FROM admin_audit_logs', run: { meta: { changes: 3 } } },
    ]);
    const env = makeEnv(db);
    const request = new Request('https://lic.eqt.net.im/api/v1/admin/system/prune', {
      method: 'POST',
      headers: { ...AUTH_HEADERS },
    });
    const url = new URL(request.url);
    const response = await handleAdminRoutes(request, env, mockCtx(), url, {});
    assert(!!response, 'Response is not null');
    if (response) {
      assertEqual(response.status, 200, 'Status is 200');
      const data = JSON.parse(await response.text());
      assert(data.success, 'success is true');
      assertEqual(data.deleted_error_logs, 5, 'deleted_error_logs = 5');
      assertEqual(data.deleted_audit_logs, 3, 'deleted_audit_logs = 3');
      assert(data.message.includes('pruned'), 'message mentions pruned');
    }
  }

  // Test 4: Handles zero deletions gracefully
  {
    const db = new MockD1([
      { sqlMatch: 'DELETE FROM system_error_logs', run: { meta: { changes: 0 } } },
      { sqlMatch: 'DELETE FROM admin_audit_logs', run: { meta: { changes: 0 } } },
    ]);
    const env = makeEnv(db);
    const request = new Request('https://lic.eqt.net.im/api/v1/admin/system/prune', {
      method: 'POST',
      headers: { ...AUTH_HEADERS },
    });
    const url = new URL(request.url);
    const response = await handleAdminRoutes(request, env, mockCtx(), url, {});
    assert(!!response, 'Response is not null');
    if (response) {
      assertEqual(response.status, 200, 'Status is 200');
      const data = JSON.parse(await response.text());
      assertEqual(data.deleted_error_logs, 0, 'deleted_error_logs = 0');
      assertEqual(data.deleted_audit_logs, 0, 'deleted_audit_logs = 0');
    }
  }

  // ============================================================
  // Summary
  // ============================================================
  const total = passed + failed;
  console.log(`\n=== Results: ${passed}/${total} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
})();
