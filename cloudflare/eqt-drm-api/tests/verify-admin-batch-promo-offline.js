/**
 * Offline unit test for Admin Batch License Generation,
 * License Filtering (source/status/redeemed), and Promo Stats.
 *
 * Run:
 *   node --experimental-sqlite tests/verify-admin-batch-promo-offline.js
 */

const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

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

// Minimal SQLite D1 wrapper with batch support
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
          console.error("D1 all error:", e, "SQL:", sql);
          return { results: [] };
        }
      },
      first: async () => {
        try {
          const stmt = this.db.prepare(sql);
          const row = stmt.get(...(binds || []));
          return row || null;
        } catch (e) {
          console.error("D1 first error:", e, "SQL:", sql);
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
          if (!/duplicate column|already exists/i.test(String(e.message))) {
            console.error("D1 run error:", e, "SQL:", sql);
          }
          throw e;
        }
      }
    };
  }

  prepare(sql) {
    let bound = [];
    return {
      bind: (...args) => {
        bound = args;
        return this._mk(sql, bound);
      },
      all: () => this._mk(sql, []).all(),
      first: () => this._mk(sql, []).first(),
      run: () => this._mk(sql, []).run()
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

async function run() {
  console.log("=== Running Admin Batch Promo & Filters Offline Tests ===");

  const adminMod = require('./compiled/admin-batch.js');
  const handleAdminRoutes = adminMod.handleAdminRoutes;

  const mockDb = new SqliteD1Mock();

  // Initialize schema
  const schemaPath = path.join(__dirname, '../schema.sql');
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');
  for (const statement of schemaSql.split(';')) {
    const trimmed = statement.trim();
    if (trimmed) {
      try {
        mockDb.db.exec(trimmed);
      } catch (err) {
        // ignore already exists or sqlite dialect differences
      }
    }
  }

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Secret, X-EQT-Environment',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS'
  };

  const env = {
    DB: mockDb,
    CF_ACCESS_TEAM_DOMAIN: 'local.dev',
    CF_ACCESS_AUD: 'local-dev'
  };

  const ctx = {
    waitUntil: (p) => {
      if (p && typeof p.catch === 'function') p.catch(() => {});
    }
  };

  function adminReq(path, method = 'GET', body = null) {
    const headers = {
      'Cf-Access-Jwt-Assertion': 'local.admin@eqt.net.im',
      'Content-Type': 'application/json'
    };
    const init = { method, headers };
    if (body) init.body = JSON.stringify(body);
    const url = new URL(`https://admin.eqt.net.im${path}`);
    return { req: new Request(url.toString(), init), url };
  }

  // 1. Validation tests on /api/v1/admin/generate-batch
  console.log("\n[Test 1] POST /api/v1/admin/generate-batch validation");
  {
    // count missing / invalid
    const { req, url } = adminReq('/api/v1/admin/generate-batch', 'POST', {
      count: 0,
      tier: 'PLUS'
    });
    const res = await handleAdminRoutes(req, env, ctx, url, corsHeaders);
    assertEqual(res.status, 400, "count=0 returns 400");
  }

  {
    // count > 100
    const { req, url } = adminReq('/api/v1/admin/generate-batch', 'POST', {
      count: 101,
      tier: 'PLUS'
    });
    const res = await handleAdminRoutes(req, env, ctx, url, corsHeaders);
    assertEqual(res.status, 400, "count=101 returns 400");
  }

  {
    // invalid tier
    const { req, url } = adminReq('/api/v1/admin/generate-batch', 'POST', {
      count: 5,
      tier: 'ULTRA'
    });
    const res = await handleAdminRoutes(req, env, ctx, url, corsHeaders);
    assertEqual(res.status, 400, "invalid tier returns 400");
  }

  {
    // promo without expires_in_days
    const { req, url } = adminReq('/api/v1/admin/generate-batch', 'POST', {
      count: 5,
      tier: 'PLUS',
      source: 'promo'
    });
    const res = await handleAdminRoutes(req, env, ctx, url, corsHeaders);
    assertEqual(res.status, 400, "promo without expires_in_days returns 400");
  }

  // 2. Successful batch generation
  console.log("\n[Test 2] POST /api/v1/admin/generate-batch successful minting");
  let promoCodes = [];
  {
    const { req, url } = adminReq('/api/v1/admin/generate-batch', 'POST', {
      count: 10,
      tier: 'PLUS',
      source: 'promo',
      expires_in_days: 30,
      duration_days: 14,
      max_devices: 2
    });
    const res = await handleAdminRoutes(req, env, ctx, url, corsHeaders);
    assertEqual(res.status, 200, "batch mint 10 returns 200");
    const json = await res.json();
    assert(json.success === true, "success is true");
    assertEqual(json.count, 10, "count is 10");
    assertEqual(json.licenses.length, 10, "10 licenses returned");
    assert(json.licenses[0].license_code.startsWith('EQT-PLUS-'), "code format starts with EQT-PLUS-");
    assertEqual(json.licenses[0].source, 'promo', "source is promo");
    assertEqual(json.licenses[0].duration_days, 14, "duration_days is 14");
    promoCodes = json.licenses.map(l => l.license_code);
  }

  // Also mint an admin license and a purchase license for filtering tests
  {
    const { req, url } = adminReq('/api/v1/admin/generate', 'POST', {
      tier: 'PRO',
      source: 'admin',
      max_devices: 3
    });
    const res = await handleAdminRoutes(req, env, ctx, url, corsHeaders);
    assertEqual(res.status, 200, "single admin license created");
  }

  // Insert mock activation for the first promo code (to simulate redeemed)
  {
    const redeemedCode = promoCodes[0];
    await mockDb.prepare(
      "INSERT INTO activations (license_code, uuid_hash, cpu_hash, disk_hash, activated_at, client_ip) VALUES (?, ?, ?, ?, ?, ?)"
    ).bind(redeemedCode, "uuid1", "cpu1", "disk1", new Date().toISOString(), "127.0.0.1").run();
  }

  // 3. Filter licenses by source
  console.log("\n[Test 3] GET /api/v1/admin/licenses filtering by source");
  {
    // filter source=promo
    const { req, url } = adminReq('/api/v1/admin/licenses?source=promo');
    const res = await handleAdminRoutes(req, env, ctx, url, corsHeaders);
    const json = await res.json();
    assertEqual(json.total, 10, "source=promo returns 10 licenses");
    assert(json.licenses.every(l => l.source === 'promo'), "all returned are promo");
  }

  {
    // filter source=admin
    const { req, url } = adminReq('/api/v1/admin/licenses?source=admin');
    const res = await handleAdminRoutes(req, env, ctx, url, corsHeaders);
    const json = await res.json();
    assertEqual(json.total, 1, "source=admin returns 1 license");
    assertEqual(json.licenses[0].source, 'admin', "source is admin");
  }

  // 4. Filter licenses by redeemed status
  console.log("\n[Test 4] GET /api/v1/admin/licenses filtering by redeemed status");
  {
    // redeemed=redeemed
    const { req, url } = adminReq('/api/v1/admin/licenses?source=promo&redeemed=redeemed');
    const res = await handleAdminRoutes(req, env, ctx, url, corsHeaders);
    const json = await res.json();
    assertEqual(json.total, 1, "source=promo&redeemed=redeemed returns 1");
    assertEqual(json.licenses[0].license_code, promoCodes[0], "matched the redeemed promo code");
    assertEqual(json.licenses[0].active_devices_count, 1, "active_devices_count is 1");
  }

  {
    // redeemed=unredeemed
    const { req, url } = adminReq('/api/v1/admin/licenses?source=promo&redeemed=unredeemed');
    const res = await handleAdminRoutes(req, env, ctx, url, corsHeaders);
    const json = await res.json();
    assertEqual(json.total, 9, "source=promo&redeemed=unredeemed returns 9");
    assertEqual(json.licenses[0].active_devices_count, 0, "active_devices_count is 0");
  }

  // 5. Check promo_stats aggregation
  console.log("\n[Test 5] Verify promo_stats in response");
  {
    const { req, url } = adminReq('/api/v1/admin/licenses');
    const res = await handleAdminRoutes(req, env, ctx, url, corsHeaders);
    const json = await res.json();
    assert(Boolean(json.promo_stats), "promo_stats exists in response");
    assertEqual(json.promo_stats.total, 10, "promo_stats.total is 10");
    assertEqual(json.promo_stats.redeemed, 1, "promo_stats.redeemed is 1");
    assertEqual(json.promo_stats.unredeemed, 9, "promo_stats.unredeemed is 9");
    assertEqual(json.promo_stats.expired_unredeemed, 0, "promo_stats.expired_unredeemed is 0 (all within 30 days)");
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

run().catch(err => {
  console.error("Test execution fatal error:", err);
  process.exit(1);
});
