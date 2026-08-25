/**
 * Offline test for zero-payment ($0 / trial / 100% coupon) refund shielding.
 *
 * Verifies that:
 * 1. Webhook fulfillment extracts paid_amount from real Paddle details.totals.grand_total path and writes to D1.
 * 2. Subscription renewal updates paid_amount from details.totals.
 * 3. isLicenseRefundable returns false for paid_amount <= 0.
 * 4. GET /api/v1/user/licenses returns refundable: false for $0 orders.
 * 5. POST /api/v1/user/refund blocks $0 orders with 400 and REFUND_NOT_ALLOWED_ZERO_AMOUNT.
 * 6. POST /api/v1/user/refund falls back to line_items when details.totals is absent instead of falsely blocking.
 */
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const crypto = require('crypto');

const compiledPortalPath = path.join(__dirname, 'compiled', 'portal.js');
const compiledPaddlePath = path.join(__dirname, 'compiled', 'paddle.js');
if (!fs.existsSync(compiledPortalPath) || !fs.existsSync(compiledPaddlePath)) {
  console.error("Compiled handlers not found. Build with esbuild first.");
  process.exit(1);
}
const { handlePortalRoutes } = require(compiledPortalPath);
const { handlePaddleRoutes } = require(compiledPaddlePath);

// MD5 WebCrypto Polyfill for Node.js
{
  const nodeCrypto = require('crypto');
  const origDigest = crypto.subtle.digest.bind(crypto.subtle);
  crypto.subtle.digest = async (algo, data) => {
    const name = typeof algo === 'string' ? algo : (algo && algo.name);
    if (name && name.toUpperCase() === 'MD5') {
      const h = nodeCrypto.createHash('md5').update(Buffer.from(data)).digest();
      return h.buffer.slice(h.byteOffset, h.byteOffset + h.byteLength);
    }
    return origDigest(algo, data);
  };
}

function assert(cond, msg) {
  if (!cond) throw new Error('ASSERT FAIL: ' + msg);
  console.log('  ✓ OK:', msg);
}

