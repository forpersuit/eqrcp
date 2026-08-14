const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Load real compiled Worker handler
const compiledPaddlePath = path.join(__dirname, 'compiled', 'paddle.js');
if (!fs.existsSync(compiledPaddlePath)) {
  console.error("Compiled paddle handler not found. Please compile with esbuild first.");
  process.exit(1);
}

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

// In-Memory D1 Mock that executes genuine SQL queries from paddle.ts
class RealPaddleD1Mock {
  constructor() {
    this.tables = {
      licenses: new Map(),
      activations: new Map(),
      device_registry: new Map(),
      system_error_logs: new Map(),
      paddle_processed_transactions: new Map()
    };
    this.autoIncrement = { activations: 1, system_error_logs: 1 };
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

  async batch(statements) {
    const results = [];
    for (const stmt of statements) {
      if (stmt && typeof stmt.run === 'function') {
        results.push(await stmt.run());
      } else {
        results.push({ meta: { changes: 1 } });
      }
    }
    return results;
  }

  executeSqlFirst(sql, args) {
    const s = sql.replace(/\s+/g, ' ').trim();

    if (s.includes('FROM paddle_processed_transactions WHERE transaction_id =')) {
      const txnId = args[0];
      const row = this.tables.paddle_processed_transactions?.get(txnId);
      return row ? { license_code: row.license_code, action: row.action } : null;
    }

    if (s.includes('FROM licenses WHERE paddle_transaction_id =')) {
      const txnId = args[0];
      for (const lic of this.tables.licenses.values()) {
        if (lic.paddle_transaction_id === txnId) {
          return { license_code: lic.license_code, buyer_email: lic.buyer_email, tier: lic.tier };
        }
      }
      return null;
    }

    if (s.includes('SELECT license_code, buyer_email, tier, status, revoke_reason FROM licenses WHERE paddle_subscription_id =')) {
      const subId = args[0];
      for (const lic of this.tables.licenses.values()) {
        if (lic.paddle_subscription_id === subId) {
          return {
            license_code: lic.license_code,
            buyer_email: lic.buyer_email,
            tier: lic.tier,
            status: lic.status,
            revoke_reason: lic.revoke_reason
          };
        }
      }
      return null;
    }

    if (s.includes('SELECT license_code, buyer_email, tier FROM licenses WHERE paddle_subscription_id =')) {
      const subId = args[0];
      for (const lic of this.tables.licenses.values()) {
        if (lic.paddle_subscription_id === subId) {
          return {
            license_code: lic.license_code,
            buyer_email: lic.buyer_email,
            tier: lic.tier
          };
        }
      }
      return null;
    }

    if (s.includes('SELECT license_code, status, auto_renew FROM licenses WHERE paddle_subscription_id =')) {
      const subId = args[0];
      for (const lic of this.tables.licenses.values()) {
        if (lic.paddle_subscription_id === subId) {
          return {
            license_code: lic.license_code,
            status: lic.status,
            auto_renew: lic.auto_renew
          };
        }
      }
      return null;
    }

    if (s.includes('SELECT * FROM licenses WHERE license_code =')) {
      return this.tables.licenses.get(args[0]) || null;
    }

    return null;
  }

  executeSqlRun(sql, args) {
    const s = sql.replace(/\s+/g, ' ').trim();

    if (s.includes('INSERT') && s.includes('INTO paddle_processed_transactions')) {
      const txnId = args[0];
      const licCode = args[1];
      const action = args[2];
      this.tables.paddle_processed_transactions.set(txnId, { transaction_id: txnId, license_code: licCode, action });
      return { meta: { changes: 1 } };
    }

    // 1. UPDATE licenses SET auto_renew = 0 WHERE paddle_subscription_id = ?
    if (s.includes('UPDATE licenses SET auto_renew = 0 WHERE paddle_subscription_id =')) {
      const subId = args[0];
      let changes = 0;
      for (const lic of this.tables.licenses.values()) {
        if (lic.paddle_subscription_id === subId) {
          lic.auto_renew = 0;
          changes++;
        }
      }
      return { meta: { changes } };
    }

    // 2. Revoke subscription (status = revoked, revoked_at = ?, revoke_reason = ?)
    if (s.includes('UPDATE licenses') && s.includes("status = 'revoked'") && s.includes('paddle_subscription_id =')) {
      const revokedAt = args[0];
      const reason = args[1];
      const subId = args[2];
      let changes = 0;
      for (const lic of this.tables.licenses.values()) {
        if (lic.paddle_subscription_id === subId) {
          lic.status = 'revoked';
          lic.revoked_at = revokedAt;
          lic.revoke_reason = reason;
          changes++;
        }
      }
      return { meta: { changes } };
    }

    // 3. Downgrade device_registry on revoke: UPDATE device_registry SET tier_label = 'free', license_code = NULL, email = NULL WHERE license_code = ?
    if (s.includes('UPDATE device_registry SET tier_label = \'free\', license_code = NULL, email = NULL WHERE license_code =')) {
      const licCode = args[0];
      let changes = 0;
      for (const dev of this.tables.device_registry.values()) {
        if (dev.license_code === licCode) {
          dev.tier_label = 'free';
          dev.license_code = null;
          dev.email = null;
          changes++;
        }
      }
      return { meta: { changes } };
    }

    // 4. Reactivate license on resume
    if (s.includes('UPDATE licenses SET status = \'active\', revoked_at = NULL, revoke_reason = NULL, auto_renew = 1') && s.includes('paddle_subscription_id =')) {
      let nextExpiry = null;
      let subId = null;
      if (args.length === 2) {
        nextExpiry = args[0];
        subId = args[1];
      } else {
        subId = args[0];
      }
      let changes = 0;
      for (const lic of this.tables.licenses.values()) {
        if (lic.paddle_subscription_id === subId) {
          lic.status = 'active';
          lic.revoked_at = null;
          lic.revoke_reason = null;
          lic.auto_renew = 1;
          if (nextExpiry) {
            lic.expires_at = nextExpiry;
          }
          changes++;
        }
      }
      return { meta: { changes } };
    }

    // 5. Restore device_registry via activations subquery
    if (s.includes('UPDATE device_registry SET tier_label = \'paid\'') && s.includes('WHERE device_id IN (SELECT device_id FROM activations WHERE license_code =')) {
      const licCode = args[0];
      const buyerEmail = args.length === 3 ? args[1] : null;
      const targetLic = args.length === 3 ? args[2] : args[1];

      // Find all device_ids in activations for targetLic
      const matchedDeviceIds = new Set();
      for (const act of this.tables.activations.values()) {
        if (act.license_code === targetLic) {
          matchedDeviceIds.add(act.device_id);
        }
      }

      let changes = 0;
      for (const dev of this.tables.device_registry.values()) {
        if (matchedDeviceIds.has(dev.device_id)) {
          dev.tier_label = 'paid';
          dev.license_code = licCode;
          if (buyerEmail) {
            dev.email = buyerEmail;
          }
          changes++;
        }
      }
      return { meta: { changes } };
    }

    return { meta: { changes: 0 } };
  }

  executeSqlAll(sql, args) {
    return [];
  }
}

async function main() {
  console.log('=== Offline E2E Verification: Subscription Cancellation, Revocation & Recovery ===');

  const WEBHOOK_SECRET = 'pdl_ntfset_test_secret_12345';
  const subId = 'sub_offline_test_' + Date.now();
  const licenseCode = 'EQT-PLUS-SUB-OFFLINE-001';
  const deviceId = 'dev_offline_mock_001';
  const email = 'subscriber@example.com';
  const initialExpiry = new Date(Date.now() + 180 * 86400000).toISOString();

  const mockDb = new RealPaddleD1Mock();

  // Seed initial license, activation, and device_registry
  mockDb.tables.licenses.set(licenseCode, {
    license_code: licenseCode,
    tier: 'PLUS',
    status: 'active',
    max_devices: 2,
    expires_at: initialExpiry,
    duration_days: 365,
    buyer_email: email,
    paddle_subscription_id: subId,
    paddle_transaction_id: 'txn_init_001',
    auto_renew: 1,
    source: 'purchase',
    revoked_at: null,
    revoke_reason: null,
    created_at: new Date().toISOString()
  });

  mockDb.tables.activations.set(1, {
    id: 1,
    license_code: licenseCode,
    uuid_hash: 'u1',
    cpu_hash: 'c1',
    disk_hash: 'd1',
    device_id: deviceId,
    activated_at: new Date().toISOString()
  });

  mockDb.tables.device_registry.set(deviceId, {
    device_id: deviceId,
    uuid_hash: 'u1',
    cpu_hash: 'c1',
    disk_hash: 'd1',
    tier_label: 'paid',
    license_code: licenseCode,
    email: email,
    last_seen_at: new Date().toISOString()
  });

  const env = {
    DB: mockDb,
    PADDLE_WEBHOOK_SECRET: WEBHOOK_SECRET,
    TELEGRAM_CHAT_ID: '12345',
    TELEGRAM_BOT_TOKEN: 'mock_token'
  };

  const ctx = {
    waitUntil(promise) {
      if (promise && typeof promise.catch === 'function') {
        promise.catch(() => {});
      }
    }
  };

  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Trace-Id, Paddle-Signature",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
  };

