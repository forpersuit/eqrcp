const crypto = require('crypto');

function assert(cond, msg) {
  if (!cond) throw new Error('ASSERT FAIL: ' + msg);
  console.log('  ✓ OK:', msg);
}

class MockDrmDB {
  constructor() {
    this.licenses = new Map(); // code -> row
    this.upgrades = new Map(); // id -> row
    this.nextUpgradeId = 1;
  }

  async createYearlyLicense(code, email, createdIso, expiresIso) {
    const row = {
      license_code: code,
      tier: 'PLUS',
      status: 'active',
      max_devices: 2,
      expires_at: expiresIso,
      duration_days: 365,
      buyer_email: email,
      buyer_email_hash: crypto.createHash('sha256').update(email).digest('hex'),
      paddle_transaction_id: 'txn_yearly_' + crypto.randomBytes(4).toString('hex'),
      paddle_subscription_id: 'sub_yearly_' + crypto.randomBytes(4).toString('hex'),
      source: 'purchase',
      auto_renew: 1,
      created_at: createdIso
    };
    this.licenses.set(code, row);
    return row;
  }

  async processLifetimeUpgradeWebhook(buyerEmail, targetCode, transactionId, priceId, nowMs = Date.now()) {
    const targetLic = this.licenses.get(targetCode);
    if (!targetLic) throw new Error('Target license not found');
    if (targetLic.expires_at === 'LIFETIME') throw new Error('Target license is already lifetime');

    // Refund window check: 14 days
    const REFUND_WINDOW_MS = 14 * 86400 * 1000;
    const createdTime = new Date(targetLic.created_at).getTime();
    if (createdTime > 0 && (nowMs - createdTime < REFUND_WINDOW_MS)) {
      return { status: 400, error: 'UPGRADE_BLOCKED_REFUND_WINDOW' };
    }

    let effectiveAt = targetLic.expires_at;
    if (!effectiveAt || isNaN(new Date(effectiveAt).getTime()) || new Date(effectiveAt).getTime() < nowMs) {
      effectiveAt = new Date(nowMs).toISOString();
    }

    const nowIso = new Date(nowMs).toISOString();
    const upgradeId = this.nextUpgradeId++;
    const upgradeRow = {
      id: upgradeId,
      user_email: buyerEmail,
      target_license_code: targetCode,
      lifetime_txn_id: transactionId,
      purchased_at: nowIso,
      effective_at: effectiveAt,
      status: 'pending',
      created_at: nowIso
    };
    this.upgrades.set(upgradeId, upgradeRow);

    // Cancel auto-renew, record txn
    targetLic.auto_renew = 0;
    targetLic.paddle_transaction_id = transactionId;

    return { status: 200, message: 'pending_upgrade', effective_at: effectiveAt, upgrade_id: upgradeId };
  }

  async checkAndApplyPendingUpgrade(licenseCode, nowMs = Date.now()) {
    const lic = this.licenses.get(licenseCode);
    if (!lic || lic.expires_at === 'LIFETIME') return lic ? lic.expires_at : null;

    let pendingUpgrade = null;
    for (const up of this.upgrades.values()) {
      if (up.target_license_code === licenseCode && up.status === 'pending') {
        pendingUpgrade = up;
        break;
      }
    }

    if (pendingUpgrade && pendingUpgrade.effective_at) {
      const effTime = new Date(pendingUpgrade.effective_at).getTime();
      if (!isNaN(effTime) && effTime <= nowMs) {
        // Lazy flip!
        lic.expires_at = 'LIFETIME';
        lic.duration_days = null;
        pendingUpgrade.status = 'applied';
        return 'LIFETIME';
      }
    }

    return lic.expires_at;
  }

  async processUpgradeRefund(transactionId) {
    let matchedUpgrade = null;
    for (const up of this.upgrades.values()) {
      if (up.lifetime_txn_id === transactionId) {
        matchedUpgrade = up;
        break;
      }
    }

    if (matchedUpgrade && matchedUpgrade.status === 'pending') {
      matchedUpgrade.status = 'cancelled';
      return { cancelled: true, upgrade_id: matchedUpgrade.id };
    }

    return { cancelled: false };
  }
}

