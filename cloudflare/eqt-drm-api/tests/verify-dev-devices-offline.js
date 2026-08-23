/**
 * Offline test suite for Unified Dev & Test Device Management,
 * Server-side Device ID DevMode Authorization, and Admin Endpoints.
 *
 * Run:
 *   node --experimental-sqlite tests/verify-dev-devices-offline.js
 */

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

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
        try {
          const stmt = this.db.prepare(sql);
          const rows = stmt.all(...(binds || []));
          return { results: rows };
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
        try {
          const stmt = this.db.prepare(sql);
          const res = stmt.run(...(binds || []));
          return {
            meta: {
              changes: res.changes,
              last_row_id: Number(res.lastInsertRowid)
            }
          };
        } catch (e) {
          throw e;
        }
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
  console.log('=== Starting Dev Devices & Server-side DevMode Authorization Tests ===\n');

  const d1 = new SqliteD1Mock();
  const schemaSql = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf-8');
  d1.db.exec(schemaSql);

  // Compile routes
  const { execSync } = require('child_process');
  execSync('npx esbuild src/routes/admin.ts src/routes/drm.ts src/utils/auth.ts --bundle --alias:cloudflare:sockets=./tests/mocks/cloudflare-sockets-stub.js --outdir=tests/compiled --platform=node --format=cjs', {
    cwd: path.join(__dirname, '..')
  });

  const { handleAdminRoutes } = require('./compiled/admin.js');
  const { handleDrmRoutes } = require('./compiled/drm.js');
  const { isDeviceAuthorizedForDev } = require('./compiled/auth.js');

  const corsHeaders = { 'Access-Control-Allow-Origin': '*' };
  const dummyCtx = { waitUntil: () => {} };
  const baseEnv = {
    DB: d1,
    ENVIRONMENT: 'production',
    CF_ACCESS_TEAM_DOMAIN: 'local.dev',
    CF_ACCESS_AUD: 'local-dev',
    CF_ACCESS_ALLOWED_EMAILS: 'admin@eqt.net.im',
    ED25519_PRIVATE_KEY: 'fc0993ec4a68da7e6f10be87959d8ecd7f227ddd4b9e65a7b925287b9b2ed12e'
  };

  const adminHeaders = {
    'Cf-Access-Jwt-Assertion': 'local.admin@eqt.net.im',
    'Content-Type': 'application/json'
  };

  console.log('--- Test Group 1: Admin Dev Devices API & Deduplication ---');

  // 1. Initial GET should be empty in production
  let url = new URL('https://admin.eqt.net.im/api/v1/admin/dev-devices');
  let req = new Request(url.toString(), {
    method: 'GET',
    headers: adminHeaders
  });
  let res = await handleAdminRoutes(req, baseEnv, dummyCtx, url, corsHeaders);
  assertEqual(res.status, 200, 'GET /dev-devices returns 200');
  let data = await res.json();
  assertEqual(data.devices.length, 0, 'Initial devices count is 0 in production');

  // 2. POST to add a new dev device
  url = new URL('https://admin.eqt.net.im/api/v1/admin/dev-devices');
  req = new Request(url.toString(), {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({
      device_id: 'd3d721780dc042beb70ca3dc836edd8e',
      email: 'dev@301098.xyz',
      notes: 'Primary Dev Machine',
      is_dev: 1,
      status: 'invalid_status_should_fallback_to_active'
    })
  });
  res = await handleAdminRoutes(req, baseEnv, dummyCtx, url, corsHeaders);
  assertEqual(res.status, 200, 'POST /dev-devices returns 200');
  data = await res.json();
  assert(data.success && data.id > 0, 'Device inserted successfully with ID');
  const addedId = data.id;

  // Verify status fell back to active in DB
  const insertedRow = d1.db.prepare('SELECT * FROM sandbox_beta_testers WHERE id = ?').get(addedId);
  assertEqual(insertedRow.status, 'active', 'Status correctly fell back to active');

  // 3. POST again with same device_id should update instead of creating duplicate row (F3 deduplication)
  req = new Request(url.toString(), {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({
      device_id: 'd3d721780dc042beb70ca3dc836edd8e',
      notes: 'Updated Notes (No duplicate)',
      is_dev: 1
    })
  });
  res = await handleAdminRoutes(req, baseEnv, dummyCtx, url, corsHeaders);
  assertEqual(res.status, 200, 'Duplicate POST /dev-devices returns 200');
  data = await res.json();
  assertEqual(data.id, addedId, 'Returned existing ID on duplicate device_id insertion');
  assertEqual(data.updated, true, 'Marked as updated on duplicate device_id insertion');

  const countRow = d1.db.prepare('SELECT COUNT(*) as cnt FROM sandbox_beta_testers').get();
  assertEqual(countRow.cnt, 1, 'Total rows in table remains 1 after duplicate insertion');

  // 4. Verify isDeviceAuthorizedForDev
  let isDev = await isDeviceAuthorizedForDev(baseEnv, 'd3d721780dc042beb70ca3dc836edd8e');
  assertEqual(isDev, true, 'isDeviceAuthorizedForDev returns true for authorized dev device');

  let notDev = await isDeviceAuthorizedForDev(baseEnv, 'unauthorized_device_id');
  assertEqual(notDev, false, 'isDeviceAuthorizedForDev returns false for unauthorized device');

  // 5. Toggle Dev permission
  url = new URL(`https://admin.eqt.net.im/api/v1/admin/dev-devices/${addedId}/toggle-dev`);
  req = new Request(url.toString(), {
    method: 'POST',
    headers: adminHeaders
  });
  res = await handleAdminRoutes(req, baseEnv, dummyCtx, url, corsHeaders);
  assertEqual(res.status, 200, 'POST /dev-devices/:id/toggle-dev returns 200');
  data = await res.json();
  assertEqual(data.is_dev, false, 'is_dev toggled from true to false');

  isDev = await isDeviceAuthorizedForDev(baseEnv, 'd3d721780dc042beb70ca3dc836edd8e');
  assertEqual(isDev, false, 'isDeviceAuthorizedForDev now returns false after toggle');

  // Toggle back to true
  url = new URL(`https://admin.eqt.net.im/api/v1/admin/dev-devices/${addedId}/toggle-dev`);
  req = new Request(url.toString(), {
    method: 'POST',
    headers: adminHeaders
  });
  res = await handleAdminRoutes(req, baseEnv, dummyCtx, url, corsHeaders);
  data = await res.json();
  assertEqual(data.is_dev, true, 'is_dev toggled back to true');

  console.log('\n--- Test Group 2: DRM Endpoints is_dev Delivery ---');

  // 6. POST /api/v1/device/register receives is_dev: true
  url = new URL('https://lic.eqt.net.im/api/v1/device/register');
  req = new Request(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      uuid_hash: 'u_hash_11111111111111111111111111111111',
      cpu_hash: 'c_hash_11111111111111111111111111111111',
      disk_hash: 'd_hash_11111111111111111111111111111111'
    })
  });
  res = await handleDrmRoutes(req, baseEnv, dummyCtx, url, corsHeaders);
  assertEqual(res.status, 200, 'POST /device/register returns 200');
  data = await res.json();
  assert(data.device_id !== undefined, 'Register response contains device_id');
  assert(typeof data.is_dev === 'boolean', 'Register response contains is_dev boolean');

  // 7. Delete device
  url = new URL(`https://admin.eqt.net.im/api/v1/admin/dev-devices/${addedId}`);
  req = new Request(url.toString(), {
    method: 'DELETE',
    headers: adminHeaders
  });
  res = await handleAdminRoutes(req, baseEnv, dummyCtx, url, corsHeaders);
  assertEqual(res.status, 200, 'DELETE /dev-devices/:id returns 200');
  data = await res.json();
  assertEqual(data.deleted_id, addedId, 'Device record deleted');

  isDev = await isDeviceAuthorizedForDev(baseEnv, 'd3d721780dc042beb70ca3dc836edd8e');
  assertEqual(isDev, false, 'Deleted device is no longer authorized for DevMode');

  console.log(`\n============================================================`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log(`============================================================`);

  if (failed > 0) process.exit(1);
}

runTests().catch(err => {
  console.error('Test runner failed:', err);
  process.exit(1);
});
