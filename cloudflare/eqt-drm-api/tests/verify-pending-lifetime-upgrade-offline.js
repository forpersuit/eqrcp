const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Load real compiled Worker handlers
const compiledDrmPath = path.join(__dirname, 'compiled', 'drm.js');
const compiledPaddlePath = path.join(__dirname, 'compiled', 'paddle.js');

if (!fs.existsSync(compiledDrmPath) || !fs.existsSync(compiledPaddlePath)) {
  console.error("Compiled route handlers not found. Please build with esbuild first.");
  process.exit(1);
}

const { checkAndApplyPendingUpgrade } = require(compiledDrmPath);
const { handlePaddleRoutes } = require(compiledPaddlePath);

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

// In-Memory D1 Mock supporting SQL matching for real Workers handlers
class RealWorkerD1Mock {
  constructor() {
    this.tables = {
      licenses: new Map(),
      license_upgrades: new Map(),
      activations: new Map(),
      user_sessions: new Map(),
      unbind_records: new Map(),
      system_error_logs: new Map()
    };
    this.autoIncrement = { license_upgrades: 1, activations: 1, system_error_logs: 1 };
  }

  prepare(sql) {
    const db = this;
    return {
      bind(...args) {
        return {
          async first() {
            return db.executeSqlFirst(sql, args);
          },
          async run() {
            return db.executeSqlRun(sql, args);
          },
          async all() {
            return { results: db.executeSqlAll(sql, args) };
          }
        };
      },
      async first() {
        return db.executeSqlFirst(sql, []);
      },
      async run() {
        return db.executeSqlRun(sql, []);
      },
      async all() {
        return { results: db.executeSqlAll(sql, []) };
      }
    };
  }

  executeSqlFirst(sql, args) {
    const s = sql.replace(/\s+/g, ' ').trim();

    // Query license by license_code
    if (s.includes('SELECT') && s.includes('FROM licenses WHERE license_code =')) {
      const code = args[0];
      return dbRowCopy(this.tables.licenses.get(code));
    }
    // Query license by paddle_subscription_id
    if (s.includes('SELECT') && s.includes('FROM licenses WHERE paddle_subscription_id =')) {
      const subId = args[0];
      for (const row of this.tables.licenses.values()) {
        if (row.paddle_subscription_id === subId) return dbRowCopy(row);
      }
      return null;
    }
    // Query license by paddle_transaction_id
    if (s.includes('SELECT') && s.includes('FROM licenses WHERE paddle_transaction_id =')) {
      const txnId = args[0];
      for (const row of this.tables.licenses.values()) {
        if (row.paddle_transaction_id === txnId) return dbRowCopy(row);
      }
      return null;
    }
    // Query pending license_upgrades by target_license_code
    if (s.includes('SELECT') && s.includes('FROM license_upgrades WHERE target_license_code =') && s.includes("status = 'pending'")) {
      // concurrencyWindow simulates two transactions reading "no pending" before either commits
      if (this.concurrencyWindow) return null;
      const code = args[0];
      for (const row of this.tables.license_upgrades.values()) {
        if (row.target_license_code === code && row.status === 'pending') {
          return dbRowCopy(row);
        }
      }
      return null;
    }
    // Query license_upgrades by lifetime_txn_id
    if (s.includes('SELECT') && s.includes('FROM license_upgrades WHERE lifetime_txn_id =')) {
      const txnId = args[0];
      for (const row of this.tables.license_upgrades.values()) {
        if (row.lifetime_txn_id === txnId) return dbRowCopy(row);
      }
      return null;
    }
    return null;
  }

