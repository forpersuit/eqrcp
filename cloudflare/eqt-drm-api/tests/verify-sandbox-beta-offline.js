/**
 * Offline test suite for Sandbox Beta Tester Eligibility, Admin Whitelist,
 * Test License Minting, Environment Guards, and Bound Device ID Enforcement on Activation.
 *
 * Build:
 *   npx esbuild src/routes/admin.ts src/routes/drm.ts --bundle --alias:cloudflare:sockets=./tests/mocks/cloudflare-sockets-stub.js --outdir=tests/compiled --platform=node --format=cjs
 * Run:
 *   node --experimental-sqlite tests/verify-sandbox-beta-offline.js
 */

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const adminRoutePath = path.join(__dirname, 'compiled', 'admin.js');
const drmRoutePath = path.join(__dirname, 'compiled', 'drm.js');
const authPath = path.join(__dirname, 'compiled', 'auth.js');

if (!fs.existsSync(adminRoutePath) || !fs.existsSync(drmRoutePath) || !fs.existsSync(authPath)) {
  console.error('Compiled routes not found. Run esbuild first.');
  process.exit(1);
}

const { handleAdminRoutes } = require(adminRoutePath);
const { handleDrmRoutes } = require(drmRoutePath);
const { ensureBetaTestersTable } = require(authPath);

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
  console.log('🧪 Sandbox Beta Eligibility & Bound Device Offline Tests');
  console.log('============================================================\n');

  // Initialize in-memory SQLite database and schema
  const mockD1 = new SqliteD1Mock();
  const schemaSql = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
  mockD1.db.exec(schemaSql);
  const testEnv = {
    DB: mockD1,
    CF_ACCESS_TEAM_DOMAIN: 'local.dev',
    CF_ACCESS_AUD: 'local-dev',
    ED25519_PRIVATE_KEY: '8d97c60e4f66e2fb7a2b72738aee392620ba20339a328ffd563da816c9c2b883',
    ENVIRONMENT: 'test'
  };
  const dummyCtx = { waitUntil: () => {} };
  const corsHeaders = { 'Access-Control-Allow-Origin': '*' };
  const adminHeaders = {
    'Cf-Access-Jwt-Assertion': 'local.admin@example.com',
    'Content-Type': 'application/json'
  };

  // Helper to call handleAdminRoutes
  async function callAdmin(method, path, body = null, env = testEnv) {
    const base = env.ENVIRONMENT === 'production' ? 'https://lic.eqt.net.im' : 'http://localhost';
    const url = new URL(path, base);
    const req = new Request(url.toString(), {
      method,
      headers: adminHeaders,
      body: body ? JSON.stringify(body) : null
    });
    const res = await handleAdminRoutes(req, env, dummyCtx, url, corsHeaders);
    if (!res) throw new Error(`Route not handled: ${method} ${path}`);
    const json = await res.json();
    return { status: res.status, json };
  }

  // Helper to call handleDrmRoutes
  async function callDrm(method, path, body = null, env = testEnv) {
    const base = env.ENVIRONMENT === 'production' ? 'https://lic.eqt.net.im' : 'http://localhost';
    const url = new URL(path, base);
    const req = new Request(url.toString(), {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : null
    });
    const res = await handleDrmRoutes(req, env, dummyCtx, url, corsHeaders);
    if (!res) throw new Error(`Route not handled: ${method} ${path}`);
    const json = await res.json();
    return { status: res.status, json };
  }

  // ------------------------------------------------------------
  // Test 1: GET /api/v1/admin/sandbox/testers (Initial Seed in Test Env)
  // ------------------------------------------------------------
  console.log('--- Test 1: Query default seeded beta testers (Test Env) ---');
  {
    const { status, json } = await callAdmin('GET', '/api/v1/admin/sandbox/testers');
    assertEqual(status, 200, 'GET /api/v1/admin/sandbox/testers returns 200 in test env');
    assert(json.success === true, 'Response success is true');
    assert(Array.isArray(json.testers), 'Testers is an array');
    assert(json.testers.length >= 3, `Seeded at least 3 beta testers (got ${json.testers.length})`);

    const hasTargetDevice = json.testers.some(t => t.device_id === 'b0036718cb9a469999d2910cdf418b1f');
    assert(hasTargetDevice, 'Contains target test device ID b0036718cb9a469999d2910cdf418b1f');

    const hasEmail1 = json.testers.some(t => t.email === 'tmp@301098.xyz');
    assert(hasEmail1, 'Contains target test email tmp@301098.xyz');

    const hasEmail2 = json.testers.some(t => t.email === 'anon@301098.xyz');
    assert(hasEmail2, 'Contains target test email anon@301098.xyz');
  }

  // ------------------------------------------------------------
  // Test 2: Production Environment Guard: Sandbox Endpoints Blocked
  // ------------------------------------------------------------
  console.log('\n--- Test 2: Production Environment Guard (Blocks Sandbox Endpoints) ---');
  {
    const prodEnv = {
      ...testEnv,
      ENVIRONMENT: 'production'
    };

    // 2A: Sandbox testers endpoint blocked in production
    const resTesters = await callAdmin('GET', '/api/v1/admin/sandbox/testers', null, prodEnv);
    assertEqual(resTesters.status, 403, 'GET /sandbox/testers returns 403 in production');
    assertEqual(resTesters.json.code, 'SANDBOX_ONLY', 'Error code is SANDBOX_ONLY');

    // 2B: Mint test license blocked in production
    const resMint = await callAdmin('POST', '/api/v1/admin/sandbox/mint-test-license', {
      device_id: 'b0036718cb9a469999d2910cdf418b1f',
      email: 'tmp@301098.xyz'
    }, prodEnv);
    assertEqual(resMint.status, 403, 'POST /sandbox/mint-test-license returns 403 in production');

    // 2C: Generate license with source='test' blocked in production
    const resGen = await callAdmin('POST', '/api/v1/admin/generate-license', {
      tier: 'PLUS',
      source: 'test',
      bound_device_id: 'b0036718cb9a469999d2910cdf418b1f'
    }, prodEnv);
    assertEqual(resGen.status, 403, 'Generate license with source=test returns 403 in production');
  }

  // ------------------------------------------------------------
  // Test 3: ensureBetaTestersTable in Production Does NOT Seed
  // ------------------------------------------------------------
  console.log('\n--- Test 3: ensureBetaTestersTable in Production does NOT seed ---');
  {
    const prodMockD1 = new SqliteD1Mock();
    const prodEnvClean = {
      DB: prodMockD1,
      ENVIRONMENT: 'production'
    };
    await ensureBetaTestersTable(prodEnvClean);
    const count = await prodMockD1.db.prepare("SELECT COUNT(*) as count FROM sandbox_beta_testers").get();
    assertEqual(Number(count.count), 0, 'Production DB has 0 seeded test records');
  }

  // ------------------------------------------------------------
  // Test 4: Add and Delete Tester Qualification Entry
  // ------------------------------------------------------------
  console.log('\n--- Test 4: Add & Delete tester qualification entry ---');
  let addedTesterId = 0;
  {
    const { status, json } = await callAdmin('POST', '/api/v1/admin/sandbox/testers', {
      device_id: 'dev_test_lab_machine_999',
      email: 'lab_qa@301098.xyz',
      notes: 'QA Automated Testing Rig'
    });
    assertEqual(status, 200, 'POST /api/v1/admin/sandbox/testers returns 200');
    assert(json.success === true, 'Added successfully');
    assert(json.id > 0, `Returned new tester ID: ${json.id}`);
    addedTesterId = json.id;

    const listRes = await callAdmin('GET', '/api/v1/admin/sandbox/testers');
    const newlyAdded = listRes.json.testers.find(t => t.id === addedTesterId);
    assert(newlyAdded && newlyAdded.device_id === 'dev_test_lab_machine_999', 'New tester persists in database');

    // Delete it
    const delRes = await callAdmin('DELETE', `/api/v1/admin/sandbox/testers/${addedTesterId}`);
    assertEqual(delRes.status, 200, 'DELETE tester returns 200');
    assert(delRes.json.success === true, 'Delete success is true');
  }

  // ------------------------------------------------------------
  // Test 5: Mint Test License: Validation and 1-Click Minting
  // ------------------------------------------------------------
  console.log('\n--- Test 5: Mint Test License Validation & Minting ---');
  let quickTestCode = '';
  {
    // 5A: Missing required parameters -> 400 Bad Request
    const resBad1 = await callAdmin('POST', '/api/v1/admin/sandbox/mint-test-license', {});
    assertEqual(resBad1.status, 400, 'Missing params returns 400');
    assert(resBad1.json.error.includes('Missing required parameters'), 'Error mentions missing parameters');

    // 5B: Valid parameters -> 200 OK
    const { status, json } = await callAdmin('POST', '/api/v1/admin/sandbox/mint-test-license', {
      tier: 'PLUS',
      device_id: 'b0036718cb9a469999d2910cdf418b1f',
      email: 'tmp@301098.xyz',
      expires_in_days: 7,
      duration_days: 30
    });
    assertEqual(status, 200, 'mint-test-license returns 200');
    assert(json.success === true, 'Mint success is true');
    assert(json.license_code.startsWith('EQT-TEST-PLUS-'), `License code prefix is EQT-TEST-PLUS- (${json.license_code})`);
    assertEqual(json.bound_device_id, 'b0036718cb9a469999d2910cdf418b1f', 'Bound device ID matches');
    assertEqual(json.buyer_email, 'tmp@301098.xyz', 'Buyer email matches');
    assertEqual(json.duration_days, 30, 'Duration days is 30');
    quickTestCode = json.license_code;
  }

  // ------------------------------------------------------------
  // Test 6: ATTACK SPOOFING DEFENSE (CRUCIAL): Attacker fake device_id bypass is BLOCKED
  // ------------------------------------------------------------
  console.log('\n--- Test 6: Attacker Spoofs device_id=boundId with fake fingerprints -> 403 Forbidden ---');
  {
    // Attacker knows bound_device_id 'b0036718cb9a469999d2910cdf418b1f' from public source
    // Attacker sends request with device_id: 'b0036718cb9a469999d2910cdf418b1f' BUT attacker's own fingerprints
    const { status, json } = await callDrm('POST', '/api/v1/activate', {
      license_code: quickTestCode,
      device_id: 'b0036718cb9a469999d2910cdf418b1f', // SPOOFED in body
      uuid_hash: 'attacker_fake_uuid_9999999999999999',
      cpu_hash: 'attacker_fake_cpu_8888888888888888',
      disk_hash: 'attacker_fake_disk_7777777777777777'
    });

    assertEqual(status, 403, 'Attacker spoofing device_id is REJECTED with 403 Forbidden');
    assert(json.error && (json.error.includes('测试设备') || json.error.includes('test device')), 'Error mentions test device restriction');

    // Verify no activation was created by attacker
    const acts = await mockD1.db.prepare("SELECT * FROM activations WHERE license_code = ?").all(quickTestCode);
    assertEqual(acts.length, 0, 'No activation record was created by attacker');
  }

  // ------------------------------------------------------------
  // Test 7: Legitimate Tester Activation with genuine hardware
  // ------------------------------------------------------------
  console.log('\n--- Test 7: Legitimate tester activates with genuine hardware -> 200 OK ---');
  {
    // Pre-registered legitimate test machine in device_registry with bound device_id
    mockD1.db.prepare(`
      INSERT INTO device_registry (device_id, uuid_hash, cpu_hash, disk_hash, tier_label, registered_at, last_seen_at)
      VALUES (?, ?, ?, ?, 'free', datetime('now'), datetime('now'))
    `).run(
      'b0036718cb9a469999d2910cdf418b1f',
      'legit_uuid_hash_1111111111111111',
      'legit_cpu_hash_2222222222222222',
      'legit_disk_hash_3333333333333333'
    );

    const { status, json } = await callDrm('POST', '/api/v1/activate', {
      license_code: quickTestCode,
      device_id: 'b0036718cb9a469999d2910cdf418b1f',
      uuid_hash: 'legit_uuid_hash_1111111111111111',
      cpu_hash: 'legit_cpu_hash_2222222222222222',
      disk_hash: 'legit_disk_hash_3333333333333333'
    });

    assertEqual(status, 200, 'Legitimate test device activates successfully (200 OK)');
    assert(json.signature && json.signature.length > 20, 'Returns signed license signature');
    assertEqual(json.tier, 'PLUS', 'Tier is PLUS');
    assertEqual(json.device_id, 'b0036718cb9a469999d2910cdf418b1f', 'Authoritative device ID is bound test ID');

    // Verify 1 activation was recorded
    const acts = await mockD1.db.prepare("SELECT * FROM activations WHERE license_code = ?").all(quickTestCode);
    assertEqual(acts.length, 1, 'Exactly 1 activation recorded for legitimate test device');
  }

  // ------------------------------------------------------------
  // Test 8: 8-day hard expiry cap (activate + verify both enforce it)
  // ------------------------------------------------------------
  console.log('\n--- Test 8: 8-day hard expiry cap on test licenses ---');
  {
    // Backdate quickTestCode creation to 9 days ago -> created_at + 8d is already in the past
    const nineDaysAgo = new Date(Date.now() - 9 * 86400000).toISOString();
    mockD1.db.prepare("UPDATE licenses SET created_at = ? WHERE license_code = ?").run(nineDaysAgo, quickTestCode);

    const res = await callDrm('POST', '/api/v1/activate', {
      license_code: quickTestCode,
      device_id: 'b0036718cb9a469999d2910cdf418b1f',
      uuid_hash: 'legit_uuid_hash_1111111111111111',
      cpu_hash: 'legit_cpu_hash_2222222222222222',
      disk_hash: 'legit_disk_hash_3333333333333333'
    });
    assertEqual(res.status, 403, 'Activate after 8-day cap returns 403 (expired)');
    assert(res.json.error, 'Returns an error message on 8-day expiry');

    const vres = await callDrm('POST', '/api/v1/verify', {
      license_code: quickTestCode,
      uuid_hash: 'legit_uuid_hash_1111111111111111',
      cpu_hash: 'legit_cpu_hash_2222222222222222',
      disk_hash: 'legit_disk_hash_3333333333333333'
    });
    assertEqual(vres.status, 403, 'Verify after 8-day cap returns 403 (expired)');

    // Restore created_at so later tests on quickTestCode remain valid
    mockD1.db.prepare("UPDATE licenses SET created_at = ? WHERE license_code = ?").run(new Date().toISOString(), quickTestCode);
  }

  // ------------------------------------------------------------
  // Test 9: Deleting a whitelist entry blocks further activation
  // ------------------------------------------------------------
  console.log('\n--- Test 9: Delete whitelist entry -> activation rejected ---');
  let delCode = '';
  {
    await callAdmin('POST', '/api/v1/admin/sandbox/testers', {
      device_id: 'del_device_001',
      email: 'del@301098.xyz',
      notes: 'deletion test'
    });
    const mintRes = await callAdmin('POST', '/api/v1/admin/sandbox/mint-test-license', {
      tier: 'PLUS',
      device_id: 'del_device_001',
      email: 'del@301098.xyz',
      expires_in_days: 8
    });
    assertEqual(mintRes.status, 200, 'Mint for registered pair returns 200');
    delCode = mintRes.json.license_code;

    mockD1.db.prepare(`
      INSERT INTO device_registry (device_id, uuid_hash, cpu_hash, disk_hash, tier_label, registered_at, last_seen_at)
      VALUES (?, ?, ?, ?, 'free', datetime('now'), datetime('now'))
    `).run('del_device_001', 'del_uuid_hash_aaaaaaaaaaaaaaaa', 'del_cpu_hash_bbbbbbbbbbbbbbbb', 'del_disk_hash_cccccccccccccccc');

    const act1 = await callDrm('POST', '/api/v1/activate', {
      license_code: delCode,
      device_id: 'del_device_001',
      uuid_hash: 'del_uuid_hash_aaaaaaaaaaaaaaaa',
      cpu_hash: 'del_cpu_hash_bbbbbbbbbbbbbbbb',
      disk_hash: 'del_disk_hash_cccccccccccccccc'
    });
    assertEqual(act1.status, 200, 'Activation succeeds while whitelist entry exists');

    const listRes = await callAdmin('GET', '/api/v1/admin/sandbox/testers');
    const row = listRes.json.testers.find(t => t.email === 'del@301098.xyz');
    assert(row && row.id, 'Whitelist row for del@301098.xyz exists');
    const delRes = await callAdmin('DELETE', `/api/v1/admin/sandbox/testers/${row.id}`);
    assertEqual(delRes.status, 200, 'DELETE whitelist entry returns 200');

    const act2 = await callDrm('POST', '/api/v1/activate', {
      license_code: delCode,
      device_id: 'del_device_001',
      uuid_hash: 'del_uuid_hash_aaaaaaaaaaaaaaaa',
      cpu_hash: 'del_cpu_hash_bbbbbbbbbbbbbbbb',
      disk_hash: 'del_disk_hash_cccccccccccccccc'
    });
    assertEqual(act2.status, 403, 'Activation rejected after whitelist entry is deleted');
  }

  // ------------------------------------------------------------
  // Test 10: Deleting a whitelist entry blocks verify (license renewal)
  // ------------------------------------------------------------
  console.log('\n--- Test 10: Delete whitelist entry -> verify rejected ---');
  {
    await callAdmin('POST', '/api/v1/admin/sandbox/testers', {
      device_id: 'verify_device_001',
      email: 'paired@301098.xyz',
      notes: 'verify deletion test'
    });
    const mintRes = await callAdmin('POST', '/api/v1/admin/sandbox/mint-test-license', {
      tier: 'PLUS',
      device_id: 'verify_device_001',
      email: 'paired@301098.xyz',
      expires_in_days: 8
    });
    const pairedCode = mintRes.json.license_code;

    mockD1.db.prepare(`
      INSERT INTO device_registry (device_id, uuid_hash, cpu_hash, disk_hash, tier_label, registered_at, last_seen_at)
      VALUES (?, ?, ?, ?, 'free', datetime('now'), datetime('now'))
    `).run('verify_device_001', 'pair_uuid_hash_dddddddddddddddd', 'pair_cpu_hash_eeeeeeeeeeeeeeee', 'pair_disk_hash_ffffffffffffffff');

    const act1 = await callDrm('POST', '/api/v1/activate', {
      license_code: pairedCode,
      device_id: 'verify_device_001',
      uuid_hash: 'pair_uuid_hash_dddddddddddddddd',
      cpu_hash: 'pair_cpu_hash_eeeeeeeeeeeeeeee',
      disk_hash: 'pair_disk_hash_ffffffffffffffff'
    });
    assertEqual(act1.status, 200, 'Activation succeeds for paired whitelist entry');

    const listRes = await callAdmin('GET', '/api/v1/admin/sandbox/testers');
    const row = listRes.json.testers.find(t => t.email === 'paired@301098.xyz');
    await callAdmin('DELETE', `/api/v1/admin/sandbox/testers/${row.id}`);

    const vres = await callDrm('POST', '/api/v1/verify', {
      license_code: pairedCode,
      uuid_hash: 'pair_uuid_hash_dddddddddddddddd',
      cpu_hash: 'pair_cpu_hash_eeeeeeeeeeeeeeee',
      disk_hash: 'pair_disk_hash_ffffffffffffffff'
    });
    assertEqual(vres.status, 403, 'Verify rejected after whitelist entry is deleted');
  }

  // ------------------------------------------------------------
  // Test 11: Email-only whitelist entry (no device) -> activation rejected
  // ------------------------------------------------------------
  console.log('\n--- Test 11: Email-only whitelist entry cannot activate ---');
  {
    await callAdmin('POST', '/api/v1/admin/sandbox/testers', {
      email: 'orphan@301098.xyz',
      notes: 'email-only entry'
    });
    const genRes = await callAdmin('POST', '/api/v1/admin/generate-license', {
      tier: 'PLUS',
      source: 'test',
      buyer_email: 'orphan@301098.xyz',
      expires_in_days: 7
    });
    assertEqual(genRes.status, 200, 'Generate test license for email-only entry returns 200');
    const orphanCode = genRes.json.license_code;

    const res = await callDrm('POST', '/api/v1/activate', {
      license_code: orphanCode,
      device_id: 'some_unregistered_device',
      uuid_hash: 'orphan_uuid_hash_1111111111111111',
      cpu_hash: 'orphan_cpu_hash_2222222222222222',
      disk_hash: 'orphan_disk_hash_3333333333333333'
    });
    assertEqual(res.status, 403, 'Email-only whitelist entry cannot activate (no bound device)');
  }

  // ------------------------------------------------------------
  // Test 12: Paddle sandbox purchase (LIFETIME) in test env is capped at 8 days
  // ------------------------------------------------------------
  console.log('\n--- Test 12: Paddle purchase code in test env capped at 8 days ---');
  {
    await callAdmin('POST', '/api/v1/admin/sandbox/testers', {
      device_id: 'paddle_device_001',
      email: 'paddle@301098.xyz',
      notes: 'paddle sandbox purchase test'
    });
    mockD1.db.prepare(`
      INSERT INTO device_registry (device_id, uuid_hash, cpu_hash, disk_hash, tier_label, registered_at, last_seen_at)
      VALUES (?, ?, ?, ?, 'free', datetime('now'), datetime('now'))
    `).run('paddle_device_001', 'paddle_uuid_hash_aaaaaaaaaaaaaaaa', 'paddle_cpu_hash_bbbbbbbbbbbbbbbb', 'paddle_disk_hash_cccccccccccccccc');

    const paddleCode = 'EQT-PAD-TEST-20260822-000001';
    const now = new Date().toISOString();
    mockD1.db.prepare(`
      INSERT INTO licenses (license_code, tier, status, max_devices, expires_at, buyer_email, source, created_at)
      VALUES (?, 'PLUS', 'active', 2, 'LIFETIME', 'paddle@301098.xyz', 'purchase', ?)
    `).run(paddleCode, now);

    const res = await callDrm('POST', '/api/v1/activate', {
      license_code: paddleCode,
      device_id: 'paddle_device_001',
      uuid_hash: 'paddle_uuid_hash_aaaaaaaaaaaaaaaa',
      cpu_hash: 'paddle_cpu_hash_bbbbbbbbbbbbbbbb',
      disk_hash: 'paddle_disk_hash_cccccccccccccccc'
    });
    assertEqual(res.status, 200, 'Paddle purchase activates in test env (whitelisted tester)');
    const got = Date.parse(res.json.expires_at);
    const expect = Date.now() + 8 * 86400000;
    assert(!Number.isNaN(got), 'Activation returns a parseable expires_at');
    assert(Math.abs(got - expect) < 120000, `expires_at is capped to ~8 days (got ${res.json.expires_at})`);

    // Backdate to 9 days ago -> 8-day cap expired
    const nineDaysAgo = new Date(Date.now() - 9 * 86400000).toISOString();
    mockD1.db.prepare("UPDATE licenses SET created_at = ? WHERE license_code = ?").run(nineDaysAgo, paddleCode);
    const res2 = await callDrm('POST', '/api/v1/activate', {
      license_code: paddleCode,
      device_id: 'paddle_device_001',
      uuid_hash: 'paddle_uuid_hash_aaaaaaaaaaaaaaaa',
      cpu_hash: 'paddle_cpu_hash_bbbbbbbbbbbbbbbb',
      disk_hash: 'paddle_disk_hash_cccccccccccccccc'
    });
    assertEqual(res2.status, 403, 'Paddle purchase after 8-day cap returns 403 (expired)');
  }

  console.log('\n============================================================');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('============================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Test runner failed:', err);
  process.exit(1);
});