async function runTests() {
  console.log('========================================');
  console.log('🚀 Running §6.7 Pending Lifetime Upgrade Offline Tests');
  console.log('========================================\n');

  const db = new MockDrmDB();
  const nowMs = Date.now();
  const thirtyDaysAgoIso = new Date(nowMs - 30 * 86400 * 1000).toISOString();
  const futureExpiresIso = new Date(nowMs + 335 * 86400 * 1000).toISOString(); // Expires in 335 days
  const userEmail = 'upgrade_user@example.com';
  const targetCode = 'EQT-PLUS-YEARLY-1001';

  // 1. Setup yearly license created 30 days ago (outside 14-day refund window)
  console.log('Test 1: Setting up active yearly license (created 30 days ago)...');
  await db.createYearlyLicense(targetCode, userEmail, thirtyDaysAgoIso, futureExpiresIso);
  const lic1 = db.licenses.get(targetCode);
  assert(lic1.status === 'active', 'Yearly license is active');
  assert(lic1.auto_renew === 1, 'Auto renew initially ON');

  // 2. Submit Lifetime Upgrade Webhook
  console.log('\nTest 2: Processing lifetime upgrade webhook (outside refund window)...');
  const upgradeTxnId = 'txn_lifetime_upg_999';
  const res2 = await db.processLifetimeUpgradeWebhook(userEmail, targetCode, upgradeTxnId, 'pri_lifetime', nowMs);
  assert(res2.status === 200, 'Upgrade webhook accepted');
  assert(res2.effective_at === futureExpiresIso, 'Effective at snapshot matches current yearly expiry');
  assert(lic1.expires_at === futureExpiresIso, 'License expires_at is NOT immediately flipped to LIFETIME (state isolation)');
  assert(lic1.auto_renew === 0, 'Auto renew correctly set to 0 (off)');

  // 3. Verify before effective_at (not yet expired)
  console.log('\nTest 3: Verification BEFORE effective date...');
  const expCheckBefore = await db.checkAndApplyPendingUpgrade(targetCode, nowMs);
  assert(expCheckBefore === futureExpiresIso, 'Verification returns yearly expires_at prior to effective date');
  assert(db.upgrades.get(res2.upgrade_id).status === 'pending', 'Upgrade status remains pending');

  // 4. Verify AFTER effective_at (time passed past expiry)
  console.log('\nTest 4: Verification AFTER effective date (lazy flip)...');
  const futureCheckMs = new Date(futureExpiresIso).getTime() + 1000;
  const expCheckAfter = await db.checkAndApplyPendingUpgrade(targetCode, futureCheckMs);
  assert(expCheckAfter === 'LIFETIME', 'Lazy flip successfully changes expires_at to LIFETIME!');
  assert(lic1.expires_at === 'LIFETIME', 'License state permanently updated to LIFETIME');
  assert(db.upgrades.get(res2.upgrade_id).status === 'applied', 'Upgrade status updated to applied');

  // 5. Test Refund Window Protection (< 14 days)
  console.log('\nTest 5: Upgrade attempt within 14-day refund window...');
  const freshCode = 'EQT-PLUS-FRESH-2002';
  const fiveDaysAgoIso = new Date(nowMs - 5 * 86400 * 1000).toISOString();
  await db.createYearlyLicense(freshCode, userEmail, fiveDaysAgoIso, futureExpiresIso);

  const res5 = await db.processLifetimeUpgradeWebhook(userEmail, freshCode, 'txn_refund_blocked', 'pri_lifetime', nowMs);
  assert(res5.status === 400 && res5.error === 'UPGRADE_BLOCKED_REFUND_WINDOW', 'Upgrade blocked for license in 14-day refund window!');

  // 6. Test Upgrade Refund Cancellation
  console.log('\nTest 6: Refund lifetime upgrade transaction while pending...');
  const targetCode3 = 'EQT-PLUS-YEARLY-3003';
  await db.createYearlyLicense(targetCode3, userEmail, thirtyDaysAgoIso, futureExpiresIso);
  const res6Upgrade = await db.processLifetimeUpgradeWebhook(userEmail, targetCode3, 'txn_upg_cancel_me', 'pri_lifetime', nowMs);

  assert(db.upgrades.get(res6Upgrade.upgrade_id).status === 'pending', 'Upgrade is pending');

  const res6Refund = await db.processUpgradeRefund('txn_upg_cancel_me');
  assert(res6Refund.cancelled === true, 'Pending upgrade cancelled on refund');
  assert(db.upgrades.get(res6Upgrade.upgrade_id).status === 'cancelled', 'Upgrade record marked cancelled');

  const lic3 = db.licenses.get(targetCode3);
  assert(lic3.status === 'active' && lic3.expires_at === futureExpiresIso, 'Yearly license remains active and valid after upgrade refund!');

  console.log('\n========================================');
  console.log('🎉 ALL §6.7 PENDING LIFETIME UPGRADE TESTS PASSED!');
  console.log('========================================\n');
}

runTests().catch(err => {
  console.error('\n❌ TEST FAILED:', err);
  process.exit(1);
});
