/**
 * Offline tests for health check endpoint.
 *
 * Tests:
 *   - D1 connectivity probe (SELECT 1)
 *   - Returns healthy/degraded status based on probe results
 *   - Returns metrics and recent events
 *
 * Build:
 *   npx esbuild src/routes/admin.ts --bundle --alias:cloudflare:sockets=./tests/mocks/cloudflare-sockets-stub.js --outfile=tests/compiled/admin-metrics.js --platform=node --format=cjs
 * Run:
 *   node tests/health-check-offline.js
 */
const path = require('path');
const fs = require('fs');

const compiledPath = path.join(__dirname, 'compiled', 'admin-metrics.js');
if (!fs.existsSync(compiledPath)) {
  console.error("Compiled admin handler not found. Build with esbuild first.");
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
class MockD1 {
  constructor(rules) {
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

function makeEnv(db, overrides = {}) {
  return {
    DB: db,
    CF_ACCESS_TEAM_DOMAIN: 'local.dev',
    CF_ACCESS_AUD: 'local-dev',
    MAIL_SENDER: 'test@eqt.net.im',
    MAIL_SENDER_PASSWORD: 'test-pass',
    MAIL_SEND_SERVER: 'smtp.test.com',
    PADDLE_WEBHOOK_SECRET: 'test-secret',
    R2_PUBLIC_URL: 'https://r2.test.com',
    ...overrides,
  };
}

const AUTH_HEADERS = {
  'Cf-Access-Jwt-Assertion': 'local.admin@eqt.net.im',
};

function mockCtx() {
  return { waitUntil: (p) => p.catch(() => {}) };
}

// ============================================================
// Test Suite: GET /api/v1/admin/health
// ============================================================
console.log('\n=== GET /api/v1/admin/health ===');

(async () => {
  // Test 1: Returns healthy status when D1 is connected
  {
    const db = new MockD1([
      { sqlMatch: 'FROM licenses WHERE status', first: { count: 30 } },
      { sqlMatch: 'SELECT count(*) as count FROM licenses', first: { count: 50 } },
      { sqlMatch: 'FROM activations WHERE activated_at', first: { count: 10 } },
      { sqlMatch: 'FROM system_error_logs WHERE created_at', first: { count: 5 } },
      { sqlMatch: 'SELECT count(*) as count FROM system_error_logs', first: { count: 100 } },
      { sqlMatch: 'SELECT 1 as ok', first: { ok: true } },
      { sqlMatch: 'PADDLE_WEBHOOK', all: { results: [
        { id: 1, level: 'ERROR', category: 'SMTP_ERROR', error_message: 'smtp failed', created_at: '2026-08-05T10:00:00Z' },
      ] } },
    ]);
    const env = makeEnv(db);
    const request = new Request('https://lic.eqt.net.im/api/v1/admin/health', {
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
      assertEqual(data.status, 'healthy', 'status is healthy');
      assert(!!data.metrics, 'response has metrics');
      assertEqual(data.metrics.total_licenses, 50, 'total_licenses = 50');
      assertEqual(data.metrics.active_licenses, 30, 'active_licenses = 30');
      assertEqual(data.metrics.today_activations, 10, 'today_activations = 10');
      assertEqual(data.metrics.total_error_logs, 100, 'total_error_logs = 100');
      assertEqual(data.metrics.errors_24h, 5, 'errors_24h = 5');
      assert(!!data.probes, 'response has probes');
      assert(data.probes.db.ok, 'db probe is ok');
      assert(typeof data.probes.db.latency_ms === 'number', 'db probe has latency_ms');
      assert(Array.isArray(data.recent_events), 'recent_events is array');
      assert(data.recent_events.length >= 1, 'recent_events has entries');
    }
  }

  // Test 2: Returns degraded status when D1 probe fails
  {
    const db = new MockD1([
      { sqlMatch: 'SELECT count(*) as count FROM licenses', first: { count: 0 } },
      { sqlMatch: "FROM licenses WHERE status", first: { count: 0 } },
      { sqlMatch: 'FROM activations WHERE activated_at', first: { count: 0 } },
      { sqlMatch: 'SELECT count(*) as count FROM system_error_logs', first: { count: 0 } },
      { sqlMatch: 'FROM system_error_logs WHERE created_at', first: { count: 0 } },
    ]);
    // Make the SELECT 1 probe throw
    const origPrepare = db.prepare.bind(db);
    db.prepare = function(sql) {
      const stmt = origPrepare(sql);
      if (sql.includes('SELECT 1 as ok')) {
        stmt.first = async () => { throw new Error('D1 connection failed'); };
      }
      return stmt;
    };
    const env = makeEnv(db);
    const request = new Request('https://lic.eqt.net.im/api/v1/admin/health', {
      method: 'GET',
      headers: { ...AUTH_HEADERS },
    });
    const url = new URL(request.url);
    const response = await handleAdminRoutes(request, env, mockCtx(), url, {});
    assert(!!response, 'Response is not null');
    if (response) {
      assertEqual(response.status, 200, 'Status is 200');
      const data = JSON.parse(await response.text());
      assertEqual(data.status, 'degraded', 'status is degraded when D1 probe fails');
    }
  }

  // Test 3: Handles D1 query failure gracefully (catch block)
  {
    const db = new MockD1([]);
    // Override prepare to throw on the licenses count query
    const origPrepare = db.prepare.bind(db);
    db.prepare = function(sql) {
      const stmt = origPrepare(sql);
      if (sql.includes('SELECT count(*) as count FROM licenses')) {
        const origBind = stmt.bind.bind(stmt);
        stmt.bind = (...binds) => {
          const res = origBind(...binds);
          res.first = async () => { throw new Error('D1 error'); };
          return res;
        };
      }
      return stmt;
    };
    const env = makeEnv(db);
    const request = new Request('https://lic.eqt.net.im/api/v1/admin/health', {
      method: 'GET',
      headers: { ...AUTH_HEADERS },
    });
    const url = new URL(request.url);
    const response = await handleAdminRoutes(request, env, mockCtx(), url, {});
    assert(!!response, 'Response is not null on D1 error');
    if (response) {
      assertEqual(response.status, 200, 'Status is 200 on D1 error');
      const data = JSON.parse(await response.text());
      assert(data.success, 'success is true on D1 error');
      assertEqual(data.metrics.total_licenses, 0, 'total_licenses defaults to 0 on error');
      assertEqual(data.metrics.active_licenses, 0, 'active_licenses defaults to 0 on error');
    }
  }

  // Test 4: Returns config flags correctly
  {
    const db = new MockD1([
      { sqlMatch: 'SELECT count(*) as count FROM licenses', first: { count: 0 } },
      { sqlMatch: "WHERE status = 'active'", first: { count: 0 } },
      { sqlMatch: 'FROM activations WHERE activated_at', first: { count: 0 } },
      { sqlMatch: 'SELECT count(*) as count FROM system_error_logs', first: { count: 0 } },
      { sqlMatch: 'WHERE created_at >=', first: { count: 0 } },
      { sqlMatch: 'SELECT 1 as ok', first: { ok: true } },
    ]);
    const env = makeEnv(db, {
      MAIL_SENDER: undefined,
      MAIL_SENDER_PASSWORD: undefined,
      MAIL_SEND_SERVER: undefined,
      PADDLE_WEBHOOK_SECRET: undefined,
      R2_PUBLIC_URL: undefined,
      ED25519_PRIVATE_KEY: 'test-key',
    });
    const request = new Request('https://lic.eqt.net.im/api/v1/admin/health', {
      method: 'GET',
      headers: { ...AUTH_HEADERS },
    });
    const url = new URL(request.url);
    const response = await handleAdminRoutes(request, env, mockCtx(), url, {});
    assert(!!response, 'Response is not null');
    if (response) {
      const data = JSON.parse(await response.text());
      assert(!data.config.smtp_configured, 'smtp_configured is false when MAIL_* missing');
      assert(!data.config.paddle_configured, 'paddle_configured is false when PADDLE_WEBHOOK_SECRET missing');
      assert(!data.config.r2_configured, 'r2_configured is false when R2_PUBLIC_URL missing');
      assert(data.config.ed25519_key_configured, 'ed25519_key_configured is true when key present');
    }
  }

  // ============================================================
  // Summary
  // ============================================================
  const total = passed + failed;
  console.log(`\n=== Results: ${passed}/${total} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
})();
