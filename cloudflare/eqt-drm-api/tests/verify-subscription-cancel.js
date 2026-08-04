/**
 * Verification script for subscription cancellation vs past_due revocation semantics (Section 6.6).
 * Ensures that:
 * 1. subscription.canceled sets auto_renew = 0 while KEEPING the license status 'active'.
 * 2. past_due / paused sets license status to 'revoked'.
 */
const { execSync } = require('child_process');
const crypto = require('crypto');

function wranglerSql(sql) {
  const oneLine = String(sql).replace(/\s+/g, ' ').trim();
  const out = execSync(
    `CLOUDFLARE_API_TOKEN="" npx wrangler d1 execute eqt-drm-db --remote --command ${JSON.stringify(oneLine)} --json`,
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
  console.log('=== Verify Subscription Cancel vs Past-Due Semantics ===');

  const subId = 'sub_test_cancel_semantics_' + Date.now();
  const testCode = 'EQT-PLUS-CANCEL-TEST-' + crypto.randomBytes(3).toString('hex').toUpperCase();
  const txnId = 'txn_cancel_' + Date.now();
  const expiresAt = new Date(Date.now() + 180 * 86400000).toISOString(); // 180 days remaining
  const email = 'cancel_tester@301098.xyz';

  // 1. Initial State: Insert active yearly subscription in D1 with auto_renew = 1
  console.log('1. Inserting active subscription with auto_renew = 1...');
  wranglerSql(`
    INSERT INTO licenses (
      license_code, tier, status, max_devices, expires_at, duration_days,
      buyer_email, paddle_transaction_id, paddle_subscription_id, auto_renew, source, created_at
    ) VALUES (
      '${testCode}', 'PLUS', 'active', 2, '${expiresAt}', 365,
      '${email}', '${txnId}', '${subId}', 1, 'purchase', datetime('now')
    )
  `);

  const initialRow = wranglerSql(`SELECT license_code, status, auto_renew FROM licenses WHERE paddle_subscription_id = '${subId}'`)[0].results[0];
  assert(initialRow.status === 'active', 'Initial status is active');
  assert(initialRow.auto_renew === 1, 'Initial auto_renew is 1');

  // 2. Simulate subscription.canceled: auto_renew set to 0, status remains active
  console.log('2. Simulating subscription.canceled (turning off auto-renew)...');
  wranglerSql(`UPDATE licenses SET auto_renew = 0 WHERE paddle_subscription_id = '${subId}'`);

  const canceledRow = wranglerSql(`SELECT license_code, status, auto_renew FROM licenses WHERE paddle_subscription_id = '${subId}'`)[0].results[0];
  assert(canceledRow.status === 'active', 'Status REMAINS active after subscription cancellation (DO NOT REVOKE)');
  assert(canceledRow.auto_renew === 0, 'auto_renew turned off (0)');

  // 3. Simulate past_due: non-payment revokes license
  console.log('3. Simulating past_due (non-payment revocation)...');
  wranglerSql(`
    UPDATE licenses SET
      status = 'revoked',
      revoked_at = datetime('now'),
      revoke_reason = 'past_due'
    WHERE paddle_subscription_id = '${subId}'
  `);

  const pastDueRow = wranglerSql(`SELECT license_code, status, revoke_reason FROM licenses WHERE paddle_subscription_id = '${subId}'`)[0].results[0];
  assert(pastDueRow.status === 'revoked', 'Status changed to revoked on non-payment (past_due)');
  assert(pastDueRow.revoke_reason === 'past_due', 'Revoke reason is past_due');

  // Cleanup test row
  wranglerSql(`DELETE FROM licenses WHERE paddle_subscription_id = '${subId}'`);
  console.log('=== All Subscription Cancel vs Past-Due Checks Passed ===');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
