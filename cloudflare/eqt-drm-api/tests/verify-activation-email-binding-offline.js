/**
 * Offline test suite for Unified License Activation & Email Binding
 * (Promo/Gift/Test code first-activation email challenge, OTP send/verify,
 * atomic DB binding, and sandbox dual-channel matching).
 */

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const authRoutePath = path.join(__dirname, 'compiled', 'auth-routes.js');
const drmRoutePath = path.join(__dirname, 'compiled', 'drm.js');

if (!fs.existsSync(authRoutePath) || !fs.existsSync(drmRoutePath)) {
  console.error('Compiled routes not found. Run esbuild first.');
  process.exit(1);
}

const { handleAuthRoutes } = require(authRoutePath);
const { handleDrmRoutes } = require(drmRoutePath);

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    console.error(`  ✗ ${msg}`);
  }
}

function assertEqual(actual, expected, msg) {
  if (actual === expected) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    console.error(`  ✗ ${msg} (expected: ${expected}, got: ${actual})`);
  }
}

// Minimal SQLite D1 wrapper
class SqliteD1Mock {
  constructor() {
    this.db = new DatabaseSync(':memory:');
    this.db.exec('PRAGMA foreign_keys = OFF');
  }

  _mk(sql, binds) {
    return {
      all: async () => {
        const rows = this.db.prepare(sql).all(...binds);
        return { results: rows || [] };
      },
      first: async () => {
        const rows = this.db.prepare(sql).all(...binds);
        return rows.length ? rows[0] : null;
      },
      run: async () => {
        const info = this.db.prepare(sql).run(...binds);
        return {
          meta: {
            changes: Number(info.changes),
            last_row_id: Number(info.lastInsertRowid)
          }
        };
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
    const results = [];
    for (const s of stmts) {
      const info = this.db.prepare(s.__sql).run(...(s.__binds || []));
      results.push({
        meta: {
          changes: Number(info.changes),
          last_row_id: Number(info.lastInsertRowid)
        }
      });
    }
    return results;
  }
}

async function runTests() {
  console.log('============================================================');
  console.log('🧪 Unified Activation & Email Binding Offline Tests');
  console.log('============================================================\n');

  const mockD1 = new SqliteD1Mock();
  const schemaSql = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
  mockD1.db.exec(schemaSql);

  const testEnv = {
    DB: mockD1,
    ED25519_PRIVATE_KEY: '8d97c60e4f66e2fb7a2b72738aee392620ba20339a328ffd563da816c9c2b883',
    ENVIRONMENT: 'production'
  };

  const dummyCtx = { waitUntil: (p) => Promise.resolve(p) };
  const corsHeaders = { 'Access-Control-Allow-Origin': '*' };

  async function callAuth(method, path, body = null, env = testEnv) {
    const base = env.ENVIRONMENT === 'production' ? 'https://lic.eqt.net.im' : 'http://localhost';
    const url = new URL(path, base);
    const req = new Request(url.toString(), {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : null
    });
    const res = await handleAuthRoutes(req, env, dummyCtx, url, corsHeaders);
    if (!res) throw new Error(`Auth Route not handled: ${method} ${path}`);
    const json = await res.json();
    return { status: res.status, json };
  }

  async function callDrm(method, path, body = null, env = testEnv) {
    const base = env.ENVIRONMENT === 'production' ? 'https://lic.eqt.net.im' : 'http://localhost';
    const url = new URL(path, base);
    const req = new Request(url.toString(), {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : null
    });
    const res = await handleDrmRoutes(req, env, dummyCtx, url, corsHeaders);
    if (!res) throw new Error(`DRM Route not handled: ${method} ${path}`);
    const json = await res.json();
    return { status: res.status, json };
  }

  // Seed a promo license with buyer_email = NULL
  const promoCode = 'EQT-PROMO-UNBOUND-001';
  mockD1.db.prepare(`
    INSERT INTO licenses (license_code, tier, status, max_devices, expires_at, buyer_email, source, created_at)
    VALUES (?, 'PLUS', 'active', 2, 'LIFETIME', NULL, 'promo', datetime('now'))
  `).run(promoCode);

  // ------------------------------------------------------------
  // Test 1: Unbound license initial activation returns need_email challenge
  // ------------------------------------------------------------
  console.log('--- Test 1: Unbound license initial activation returns need_email challenge ---');
  {
    const res = await callDrm('POST', '/api/v1/activate', {
      license_code: promoCode,
      device_id: 'dev_binding_test_1',
      uuid_hash: 'uuid_binding_1111111111111111',
      cpu_hash: 'cpu_binding_2222222222222222',
      disk_hash: 'disk_binding_3333333333333333'
    });
    assertEqual(res.status, 200, 'Initial activation returns 200');
    assertEqual(res.json.need_email, true, 'Returns need_email = true');
    assertEqual(res.json.license_code, promoCode, 'Returns correct license_code');
    assert(Boolean(res.json.message), 'Returns localized challenge message');
  }

  // ------------------------------------------------------------
  // Test 2: Request OTP via /api/v1/auth/send-code for activation
  // ------------------------------------------------------------
  console.log('\n--- Test 2: Request OTP via /api/v1/auth/send-code for activation ---');
  {
    // 2.1 Missing license_code
    const missingLic = await callAuth('POST', '/api/v1/auth/send-code', {
      email: 'user@example.com',
      purpose: 'activate'
    });
    assertEqual(missingLic.status, 400, 'Missing license_code returns 400');

    // 2.2 Invalid license_code
    const notFound = await callAuth('POST', '/api/v1/auth/send-code', {
      email: 'user@example.com',
      purpose: 'activate',
      license_code: 'NON_EXISTENT_CODE'
    });
    assertEqual(notFound.status, 404, 'Non-existent license returns 404');

    // 2.3 Valid request
    const sendRes = await callAuth('POST', '/api/v1/auth/send-code', {
      email: 'user@example.com',
      purpose: 'activate',
      license_code: promoCode
    });
    assertEqual(sendRes.status, 200, 'Valid send-code returns 200');
    assertEqual(sendRes.json.success, true, 'send-code returns success: true');

    // 2.4 Immediate retry rate limit (60s cooldown)
    const retryRes = await callAuth('POST', '/api/v1/auth/send-code', {
      email: 'user@example.com',
      purpose: 'activate',
      license_code: promoCode
    });
    assertEqual(retryRes.status, 429, 'Immediate retry returns 429 Rate Limited');
  }

  // ------------------------------------------------------------
  // Test 3: Activate with invalid vs valid OTP code
  // ------------------------------------------------------------
  console.log('\n--- Test 3: Activate with invalid vs valid OTP code ---');
  {
    // Query saved code from DB
    const codeRow = mockD1.db.prepare(
      "SELECT code FROM verification_codes WHERE email = 'activate:user@example.com'"
    ).get();
    assert(Boolean(codeRow && codeRow.code), 'Verification code saved in verification_codes table');
    const validOtp = codeRow.code;

    // 3.1 Invalid OTP code
    const wrongRes = await callDrm('POST', '/api/v1/activate', {
      license_code: promoCode,
      email: 'user@example.com',
      verification_code: '999999',
      device_id: 'dev_binding_test_1',
      uuid_hash: 'uuid_binding_1111111111111111',
      cpu_hash: 'cpu_binding_2222222222222222',
      disk_hash: 'disk_binding_3333333333333333'
    });
    assertEqual(wrongRes.status, 400, 'Wrong verification code returns 400');
    assertEqual(wrongRes.json.error_code, 'INVALID_VERIFICATION_CODE', 'Error code is INVALID_VERIFICATION_CODE');

    // 3.2 Correct OTP code
    const correctRes = await callDrm('POST', '/api/v1/activate', {
      license_code: promoCode,
      email: 'user@example.com',
      verification_code: validOtp,
      device_id: 'dev_binding_test_1',
      uuid_hash: 'uuid_binding_1111111111111111',
      cpu_hash: 'cpu_binding_2222222222222222',
      disk_hash: 'disk_binding_3333333333333333'
    });
    assertEqual(correctRes.status, 200, 'Correct verification code activates successfully (200)');
    assert(Boolean(correctRes.json.signature), 'Returns signed license certificate');
    assertEqual(correctRes.json.tier, 'PLUS', 'Certificate tier is PLUS');

    // Verify DB update
    const licDb = mockD1.db.prepare("SELECT buyer_email FROM licenses WHERE license_code = ?").get(promoCode);
    assertEqual(licDb.buyer_email, 'user@example.com', 'License buyer_email is bound in DB');
  }

  // ------------------------------------------------------------
  // Test 4: Re-activation from same device does not challenge
  // ------------------------------------------------------------
  console.log('\n--- Test 4: Re-activation from same device does not challenge ---');
  {
    mockD1.db.prepare("DELETE FROM rate_limits WHERE key LIKE 'activate:%'").run();
    const reRes = await callDrm('POST', '/api/v1/activate', {
      license_code: promoCode,
      device_id: 'dev_binding_test_1',
      uuid_hash: 'uuid_binding_1111111111111111',
      cpu_hash: 'cpu_binding_2222222222222222',
      disk_hash: 'disk_binding_3333333333333333'
    });
    assertEqual(reRes.status, 200, 'Re-activation returns 200');
    assert(!reRes.json.need_email, 'Does not ask for email on re-activation');
    assert(Boolean(reRes.json.signature), 'Returns signature on re-activation');
  }

  // ------------------------------------------------------------
  // Test 5: Second device activates directly (buyer_email is already set)
  // ------------------------------------------------------------
  console.log('\n--- Test 5: Second device activates directly without challenge ---');
  {
    mockD1.db.prepare("DELETE FROM rate_limits WHERE key LIKE 'activate:%'").run();
    const dev2Res = await callDrm('POST', '/api/v1/activate', {
      license_code: promoCode,
      device_id: 'dev_binding_test_2',
      uuid_hash: 'uuid_binding_4444444444444444',
      cpu_hash: 'cpu_binding_5555555555555555',
      disk_hash: 'disk_binding_6666666666666666'
    });
    assertEqual(dev2Res.status, 200, 'Second device activates 200 OK');
    assert(!dev2Res.json.need_email, 'Does not ask for email (already bound)');
    assert(Boolean(dev2Res.json.signature), 'Returns signature for second device');
  }

  // ------------------------------------------------------------
  // Test 6: Sandbox dual-channel matching with unbound test license
  // ------------------------------------------------------------
  console.log('\n--- Test 6: Sandbox dual-channel matching with unbound test license ---');
  {
    const sandboxEnv = {
      DB: mockD1,
      ED25519_PRIVATE_KEY: '8d97c60e4f66e2fb7a2b72738aee392620ba20339a328ffd563da816c9c2b883',
      ENVIRONMENT: 'test'
    };

    // Seed beta tester
    mockD1.db.prepare(`
      INSERT INTO sandbox_beta_testers (email, device_id, status, created_at)
      VALUES ('sandbox_tester@example.com', 'sandbox_dev_001', 'active', datetime('now'))
    `).run();

    // Register hardware
    mockD1.db.prepare(`
      INSERT INTO device_registry (device_id, uuid_hash, cpu_hash, disk_hash, tier_label, registered_at, last_seen_at)
      VALUES ('sandbox_dev_001', 'sbox_uuid_1', 'sbox_cpu_1', 'sbox_disk_1', 'free', datetime('now'), datetime('now'))
    `).run();

    // Seed unbound test promo code
    const sboxCode = 'EQT-TEST-PROMO-UNBOUND-001';
    mockD1.db.prepare(`
      INSERT INTO licenses (license_code, tier, status, max_devices, expires_at, buyer_email, source, created_at)
      VALUES (?, 'PLUS', 'active', 2, 'LIFETIME', NULL, 'test', datetime('now'))
    `).run(sboxCode);

    // Initial activation returns need_email (bypasses sandbox rejection before challenge!)
    const sboxChallenge = await callDrm('POST', '/api/v1/activate', {
      license_code: sboxCode,
      device_id: 'sandbox_dev_001',
      uuid_hash: 'sbox_uuid_1',
      cpu_hash: 'sbox_cpu_1',
      disk_hash: 'sbox_disk_1'
    }, sandboxEnv);
    assertEqual(sboxChallenge.status, 200, 'Sandbox initial activation returns 200');
    assertEqual(sboxChallenge.json.need_email, true, 'Sandbox returns need_email = true');

    // Send code
    const sboxSend = await callAuth('POST', '/api/v1/auth/send-code', {
      email: 'sandbox_tester@example.com',
      purpose: 'activate',
      license_code: sboxCode
    }, sandboxEnv);
    assertEqual(sboxSend.status, 200, 'Send-code succeeds in sandbox');

    const sboxCodeRow = mockD1.db.prepare(
      "SELECT code FROM verification_codes WHERE email = 'activate:sandbox_tester@example.com'"
    ).get();
    assert(Boolean(sboxCodeRow && sboxCodeRow.code), 'Sandbox verification code generated');

    // Activate with verified email & code
    const sboxAct = await callDrm('POST', '/api/v1/activate', {
      license_code: sboxCode,
      email: 'sandbox_tester@example.com',
      verification_code: sboxCodeRow.code,
      device_id: 'sandbox_dev_001',
      uuid_hash: 'sbox_uuid_1',
      cpu_hash: 'sbox_cpu_1',
      disk_hash: 'sbox_disk_1'
    }, sandboxEnv);
    assertEqual(sboxAct.status, 200, 'Sandbox tester activates successfully with verified email');
    assert(Boolean(sboxAct.json.signature), 'Returns signed certificate in sandbox');
  }

  console.log('\n============================================================');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('============================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Test execution error:', err);
  process.exit(1);
});