  // Helper to invoke genuine handlePaddleRoutes with signed Webhook payload
  async function sendWebhook(eventData) {
    const rawBody = JSON.stringify(eventData);
    const signature = await createPaddleSignature(rawBody, WEBHOOK_SECRET);
    const req = new Request('https://lic-test.eqt.net.im/api/v1/paddle/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Paddle-Signature': signature
      },
      body: rawBody
    });
    return await handlePaddleRoutes(req, env, ctx, new URL(req.url), corsHeaders);
  }

  // -------------------------------------------------------------
  // Test Case 1: subscription.canceled (Turns off auto_renew, keeps status 'active')
  // -------------------------------------------------------------
  console.log('\n[Case 1] Handling subscription.canceled webhook...');
  const cancelPayload = {
    event_id: 'evt_cancel_001',
    event_type: 'subscription.canceled',
    data: {
      id: subId,
      status: 'canceled'
    }
  };
  const resCancel = await sendWebhook(cancelPayload);
  assert(resCancel.status === 200, 'subscription.canceled webhook returns 200 OK');
  const licAfterCancel = mockDb.tables.licenses.get(licenseCode);
  assert(licAfterCancel.status === 'active', 'License status remains active after cancel');
  assert(licAfterCancel.auto_renew === 0, 'License auto_renew is set to 0');

  // -------------------------------------------------------------
  // Test Case 2: subscription.updated (past_due - Non-payment revokes license & unlinks device)
  // -------------------------------------------------------------
  console.log('\n[Case 2] Handling subscription.updated (past_due) webhook...');
  const pastDuePayload = {
    event_id: 'evt_past_due_001',
    event_type: 'subscription.updated',
    data: {
      id: subId,
      status: 'past_due'
    }
  };
  const resPastDue = await sendWebhook(pastDuePayload);
  assert(resPastDue.status === 200, 'subscription.updated (past_due) webhook returns 200 OK');
  const licAfterPastDue = mockDb.tables.licenses.get(licenseCode);
  assert(licAfterPastDue.status === 'revoked', 'License status changes to revoked on past_due');
  assert(licAfterPastDue.revoke_reason === 'past_due', 'License revoke_reason is past_due');
  assert(licAfterPastDue.revoked_at !== null, 'License revoked_at is recorded');

  const devAfterPastDue = mockDb.tables.device_registry.get(deviceId);
  assert(devAfterPastDue.tier_label === 'free', 'Device tier_label downgraded to free');
  assert(devAfterPastDue.license_code === null, 'Device license_code unlinked to null');
  assert(devAfterPastDue.email === null, 'Device email unlinked to null');

  // -------------------------------------------------------------
  // Test Case 3: subscription.updated (active - Subscription resumed & devices restored via activations)
  // -------------------------------------------------------------
  console.log('\n[Case 3] Handling subscription.updated (active) resume webhook...');
  const renewedExpiry = new Date(Date.now() + 365 * 86400000).toISOString();
  const resumePayload = {
    event_id: 'evt_resume_001',
    event_type: 'subscription.updated',
    data: {
      id: subId,
      status: 'active',
      current_billing_period: {
        ends_at: renewedExpiry
      }
    }
  };
  const resResume = await sendWebhook(resumePayload);
  assert(resResume.status === 200, 'subscription.updated (active) resume webhook returns 200 OK');
  const resumeJson = await resResume.json();
  assert(resumeJson.status === 'active', 'Resume response status is active');

  const licAfterResume = mockDb.tables.licenses.get(licenseCode);
  assert(licAfterResume.status === 'active', 'License status restored to active');
  assert(licAfterResume.auto_renew === 1, 'License auto_renew restored to 1');
  assert(licAfterResume.revoked_at === null, 'License revoked_at cleared to null');
  assert(licAfterResume.revoke_reason === null, 'License revoke_reason cleared to null');
  assert(licAfterResume.expires_at === renewedExpiry, 'License expires_at updated to current_billing_period.ends_at');

  // Verify genuine activations subquery restoration on device_registry
  const devAfterResume = mockDb.tables.device_registry.get(deviceId);
  assert(devAfterResume.tier_label === 'paid', 'Device tier_label restored to paid via activations subquery');
  assert(devAfterResume.license_code === licenseCode, 'Device license_code restored to licenseCode');
  assert(devAfterResume.email === email, 'Device email restored to buyer email');

  // -------------------------------------------------------------
  // Test Case 4: subscription.created / subscription.activated (Acknowledged)
  // -------------------------------------------------------------
  console.log('\n[Case 4] Handling subscription.created acknowledgement...');
  const createdPayload = {
    event_id: 'evt_create_001',
    event_type: 'subscription.created',
    data: {
      id: 'sub_new_001',
      customer_id: 'ctm_123'
    }
  };
  const resCreate = await sendWebhook(createdPayload);
  assert(resCreate.status === 200, 'subscription.created returns 200 OK');
  const createJson = await resCreate.json();
  assert(createJson.message.includes('acknowledged'), 'subscription.created response says acknowledged');

  // -------------------------------------------------------------
  // Test Case 5: transaction.completed Replay (Idempotency)
  // -------------------------------------------------------------
  console.log('\n[Case 5] Handling transaction.completed replay for existing txn...');
  const initTxnId = 'txn_offline_init_001';
  mockDb.tables.licenses.set('EQT-PLUS-ORIG', {
    license_code: 'EQT-PLUS-ORIG',
    paddle_transaction_id: initTxnId,
    paddle_subscription_id: 'sub_orig',
    status: 'active'
  });
  mockDb.tables.paddle_processed_transactions.set(initTxnId, {
    transaction_id: initTxnId,
    license_code: 'EQT-PLUS-ORIG',
    action: 'initial'
  });

  const replayPayload = {
    event_id: 'evt_replay_001',
    event_type: 'transaction.completed',
    data: {
      id: initTxnId,
      customer_id: 'ctm_123',
      items: [{ price_id: 'pri_01kxymyma34hgmndccwswheta3', quantity: 1 }]
    }
  };
  const resReplay = await sendWebhook(replayPayload);
  assert(resReplay.status === 200, 'Replayed transaction returns 200 OK');
  const replayJson = await resReplay.json();
  assert(replayJson.message.includes('already processed'), 'Replayed transaction returns already processed message');
  assert(replayJson.license_code === 'EQT-PLUS-ORIG', 'Replayed transaction returns matching license_code');

  console.log('\n=== All Subscription Lifecycle & Recovery Tests Passed 100% ===');
}

main().catch(err => {
  console.error('Test Execution Failed:', err);
  process.exit(1);
});
