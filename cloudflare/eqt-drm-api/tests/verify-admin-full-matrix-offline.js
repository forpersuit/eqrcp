/**
 * Comprehensive offline verification for Admin API with Full Data State Matrix
 * Covers:
 * 1. License Lifecycle Matrix (12 distinct states: source, status, double expiration, activations, unbinds)
 * 2. Promo Stats aggregation accuracy across multi-state datasets
 * 3. Audit Log Matrix (all 7 operations including BATCH_GENERATE, REVOKE, UNBIND, etc.)
 * 4. Query & Filter combinations (source, status, redeemed, search query)
 * 5. Pagination boundary & deep paging robustness test
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
  console.log("=== [Matrix Test Suite] Admin Query, Pagination & Audit Log Matrix ===");

  const adminMod = require('./compiled/admin-batch.js');
  const handleAdminRoutes = adminMod.handleAdminRoutes;

  const mockDb = new SqliteD1Mock();

  // Load schema
  const schemaPath = path.join(__dirname, '../schema.sql');
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');
  for (const statement of schemaSql.split(';')) {
    const trimmed = statement.trim();
    if (trimmed) {
      try {
        mockDb.db.exec(trimmed);
      } catch (err) {}
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

  const now = new Date();
  const past30d = new Date(now.getTime() - 30 * 86400000).toISOString();
  const past5d = new Date(now.getTime() - 5 * 86400000).toISOString();
  const past2d = new Date(now.getTime() - 2 * 86400000).toISOString();
  const future10d = new Date(now.getTime() + 10 * 86400000).toISOString();
  const future30d = new Date(now.getTime() + 30 * 86400000).toISOString();

  console.log("\n[Setup] Populating 12 Distinct License Lifecycle States...");

  // Matrix of 12 License States:
  const licenseSeed = [
    // 1. Promo Active Unredeemed (valid window, not redeemed yet)
    { code: 'EQT-PLUS-PROMO-UNRED', tier: 'PLUS', status: 'active', source: 'promo', max_devices: 2, expires_at: future30d, duration_days: 14, created_at: past2d },
    // 2. Promo Overdue Unredeemed (redeem window expired, 0 activations)
    { code: 'EQT-PLUS-PROMO-EXPIRED', tier: 'PLUS', status: 'active', source: 'promo', max_devices: 2, expires_at: past5d, duration_days: 14, created_at: past30d },
    // 3. Promo Redeemed Active (activated 2 days ago, within 14-day duration)
    { code: 'EQT-PLUS-PROMO-RED-ACT', tier: 'PLUS', status: 'active', source: 'promo', max_devices: 2, expires_at: future10d, duration_days: 14, created_at: past5d },
    // 4. Promo Redeemed Full Devices (activated on 2 devices, max reached)
    { code: 'EQT-PRO-PROMO-RED-FULL', tier: 'PRO', status: 'active', source: 'promo', max_devices: 2, expires_at: future30d, duration_days: 30, created_at: past5d },
    // 5. Promo Revoked by Admin
    { code: 'EQT-PLUS-PROMO-REVOKED', tier: 'PLUS', status: 'revoked', source: 'promo', max_devices: 2, expires_at: future30d, duration_days: 14, revoke_reason: 'admin', created_at: past5d },
    
    // 6. Purchase Active Lifetime (standard purchase with Paddle txn, 1 activation)
    { code: 'EQT-PRO-PURCHASE-LIFE', tier: 'PRO', status: 'active', source: 'purchase', max_devices: 3, expires_at: 'LIFETIME', paddle_txn: 'txn_life_001', buyer_email: 'buyer1@eqt.im', created_at: past30d },
    // 7. Purchase Active Subscription (auto-renewing active sub)
    { code: 'EQT-PRO-PURCHASE-SUB', tier: 'PRO', status: 'active', source: 'purchase', max_devices: 3, expires_at: future30d, paddle_txn: 'txn_sub_002', buyer_email: 'sub@eqt.im', created_at: past5d },
    // 8. Purchase Revoked Refund (user refunded on Paddle)
    { code: 'EQT-PLUS-PURCHASE-REFUND', tier: 'PLUS', status: 'revoked', source: 'purchase', max_devices: 2, expires_at: 'LIFETIME', paddle_txn: 'txn_ref_003', buyer_email: 'refund@eqt.im', revoke_reason: 'refund', created_at: past30d },
    // 9. Purchase Revoked Chargeback (fraud/chargeback)
    { code: 'EQT-PRO-PURCHASE-CHARGEBACK', tier: 'PRO', status: 'revoked', source: 'purchase', max_devices: 3, expires_at: 'LIFETIME', paddle_txn: 'txn_cb_004', buyer_email: 'fraud@eqt.im', revoke_reason: 'chargeback', created_at: past30d },
    // 10. Purchase Suspended
    { code: 'EQT-PLUS-PURCHASE-SUSPENDED', tier: 'PLUS', status: 'suspended', source: 'purchase', max_devices: 2, expires_at: 'LIFETIME', paddle_txn: 'txn_sus_005', buyer_email: 'sus@eqt.im', created_at: past5d },

    // 11. Admin Internal Dev License (LIFETIME, manual grant)
    { code: 'EQT-PRO-ADMIN-DEV', tier: 'PRO', status: 'active', source: 'admin', max_devices: 5, expires_at: 'LIFETIME', buyer_email: 'internal-dev@eqt.im', created_at: past30d },
    // 12. Test Sandbox License (restricted to bound device)
    { code: 'EQT-PLUS-TEST-BOUND', tier: 'PLUS', status: 'active', source: 'test', max_devices: 1, expires_at: future10d, duration_days: 7, bound_device_id: 'dev_test_node_01', created_at: past2d }
  ];

  for (const lic of licenseSeed) {
    mockDb.db.prepare(`
      INSERT INTO licenses (license_code, tier, status, max_devices, expires_at, duration_days, paddle_transaction_id, buyer_email, source, bound_device_id, revoke_reason, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      lic.code, lic.tier, lic.status, lic.max_devices, lic.expires_at,
      lic.duration_days || null, lic.paddle_txn || null, lic.buyer_email || null,
      lic.source, lic.bound_device_id || null, lic.revoke_reason || null, lic.created_at
    );
  }

  // Populate activations & unbinds:
  // Promo RED-ACT has 1 device
  mockDb.db.prepare(`
    INSERT INTO activations (license_code, device_id, uuid_hash, cpu_hash, disk_hash, activated_at, client_ip, ip_country, city)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run('EQT-PLUS-PROMO-RED-ACT', 'dev_promo_1', 'u_1', 'c_1', 'd_1', past2d, '1.1.1.1', 'JP', 'Tokyo');

  // Promo RED-FULL has 2 devices
  mockDb.db.prepare(`
    INSERT INTO activations (license_code, device_id, uuid_hash, cpu_hash, disk_hash, activated_at, client_ip, ip_country, city)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run('EQT-PRO-PROMO-RED-FULL', 'dev_promo_full_1', 'u_2', 'c_2', 'd_2', past5d, '2.2.2.2', 'US', 'San Francisco');
  mockDb.db.prepare(`
    INSERT INTO activations (license_code, device_id, uuid_hash, cpu_hash, disk_hash, activated_at, client_ip, ip_country, city)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run('EQT-PRO-PROMO-RED-FULL', 'dev_promo_full_2', 'u_3', 'c_3', 'd_3', past2d, '2.2.2.3', 'US', 'San Jose');

  // Purchase LIFE has 1 device + 1 unbind history record
  mockDb.db.prepare(`
    INSERT INTO activations (id, license_code, device_id, uuid_hash, cpu_hash, disk_hash, activated_at, client_ip, ip_country, city)
    VALUES (101, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run('EQT-PRO-PURCHASE-LIFE', 'dev_life_current', 'u_4', 'c_4', 'd_4', past5d, '8.8.8.8', 'SG', 'Singapore');

  mockDb.db.prepare(`
    INSERT INTO unbind_records (license_code, activation_id, unbound_at)
    VALUES (?, ?, ?)
  `).run('EQT-PRO-PURCHASE-LIFE', 99, past5d);

  // Populate Audit Logs for 7 different operations
  console.log("[Setup] Populating Admin Audit Logs for 7 Operations...");
  const auditSeed = [
    { action: 'GENERATE', target_type: 'LICENSE', target_id: 'EQT-PRO-ADMIN-DEV', details: { tier: 'PRO', source: 'admin', max_devices: 5, expires_at: 'LIFETIME' } },
    { action: 'BATCH_GENERATE', target_type: 'LICENSE', target_id: null, details: { count: 50, tier: 'PLUS', source: 'promo', max_devices: 2, expires_at: future30d, duration_days: 14 } },
    { action: 'REVOKE', target_type: 'LICENSE', target_id: 'EQT-PLUS-PURCHASE-REFUND', details: { reason: 'refund', previous_status: 'active' } },
    { action: 'UNBIND', target_type: 'ACTIVATION', target_id: '99', details: { license_code: 'EQT-PRO-PURCHASE-LIFE', device_id: 'dev_old' } },
    { action: 'CLEAR_LOGS', target_type: 'SYSTEM', target_id: null, details: { count: 120 } },
    { action: 'RESET_CIRCUIT_BREAKER', target_type: 'TLS_CIRCUIT', target_id: 'gts_ca', details: { previous_state: 'OPEN', new_state: 'CLOSED' } },
    { action: 'RESET_IP_RATE_LIMIT', target_type: 'TLS_RATE_LIMIT', target_id: '1.2.3.4', details: { ip: '1.2.3.4', cleared: true } }
  ];

  for (const aud of auditSeed) {
    mockDb.db.prepare(`
      INSERT INTO admin_audit_logs (action, target_type, target_id, details_json, operator_ip, created_at)
      VALUES (?, ?, ?, ?, '127.0.0.1', ?)
    `).run(aud.action, aud.target_type, aud.target_id, JSON.stringify(aud.details), past2d);
  }

  // --- Test Suite Execution ---

  console.log("\n[Test 1] Verify Promo Stats Aggregation Accuracy across 12-state dataset");
  {
    const { req, url } = adminReq('/api/v1/admin/licenses');
    const res = await handleAdminRoutes(req, env, ctx, url, corsHeaders);
    assertEqual(res.status, 200, "GET /licenses returns 200");
    const json = await res.json();
    assertEqual(json.total, 12, "Total licenses matches 12 seed records");
    
    // Promo breakdown:
    // Total promo: 5 (UNRED, EXPIRED, RED-ACT, RED-FULL, REVOKED)
    // Redeemed: 2 (RED-ACT, RED-FULL)
    // Unredeemed (valid deadline): 2 (UNRED, REVOKED has future deadline and 0 acts)
    // Expired Unredeemed: 1 (EXPIRED)
    const stats = json.promo_stats;
    assertEqual(stats.total, 5, "promo_stats.total is 5");
    assertEqual(stats.redeemed, 2, "promo_stats.redeemed is 2");
    assertEqual(stats.unredeemed, 2, "promo_stats.unredeemed is 2");
    assertEqual(stats.expired_unredeemed, 1, "promo_stats.expired_unredeemed is 1");
  }

  console.log("\n[Test 2] Filter by Source Matrix (promo, purchase, admin, test)");
  {
    // source=promo
    const resPromo = await handleAdminRoutes(adminReq('/api/v1/admin/licenses?source=promo').req, env, ctx, adminReq('/api/v1/admin/licenses?source=promo').url, corsHeaders);
    const jsonPromo = await resPromo.json();
    assertEqual(jsonPromo.total, 5, "source=promo returns 5 records");

    // source=purchase
    const resPur = await handleAdminRoutes(adminReq('/api/v1/admin/licenses?source=purchase').req, env, ctx, adminReq('/api/v1/admin/licenses?source=purchase').url, corsHeaders);
    const jsonPur = await resPur.json();
    assertEqual(jsonPur.total, 5, "source=purchase returns 5 records");

    // source=admin
    const resAdm = await handleAdminRoutes(adminReq('/api/v1/admin/licenses?source=admin').req, env, ctx, adminReq('/api/v1/admin/licenses?source=admin').url, corsHeaders);
    const jsonAdm = await resAdm.json();
    assertEqual(jsonAdm.total, 1, "source=admin returns 1 record");

    // source=test
    const resTest = await handleAdminRoutes(adminReq('/api/v1/admin/licenses?source=test').req, env, ctx, adminReq('/api/v1/admin/licenses?source=test').url, corsHeaders);
    const jsonTest = await resTest.json();
    assertEqual(jsonTest.total, 1, "source=test returns 1 record");
  }

  console.log("\n[Test 3] Filter by Status Matrix (active, revoked, suspended)");
  {
    // status=active
    const resAct = await handleAdminRoutes(adminReq('/api/v1/admin/licenses?status=active').req, env, ctx, adminReq('/api/v1/admin/licenses?status=active').url, corsHeaders);
    const jsonAct = await resAct.json();
    assertEqual(jsonAct.total, 8, "status=active returns 8 records");

    // status=revoked
    const resRev = await handleAdminRoutes(adminReq('/api/v1/admin/licenses?status=revoked').req, env, ctx, adminReq('/api/v1/admin/licenses?status=revoked').url, corsHeaders);
    const jsonRev = await resRev.json();
    assertEqual(jsonRev.total, 3, "status=revoked returns 3 records");

    // status=suspended
    const resSus = await handleAdminRoutes(adminReq('/api/v1/admin/licenses?status=suspended').req, env, ctx, adminReq('/api/v1/admin/licenses?status=suspended').url, corsHeaders);
    const jsonSus = await resSus.json();
    assertEqual(jsonSus.total, 1, "status=suspended returns 1 record");
  }

  console.log("\n[Test 4] Filter by Redeemed Status Matrix (redeemed vs unredeemed)");
  {
    // redeemed=redeemed
    const resRed = await handleAdminRoutes(adminReq('/api/v1/admin/licenses?redeemed=redeemed').req, env, ctx, adminReq('/api/v1/admin/licenses?redeemed=redeemed').url, corsHeaders);
    const jsonRed = await resRed.json();
    assertEqual(jsonRed.total, 3, "redeemed=redeemed returns 3 records (2 promo + 1 purchase)");

    // redeemed=unredeemed
    const resUnred = await handleAdminRoutes(adminReq('/api/v1/admin/licenses?redeemed=unredeemed').req, env, ctx, adminReq('/api/v1/admin/licenses?redeemed=unredeemed').url, corsHeaders);
    const jsonUnred = await resUnred.json();
    assertEqual(jsonUnred.total, 9, "redeemed=unredeemed returns 9 records");
  }

  console.log("\n[Test 5] Compound Filter Combinations (source=promo + redeemed=unredeemed + status=active)");
  {
    const resCompound = await handleAdminRoutes(
      adminReq('/api/v1/admin/licenses?source=promo&redeemed=unredeemed&status=active').req,
      env, ctx,
      adminReq('/api/v1/admin/licenses?source=promo&redeemed=unredeemed&status=active').url,
      corsHeaders
    );
    const jsonComp = await resCompound.json();
    assertEqual(jsonComp.total, 2, "source=promo & unredeemed & active returns 2 records (UNRED and EXPIRED)");
  }

  console.log("\n[Test 6] Search Query Matching (Paddle Txn, Email, Bound Device, License Code)");
  {
    // Search by Paddle transaction
    const resTxn = await handleAdminRoutes(adminReq('/api/v1/admin/licenses?q=txn_sub_002').req, env, ctx, adminReq('/api/v1/admin/licenses?q=txn_sub_002').url, corsHeaders);
    assertEqual((await resTxn.json()).total, 1, "Search by paddle txn matches exactly 1");

    // Search by Email
    const resEmail = await handleAdminRoutes(adminReq('/api/v1/admin/licenses?q=buyer1@eqt.im').req, env, ctx, adminReq('/api/v1/admin/licenses?q=buyer1@eqt.im').url, corsHeaders);
    assertEqual((await resEmail.json()).total, 1, "Search by email matches 1");

    // Search by Bound Device
    const resCode = await handleAdminRoutes(adminReq('/api/v1/admin/licenses?q=TEST-BOUND').req, env, ctx, adminReq('/api/v1/admin/licenses?q=TEST-BOUND').url, corsHeaders);
    assertEqual((await resCode.json()).total, 1, "Search by partial license code matches 1");
  }

  console.log("\n[Test 7] Pagination & Limits Boundary Robustness");
  {
    // Page 1: limit 5, offset 0
    const resP1 = await handleAdminRoutes(adminReq('/api/v1/admin/licenses?limit=5&offset=0').req, env, ctx, adminReq('/api/v1/admin/licenses?limit=5&offset=0').url, corsHeaders);
    const jsonP1 = await resP1.json();
    assertEqual(jsonP1.licenses.length, 5, "Page 1 returns 5 records");
    assertEqual(jsonP1.total, 12, "Total remains 12");

    // Page 2: limit 5, offset 5
    const resP2 = await handleAdminRoutes(adminReq('/api/v1/admin/licenses?limit=5&offset=5').req, env, ctx, adminReq('/api/v1/admin/licenses?limit=5&offset=5').url, corsHeaders);
    const jsonP2 = await resP2.json();
    assertEqual(jsonP2.licenses.length, 5, "Page 2 returns 5 records");

    // Page 3: limit 5, offset 10 (tail page)
    const resP3 = await handleAdminRoutes(adminReq('/api/v1/admin/licenses?limit=5&offset=10').req, env, ctx, adminReq('/api/v1/admin/licenses?limit=5&offset=10').url, corsHeaders);
    const jsonP3 = await resP3.json();
    assertEqual(jsonP3.licenses.length, 2, "Page 3 returns 2 tail records");

    // Deep page out of bounds: offset 100
    const resP4 = await handleAdminRoutes(adminReq('/api/v1/admin/licenses?limit=5&offset=100').req, env, ctx, adminReq('/api/v1/admin/licenses?limit=5&offset=100').url, corsHeaders);
    const jsonP4 = await resP4.json();
    assertEqual(jsonP4.licenses.length, 0, "Out of bounds page returns empty array without error");

    // Non-overlapping check between P1 and P2
    const p1Codes = new Set(jsonP1.licenses.map(l => l.license_code));
    const p2Overlap = jsonP2.licenses.some(l => p1Codes.has(l.license_code));
    assert(!p2Overlap, "Pagination has zero overlap between consecutive pages");
  }

  console.log("\n[Test 8] Admin Audit Log Query & Action Filtering (7 Action Types)");
  {
    // Query all logs
    const resAllLogs = await handleAdminRoutes(adminReq('/api/v1/admin/audit-logs').req, env, ctx, adminReq('/api/v1/admin/audit-logs').url, corsHeaders);
    const jsonAllLogs = await resAllLogs.json();
    assertEqual(jsonAllLogs.total, 7, "Total audit logs matches 7 seed operations");

    // Query BATCH_GENERATE
    const resBatchLog = await handleAdminRoutes(adminReq('/api/v1/admin/audit-logs?action=BATCH_GENERATE').req, env, ctx, adminReq('/api/v1/admin/audit-logs?action=BATCH_GENERATE').url, corsHeaders);
    const jsonBatchLog = await resBatchLog.json();
    assertEqual(jsonBatchLog.total, 1, "Action BATCH_GENERATE filtered correctly");
    const batchDetails = JSON.parse(jsonBatchLog.logs[0].details_json);
    assertEqual(batchDetails.count, 50, "Audit details records count=50");
    assertEqual(batchDetails.duration_days, 14, "Audit details records duration_days=14");

    // Query REVOKE
    const resRevokeLog = await handleAdminRoutes(adminReq('/api/v1/admin/audit-logs?action=REVOKE').req, env, ctx, adminReq('/api/v1/admin/audit-logs?action=REVOKE').url, corsHeaders);
    assertEqual((await resRevokeLog.json()).total, 1, "Action REVOKE filtered correctly");

    // Query UNBIND
    const resUnbindLog = await handleAdminRoutes(adminReq('/api/v1/admin/audit-logs?action=UNBIND').req, env, ctx, adminReq('/api/v1/admin/audit-logs?action=UNBIND').url, corsHeaders);
    assertEqual((await resUnbindLog.json()).total, 1, "Action UNBIND filtered correctly");

    // Query CLEAR_LOGS
    const resClearLog = await handleAdminRoutes(adminReq('/api/v1/admin/audit-logs?action=CLEAR_LOGS').req, env, ctx, adminReq('/api/v1/admin/audit-logs?action=CLEAR_LOGS').url, corsHeaders);
    assertEqual((await resClearLog.json()).total, 1, "Action CLEAR_LOGS filtered correctly");

    // Query RESET_CIRCUIT_BREAKER
    const resCircuitLog = await handleAdminRoutes(adminReq('/api/v1/admin/audit-logs?action=RESET_CIRCUIT_BREAKER').req, env, ctx, adminReq('/api/v1/admin/audit-logs?action=RESET_CIRCUIT_BREAKER').url, corsHeaders);
    assertEqual((await resCircuitLog.json()).total, 1, "Action RESET_CIRCUIT_BREAKER filtered correctly");
  }

  console.log("\n============================================================");
  console.log(`Matrix Test Results: ${passed} passed, ${failed} failed`);
  console.log("============================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

run().catch(err => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