  executeSqlRun(sql, args) {
    const s = sql.replace(/\s+/g, ' ').trim();

    // Insert license_upgrades (simulating INSERT OR IGNORE + both UNIQUE indexes)
    if (s.includes('INTO license_upgrades')) {
      // idx_upgrades_lifetime_txn UNIQUE: redelivery of the same txn is silently ignored
      for (const row of this.tables.license_upgrades.values()) {
        if (row.lifetime_txn_id === args[2]) return { meta: { changes: 0 } };
      }
      // idx_upgrades_target partial UNIQUE (target_license_code) WHERE status='pending':
      // a concurrent second pending upgrade for the same license is silently ignored → no orphan rows
      for (const row of this.tables.license_upgrades.values()) {
        if (row.target_license_code === args[1] && row.status === 'pending') return { meta: { changes: 0 } };
      }
      const id = this.autoIncrement.license_upgrades++;
      const row = {
        id,
        user_email: args[0],
        target_license_code: args[1],
        lifetime_txn_id: args[2],
        purchased_at: args[3],
        effective_at: args[4],
        status: 'pending',
        created_at: args[5]
      };
      this.tables.license_upgrades.set(id, row);
      return { meta: { changes: 1 } };
    }

    // Insert system_error_logs
    if (s.includes('INSERT INTO system_error_logs')) {
      const id = this.autoIncrement.system_error_logs++;
      this.tables.system_error_logs.set(id, { id, args });
      return { meta: { changes: 1 } };
    }

    // Update license (auto_renew / email update on upgrade)
    if (s.includes('UPDATE licenses SET auto_renew = 0')) {
      const code = args[2];
      const row = this.tables.licenses.get(code);
      if (row) {
        row.auto_renew = 0;
        if (args[0]) row.buyer_email = args[0];
        if (args[1]) row.buyer_email_hash = args[1];
      }
      return { meta: { changes: 1 } };
    }

    // Update license expires_at to LIFETIME (Lazy flip)
    if (s.includes("UPDATE licenses SET expires_at = 'LIFETIME'")) {
      const code = args[0];
      const row = this.tables.licenses.get(code);
      if (row && row.expires_at !== 'LIFETIME') {
        row.expires_at = 'LIFETIME';
        row.duration_days = null;
      }
      return { meta: { changes: 1 } };
    }

    // Revoke license (by license_code or paddle_transaction_id)
    if (s.includes("UPDATE licenses SET status = 'revoked'")) {
      const revokedAt = args[0];
      const reason = args[1];
      const codeOrTxn = args[2];

      const lic = this.tables.licenses.get(codeOrTxn);
      if (lic) {
        lic.status = 'revoked';
        lic.revoke_reason = reason;
        lic.revoked_at = revokedAt;
      } else {
        for (const r of this.tables.licenses.values()) {
          if (r.paddle_transaction_id === codeOrTxn) {
            r.status = 'revoked';
            r.revoke_reason = reason;
            r.revoked_at = revokedAt;
          }
        }
      }
      return { meta: { changes: 1 } };
    }

    // Update upgrade status (applied / cancelled)
    if (s.includes('UPDATE license_upgrades SET status =')) {
      const statusMatch = s.match(/status = '(\w+)'/);
      const newStatus = statusMatch ? statusMatch[1] : 'cancelled';
      const id = args[0];
      const row = this.tables.license_upgrades.get(id);
      if (row) row.status = newStatus;
      return { meta: { changes: 1 } };
    }

    return { meta: { changes: 1 } };
  }

  executeSqlAll(sql, args) {
    return [];
  }
}

function dbRowCopy(row) {
  return row ? JSON.parse(JSON.stringify(row)) : null;
}

const ctx = {
  waitUntil(promise) {
    if (promise && typeof promise.catch === 'function') {
      promise.catch(() => {});
    }
  }
};

const PRICE_LIFETIME_ID = "pri_01kxymyma34hgmndccwswheta3";
const SECRET_KEY = "test_webhook_secret_key";

