/**
 * Offline test for POST /api/v1/user/toggle-auto-renew against a real Paddle subscription.
 *
 * Regression guard for the auto-renew "off then back on" bug: turning auto-renew back ON
 * must clear the Paddle-side scheduled cancel (PATCH subscriptions/{id} scheduled_change:null),
 * otherwise the subscription still dies at the end of the billing period while the UI
 * claims auto-renew is enabled.
 *
 * Runs the REAL bundled handlePortalRoutes against an in-memory SQLite (node:sqlite)
 * backed D1 mock, with global.fetch stubbed to capture the Paddle calls.
 */
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const compiledPortalPath = path.join(__dirname, 'compiled', 'portal.js');
if (!fs.existsSync(compiledPortalPath)) {
  console.error("Compiled portal handler not found. Build with esbuild first.");
  process.exit(1);
}
const { handlePortalRoutes } = require(compiledPortalPath);

function assert(cond, msg) {
  if (!cond) throw new Error('ASSERT FAIL: ' + msg);
  console.log('  ✓ OK:', msg);
}

class SqliteD1Mock {
  constructor() {
    this.db = new DatabaseSync(':memory:');
    this.db.exec('PRAGMA foreign_keys = OFF');
  }
  _mk(sql, binds) {
    return {
      all: async () => ({ results: this.db.prepare(sql).all(...binds) }),
      first: async () => {
        const rows = this.db.prepare(sql).all(...binds);
        return rows.length ? rows[0] : null;
      },
      run: async () => {
        const info = this.db.prepare(sql).run(...binds);
        return { meta: { changes: Number(info.changes) } };
      },
      __sql: sql,
      __binds: binds
    };
  }
  prepare(sql) {
    const base = this._mk(sql, []);
    base.bind = (...binds) => this._mk(sql, binds);
    return base;
  }
  async batch(stmts) {
    let changes = 0;
    for (const s of stmts) {
      const info = this.db.prepare(s.__sql).run(...(s.__binds || []));
      changes += Number(info.changes);
    }
    return [{ meta: { changes } }];
  }
}

