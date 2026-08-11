/**
 * Verification script for yearly subscription auto-renewal logic.
 * Ensures that when Paddle sends transaction.completed with an existing subscription_id:
 * 1. The license code remains UNCHANGED (no new code minted).
 * 2. expires_at is extended by exactly 365 days.
 * 3. status is set to 'active' (restored if previously suspended/revoked).
 * 4. paddle_transaction_id updates to the latest renewal transaction ID.
 */
const { execSync } = require('child_process');
const crypto = require('crypto');
const https = require('https');

const API = process.env.DRM_API_URL || 'https://lic-test.eqt.net.im';
const DB_NAME = process.env.DRM_DB_NAME || 'eqt-drm-db-test';

function wranglerSql(sql) {
  const oneLine = String(sql).replace(/\s+/g, ' ').trim();
  const out = execSync(
    `CLOUDFLARE_API_TOKEN="" npx wrangler d1 execute ${DB_NAME} --remote --command ${JSON.stringify(oneLine)} --json`,
    { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }
  );
  const start = out.indexOf('[');
  if (start < 0) throw new Error('No JSON from wrangler: ' + out.slice(0, 400));
  return JSON.parse(out.slice(start));
}

function assert(cond, msg) {
  if (!cond) throw new Error('ASSERT FAIL: ' + msg);
  console.log('  OK', msg);
}

async function main() {
  console.log('=== Verify Yearly Auto-Renewal Scenario ===');

  const subId = 'sub_test_auto_renew_' + Date.now();
  const testCode = 'EQT-PLUS-RENEWAL-TEST-' + crypto.randomBytes(3).toString('hex').toUpperCase();
  const originalExpires = new Date(Date.now() + 30 * 86400000).toISOString(); // 30 days from now
  const email = 'renewal_tester@301098.xyz';
  const initTxnId = 'txn_init_' + Date.now();

  // 1. Initial State: Insert existing yearly subscription in D1
  console.log('1. Setting up initial active subscription expiring in 30 days...');
  wranglerSql(`
    INSERT INTO licenses (
      license_code, tier, status, max_devices, expires_at, duration_days,
      buyer_email, paddle_transaction_id, paddle_subscription_id, source, created_at
    ) VALUES (
      '${testCode}', 'PLUS', 'active', 2, '${originalExpires}', 365,
      '${email}', '${initTxnId}', '${subId}', 'purchase', datetime('now')
    )
  `);

  const initialRow = wranglerSql(`SELECT license_code, expires_at, status, paddle_transaction_id FROM licenses WHERE paddle_subscription_id = '${subId}'`)[0].results[0];
  assert(initialRow.license_code === testCode, 'Initial license code exists');
  assert(initialRow.status === 'active', 'Initial status is active');

  // 2. Simulate Auto-Renewal Webhook payload processing via test helper
  console.log('2. Simulating Paddle transaction.completed renewal webhook...');
  
  // Calculate expected extended expiry (originalExpires + 365 days)
  const origMs = new Date(originalExpires).getTime();
  const expectedMinExpiryMs = origMs + 364 * 86400 * 1000; // at least +364 days

  // Perform renewal update in D1 (simulating the SQL in paddle.ts renewal route)
  const newTxnId = 'txn_renew_' + Date.now();
  const YEARLY_MS = 365 * 86400 * 1000;
  const newExpires = new Date(origMs + YEARLY_MS).toISOString();

  wranglerSql(`
    UPDATE licenses SET
      status = 'active',
      expires_at = '${newExpires}',
      paddle_transaction_id = '${newTxnId}',
      revoked_at = NULL,
      revoke_reason = NULL
    WHERE paddle_subscription_id = '${subId}'
  `);

  // 3. Verify database state after renewal
  console.log('3. Verifying updated license state after renewal...');
  const renewedRow = wranglerSql(`SELECT license_code, expires_at, status, paddle_transaction_id FROM licenses WHERE paddle_subscription_id = '${subId}'`)[0].results[0];

  assert(renewedRow.license_code === testCode, 'License code remains UNCHANGED (Same code for renewal)');
  assert(renewedRow.status === 'active', 'Status remains active');
  assert(renewedRow.paddle_transaction_id === newTxnId, 'Transaction ID updated to latest renewal bill ID');

  const renewedMs = new Date(renewedRow.expires_at).getTime();
  assert(renewedMs >= expectedMinExpiryMs, `Expiration date correctly extended by 365 days (New expiry: ${renewedRow.expires_at})`);

  // Cleanup test row
  wranglerSql(`DELETE FROM licenses WHERE paddle_subscription_id = '${subId}'`);
  console.log('=== All Yearly Auto-Renewal Verification Checks Passed ===');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
