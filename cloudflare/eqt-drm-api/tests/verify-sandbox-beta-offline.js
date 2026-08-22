/**
 * Offline test suite for Sandbox Beta Tester Eligibility, Admin Whitelist,
 * Test License Minting, and Bound Device ID Enforcement on Activation.
 *
 * Build:
 *   npx esbuild src/routes/admin.ts src/routes/drm.ts --bundle --alias:cloudflare:sockets=./tests/mocks/cloudflare-sockets-stub.js --outdir=tests/compiled --platform=node --format=cjs
 * Run:
 *   node tests/verify-sandbox-beta-offline.js
 */

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const adminRoutePath = path.join(__dirname, 'compiled', 'admin.js');
const drmRoutePath = path.join(__dirname, 'compiled', 'drm.js');

if (!fs.existsSync(adminRoutePath) || !fs.existsSync(drmRoutePath)) {
  console.error('Compiled routes not found. Run esbuild first.');
  process.exit(1);
}

const { handleAdminRoutes } = require(adminRoutePath);
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
  console.log('🧪 Sandbox Beta Eligibility & Bound Device Offline Tests');
  console.log('============================================================\n');

  // Initialize in-memory SQLite database and schema
  const mockD1 = new SqliteD1Mock();
  const schemaSql = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
  mockD1.db.exec(schemaSql);
  const env = {
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
  async function callAdmin(method, path, body = null) {
    const url = new URL(path, 'http://localhost');
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
  async function callDrm(method, path, body = null) {
    const url = new URL(path, 'http://localhost');
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
  // Test 1: GET /api/v1/admin/sandbox/testers (Initial Seed)
  // ------------------------------------------------------------
  console.log('--- Test 1: Query default seeded beta testers ---');
  {
    const { status, json } = await callAdmin('GET', '/api/v1/admin/sandbox/testers');
    assertEqual(status, 200, 'GET /api/v1/admin/sandbox/testers returns 200');
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
  // Test 2: POST /api/v1/admin/sandbox/testers (Add tester entry)
  // ------------------------------------------------------------
  console.log('\n--- Test 2: Add new tester qualification entry ---');
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
  }

  // ------------------------------------------------------------
  // Test 3: POST /api/v1/admin/sandbox/mint-test-license
  // ------------------------------------------------------------
  console.log('\n--- Test 3: 1-Click Quick Mint Test License ---');
  let quickTestCode = '';
  {
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
  // Test 4: Activate with matching Bound Device ID -> SUCCESS
  // ------------------------------------------------------------
  console.log('\n--- Test 4: Activate test license on authorized test device ID ---');
  {
    mockD1.db.prepare(`
      INSERT INTO device_registry (device_id, uuid_hash, cpu_hash, disk_hash, tier_label, registered_at, last_seen_at)
      VALUES (?, ?, ?, ?, 'free', datetime('now'), datetime('now'))
    `).run(
      'b0036718cb9a469999d2910cdf418b1f',
      'mock_uuid_hash_1111111111111111',
      'mock_cpu_hash_2222222222222222',
      'mock_disk_hash_3333333333333333'
    );

    const { status, json } = await callDrm('POST', '/api/v1/activate', {
      license_code: quickTestCode,
      device_id: 'b0036718cb9a469999d2910cdf418b1f',
      uuid_hash: 'mock_uuid_hash_1111111111111111',
      cpu_hash: 'mock_cpu_hash_2222222222222222',
      disk_hash: 'mock_disk_hash_3333333333333333'
    });
    assertEqual(status, 200, 'Activation on authorized test device returns 200');
    assert(json.signature && json.signature.length > 20, 'Returns signed license signature');
    assertEqual(json.tier, 'PLUS', 'Tier is PLUS');
    assertEqual(json.device_id, 'b0036718cb9a469999d2910cdf418b1f', 'Device ID matches');
  }

  // ------------------------------------------------------------
  // Test 5: Activate with unauthorized Device ID -> REJECTED (403)
  // ------------------------------------------------------------
  console.log('\n--- Test 5: Activate test license on unauthorized device -> 403 Forbidden ---');
  {
    // Generate a fresh test code bound to device A
    const mintRes = await callAdmin('POST', '/api/v1/admin/generate-license', {
      tier: 'PRO',
      source: 'test',
      bound_device_id: 'b0036718cb9a469999d2910cdf418b1f',
      buyer_email: 'anon@301098.xyz',
      expires_in_days: 7,
      duration_days: 14
    });
    assertEqual(mintRes.status, 200, 'Generate test license via standard endpoint returns 200');
    const proTestCode = mintRes.json.license_code;

    // Try to activate on unauthorized device B
    const { status, json } = await callDrm('POST', '/api/v1/activate', {
      license_code: proTestCode,
      device_id: 'unauthorized_attacker_device_999',
      uuid_hash: 'other_uuid_hash_4444444444444444',
      cpu_hash: 'other_cpu_hash_5555555555555555',
      disk_hash: 'other_disk_hash_6666666666666666'
    });
    assertEqual(status, 403, 'Activation on unauthorized device returns 403 Forbidden');
    assert(json.error && (json.error.includes('测试设备') || json.error.includes('test device')), `Error message mentions test device restriction: ${json.error}`);
  }

  // ------------------------------------------------------------
  // Test 6: DELETE /api/v1/admin/sandbox/testers/:id
  // ------------------------------------------------------------
  console.log('\n--- Test 6: Remove tester qualification entry ---');
  {
    const { status, json } = await callAdmin('DELETE', `/api/v1/admin/sandbox/testers/${addedTesterId}`);
    assertEqual(status, 200, 'DELETE tester returns 200');
    assert(json.success === true, 'Delete success is true');

    const listRes = await callAdmin('GET', '/api/v1/admin/sandbox/testers');
    const stillExists = listRes.json.testers.some(t => t.id === addedTesterId);
    assert(!stillExists, 'Deleted tester no longer appears in whitelist');
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
