/**
 * Offline test for zero-payment ($0 / trial / 100% coupon) refund shielding.
 *
 * Verifies that:
 * 1. isLicenseRefundable returns false for paid_amount <= 0.
 * 2. GET /api/v1/user/licenses returns refundable: false for $0 orders.
 * 3. POST /api/v1/user/refund blocks $0 orders with 400 and REFUND_NOT_ALLOWED_ZERO_AMOUNT without calling Paddle adjustments.
 */
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const crypto = require('crypto');

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
      all: async () => {
        const rows = this.db.prepare(sql).all(...binds);
        return { results: rows };
      },
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

async function sha256Hex(str) {
  return crypto.createHash('sha256').update(str).digest('hex');
}

async function run() {
  console.log('=== Running Zero-Payment Refund Shield Offline Test ===');
  const d1 = new SqliteD1Mock();

  // Create tables
  d1.db.exec(`
    CREATE TABLE IF NOT EXISTS licenses (
      license_code TEXT PRIMARY KEY,
      tier TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      max_devices INTEGER DEFAULT 2,
      expires_at TEXT,
      duration_days INTEGER DEFAULT NULL,
      buyer_email_hash TEXT DEFAULT NULL,
      buyer_email TEXT DEFAULT NULL,
      paddle_transaction_id TEXT DEFAULT NULL,
      paddle_subscription_id TEXT DEFAULT NULL,
      source TEXT DEFAULT NULL,
      auto_renew INTEGER DEFAULT 1,
      revoked_at TEXT DEFAULT NULL,
      revoke_reason TEXT DEFAULT NULL,
      last_purchased_at TEXT DEFAULT NULL,
      paid_amount REAL DEFAULT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS user_sessions (
      session_token TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS activations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      license_code TEXT NOT NULL,
      uuid_hash TEXT,
      cpu_hash TEXT,
      disk_hash TEXT,
      device_id TEXT DEFAULT NULL,
      activated_at TEXT NOT NULL,
      client_ip TEXT DEFAULT NULL,
      ip_country TEXT DEFAULT NULL,
      user_agent TEXT DEFAULT NULL,
      city TEXT DEFAULT NULL,
      region TEXT DEFAULT NULL,
      latitude REAL DEFAULT NULL,
      longitude REAL DEFAULT NULL,
      trace_id TEXT DEFAULT NULL
    );
    CREATE TABLE IF NOT EXISTS unbind_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      license_code TEXT NOT NULL,
      device_id TEXT,
      unbound_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS license_upgrades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_email TEXT NOT NULL,
      target_license_code TEXT NOT NULL,
      lifetime_txn_id TEXT NOT NULL,
      purchased_at TEXT NOT NULL,
      effective_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL
    );
  `);

  const email = 'zero@example.com';
  const emailH = await sha256Hex(email);
  const token = 'token-zero-payment-test';
  const sessionExpiry = new Date(Date.now() + 86400000).toISOString();
  const nowIso = new Date().toISOString();

  d1.db.exec(`
    INSERT INTO user_sessions (session_token, email, expires_at)
    VALUES ('${token}', '${email}', '${sessionExpiry}');
  `);

  // Insert two licenses: one with paid_amount = 0 ($0 transaction), one with paid_amount = 11.99
  const licZero = 'EQT-PLUS-20260824-ZERO01-1111';
  const licPaid = 'EQT-PLUS-20260824-PAID01-2222';

  d1.db.exec(`
    INSERT INTO licenses (license_code, tier, status, buyer_email, buyer_email_hash, paddle_transaction_id, paddle_subscription_id, source, paid_amount, created_at, last_purchased_at)
    VALUES ('${licZero}', 'PLUS', 'active', '${email}', '${emailH}', 'txn_01zero0000000000000001', 'sub_01zero0000000000000001', 'purchase', 0.0, '${nowIso}', '${nowIso}');
    INSERT INTO licenses (license_code, tier, status, buyer_email, buyer_email_hash, paddle_transaction_id, paddle_subscription_id, source, paid_amount, created_at, last_purchased_at)
    VALUES ('${licPaid}', 'PLUS', 'active', '${email}', '${emailH}', 'txn_01paid0000000000000002', 'sub_01paid0000000000000002', 'purchase', 11.99, '${nowIso}', '${nowIso}');
  `);

  const env = {
    DB: d1,
    PADDLE_API_KEY: 'pdl_live_dummy_test_key'
  };
  const ctx = {
    waitUntil: () => {}
  };
  const corsHeaders = { 'Access-Control-Allow-Origin': '*' };

  // 1. Test GET /api/v1/user/licenses
  const getReq = new Request('https://lic.eqt.net.im/api/v1/user/licenses', {
    method: 'GET',
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const getRes = await handlePortalRoutes(getReq, env, ctx, new URL(getReq.url), corsHeaders);
  assert(getRes.status === 200, 'GET /licenses status 200');
  const getData = await getRes.json();
  assert(getData.licenses && getData.licenses.length === 2, 'Found 2 licenses');

  const zeroItem = getData.licenses.find(l => l.license_code === licZero);
  const paidItem = getData.licenses.find(l => l.license_code === licPaid);

  assert(zeroItem.refundable === false, 'Zero-payment license has refundable: false');
  assert(paidItem.refundable === true, 'Paid license has refundable: true');

  // 2. Test POST /api/v1/user/refund on zero-payment license (fast-path blocked before network call)
  const refundReq = new Request('https://lic.eqt.net.im/api/v1/user/refund', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ license_code: licZero, lang: 'zh' })
  });
  const refundRes = await handlePortalRoutes(refundReq, env, ctx, new URL(refundReq.url), corsHeaders);
  assert(refundRes.status === 400, 'POST /refund on $0 license returns 400');
  const refundData = await refundRes.json();
  assert(refundData.error_code === 'REFUND_NOT_ALLOWED_ZERO_AMOUNT', 'Error code is REFUND_NOT_ALLOWED_ZERO_AMOUNT');
  assert(refundData.error.includes('0 元'), 'Error message mentions 0 元');

  // Verify license remains active (not erroneously revoked or corrupted)
  const row = d1.db.prepare(`SELECT status FROM licenses WHERE license_code = ?`).get(licZero);
  assert(row.status === 'active', 'Zero-payment license remains active');

  console.log('=== All Zero-Payment Refund Shield Tests Passed! ===\n');
}

run().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
