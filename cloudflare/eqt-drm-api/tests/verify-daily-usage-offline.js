/**
 * Offline test suite for Authoritative Cloud Free-Tier Daily Usage Sync (§8).
 *
 * Run:
 *   node --experimental-sqlite tests/verify-daily-usage-offline.js
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
          return { success: true, meta: { changes: res.changes, last_row_id: res.lastInsertRowid } };
        } catch (e) {
          return { success: false, error: e.message };
        }
      },
      bind: (...args) => this._mk(sql, args)
    };
  }

  prepare(sql) {
    return this._mk(sql, []);
  }

  async batch(statements) {
    const results = [];
    for (const stmt of statements) {
      results.push(await stmt.run());
    }
    return results;
  }

  async exec(rawSql) {
    this.db.exec(rawSql);
    return { success: true };
  }
}

async function runTests() {
  console.log('=== Starting Authoritative Daily Usage Offline Tests ===\n');

  const { handleDrmRoutes } = require('./compiled/drm.js');

  if (!handleDrmRoutes) {
    console.error('Failed to load handleDrmRoutes from compiled drm.js');
    process.exit(1);
  }

  const d1 = new SqliteD1Mock();
  const schemaSql = fs.readFileSync(path.join(__dirname, '../schema.sql'), 'utf-8');
  d1.db.exec(schemaSql);

  const env = {
    DB: d1,
    ED25519_PRIVATE_KEY: '0000000000000000000000000000000000000000000000000000000000000000'
  };

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*'
  };

  // Seed registered free device
  d1.db.exec("INSERT INTO device_registry (device_id, tier_label, registered_at) VALUES ('test_dev_001', 'free', datetime('now'))");

  // Test 0: Unregistered device must be rejected with 404 (F1 guard)
  console.log('0. Testing unregistered device rejection...');
  {
    const req = new Request('https://lic.eqt.net.im/api/v1/device/sync-usage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        device_id: 'unknown_ghost_dev',
        delta_seconds: 10,
        delta_transfers: 1
      })
    });

    const res = await handleDrmRoutes(req, env, { waitUntil: () => {} }, new URL(req.url), corsHeaders);
    assertEqual(res.status, 404, 'unregistered device returns 404 Not Found');
  }

  // Test 1: Sync usage for free device - initial incremental report
  console.log('1. Testing incremental daily usage sync...');
  {
    const req = new Request('https://lic.eqt.net.im/api/v1/device/sync-usage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        device_id: 'test_dev_001',
        delta_seconds: 45,
        delta_transfers: 1
      })
    });

    const res = await handleDrmRoutes(req, env, { waitUntil: () => {} }, new URL(req.url), corsHeaders);
    assertEqual(res.status, 200, 'sync-usage returns 200 OK');
    const data = await res.json();
    assertEqual(data.success, true, 'sync-usage response has success: true');
    assertEqual(data.used_seconds, 45, 'used_seconds is 45');
    assertEqual(data.used_transfers, 1, 'used_transfers is 1');
    assertEqual(data.quota_exceeded, false, 'quota_exceeded is false');
    assert(Boolean(data.signature && data.signature.length === 128), 'sync-usage response contains valid 64-byte Ed25519 hex signature');
  }

  // Test 2: Accumulate usage on same day
  console.log('2. Testing usage accumulation...');
  {
    const req = new Request('https://lic.eqt.net.im/api/v1/device/sync-usage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        device_id: 'test_dev_001',
        delta_seconds: 60,
        delta_transfers: 2
      })
    });

    const res = await handleDrmRoutes(req, env, { waitUntil: () => {} }, new URL(req.url), corsHeaders);
    const data = await res.json();
    assertEqual(data.used_seconds, 105, 'accumulated used_seconds is 105');
    assertEqual(data.used_transfers, 3, 'accumulated used_transfers is 3');
    assertEqual(data.quota_exceeded, false, 'quota_exceeded remains false');
  }

  // Test 3: Exceed daily quota (> 300 seconds)
  console.log('3. Testing quota exceeded trigger...');
  {
    const req = new Request('https://lic.eqt.net.im/api/v1/device/sync-usage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        device_id: 'test_dev_001',
        delta_seconds: 200,
        delta_transfers: 0
      })
    });

    const res = await handleDrmRoutes(req, env, { waitUntil: () => {} }, new URL(req.url), corsHeaders);
    const data = await res.json();
    assertEqual(data.used_seconds, 305, 'accumulated used_seconds is 305');
    assertEqual(data.quota_exceeded, true, 'quota_exceeded is true when > 300s');
  }

  // Test 4: Query usage without delta (delta = 0)
  console.log('4. Testing zero-delta usage query...');
  {
    const req = new Request('https://lic.eqt.net.im/api/v1/device/sync-usage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        device_id: 'test_dev_001',
        delta_seconds: 0,
        delta_transfers: 0
      })
    });

    const res = await handleDrmRoutes(req, env, { waitUntil: () => {} }, new URL(req.url), corsHeaders);
    const data = await res.json();
    assertEqual(data.used_seconds, 305, 'returns authoritative 305 used_seconds');
    assertEqual(data.quota_exceeded, true, 'returns quota_exceeded: true');
  }

  // Test 5: Paid device bypasses quota limits
  console.log('5. Testing paid device quota bypass...');
  {
    d1.db.exec("INSERT INTO device_registry (device_id, tier_label, registered_at) VALUES ('paid_dev_999', 'paid', datetime('now'))");

    const req = new Request('https://lic.eqt.net.im/api/v1/device/sync-usage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        device_id: 'paid_dev_999',
        delta_seconds: 9999,
        delta_transfers: 50
      })
    });

    const res = await handleDrmRoutes(req, env, { waitUntil: () => {} }, new URL(req.url), corsHeaders);
    const data = await res.json();
    assertEqual(data.is_paid, true, 'paid device recognized as is_paid: true');
    assertEqual(data.quota_exceeded, false, 'paid device quota_exceeded is false');
  }

  console.log(`\n============================================================`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log(`============================================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Unhandled test failure:', err);
  process.exit(1);
});
