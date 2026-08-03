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

    // Insert license_upgrades
    if (s.includes('INSERT INTO license_upgrades')) {
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

// Dummy ExecutionContext for Workers waitUntil
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

  // Test 1: Real Webhook Request to handlePaddleRoutes for Lifetime Upgrade
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
    headers: {
      'Content-Type': 'application/json',
      'paddle-signature': sig1
    },
    body: rawBody1
  });
  const url1 = new URL(req1.url);

  // Directly execute the REAL compiled Worker handler!
  const res1 = await handlePaddleRoutes(req1, env, ctx, url1, corsHeaders);
  assert(res1.status === 200, 'REAL handlePaddleRoutes returned 200 OK');
  const res1Json = await res1.json();
  assert(res1Json.status === 'pending_upgrade', 'REAL handler returned status pending_upgrade');

  const licAfterUpg = db.tables.licenses.get(targetCode);
  assert(licAfterUpg.paddle_transaction_id === 'txn_yearly_orig_100', 'REAL handler preserved original yearly paddle_transaction_id (No overwrite!)');
  assert(licAfterUpg.auto_renew === 0, 'REAL handler updated auto_renew = 0');
  assert(db.tables.license_upgrades.size === 1, 'REAL handler created row in license_upgrades table');

  // Test 2: REAL checkAndApplyPendingUpgrade Lazy Flip Handler
  console.log('\nTest 2: REAL checkAndApplyPendingUpgrade before & after effective date...');
  const beforeResult = await checkAndApplyPendingUpgrade(env, targetCode, futureExpiresIso);
  assert(beforeResult === futureExpiresIso, 'REAL checkAndApplyPendingUpgrade returns yearly expires_at before effective date');

  // Fast-forward effective date in DB to past
  const pastExpiresIso = new Date(nowMs - 1000).toISOString();
  const upgRow = Array.from(db.tables.license_upgrades.values())[0];
  upgRow.effective_at = pastExpiresIso;

  const afterResult = await checkAndApplyPendingUpgrade(env, targetCode, futureExpiresIso);
  assert(afterResult === 'LIFETIME', 'REAL checkAndApplyPendingUpgrade lazy flipped status to LIFETIME!');
  assert(upgRow.status === 'applied', 'REAL checkAndApplyPendingUpgrade set upgrade status = applied');

  // Test 3: REAL handlePaddleRoutes Refund on APPLIED Upgrade (Issue A & B Real Route Verification!)
  console.log('\nTest 3: REAL handlePaddleRoutes refund on APPLIED lifetime upgrade...');
  const refundBodyObj = {
    event_type: 'transaction.refunded',
    data: { id: upgTxnId }
  };
  const rawBody3 = JSON.stringify(refundBodyObj);
  const sig3 = await createPaddleSignature(rawBody3, SECRET_KEY);

  const req3 = new Request('https://lic.eqt.net.im/api/v1/paddle/webhook', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'paddle-signature': sig3
    },
    body: rawBody3
  });
  const url3 = new URL(req3.url);

  const res3 = await handlePaddleRoutes(req3, env, ctx, url3, corsHeaders);
  assert(res3.status === 200, 'REAL refund webhook returned 200 OK');
  const res3Json = await res3.json();
  assert(res3Json.status === 'revoked', 'REAL handler returned status revoked for applied upgrade refund');

  const licAfterAppliedRefund = db.tables.licenses.get(targetCode);
  assert(licAfterAppliedRefund.status === 'revoked', 'REAL handler successfully revoked target license in DB by target_license_code!');
  assert(licAfterAppliedRefund.revoke_reason === 'refund', 'REAL handler set revoke_reason = refund');

  console.log('\n========================================');
  console.log('🎉 100% REAL WORKER ROUTE INTEGRATION TESTS PASSED!');
  console.log('========================================\n');
}

runTests().catch(err => {
  console.error(err);
  process.exit(1);
});