async function createPaddleSignature(rawBody, secretKey) {
  const ts = Math.floor(Date.now() / 1000).toString();
  const encoder = new TextEncoder();
  const key = await crypto.webcrypto.subtle.importKey(
    "raw",
    encoder.encode(secretKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sigBuf = await crypto.webcrypto.subtle.sign("HMAC", key, encoder.encode(`${ts}:${rawBody}`));
  const h1 = Array.from(new Uint8Array(sigBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
  return `ts=${ts};h1=${h1}`;
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
    CREATE TABLE IF NOT EXISTS paddle_processed_transactions (
      transaction_id TEXT PRIMARY KEY,
      license_code TEXT,
      action TEXT,
      created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS device_registry (
      device_id TEXT PRIMARY KEY,
      uuid_hash TEXT,
      cpu_hash TEXT,
      disk_hash TEXT,
      tier_label TEXT NOT NULL DEFAULT 'free',
      license_code TEXT DEFAULT NULL,
      email TEXT DEFAULT NULL,
      registered_at TEXT NOT NULL,
      last_seen_at TEXT,
      last_ip TEXT DEFAULT NULL,
      ip_country TEXT DEFAULT NULL,
      city TEXT DEFAULT NULL,
      region TEXT DEFAULT NULL,
      latitude REAL DEFAULT NULL,
      longitude REAL DEFAULT NULL,
      app_version TEXT DEFAULT NULL
    );
    CREATE TABLE IF NOT EXISTS system_error_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL,
      severity TEXT NOT NULL,
      message TEXT NOT NULL,
      context_json TEXT,
      stack_trace TEXT,
      occurred_at TEXT NOT NULL
    );
  `);

  const PADDLE_WEBHOOK_SECRET = 'pdl_whsec_test_zero_payment_12345';
  const PRICE_YEARLY = 'pri_yearly_test_111';
  const PRICE_LIFETIME = 'pri_lifetime_test_222';

  const env = {
    DB: d1,
    PADDLE_API_KEY: 'pdl_live_dummy_test_key',
    PADDLE_WEBHOOK_SECRET: PADDLE_WEBHOOK_SECRET,
    PADDLE_PRICE_ID_PLUS_YEARLY: PRICE_YEARLY,
    PADDLE_PRICE_ID_PLUS_LIFETIME: PRICE_LIFETIME,
    PRICE_YEARLY_ID: PRICE_YEARLY,
    PRICE_LIFETIME_ID: PRICE_LIFETIME
  };
  const ctx = {
    waitUntil: () => {}
  };
  const corsHeaders = { 'Access-Control-Allow-Origin': '*' };

  // -------------------------------------------------------------
  // Part 1: Test Webhook Fulfillment Write Layer for paid_amount
  // -------------------------------------------------------------
  console.log('\n--- Part 1: Webhook Fulfillment & paid_amount Persistence ---');

  // 1A. Normal purchase ($29.99) with Paddle v2 details.totals structure
  const paidTxnId = 'txn_paid_webhook_001';
  const paidPayload = {
    event_type: 'transaction.completed',
    data: {
      id: paidTxnId,
      customer: { email: 'buyer_paid@example.com' },
      items: [{ price_id: PRICE_LIFETIME, quantity: 1, price: { id: PRICE_LIFETIME, unit_price: { amount: '2999', currency_code: 'USD' } } }],
      details: {
        totals: { subtotal: '2999', discount: '0', tax: '0', total: '2999', grand_total: '2999' }
      }
    }
  };
  const rawBodyPaid = JSON.stringify(paidPayload);
  const sigPaid = await createPaddleSignature(rawBodyPaid, PADDLE_WEBHOOK_SECRET);
  const reqPaid = new Request('https://lic.eqt.net.im/api/v1/paddle/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'paddle-signature': sigPaid },
    body: rawBodyPaid
  });
  const resPaid = await handlePaddleRoutes(reqPaid, env, ctx, new URL(reqPaid.url), corsHeaders);
  assert(resPaid && resPaid.status === 200, 'Paid webhook returns 200 OK');
  const paidLicRow = d1.db.prepare(`SELECT * FROM licenses WHERE paddle_transaction_id = ?`).get(paidTxnId);
  assert(paidLicRow && paidLicRow.license_code, 'Paid license was minted in D1');
  assert(paidLicRow.paid_amount === 2999, `paid_amount correctly recorded from details.totals: ${paidLicRow.paid_amount} === 2999`);

  // 1B. Renewal with details.totals structure
  const subLicenseCode = 'EQT-PLUS-20260824-SUB001-3333';
  const subId = 'sub_test_001';
  const nowIso = new Date().toISOString();
  d1.db.exec(`
    INSERT INTO licenses (license_code, tier, status, buyer_email, buyer_email_hash, paddle_transaction_id, paddle_subscription_id, source, paid_amount, created_at, last_purchased_at)
    VALUES ('${subLicenseCode}', 'PLUS', 'active', 'sub_buyer@example.com', 'hash_sub', 'txn_sub_init', '${subId}', 'purchase', 1199, '${nowIso}', '${nowIso}');
  `);

  const renewalTxnId = 'txn_renew_webhook_002';
  const renewPayload = {
    event_type: 'transaction.completed',
    data: {
      id: renewalTxnId,
      subscription_id: subId,
      customer: { email: 'sub_buyer@example.com' },
      items: [{ price_id: PRICE_YEARLY, quantity: 1, price: { id: PRICE_YEARLY, unit_price: { amount: '1199', currency_code: 'USD' } } }],
      details: {
        totals: { subtotal: '1199', discount: '0', tax: '0', total: '1199', grand_total: '1199' }
      }
    }
  };
  const rawBodyRenew = JSON.stringify(renewPayload);
  const sigRenew = await createPaddleSignature(rawBodyRenew, PADDLE_WEBHOOK_SECRET);
  const reqRenew = new Request('https://lic.eqt.net.im/api/v1/paddle/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'paddle-signature': sigRenew },
    body: rawBodyRenew
  });
  const resRenew = await handlePaddleRoutes(reqRenew, env, ctx, new URL(reqRenew.url), corsHeaders);
  assert(resRenew && resRenew.status === 200, 'Renewal webhook returns 200 OK');
  const renewedLicRow = d1.db.prepare(`SELECT * FROM licenses WHERE license_code = ?`).get(subLicenseCode);
  assert(renewedLicRow.paddle_transaction_id === renewalTxnId, 'Renewal updated paddle_transaction_id');
  assert(renewedLicRow.paid_amount === 1199, `paid_amount correctly updated from renewal details.totals: ${renewedLicRow.paid_amount}`);

  // -------------------------------------------------------------
  // Part 2: Test User Portal Licenses & Refund Fast Path
  // -------------------------------------------------------------
  console.log('\n--- Part 2: User Portal Refund Shielding ---');

  const email = 'zero@example.com';
  const emailH = await sha256Hex(email);
  const token = 'token-zero-payment-test';
  const sessionExpiry = new Date(Date.now() + 86400000).toISOString();

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

  // 2A. Test GET /api/v1/user/licenses
  const getReq = new Request('https://lic.eqt.net.im/api/v1/user/licenses', {
    method: 'GET',
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const getRes = await handlePortalRoutes(getReq, env, ctx, new URL(getReq.url), corsHeaders);
  assert(getRes.status === 200, 'GET /licenses status 200');
  const getData = await getRes.json();
  assert(getData.licenses && getData.licenses.length === 2, 'Found 2 licenses for user');

  const zeroItem = getData.licenses.find(l => l.license_code === licZero);
  const paidItem = getData.licenses.find(l => l.license_code === licPaid);

  assert(zeroItem.refundable === false, 'Zero-payment license has refundable: false');
  assert(paidItem.refundable === true, 'Paid license has refundable: true');

  // 2B. Test POST /api/v1/user/refund on zero-payment license (fast-path blocked before network call)
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

  // -------------------------------------------------------------
  // Part 3: Test Real-time Paddle Query & Line Items Fallback in Refund Handler
  // -------------------------------------------------------------
  console.log('\n--- Part 3: Paddle Live Query & Line Items Fallback ---');

  const licUncachedZero = 'EQT-PLUS-20260824-UNC001-4444';
  const licUncachedPaid = 'EQT-PLUS-20260824-UNC002-5555';
  const txnZero = 'txn_01uncachedzero000001';
  const txnPaid = 'txn_01uncachedpaid000002';

  d1.db.exec(`
    INSERT INTO licenses (license_code, tier, status, buyer_email, buyer_email_hash, paddle_transaction_id, paddle_subscription_id, source, paid_amount, created_at, last_purchased_at)
    VALUES ('${licUncachedZero}', 'PLUS', 'active', '${email}', '${emailH}', '${txnZero}', 'sub_01unc010000000001', 'purchase', NULL, '${nowIso}', '${nowIso}');
    INSERT INTO licenses (license_code, tier, status, buyer_email, buyer_email_hash, paddle_transaction_id, paddle_subscription_id, source, paid_amount, created_at, last_purchased_at)
    VALUES ('${licUncachedPaid}', 'PLUS', 'active', '${email}', '${emailH}', '${txnPaid}', 'sub_01unc020000000002', 'purchase', NULL, '${nowIso}', '${nowIso}');
  `);

  // Mock global fetch for Paddle transaction & adjustments API
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    const urlStr = String(url);
    if (urlStr.includes(`/transactions/${txnZero}`)) {
      return new Response(JSON.stringify({
        data: {
          id: txnZero,
          details: {
            totals: { grand_total: '0', total: '0' },
            line_items: [{ id: 'item_1', totals: { grand_total: '0' } }]
          }
        }
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (urlStr.includes(`/transactions/${txnPaid}`)) {
      // Missing details.totals, but has realistic line_items with price.unit_price.amount
      return new Response(JSON.stringify({
        data: {
          id: txnPaid,
          details: {
            line_items: [{ id: 'item_2', price: { unit_price: { amount: '2999' } } }]
          }
        }
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (urlStr.includes('/adjustments')) {
      return new Response(JSON.stringify({
        data: {
          id: 'adj_test_success_123',
          action: 'refund',
          status: 'approved'
        }
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return origFetch(url, opts);
  };

  try {
    // 3A. Refund on uncached 0-amount transaction -> blocked and cached to DB as 0
    const reqUncachedZero = new Request('https://lic.eqt.net.im/api/v1/user/refund', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ license_code: licUncachedZero, lang: 'en' })
    });
    const resUncachedZero = await handlePortalRoutes(reqUncachedZero, env, ctx, new URL(reqUncachedZero.url), corsHeaders);
    assert(resUncachedZero.status === 400, 'Uncached $0 refund returns 400 after Paddle query');
    const uncachedZeroData = await resUncachedZero.json();
    assert(uncachedZeroData.error_code === 'REFUND_NOT_ALLOWED_ZERO_AMOUNT', 'Error code REFUND_NOT_ALLOWED_ZERO_AMOUNT');
    const cachedRow = d1.db.prepare(`SELECT paid_amount FROM licenses WHERE license_code = ?`).get(licUncachedZero);
    assert(cachedRow.paid_amount === 0, `paid_amount was cached into DB: ${cachedRow.paid_amount} === 0`);

    // 3B. Refund on uncached transaction with missing totals but positive line_items -> not blocked by zero amount check
    const reqUncachedPaid = new Request('https://lic.eqt.net.im/api/v1/user/refund', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ license_code: licUncachedPaid, lang: 'en' })
    });
    const resUncachedPaid = await handlePortalRoutes(reqUncachedPaid, env, ctx, new URL(reqUncachedPaid.url), corsHeaders);
    assert(resUncachedPaid.status === 200, 'Uncached paid refund (line_items fallback) proceeds and returns 200');
    const cachedPaidRow = d1.db.prepare(`SELECT paid_amount, status FROM licenses WHERE license_code = ?`).get(licUncachedPaid);
    assert(cachedPaidRow.paid_amount === 2999, `paid_amount was cached from line_items: ${cachedPaidRow.paid_amount} === 2999`);
    assert(cachedPaidRow.status === 'revoked', 'License status updated to revoked upon refund');
  } finally {
    globalThis.fetch = origFetch;
  }

  console.log('\n=== All Zero-Payment Refund Shield Tests Passed! ===\n');
}

run().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
