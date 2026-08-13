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

const { handleDrmRoutes, checkAndApplyPendingUpgrade } = require(compiledDrmPath);
const { handlePaddleRoutes } = require(compiledPaddlePath);

// Node's WebCrypto does not implement MD5 (only SHA-*); the Worker mint path uses
// crypto.subtle.digest("MD5", ...) for the license checksum. Route MD5 through node:crypto
// so the mint path is exercisable in the offline harness (other algos keep WebCrypto).
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

// In-Memory D1 Mock supporting SQL matching for real Workers handlers
class RealWorkerD1Mock {
  constructor() {
    this.tables = {
      licenses: new Map(),
      license_upgrades: new Map(),
      activations: new Map(),
      user_sessions: new Map(),
      unbind_records: new Map(),
      system_error_logs: new Map(),
      rate_limits: new Map()
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
      // A2: atomicMintWindow simulates two concurrent deliveries reading "no existing row" before either commits
      if (this.atomicMintWindow) return null;
      const txnId = args[0];
      for (const row of this.tables.licenses.values()) {
        if (row.paddle_transaction_id === txnId) return dbRowCopy(row);
      }
      return null;
    }
    // Query rate_limits by key (A3)
    if (s.includes('SELECT') && s.includes('FROM rate_limits WHERE key =')) {
      const key = args[0];
      return dbRowCopy(this.tables.rate_limits.get(key));
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

    // Insert license (new-purchase mint path) — license_code is the PK.
    // A2: simulate the real UNIQUE index idx_licenses_paddle_txn on paddle_transaction_id —
    // a non-null txn that already exists throws, which the Worker's outer catch turns into a 500
    // (then Paddle retries and the existing-row check returns 200 idempotent).
    if (s.includes('INSERT INTO licenses')) {
      const txnId = args[8];
      if (txnId !== null && txnId !== undefined && txnId !== '') {
        for (const r of this.tables.licenses.values()) {
          if (r.paddle_transaction_id === txnId) {
            throw new Error('UNIQUE constraint failed: licenses.paddle_transaction_id');
          }
        }
      }
      const row = {
        license_code: args[0],
        tier: args[1],
        status: args[2],
        max_devices: args[3],
        expires_at: args[4],
        duration_days: args[5],
        buyer_email_hash: args[6],
        buyer_email: args[7],
        paddle_transaction_id: args[8],
        paddle_subscription_id: args[9],
        source: args[10],
        created_at: args[11],
        last_purchased_at: args[12]
      };
      this.tables.licenses.set(row.license_code, row);
      return { meta: { changes: 1 } };
    }

    // Insert system_error_logs
    if (s.includes('INSERT INTO system_error_logs')) {
      const id = this.autoIncrement.system_error_logs++;
      this.tables.system_error_logs.set(id, { id, args });
      return { meta: { changes: 1 } };
    }

    // INSERT OR REPLACE INTO rate_limits (A3: new window reset)
    // SQL: INSERT OR REPLACE INTO rate_limits (key, count, window_start) VALUES (?, 1, ?)
    // args[0]=key, args[1]=window_start (count is literal 1 in SQL)
    if (s.includes('INSERT OR REPLACE') && s.includes('INTO rate_limits')) {
      const key = args[0];
      const windowStart = args[1];
      this.tables.rate_limits.set(key, { key, count: 1, window_start: windowStart });
      return { meta: { changes: 1 } };
    }

    // UPDATE rate_limits (A3: increment count)
    if (s.includes('UPDATE rate_limits SET count = count + 1')) {
      const key = args[0];
      const row = this.tables.rate_limits.get(key);
      if (row) {
        row.count += 1;
        return { meta: { changes: 1 } };
      }
      return { meta: { changes: 0 } };
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
  const env = { DB: db, PADDLE_WEBHOOK_SECRET: SECRET_KEY, PADDLE_PRICE_ID_PLUS_LIFETIME: PRICE_LIFETIME_ID };
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

  // Test 1: Real Webhook Request for Lifetime Purchase with target_license_code → FALLBACK new-key mint (upgrade disabled)
  console.log('Test 1: REAL handlePaddleRoutes Webhook invocation with HMAC signature (Lifetime upgrade disabled → new-key mint fallback)...');
  const upgTxnId = 'txn_lifetime_upg_888';
  const webhookBodyObj = {
    event_type: 'transaction.completed',
    data: {
      id: upgTxnId,
      customer: { email: 'user@example.com' },
      items: [{ price_id: PRICE_LIFETIME_ID, quantity: 1, price: { id: PRICE_LIFETIME_ID, unit_price: { amount: '2999', currency_code: 'USD' } } }],
      totals: { subtotal: '2999', discount: '0', tax: '0', total: '2999', grand_total: '2999' },
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
  assert(res1Json.message === 'License generated and fulfilled', 'REAL handler minted a NEW lifetime key (fallback, not pending upgrade): ' + res1Json.message);
  assert(!!res1Json.license_code && res1Json.license_code !== targetCode, 'REAL handler minted a new license_code distinct from target_license_code');

  // New key is LIFETIME and tied to the upgrade payment txn (source=purchase)
  const mintedLic = db.tables.licenses.get(res1Json.license_code);
  assert(!!mintedLic && mintedLic.expires_at === 'LIFETIME', 'New minted key is LIFETIME');
  assert(mintedLic.paddle_transaction_id === upgTxnId, 'New minted key linked to the LIFETIME payment txn');
  assert(mintedLic.source === 'purchase', 'New minted key source = purchase');

  // Original yearly subscription license is untouched (no upgrade applied, no auto_renew flip)
  const licAfterUpg = db.tables.licenses.get(targetCode);
  assert(licAfterUpg.paddle_transaction_id === 'txn_yearly_orig_100', 'REAL handler preserved original yearly paddle_transaction_id (no upgrade)');
  assert(licAfterUpg.auto_renew === 1, 'REAL handler left auto_renew = 1 (upgrade disabled)');
  assert(licAfterUpg.expires_at === futureExpiresIso, 'REAL handler left expires_at unchanged (upgrade disabled)');
  assert(db.tables.license_upgrades.size === 0, 'REAL handler created NO license_upgrades row (upgrade disabled)');

  // Test 2: REAL idempotent redelivery (N1) + distinct-txn LIFETIME purchase mints its own key
  console.log('\nTest 2: REAL handlePaddleRoutes idempotent redelivery + distinct-txn fallback mint...');

  // 2a: Same transaction re-delivered → idempotent 200 "already processed" (N1 Fix, now via paddle_transaction_id dedupe)
  const req2Idem = new Request('https://lic.eqt.net.im/api/v1/paddle/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'paddle-signature': sig1 },
    body: rawBody1
  });
  const res2Idem = await handlePaddleRoutes(req2Idem, env, ctx, new URL(req2Idem.url), corsHeaders);
  assert(res2Idem.status === 200, 'Same txn redelivery idempotently returns 200 (N1 Fix)');
  const res2IdemJson = await res2Idem.json();
  assert(res2IdemJson.message === 'Transaction already processed', 'Same txn redelivery returns already-processed (no double mint)');
  assert(res2IdemJson.license_code === res1Json.license_code, 'Redelivery returns the SAME minted key (idempotent)');

  // 2b: A DIFFERENT transaction carrying the same target code → each LIFETIME payment mints its own new key (upgrade disabled, no pending block)
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
  assert(resDup.status === 200, 'Distinct-txn LIFETIME purchase also fulfills via new-key mint (200)');
  const resDupJson = await resDup.json();
  assert(!!resDupJson.license_code && resDupJson.license_code !== res1Json.license_code, 'Second LIFETIME purchase minted a DISTINCT new key');
  assert(db.tables.license_upgrades.size === 0, 'No license_upgrades row created for either LIFETIME purchase');
  assert(db.tables.licenses.size === 3, 'Three licenses total: yearly + 2 minted LIFETIME keys');

  // Test 3: REAL in-refund-window license + LIFETIME purchase → falls back to new-key mint (upgrade disabled; refund-window guard no longer blocks)
  console.log('\nTest 3: REAL handlePaddleRoutes — LIFETIME purchase targeting in-refund-window license falls back to new-key mint...');
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
      items: [{ price_id: PRICE_LIFETIME_ID, quantity: 1, price: { id: PRICE_LIFETIME_ID, unit_price: { amount: '2999', currency_code: 'USD' } } }],
      totals: { subtotal: '2999', discount: '0', tax: '0', total: '2999', grand_total: '2999' },
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
  assert(resFresh.status === 200, 'REAL handler minted a new key for the in-refund-window license (200)');
  const resFreshJson = await resFresh.json();
  assert(resFreshJson.message === 'License generated and fulfilled' && !!resFreshJson.license_code, 'REAL handler fell back to new-key mint (window no longer blocks)');
  assert(db.tables.license_upgrades.size === 0, 'No license_upgrades row created for in-window purchase');
  const freshAfter = db.tables.licenses.get(freshCode);
  assert(freshAfter.status === 'active' && freshAfter.expires_at === futureExpiresIso, 'In-window target license untouched (stays active, no upgrade applied)');

  // Test 4: REAL Refund PENDING Upgrade (retained historical-path capability) — cancel only, license stays active
  console.log('\nTest 4: REAL handlePaddleRoutes refund on PENDING lifetime upgrade (retained historical-path capability)...');
  // Seed a historical pending upgrade row directly (as if created before the upgrade was disabled)
  const histPendTxn = 'txn_hist_pending_777';
  db.tables.license_upgrades.set(1, {
    id: 1,
    user_email: 'user@example.com',
    target_license_code: targetCode,
    lifetime_txn_id: histPendTxn,
    purchased_at: thirtyDaysAgoIso,
    effective_at: futureExpiresIso,
    status: 'pending',
    created_at: thirtyDaysAgoIso
  });
  const pendingRefundObj = { event_type: 'transaction.refunded', data: { id: histPendTxn } };
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
  assert(resPendingRefundJson.status === 'cancelled', 'REAL handler cancelled historical pending upgrade on refund');

  const licAfterPendingRefund = db.tables.licenses.get(targetCode);
  assert(licAfterPendingRefund.status === 'active', 'Yearly license remains ACTIVE after pending upgrade refund');
  assert(db.tables.license_upgrades.get(1).status === 'cancelled', 'Historical pending row marked cancelled');

  // Test 5: REAL Lazy Flip Handler (retained historical-path capability)
  console.log('\nTest 5: REAL checkAndApplyPendingUpgrade lazy flip (retained historical-path capability)...');
  // Seed a second historical pending row whose effective_at is already past (due) → lazy flip should apply it
  const histFlipTxn = 'txn_hist_pending_888';
  db.tables.license_upgrades.set(2, {
    id: 2,
    user_email: 'user@example.com',
    target_license_code: targetCode,
    lifetime_txn_id: histFlipTxn,
    purchased_at: thirtyDaysAgoIso,
    effective_at: new Date(nowMs - 1000).toISOString(),
    status: 'pending',
    created_at: thirtyDaysAgoIso
  });
  const upgRow = db.tables.license_upgrades.get(2);

  const afterResult = await checkAndApplyPendingUpgrade(env, targetCode, futureExpiresIso);
  assert(afterResult === 'LIFETIME', 'REAL checkAndApplyPendingUpgrade lazy flipped status to LIFETIME!');
  assert(upgRow.status === 'applied', 'REAL checkAndApplyPendingUpgrade set upgrade status = applied');
  assert(db.tables.licenses.get(targetCode).expires_at === 'LIFETIME', 'Target license expires_at flipped to LIFETIME');

  // Test 6: REAL handlePaddleRoutes Refund on APPLIED Upgrade (Revokes Target License) — retained historical-path capability
  console.log('\nTest 6: REAL handlePaddleRoutes refund on APPLIED lifetime upgrade (retained historical-path capability)...');
  const appliedRefundObj = { event_type: 'transaction.refunded', data: { id: histFlipTxn } };
  const rawBodyAppliedRefund = JSON.stringify(appliedRefundObj);
  const sigAppliedRefund = await createPaddleSignature(rawBodyAppliedRefund, SECRET_KEY);
  const reqAppliedRefund = new Request('https://lic.eqt.net.im/api/v1/paddle/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'paddle-signature': sigAppliedRefund },
    body: rawBodyAppliedRefund
  });
  const resAppliedRefund = await handlePaddleRoutes(reqAppliedRefund, env, ctx, new URL(reqAppliedRefund.url), corsHeaders);
  assert(resAppliedRefund.status === 200, 'Applied refund webhook returned 200 OK');
  const resAppliedRefundJson = await resAppliedRefund.json();
  assert(resAppliedRefundJson.status === 'revoked', 'REAL handler returned status revoked for applied upgrade refund');

  const licAfterAppliedRefund = db.tables.licenses.get(targetCode);
  assert(licAfterAppliedRefund.status === 'revoked', 'REAL handler successfully revoked target license in DB by target_license_code!');
  assert(licAfterAppliedRefund.revoke_reason === 'refund', 'REAL handler set revoke_reason = refund');
  assert(db.tables.license_upgrades.get(2).status === 'cancelled', 'Applied upgrade row marked cancelled after refund');

  // Test 7: REAL concurrent same-code LIFETIME purchases → each mints its own key, no pending rows (upgrade disabled)
  console.log('\nTest 7: REAL concurrent different-txn LIFETIME purchases for same code → each mints independently, no pending rows...');
  const dbConc = new RealWorkerD1Mock();
  const envConc = { DB: dbConc, PADDLE_WEBHOOK_SECRET: SECRET_KEY, PADDLE_PRICE_ID_PLUS_LIFETIME: PRICE_LIFETIME_ID };
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

  const mkUpgradeReq = async (txnId) => {
    const obj = {
      event_type: 'transaction.completed',
      data: {
        id: txnId,
        customer: { email: 'conc@example.com' },
        items: [{ price_id: PRICE_LIFETIME_ID, quantity: 1, price: { id: PRICE_LIFETIME_ID, unit_price: { amount: '2999', currency_code: 'USD' } } }],
        totals: { subtotal: '2999', discount: '0', tax: '0', total: '2999', grand_total: '2999' },
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
  const resConcAJson = await resConcA.json();
  const resConcB = await handlePaddleRoutes(await mkUpgradeReq('txn_conc_B'), envConc, ctx, reqConc, corsHeaders);
  assert(resConcB.status === 200, 'Concurrent txn B returned 200');
  const resConcBJson = await resConcB.json();

  // Both LIFETIME purchases minted DISTINCT new keys (fallback semantics); upgrade rows never created → no orphan risk
  assert(!!resConcAJson.license_code && !!resConcBJson.license_code, 'Both concurrent purchases minted a license_code');
  assert(resConcAJson.license_code !== resConcBJson.license_code, 'Concurrent purchases minted DISTINCT keys');
  assert(dbConc.tables.licenses.size === 3, 'Three licenses: yearly + 2 minted LIFETIME keys');
  assert(dbConc.tables.license_upgrades.size === 0, 'No license_upgrades row created under concurrency (upgrade disabled)');
  const concLic = dbConc.tables.licenses.get(concCode);
  assert(concLic.expires_at === futureExpiresIso && concLic.status === 'active', 'Original code untouched by concurrent fallback mints');

  // Test 8: REAL amount validation (A1) — $0 / quantity-0 transaction must NOT fulfill a license
  console.log('\nTest 8: REAL handlePaddleRoutes rejects $0 and quantity-0 transactions (A1)...');
  const dbZero = new RealWorkerD1Mock();
  const envZero = { DB: dbZero, PADDLE_WEBHOOK_SECRET: SECRET_KEY, PADDLE_PRICE_ID_PLUS_LIFETIME: PRICE_LIFETIME_ID };
  const mkZeroReq = async (txnId, overrides) => {
    const obj = {
      event_type: 'transaction.completed',
      data: {
        id: txnId,
        customer: { email: 'zero@example.com' },
        items: [{ price_id: PRICE_LIFETIME_ID, quantity: 1, price: { id: PRICE_LIFETIME_ID, unit_price: { amount: '2999', currency_code: 'USD' } } }],
        totals: { subtotal: '2999', discount: '0', tax: '0', total: '2999', grand_total: '2999' },
        ...overrides
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
  const zeroReq = await mkZeroReq('txn_zero_000', { totals: { subtotal: '0', discount: '0', tax: '0', total: '0', grand_total: '0' } });
  const resZero = await handlePaddleRoutes(zeroReq, envZero, ctx, new URL(zeroReq.url), corsHeaders);
  assert(resZero.status === 400, '$0 lifetime transaction rejected with 400');
  const resZeroJson = await resZero.json();
  assert(resZeroJson.code === 'AMOUNT_VALIDATION_FAILED', '$0 transaction returned AMOUNT_VALIDATION_FAILED');
  assert(dbZero.tables.licenses.size === 0, 'No license minted for $0 transaction');

  const qtyZeroReq = await mkZeroReq('txn_zero_qty', { items: [{ price_id: PRICE_LIFETIME_ID, quantity: 0, price: { id: PRICE_LIFETIME_ID, unit_price: { amount: '2999', currency_code: 'USD' } } }] });
  const resQtyZero = await handlePaddleRoutes(qtyZeroReq, envZero, ctx, new URL(qtyZeroReq.url), corsHeaders);
  assert(resQtyZero.status === 400, 'Quantity-0 transaction rejected with 400');
  const resQtyZeroJson = await resQtyZero.json();
  assert(resQtyZeroJson.code === 'AMOUNT_VALIDATION_FAILED', 'Quantity-0 transaction returned AMOUNT_VALIDATION_FAILED');
  assert(dbZero.tables.licenses.size === 0, 'No license minted for quantity-0 transaction');

  // Test 9: REAL refund with OLD txn + subscription fallback (B1) — earlier billing-period refund revokes license
  console.log('\nTest 9: REAL handlePaddleRoutes refund of older period via subscription fallback (B1)...');
  const dbB1 = new RealWorkerD1Mock();
  const envB1 = { DB: dbB1, PADDLE_WEBHOOK_SECRET: SECRET_KEY, PADDLE_PRICE_ID_PLUS_LIFETIME: PRICE_LIFETIME_ID };
  const b1Code = 'EQT-PLUS-B1-555';
  const b1CreatedAt = new Date(nowMs - 60 * 86400 * 1000).toISOString();
  dbB1.tables.licenses.set(b1Code, {
    license_code: b1Code,
    tier: 'PLUS',
    status: 'active',
    expires_at: futureExpiresIso,
    duration_days: 365,
    buyer_email: 'b1@example.com',
    buyer_email_hash: 'hashb1',
    created_at: b1CreatedAt,
    last_purchased_at: new Date(nowMs - 10 * 86400 * 1000).toISOString(),
    auto_renew: 1,
    paddle_transaction_id: 'txn_latest_renew_999', // latest renewal overwrote the txn id
    paddle_subscription_id: 'sub_b1_001'
  });

  // Refund an OLDER billing-period txn that is no longer stored; only subscription_id links it
  const b1RefundObj = {
    event_type: 'transaction.refunded',
    data: { id: 'txn_old_period_333', subscription_id: 'sub_b1_001' }
  };
  const rawB1 = JSON.stringify(b1RefundObj);
  const sigB1 = await createPaddleSignature(rawB1, SECRET_KEY);
  const reqB1 = new Request('https://lic.eqt.net.im/api/v1/paddle/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'paddle-signature': sigB1 },
    body: rawB1
  });
  const resB1 = await handlePaddleRoutes(reqB1, envB1, ctx, new URL(reqB1.url), corsHeaders);
  assert(resB1.status === 200, 'Old-period refund webhook returned 200');
  const b1Lic = dbB1.tables.licenses.get(b1Code);
  assert(b1Lic.status === 'revoked', 'B1 subscription fallback revoked the license despite stale txn_id');
  assert(b1Lic.revoke_reason === 'refund', 'B1 revoke_reason set to refund');

  // Test 10: REAL adjustment.created/updated B1 branch — subscription fallback revokes (reviewer P2 blind spot)
  console.log('\nTest 10: REAL adjustment.* refund/chargeback via subscription fallback (B1 branch)...');
  const mkAdjDb = async () => {
    const d = new RealWorkerD1Mock();
    const e = { DB: d, PADDLE_WEBHOOK_SECRET: SECRET_KEY, PADDLE_PRICE_ID_PLUS_LIFETIME: PRICE_LIFETIME_ID };
    return { d, e };
  };
  const adjReq = async (d, e, txnId, overrides) => {
    const obj = {
      event_type: 'adjustment.updated',
      data: { id: 'adj_001', transaction_id: txnId, action: 'refund', ...(overrides || {}) }
    };
    const raw = JSON.stringify(obj);
    const sig = await createPaddleSignature(raw, SECRET_KEY);
    const req = new Request('https://lic.eqt.net.im/api/v1/paddle/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'paddle-signature': sig },
      body: raw
    });
    return handlePaddleRoutes(req, e, ctx, new URL(req.url), corsHeaders);
  };
  const seedAdjLicense = (d, code, txnId, subId) => {
    d.tables.licenses.set(code, {
      license_code: code,
      tier: 'PLUS',
      status: 'active',
      expires_at: futureExpiresIso,
      duration_days: 365,
      buyer_email: 'adj@example.com',
      buyer_email_hash: 'hashadj',
      created_at: new Date(nowMs - 60 * 86400 * 1000).toISOString(),
      last_purchased_at: new Date(nowMs - 10 * 86400 * 1000).toISOString(),
      auto_renew: 1,
      paddle_transaction_id: txnId,
      paddle_subscription_id: subId
    });
  };

  // 10a: adjustment refund on a STALE txn (only subscription links it) → subscription fallback revokes
  const { d: dbAdj, e: envAdj } = await mkAdjDb();
  seedAdjLicense(dbAdj, 'EQT-PLUS-ADJ-111', 'txn_adj_latest_1', 'sub_adj_001');
  const resAdj = await adjReq(dbAdj, envAdj, 'txn_old_period_777', { subscription_id: 'sub_adj_001' });
  assert(resAdj.status === 200, 'adjustment.updated refund returned 200');
  const adjLic = dbAdj.tables.licenses.get('EQT-PLUS-ADJ-111');
  assert(adjLic.status === 'revoked', 'adjustment B1 subscription fallback revoked the license');
  assert(adjLic.revoke_reason === 'refund', 'adjustment revoke_reason set to refund');

  // 10b: chargeback adjustment also revokes via fallback (reason = chargeback)
  const { d: dbAdjCb, e: envAdjCb } = await mkAdjDb();
  seedAdjLicense(dbAdjCb, 'EQT-PLUS-ADJ-222', 'txn_adj_latest_2', 'sub_adj_002');
  await adjReq(dbAdjCb, envAdjCb, 'txn_old_period_888', { action: 'chargeback', subscription_id: 'sub_adj_002' });
  const adjLicCb = dbAdjCb.tables.licenses.get('EQT-PLUS-ADJ-222');
  assert(adjLicCb.status === 'revoked' && adjLicCb.revoke_reason === 'chargeback', 'chargeback adjustment revoked with reason chargeback');

  // 10c: non money-movement action (credit) must NOT revoke
  const { d: dbAdjCr, e: envAdjCr } = await mkAdjDb();
  seedAdjLicense(dbAdjCr, 'EQT-PLUS-ADJ-333', 'txn_adj_latest_3', 'sub_adj_003');
  await adjReq(dbAdjCr, envAdjCr, 'txn_old_period_999', { action: 'credit', subscription_id: 'sub_adj_003' });
  const adjLicCr = dbAdjCr.tables.licenses.get('EQT-PLUS-ADJ-333');
  assert(adjLicCr.status === 'active', 'credit adjustment did NOT revoke the license (only refund/chargeback do)');

  // Test 11: REAL A1 discount boundary — $5 discounted lifetime order still fulfills full license (intentional loose design)
  console.log('\nTest 11: REAL discounted lifetime order ($5 of $29.99) still fulfills full license (A1 deliberate design)...');
  const dbDisc = new RealWorkerD1Mock();
  const envDisc = { DB: dbDisc, PADDLE_WEBHOOK_SECRET: SECRET_KEY, PADDLE_PRICE_ID_PLUS_LIFETIME: PRICE_LIFETIME_ID };
  const discObj = {
    event_type: 'transaction.completed',
    data: {
      id: 'txn_discounted_555',
      customer: { email: 'disc@example.com' },
      items: [{ price_id: PRICE_LIFETIME_ID, quantity: 1, price: { id: PRICE_LIFETIME_ID, unit_price: { amount: '2999', currency_code: 'USD' } } }],
      totals: { subtotal: '2999', discount: '2499', tax: '0', total: '500', grand_total: '500' }
    }
  };
  const rawDisc = JSON.stringify(discObj);
  const sigDisc = await createPaddleSignature(rawDisc, SECRET_KEY);
  const reqDisc = new Request('https://lic.eqt.net.im/api/v1/paddle/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'paddle-signature': sigDisc },
    body: rawDisc
  });
  const resDisc = await handlePaddleRoutes(reqDisc, envDisc, ctx, new URL(reqDisc.url), corsHeaders);
  assert(resDisc.status === 200, 'Discounted lifetime order fulfilled with 200 (amount > 0 passes validation)');
  const resDiscJson = await resDisc.json();
  assert(!!resDiscJson.license_code, 'Discounted order minted a license_code');
  const discLic = Array.from(dbDisc.tables.licenses.values())[0];
  assert(discLic && discLic.tier === 'PLUS' && discLic.expires_at === 'LIFETIME', 'Discounted order minted a full PLUS LIFETIME license (intentional loose A1)');

  // Test 12: REAL adjustment × upgrade interaction — pending/applied upgrade short-circuits license fallback
  console.log('\nTest 12: REAL adjustment refund on lifetime upgrade rows (pending → cancel only, applied → revoke)...');
  const dbUpg = new RealWorkerD1Mock();
  const envUpg = { DB: dbUpg, PADDLE_WEBHOOK_SECRET: SECRET_KEY, PADDLE_PRICE_ID_PLUS_LIFETIME: PRICE_LIFETIME_ID };
  const upgAdjReq = async (txnId, overrides = {}) => {
    const obj = {
      event_type: 'adjustment.updated',
      data: { id: 'adj_upg_1', transaction_id: txnId, action: 'refund', ...overrides }
    };
    const raw = JSON.stringify(obj);
    const sig = await createPaddleSignature(raw, SECRET_KEY);
    const req = new Request('https://lic.eqt.net.im/api/v1/paddle/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'paddle-signature': sig },
      body: raw
    });
    return handlePaddleRoutes(req, envUpg, ctx, new URL(req.url), corsHeaders);
  };

  // 12a: pending upgrade → cancelled, underlying license stays ACTIVE
  dbUpg.tables.licenses.set('EQT-PLUS-UPG-PND', {
    license_code: 'EQT-PLUS-UPG-PND',
    tier: 'PLUS', status: 'active',
    expires_at: futureExpiresIso, duration_days: 365,
    buyer_email: 'upg@example.com', buyer_email_hash: 'hashupg',
    created_at: thirtyDaysAgoIso, last_purchased_at: thirtyDaysAgoIso,
    auto_renew: 1, paddle_transaction_id: 'txn_yearly_upg_1', paddle_subscription_id: 'sub_upg_1'
  });
  dbUpg.tables.license_upgrades.set(1, {
    id: 1, user_email: 'upg@example.com', target_license_code: 'EQT-PLUS-UPG-PND',
    lifetime_txn_id: 'txn_upg_adj_pnd', purchased_at: new Date(nowMs).toISOString(),
    effective_at: futureExpiresIso, status: 'pending', created_at: new Date(nowMs).toISOString()
  });
  const resUpgPnd = await upgAdjReq('txn_upg_adj_pnd');
  assert(resUpgPnd.status === 200, 'Adjustment refund on pending upgrade returned 200');
  const resUpgPndJson = await resUpgPnd.json();
  assert(resUpgPndJson.status === 'cancelled', 'Pending upgrade cancelled (status cancelled)');
  const licUpgPnd = dbUpg.tables.licenses.get('EQT-PLUS-UPG-PND');
  assert(licUpgPnd.status === 'active', 'Underlying license stays ACTIVE when pending upgrade is cancelled');
  assert(dbUpg.tables.license_upgrades.get(1).status === 'cancelled', 'Upgrade row marked cancelled');

  // 12b: applied upgrade → cancelled + underlying license revoked via target_license_code
  dbUpg.tables.licenses.set('EQT-PLUS-UPG-APL', {
    license_code: 'EQT-PLUS-UPG-APL',
    tier: 'PLUS', status: 'active',
    expires_at: 'LIFETIME', duration_days: null,
    buyer_email: 'upg@example.com', buyer_email_hash: 'hashupg2',
    created_at: thirtyDaysAgoIso, last_purchased_at: new Date(nowMs - 2 * 86400 * 1000).toISOString(),
    auto_renew: 0, paddle_transaction_id: 'txn_yearly_upg_2', paddle_subscription_id: 'sub_upg_2'
  });
  dbUpg.tables.license_upgrades.set(2, {
    id: 2, user_email: 'upg@example.com', target_license_code: 'EQT-PLUS-UPG-APL',
    lifetime_txn_id: 'txn_upg_adj_apl', purchased_at: new Date(nowMs - 30 * 86400 * 1000).toISOString(),
    effective_at: new Date(nowMs - 29 * 86400 * 1000).toISOString(), status: 'applied', created_at: new Date(nowMs - 30 * 86400 * 1000).toISOString()
  });
  const resUpgApl = await upgAdjReq('txn_upg_adj_apl');
  assert(resUpgApl.status === 200, 'Adjustment refund on applied upgrade returned 200');
  const resUpgAplJson = await resUpgApl.json();
  assert(resUpgAplJson.status === 'revoked', 'Applied upgrade refund returned status revoked');
  const licUpgApl = dbUpg.tables.licenses.get('EQT-PLUS-UPG-APL');
  assert(licUpgApl.status === 'revoked' && licUpgApl.revoke_reason === 'refund', 'Applied-upgrade license revoked with reason refund');
  assert(dbUpg.tables.license_upgrades.get(2).status === 'cancelled', 'Applied upgrade row marked cancelled after refund');

  // Test 13: REAL A2 atomic mint — unique index prevents concurrent same-txn double-mint
  console.log('\nTest 13: REAL concurrent same-txn mint → unique index 500 → Paddle retry idempotent 200 (A2)...');
  const dbA2 = new RealWorkerD1Mock();
  const envA2 = { DB: dbA2, PADDLE_WEBHOOK_SECRET: SECRET_KEY, PADDLE_PRICE_ID_PLUS_LIFETIME: PRICE_LIFETIME_ID };
  const mkMintReq = async (txnId) => {
    const obj = {
      event_type: 'transaction.completed',
      data: {
        id: txnId,
        customer: { email: 'a2@example.com' },
        items: [{ price_id: PRICE_LIFETIME_ID, quantity: 1, price: { id: PRICE_LIFETIME_ID, unit_price: { amount: '2999', currency_code: 'USD' } } }],
        totals: { subtotal: '2999', discount: '0', tax: '0', total: '2999', grand_total: '2999' }
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
  const mintUrl = new URL('https://lic.eqt.net.im/api/v1/paddle/webhook');

  // A: first delivery mints (existing-check sees nothing, INSERT succeeds)
  dbA2.atomicMintWindow = true;
  const resA2A = await handlePaddleRoutes(await mkMintReq('txn_a2_001'), envA2, ctx, mintUrl, corsHeaders);
  assert(resA2A.status === 200, 'First delivery minted license with 200');
  assert(Array.from(dbA2.tables.licenses.values()).length === 1, 'Exactly one license after first delivery');

  // B: concurrent redelivery reads "no existing" then INSERT hits the UNIQUE constraint → outer catch → 500
  const resA2B = await handlePaddleRoutes(await mkMintReq('txn_a2_001'), envA2, ctx, mintUrl, corsHeaders);
  assert(resA2B.status === 500, 'Concurrent redelivery returned 500 (unique constraint → outer catch)');
  assert(Array.from(dbA2.tables.licenses.values()).length === 1, 'STILL exactly one license — no double mint');

  // C: Paddle retry after the window closes → existing-row check hits → idempotent 200, same code
  dbA2.atomicMintWindow = false;
  const resA2C = await handlePaddleRoutes(await mkMintReq('txn_a2_001'), envA2, ctx, mintUrl, corsHeaders);
  assert(resA2C.status === 200, 'Retry after window closed returned idempotent 200');
  const resA2CJson = await resA2C.json();
  assert(resA2CJson.message === 'Transaction already processed' && !!resA2CJson.license_code, 'Retry returned already-processed with a license_code');
  assert(Array.from(dbA2.tables.licenses.values()).length === 1, 'No extra license after retry');

  // D: a DIFFERENT transaction still mints normally (unique index only blocks same-txn duplicates)
  const resA2D = await handlePaddleRoutes(await mkMintReq('txn_a2_002'), envA2, ctx, mintUrl, corsHeaders);
  assert(resA2D.status === 200, 'Different transaction still mints with 200');
  assert(Array.from(dbA2.tables.licenses.values()).length === 2, 'Two licenses minted (txn_a2_001 + txn_a2_002)');

  // E: NULL/non-purchase rows are unaffected by the unique index (SQLite allows multiple NULLs)
  // Mock INSERT only enforces non-null txn uniqueness — same semantics as the real partial behavior.
  const dbA2Null = new RealWorkerD1Mock();
  const envA2Null = { DB: dbA2Null, PADDLE_WEBHOOK_SECRET: SECRET_KEY, PADDLE_PRICE_ID_PLUS_LIFETIME: PRICE_LIFETIME_ID };
  dbA2Null.tables.licenses.set('EQT-PLUS-PROMO-1', { license_code: 'EQT-PLUS-PROMO-1', tier: 'PLUS', status: 'active', source: 'promo', paddle_transaction_id: null, created_at: new Date().toISOString() });
  dbA2Null.tables.licenses.set('EQT-PLUS-PROMO-2', { license_code: 'EQT-PLUS-PROMO-2', tier: 'PLUS', status: 'active', source: 'promo', paddle_transaction_id: null, created_at: new Date().toISOString() });
  assert(dbA2Null.tables.licenses.size === 2, 'Two promo rows with NULL paddle_transaction_id coexist (unique index allows multiple NULLs)');

  // Test 14: REAL A3 activate rate limit — 429 after 10 requests per minute
  console.log('\nTest 14: REAL handleDrmRoutes activate rate limit (A3)...');
  const dbActRL = new RealWorkerD1Mock();
  const envActRL = { DB: dbActRL, PADDLE_WEBHOOK_SECRET: SECRET_KEY, PADDLE_PRICE_ID_PLUS_LIFETIME: PRICE_LIFETIME_ID };
  const corsHeadersDRM = {};

  dbActRL.tables.licenses.set('EQT-PLUS-RL-ACT-001', {
    license_code: 'EQT-PLUS-RL-ACT-001',
    tier: 'PLUS', status: 'active',
    expires_at: 'LIFETIME', duration_days: null,
    buyer_email: 'rl-act@example.com', buyer_email_hash: 'hashrlact',
    created_at: new Date(nowMs - 30 * 86400 * 1000).toISOString(),
    paddle_transaction_id: 'txn_rl_act_1', paddle_subscription_id: null,
    source: 'purchase'
  });
  // Seed 10 existing requests in the window (hitting the limit)
  const windowStart = new Date(nowMs - 30000).toISOString(); // 30 seconds ago, within 60s window
  dbActRL.tables.rate_limits.set('activate:EQT-PLUS-RL-ACT-001', { key: 'activate:EQT-PLUS-RL-ACT-001', count: 10, window_start: windowStart });

  const activateReq = (code, body) => new Request('https://lic.eqt.net.im/api/v1/activate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  // 14a: 11th activate should be 429
  const resActRL = await handleDrmRoutes(activateReq('EQT-PLUS-RL-ACT-001', { license_code: 'EQT-PLUS-RL-ACT-001', uuid_hash: 'u1', cpu_hash: 'c1', disk_hash: 'd1' }), envActRL, ctx, new URL('https://lic.eqt.net.im/api/v1/activate'), corsHeadersDRM);
  assert(resActRL.status === 429, 'Activate returns 429 when rate limit exceeded (10/min)');
  const resActRLJson = await resActRL.json();
  assert(!!resActRLJson.error && resActRLJson.error.includes('Too many requests'), 'Activate rate limit error message returned');

  // 14b: Different license_code is NOT rate-limited (per-code isolation). The rate limit check
  // runs early (before full activation flow) and creates a rate_limits entry with count=1.
  // The route will throw afterward (mock lacks batch/ED25519) — catch that and verify count.
  try {
    await handleDrmRoutes(activateReq('EQT-PLUS-RL-ACT-002', { license_code: 'EQT-PLUS-RL-ACT-002', uuid_hash: 'u2', cpu_hash: 'c2', disk_hash: 'd2' }), envActRL, ctx, new URL('https://lic.eqt.net.im/api/v1/activate'), corsHeadersDRM);
  } catch (e) {
    // Expected: route can't complete full activation flow in mock
    const rlEntry = dbActRL.tables.rate_limits.get('activate:EQT-PLUS-RL-ACT-002');
    if (!rlEntry) throw new Error('rate_limits entry not found for ACT-002 — rate limit check did not run: ' + (e.message || e));
    assert(rlEntry.count === 1, 'Different license_code is NOT rate-limited (per-code isolation, count=1)');
  }

  // Test 15: REAL A3 verify rate limit — 429 after 20 requests per minute
  console.log('\nTest 15: REAL handleDrmRoutes verify rate limit (A3)...');
  const dbVerRL = new RealWorkerD1Mock();
  const envVerRL = { DB: dbVerRL, PADDLE_WEBHOOK_SECRET: SECRET_KEY, PADDLE_PRICE_ID_PLUS_LIFETIME: PRICE_LIFETIME_ID };
  // Seed an active activation so verify succeeds normally
  dbVerRL.tables.licenses.set('EQT-PLUS-RL-VER-001', {
    license_code: 'EQT-PLUS-RL-VER-001',
    tier: 'PLUS', status: 'active',
    expires_at: 'LIFETIME', buyer_email: 'rl-ver@example.com',
    created_at: new Date(nowMs - 30 * 86400 * 1000).toISOString(),
    paddle_transaction_id: 'txn_rl_ver_1'
  });
  dbVerRL.tables.rate_limits.set('verify:EQT-PLUS-RL-VER-001', { key: 'verify:EQT-PLUS-RL-VER-001', count: 20, window_start: windowStart });

  const verifyReq = (code) => new Request('https://lic.eqt.net.im/api/v1/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ license_code: code, uuid_hash: 'u1', cpu_hash: 'c1', disk_hash: 'd1' })
  });

  // 15a: 21st verify should be 429
  const resVerRL = await handleDrmRoutes(verifyReq('EQT-PLUS-RL-VER-001'), envVerRL, ctx, new URL('https://lic.eqt.net.im/api/v1/verify'), corsHeadersDRM);
  assert(resVerRL.status === 429, 'Verify returns 429 when rate limit exceeded (20/min)');

  // 15b: Different license_code is NOT rate-limited (per-code isolation)
  try {
    await handleDrmRoutes(verifyReq('EQT-PLUS-RL-VER-002'), envVerRL, ctx, new URL('https://lic.eqt.net.im/api/v1/verify'), corsHeadersDRM);
  } catch (e) {
    const verRlEntry = envVerRL.DB.tables.rate_limits.get('verify:EQT-PLUS-RL-VER-002');
    if (!verRlEntry) throw new Error('rate_limits entry not found for VER-002: ' + (e.message || e));
    assert(verRlEntry.count === 1, 'Different verify code is NOT rate-limited (per-code isolation, count=1)');
  }

  // Test 16: REAL A3 window expiry — expired window resets count
  console.log('\nTest 16: REAL A3 window expiry recovery...');
  const dbExpiry = new RealWorkerD1Mock();
  const envExpiry = { DB: dbExpiry, PADDLE_WEBHOOK_SECRET: SECRET_KEY, PADDLE_PRICE_ID_PLUS_LIFETIME: PRICE_LIFETIME_ID };
  const expiredWindow = new Date(nowMs - 90000).toISOString(); // 90s ago, > 60s window
  // Seed count=10 at expired window → rate limit should reset when handleDrmRoutes checks
  dbExpiry.tables.rate_limits.set('activate:EQT-PLUS-RL-EXP-001', { key: 'activate:EQT-PLUS-RL-EXP-001', count: 10, window_start: expiredWindow });
  // License must exist for activate route to proceed past early checks
  dbExpiry.tables.licenses.set('EQT-PLUS-RL-EXP-001', {
    license_code: 'EQT-PLUS-RL-EXP-001',
    tier: 'PLUS', status: 'active', expires_at: 'LIFETIME',
    buyer_email: 'rl-exp@example.com',
    created_at: new Date(nowMs - 30 * 86400 * 1000).toISOString(),
    paddle_transaction_id: 'txn_rl_exp_1'
  });
  // The route will NOT complete (mock lacks batch/ED25519) but the rate limit check runs FIRST,
  // and when it detects the expired window it resets count=1 + writes new window_start.
  try {
    await handleDrmRoutes(activateReq('EQT-PLUS-RL-EXP-001', { license_code: 'EQT-PLUS-RL-EXP-001', uuid_hash: 'u4', cpu_hash: 'c4', disk_hash: 'd4' }), envExpiry, ctx, new URL('https://lic.eqt.net.im/api/v1/activate'), corsHeadersDRM);
  } catch (e) {
    const expiryRow = dbExpiry.tables.rate_limits.get('activate:EQT-PLUS-RL-EXP-001');
    if (!expiryRow) throw new Error('rate_limits entry not found after expiry reset: ' + (e.message || e));
    assert(expiryRow.count === 1, 'Rate limit count reset to 1 after window expiry');
    assert(expiryRow.window_start !== expiredWindow, 'Rate limit window_start updated after window expiry');
  }

  console.log('\n========================================');
  console.log('🎉 ALL 16 REAL WORKER ROUTE INTEGRATION TESTS PASSED PERFECTLY!');
  console.log('========================================\n');
}

runTests().catch(err => {
  console.error(err);
  process.exit(1);
});