async function run() {
  console.log('=== Running Portal Toggle Auto-Renew Offline Tests ===\n');

  const d1 = new SqliteD1Mock();
  const schemaSql = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
  d1.db.exec(schemaSql);

  const testEmail = 'sub@example.com';
  const testToken = 'sub-toggle-session-token-12345';
  const subId = 'sub_01m0pby2pbx0fkwzsakvgr3ev2';
  const txnId = 'txn_01m0pb3za53w93zzq5feabqs9d';
  const expiresAt = new Date(Date.now() + 86400 * 1000).toISOString();

  d1.db.prepare(`
    INSERT INTO user_sessions (session_token, email, expires_at)
    VALUES (?, ?, ?)
  `).run(testToken, testEmail, expiresAt);

  d1.db.prepare(`
    INSERT INTO licenses (license_code, tier, max_devices, buyer_email, created_at, status, source, paddle_subscription_id, paddle_transaction_id, auto_renew)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'EQT-PLUS-20260823-SUBTEST-0000', 'PLUS', 2, testEmail,
    new Date().toISOString(), 'active', 'purchase', subId, txnId, 1
  );

  const env = {
    DB: d1,
    ENVIRONMENT: 'production',
    JWT_SECRET: 'test-secret',
    ED25519_PRIVATE_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    PADDLE_API_KEY: 'pdl_live_0000000000000000000000000000000000000000000000'
  };
  const ctx = { waitUntil: (p) => Promise.resolve(p) };
  const corsHeaders = { 'Access-Control-Allow-Origin': '*' };

  // Stub global.fetch to capture Paddle calls (live base url, NOT sandbox).
  const paddleCalls = [];
  const origFetch = global.fetch;
  global.fetch = async (url, init) => {
    paddleCalls.push({ url: String(url), method: init && init.method, body: init && init.body });
    return { ok: true, status: 200, text: async () => '{}' };
  };

  async function toggle(autoRenew) {
    const url = new URL('https://lic.eqt.net.im/api/v1/user/toggle-auto-renew');
    const req = new Request(url.toString(), {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${testToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ license_code: 'EQT-PLUS-20260823-SUBTEST-0000', auto_renew: autoRenew, lang: 'en' })
    });
    const res = await handlePortalRoutes(req, env, ctx, url, corsHeaders);
    return res;
  }

  function rowAutoRenew() {
    return d1.db.prepare('SELECT auto_renew FROM licenses WHERE license_code = ?')
      .get('EQT-PLUS-20260823-SUBTEST-0000').auto_renew;
  }

  try {
    // TEST 1: Toggle OFF → Paddle POST cancel (next_billing_period), D1 auto_renew=0
    {
      console.log('[Test 1] Toggle auto-renew OFF');
      paddleCalls.length = 0;
      const res = await toggle(false);
      assert(res.status === 200, 'Response status is 200');
      const body = await res.json();
      assert(body.success === true && body.auto_renew === 0, 'Response success + auto_renew=0');
      assert(paddleCalls.length === 1, 'Exactly 1 Paddle call issued');
      const call = paddleCalls[0];
      assert(call.method === 'POST', 'Paddle call method is POST');
      assert(call.url === `https://api.paddle.com/subscriptions/${subId}/cancel`, 'Paddle cancel URL matches');
      assert(JSON.parse(call.body).effective_from === 'next_billing_period', 'Paddle cancel effective_from = next_billing_period');
      assert(rowAutoRenew() === 0, 'D1 auto_renew is 0');
    }

    // TEST 2: Toggle ON → Paddle PATCH subscriptions/{id} scheduled_change:null, D1 auto_renew=1
    {
      console.log('[Test 2] Toggle auto-renew ON (must clear Paddle scheduled cancel)');
      paddleCalls.length = 0;
      const res = await toggle(true);
      assert(res.status === 200, 'Response status is 200');
      const body = await res.json();
      assert(body.success === true && body.auto_renew === 1, 'Response success + auto_renew=1');
      assert(paddleCalls.length === 1, 'Exactly 1 Paddle call issued');
      const call = paddleCalls[0];
      assert(call.method === 'PATCH', 'Paddle call method is PATCH');
      assert(call.url === `https://api.paddle.com/subscriptions/${subId}`, 'Paddle PATCH URL matches');
      assert(JSON.parse(call.body).scheduled_change === null, 'Paddle PATCH scheduled_change = null');
      assert(rowAutoRenew() === 1, 'D1 auto_renew is 1');
    }

    // TEST 3: Non-purchase license → 403, no Paddle call, no state change
    {
      console.log('[Test 3] Toggle on non-purchase license is rejected');
      d1.db.prepare(`
        INSERT INTO licenses (license_code, tier, max_devices, buyer_email, created_at, status, source, auto_renew)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run('EQT-PLUS-20260823-ADMINSUB-0000', 'PLUS', 2, testEmail,
        new Date().toISOString(), 'active', 'admin', 1);
      paddleCalls.length = 0;
      const url = new URL('https://lic.eqt.net.im/api/v1/user/toggle-auto-renew');
      const req = new Request(url.toString(), {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${testToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ license_code: 'EQT-PLUS-20260823-ADMINSUB-0000', auto_renew: false, lang: 'en' })
      });
      const res = await handlePortalRoutes(req, env, ctx, url, corsHeaders);
      assert(res.status === 403, 'Response status is 403');
      assert(paddleCalls.length === 0, 'No Paddle call issued for non-purchase license');
    }
  } finally {
    global.fetch = origFetch;
  }

  console.log('\n============================================================');
  console.log('All 3 Portal Toggle Auto-Renew Offline Tests PASSED!');
  console.log('============================================================');
}

run().catch(err => {
  console.error('Test failed with error:', err);
  process.exit(1);
});