async function runTests() {
  console.log('========================================');
  console.log('🚀 Running REAL Worker Route Handler Tests for §6.7 Upgrades...');
  console.log('========================================\n');

  const db = new RealWorkerD1Mock();
  const env = { DB: db, PADDLE_WEBHOOK_SECRET: SECRET_KEY };
  const corsHeaders = {};

  const nowMs = Date.now();
  const thirtyDaysAgoIso = new Date(nowMs - 30 * 86400 * 1000).toISOString();
  const futureExpiresIso = new Date(nowMs + 335 * 86400 * 1000).toISOString();
  const targetCode = 'EQT-PLUS-TEST-001';

  db.tables.licenses.set(targetCode, {
    license_code: targetCode,
    tier: 'PLUS',
    status: 'active',
    expires_at: futureExpiresIso,
    duration_days: 365,
    buyer_email: 'user@example.com',
    buyer_email_hash: 'hash123',
    created_at: thirtyDaysAgoIso,
    last_purchased_at: thirtyDaysAgoIso,
    auto_renew: 1,
    paddle_transaction_id: 'txn_yearly_orig_100',
    paddle_subscription_id: 'sub_yearly_orig_200'
  });

  // Test 1: Real Webhook Request for Lifetime Upgrade (Pending)
  console.log('Test 1: REAL handlePaddleRoutes Webhook invocation with HMAC signature (Pending Upgrade)...');
  const upgTxnId = 'txn_lifetime_upg_888';
  const webhookBodyObj = {
    event_type: 'transaction.completed',
    data: {
      id: upgTxnId,
      customer: { email: 'user@example.com' },
      items: [{ price_id: PRICE_LIFETIME_ID }],
      custom_data: { target_license_code: targetCode, buyer_email: 'user@example.com' }
    }
  };
  const rawBody1 = JSON.stringify(webhookBodyObj);
  const sig1 = await createPaddleSignature(rawBody1, SECRET_KEY);

  const req1 = new Request('https://lic.eqt.net.im/api/v1/paddle/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'paddle-signature': sig1 },
    body: rawBody1
  });
  const res1 = await handlePaddleRoutes(req1, env, ctx, new URL(req1.url), corsHeaders);
  assert(res1.status === 200, 'REAL handlePaddleRoutes returned 200 OK');
  const res1Json = await res1.json();
  assert(res1Json.status === 'pending_upgrade', 'REAL handler returned status pending_upgrade');

  const licAfterUpg = db.tables.licenses.get(targetCode);
  assert(licAfterUpg.paddle_transaction_id === 'txn_yearly_orig_100', 'REAL handler preserved original yearly paddle_transaction_id (No overwrite!)');
  assert(licAfterUpg.auto_renew === 0, 'REAL handler updated auto_renew = 0');
  assert(db.tables.license_upgrades.size === 1, 'REAL handler created row in license_upgrades table');

  // Test 2: REAL Duplicate Upgrade Prevention (V1 & V2 & N1)
  console.log('\nTest 2: REAL handlePaddleRoutes idempotent redelivery + duplicate purchase rejection...');

  // 2a: Same transaction re-delivered → idempotent 200 (N1 Fix)
  const req2Idem = new Request('https://lic.eqt.net.im/api/v1/paddle/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'paddle-signature': sig1 },
    body: rawBody1
  });
  const res2Idem = await handlePaddleRoutes(req2Idem, env, ctx, new URL(req2Idem.url), corsHeaders);
  assert(res2Idem.status === 200, 'Same txn redelivery idempotently returns 200 (N1 Fix)');
  const res2IdemJson = await res2Idem.json();
  assert(res2IdemJson.status === 'pending_upgrade', 'Same txn redelivery returns pending_upgrade status');

  // 2b: Different transaction for the same license → 400 UPGRADE_ALREADY_PENDING (V1 Fix)
  const dupWebhookObj = {
    event_type: 'transaction.completed',
    data: { ...webhookBodyObj.data, id: 'txn_lifetime_upg_889' }
  };
  const rawBodyDup = JSON.stringify(dupWebhookObj);
  const sigDup = await createPaddleSignature(rawBodyDup, SECRET_KEY);
  const reqDup = new Request('https://lic.eqt.net.im/api/v1/paddle/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'paddle-signature': sigDup },
    body: rawBodyDup
  });
  const resDup = await handlePaddleRoutes(reqDup, env, ctx, new URL(reqDup.url), corsHeaders);
  assert(resDup.status === 400, 'Duplicate purchase (different txn) correctly rejected with 400 Bad Request (V1 Fix)');
  const resDupJson = await resDup.json();
  assert(resDupJson.code === 'UPGRADE_ALREADY_PENDING', 'REAL handler returned UPGRADE_ALREADY_PENDING code');
  assert(db.tables.license_upgrades.size === 1, 'No extra license_upgrades row inserted for duplicate purchase');

  // Test 3: REAL Refund Window Block (< 14 days) (Issue 4)
  console.log('\nTest 3: REAL handlePaddleRoutes 14-day refund window block...');
  const freshCode = 'EQT-PLUS-FRESH-999';
  const fiveDaysAgoIso = new Date(nowMs - 5 * 86400 * 1000).toISOString();
  db.tables.licenses.set(freshCode, {
    license_code: freshCode,
    tier: 'PLUS',
    status: 'active',
    expires_at: futureExpiresIso,
    created_at: fiveDaysAgoIso,
    last_purchased_at: fiveDaysAgoIso,
    buyer_email: 'fresh@example.com'
  });

  const freshWebhookObj = {
    event_type: 'transaction.completed',
    data: {
      id: 'txn_fresh_upg',
      customer: { email: 'fresh@example.com' },
      items: [{ price_id: PRICE_LIFETIME_ID }],
      custom_data: { target_license_code: freshCode, buyer_email: 'fresh@example.com' }
    }
  };
  const rawBodyFresh = JSON.stringify(freshWebhookObj);
  const sigFresh = await createPaddleSignature(rawBodyFresh, SECRET_KEY);
  const reqFresh = new Request('https://lic.eqt.net.im/api/v1/paddle/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'paddle-signature': sigFresh },
    body: rawBodyFresh
  });
  const resFresh = await handlePaddleRoutes(reqFresh, env, ctx, new URL(reqFresh.url), corsHeaders);
  assert(resFresh.status === 400, 'REAL handler rejected upgrade for license in 14-day refund window with 400 Bad Request');
  const resFreshJson = await resFresh.json();
  assert(resFreshJson.code === 'UPGRADE_BLOCKED_REFUND_WINDOW', 'REAL handler returned UPGRADE_BLOCKED_REFUND_WINDOW code');

  // Test 4: REAL Refund PENDING Upgrade (Upgrade cancelled, Yearly license remains active)
  console.log('\nTest 4: REAL handlePaddleRoutes refund on PENDING lifetime upgrade...');
  const pendingRefundObj = { event_type: 'transaction.refunded', data: { id: upgTxnId } };
  const rawBodyPendingRefund = JSON.stringify(pendingRefundObj);
  const sigPendingRefund = await createPaddleSignature(rawBodyPendingRefund, SECRET_KEY);
  const reqPendingRefund = new Request('https://lic.eqt.net.im/api/v1/paddle/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'paddle-signature': sigPendingRefund },
    body: rawBodyPendingRefund
  });
  const resPendingRefund = await handlePaddleRoutes(reqPendingRefund, env, ctx, new URL(reqPendingRefund.url), corsHeaders);
  assert(resPendingRefund.status === 200, 'Pending refund webhook returned 200 OK');
  const resPendingRefundJson = await resPendingRefund.json();
  assert(resPendingRefundJson.status === 'cancelled', 'REAL handler cancelled pending upgrade on refund');

  const licAfterPendingRefund = db.tables.licenses.get(targetCode);
  assert(licAfterPendingRefund.status === 'active', 'Yearly license remains ACTIVE after pending upgrade refund');

  // Test 5: REAL Lazy Flip Handler
  console.log('\nTest 5: REAL checkAndApplyPendingUpgrade before & after effective date...');
  // Restore upgrade row to pending for lazy flip test
  const upgRow = Array.from(db.tables.license_upgrades.values())[0];
  upgRow.status = 'pending';
  upgRow.effective_at = new Date(nowMs - 1000).toISOString();

  const afterResult = await checkAndApplyPendingUpgrade(env, targetCode, futureExpiresIso);
  assert(afterResult === 'LIFETIME', 'REAL checkAndApplyPendingUpgrade lazy flipped status to LIFETIME!');
  assert(upgRow.status === 'applied', 'REAL checkAndApplyPendingUpgrade set upgrade status = applied');

  // Test 6: REAL handlePaddleRoutes Refund on APPLIED Upgrade (Revokes Target License)
  console.log('\nTest 6: REAL handlePaddleRoutes refund on APPLIED lifetime upgrade...');
  const reqAppliedRefund = new Request('https://lic.eqt.net.im/api/v1/paddle/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'paddle-signature': sigPendingRefund },
    body: rawBodyPendingRefund
  });
  const resAppliedRefund = await handlePaddleRoutes(reqAppliedRefund, env, ctx, new URL(reqAppliedRefund.url), corsHeaders);
  assert(resAppliedRefund.status === 200, 'Applied refund webhook returned 200 OK');
  const resAppliedRefundJson = await resAppliedRefund.json();
  assert(resAppliedRefundJson.status === 'revoked', 'REAL handler returned status revoked for applied upgrade refund');

  const licAfterAppliedRefund = db.tables.licenses.get(targetCode);
  assert(licAfterAppliedRefund.status === 'revoked', 'REAL handler successfully revoked target license in DB by target_license_code!');
  assert(licAfterAppliedRefund.revoke_reason === 'refund', 'REAL handler set revoke_reason = refund');

  // Test 7: REAL concurrent same-code atomicity — partial unique index prevents orphan rows (N3 blind spot)
  console.log('\nTest 7: REAL concurrent different-txn inserts for same code → partial unique index prevents orphan...');
  const dbConc = new RealWorkerD1Mock();
  const envConc = { DB: dbConc, PADDLE_WEBHOOK_SECRET: SECRET_KEY };
  const concCode = 'EQT-PLUS-CONC-777';
  const concCreatedAt = new Date(nowMs - 40 * 86400 * 1000).toISOString();
  dbConc.tables.licenses.set(concCode, {
    license_code: concCode,
    tier: 'PLUS',
    status: 'active',
    expires_at: futureExpiresIso,
    created_at: concCreatedAt,
    last_purchased_at: concCreatedAt,
    buyer_email: 'conc@example.com'
  });

  // Simulate both transactions completing at the same instant: each request reads "no pending" before either commits
  dbConc.concurrencyWindow = true;

  const mkUpgradeReq = async (txnId) => {
    const obj = {
      event_type: 'transaction.completed',
      data: {
        id: txnId,
        customer: { email: 'conc@example.com' },
        items: [{ price_id: PRICE_LIFETIME_ID }],
        custom_data: { target_license_code: concCode, buyer_email: 'conc@example.com' }
      }
    };
    const raw = JSON.stringify(obj);
    const sig = await createPaddleSignature(raw, SECRET_KEY);
    return new Request('https://lic.eqt.net.im/api/v1/paddle/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'paddle-signature': sig },
      body: raw
    });
  };

  const reqConc = new URL('https://lic.eqt.net.im/api/v1/paddle/webhook');
  const resConcA = await handlePaddleRoutes(await mkUpgradeReq('txn_conc_A'), envConc, ctx, reqConc, corsHeaders);
  assert(resConcA.status === 200, 'Concurrent txn A returned 200');
  const resConcB = await handlePaddleRoutes(await mkUpgradeReq('txn_conc_B'), envConc, ctx, reqConc, corsHeaders);
  assert(resConcB.status === 200, 'Concurrent txn B returned 200 (INSERT OR IGNORE silently swallowed, no 400 needed)');

  const concPending = Array.from(dbConc.tables.license_upgrades.values()).filter(r => r.status === 'pending');
  assert(concPending.length === 1, 'Partial unique index kept exactly ONE pending row for the same code (no orphan!)');
  assert(concPending[0].lifetime_txn_id === 'txn_conc_A', 'The surviving pending row is the first transaction (id ASC order)');

  // Lazy flip consumes the single row; nothing left pending afterward
  dbConc.concurrencyWindow = false; // concurrency window closed: subsequent reads see committed state
  concPending[0].effective_at = new Date(nowMs - 1000).toISOString();
  const concFlip = await checkAndApplyPendingUpgrade(envConc, concCode, futureExpiresIso);
  assert(concFlip === 'LIFETIME', 'Lazy flip applied LIFETIME from the single pending row');
  const concPendingAfter = Array.from(dbConc.tables.license_upgrades.values()).filter(r => r.status === 'pending');
  assert(concPendingAfter.length === 0, 'No orphan pending row remains after lazy flip');

  console.log('\n========================================');
  console.log('🎉 ALL 7 REAL WORKER ROUTE INTEGRATION TESTS PASSED PERFECTLY!');
  console.log('========================================\n');
}

runTests().catch(err => {
  console.error(err);
  process.exit(1);
});
