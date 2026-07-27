/**
 * Complete Multi-Plan, Refund, Subscription Update, and Go Engine DRM Activation E2E Test Suite.
 */
const crypto = require('crypto');
const https = require('https');
const { execSync } = require('child_process');

const WORKER_URL = 'https://lic.eqt.net.im';
const WEBHOOK_SECRET = 'pdl_ntfset_01kxypg9ghrbrymheqbcjxhzt5_2AXS+FE+VGHMCShesn7R6E17ThC0VZyl';

const PRICE_LIFETIME_ID = 'pri_01kyhmkv4ppj10r4cdgw3sv48p';
const PRICE_YEARLY_ID = 'pri_01kxymxqngex49tg65wb0701pc';
const PRICE_PRO_MONTHLY_ID = 'pri_01kyhmv79rkyncryce1wjg9582';

function signPaddleWebhook(rawBody, secret) {
  const ts = Math.floor(Date.now() / 1000);
  const payload = `${ts}:${rawBody}`;
  const h1 = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return `ts=${ts};h1=${h1}`;
}

function postWebhook(bodyObj) {
  return new Promise((resolve, reject) => {
    const rawBody = JSON.stringify(bodyObj);
    const signature = signPaddleWebhook(rawBody, WEBHOOK_SECRET);
    const url = new URL(`${WORKER_URL}/api/v1/paddle/webhook`);

    const req = https.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Paddle-Signature': signature
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch (_) {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });

    req.on('error', reject);
    req.write(rawBody);
    req.end();
  });
}

function queryLicense(txnId, lang = 'zh') {
  return new Promise((resolve, reject) => {
    const url = new URL(`${WORKER_URL}/api/v1/paddle/license-query?transaction_id=${txnId}`);
    https.get(url, {
      headers: { 'Accept-Language': lang }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch (_) {
          resolve({ status: res.statusCode, body: data });
        }
      });
    }).on('error', reject);
  });
}

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

function activateInGoEngine(licenseCode) {
  const goScript = `
package main
import (
	"fmt"
	"os"
	"eqt/pkg/server"
)
func main() {
	err := server.ActivateLicenseOnline("${licenseCode}")
	if err != nil {
		fmt.Printf("FAIL: %v\\n", err)
		os.Exit(1)
	}
	paid := server.GetPaidStatus()
	tier := server.GetLicenseTier()
	fmt.Printf("SUCCESS: paid=%v, tier=%s\\n", paid, tier)
}
  `;
  const fs = require('fs');
  const tmpGoFile = '/tmp/test_go_activate.go';
  fs.writeFileSync(tmpGoFile, goScript, 'utf8');

  try {
    const out = execSync(`go run ${tmpGoFile}`, {
      cwd: '/home/yelon/develop/me/eqrcp',
      encoding: 'utf8',
      env: { ...process.env, EQT_LICENSE_SERVER: 'https://lic.eqt.net.im' }
    });
    return out.trim();
  } finally {
    try { fs.unlinkSync(tmpGoFile); } catch (_) {}
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error('ASSERT FAIL: ' + msg);
  console.log('  ✅ OK:', msg);
}

async function main() {
  console.log('======================================================================');
  console.log('=== EQT Multi-Plan, Refund, Subscription Update & Go DRM E2E Flow ===');
  console.log('======================================================================\n');

  const testEmail = 'tmp@301098.xyz';

  // ----------------------------------------------------------------------
  // TEST PLAN 1: PLUS Lifetime (pri_01kyhmkv4ppj10r4cdgw3sv48p) + Refund Test
  // ----------------------------------------------------------------------
  console.log('--- TEST PLAN 1: PLUS Lifetime Purchase, Go Engine Activation & Refund ---');
  const txnIdLifetime = 'txn_sdbx_life_' + Date.now();

  const lifetimeWebhookRes = await postWebhook({
    event_type: 'transaction.completed',
    data: {
      id: txnIdLifetime,
      customer: { email: testEmail },
      custom_data: { buyer_email: testEmail, lang: 'ja' },
      items: [{ price_id: PRICE_LIFETIME_ID, quantity: 1 }]
    }
  });

  assert(lifetimeWebhookRes.status === 200, 'Lifetime purchase webhook acknowledged 200');
  const lifetimeCode = lifetimeWebhookRes.body.license_code;
  assert(lifetimeCode && lifetimeCode.startsWith('EQT-PLUS-'), 'Minted PLUS Lifetime license code');
  console.log(`  Lifetime Code: ${lifetimeCode}`);

  // Test Go engine activation for Lifetime code
  const goResLife = activateInGoEngine(lifetimeCode);
  assert(goResLife.includes('SUCCESS: paid=true'), 'Go engine activated Lifetime license successfully');
  console.log(`  Go DRM Engine Activation Result: ${goResLife}`);

  // Test Refund for Lifetime
  console.log('  Testing Refund for Lifetime plan...');
  const refundWebhookRes = await postWebhook({
    event_type: 'transaction.refunded',
    data: { id: txnIdLifetime }
  });
  assert(refundWebhookRes.status === 200 && refundWebhookRes.body.revoke_reason === 'refund', 'Lifetime license revoked on refund');

  const d1RefundRow = wranglerSql(`SELECT status, revoke_reason FROM licenses WHERE license_code = '${lifetimeCode}'`)[0].results[0];
  assert(d1RefundRow.status === 'revoked' && d1RefundRow.revoke_reason === 'refund', 'D1 database status is revoked with reason=refund');
  console.log('PLUS Lifetime Purchase, Go Activation & Refund Test Passed!\n');

  // ----------------------------------------------------------------------
  // TEST PLAN 2: PLUS Yearly (pri_01kxymxqngex49tg65wb0701pc) + Renewal + Cancel
  // ----------------------------------------------------------------------
  console.log('--- TEST PLAN 2: PLUS Yearly Purchase, Go Activation, Auto-Renewal & Cancel ---');
  const txnIdYearly = 'txn_sdbx_yr_' + Date.now();
  const subIdYearly = 'sub_sdbx_yr_' + Date.now();

  const yearlyRes = await postWebhook({
    event_type: 'transaction.completed',
    data: {
      id: txnIdYearly,
      subscription_id: subIdYearly,
      customer: { email: testEmail },
      custom_data: { buyer_email: testEmail, lang: 'zh' },
      items: [{ price_id: PRICE_YEARLY_ID, quantity: 1 }]
    }
  });

  assert(yearlyRes.status === 200, 'PLUS Yearly purchase webhook acknowledged 200');
  const yearlyCode = yearlyRes.body.license_code;
  assert(yearlyCode && yearlyCode.startsWith('EQT-PLUS-'), 'Minted PLUS Yearly license code');
  console.log(`  Yearly Code: ${yearlyCode}`);

  // Activate in Go engine
  const goResYearly = activateInGoEngine(yearlyCode);
  assert(goResYearly.includes('SUCCESS: paid=true'), 'Go engine activated PLUS Yearly license successfully');

  // Renewal Cycle 2
  console.log('  Testing Subscription Auto-Renewal (Cycle 2)...');
  const txnIdYearlyRenew = 'txn_sdbx_yr_renew_' + Date.now();
  const yearlyRenewRes = await postWebhook({
    event_type: 'transaction.completed',
    data: {
      id: txnIdYearlyRenew,
      subscription_id: subIdYearly,
      customer: { email: testEmail },
      custom_data: { buyer_email: testEmail, lang: 'zh' },
      items: [{ price_id: PRICE_YEARLY_ID, quantity: 1 }]
    }
  });
  assert(yearlyRenewRes.status === 200 && yearlyRenewRes.body.license_code === yearlyCode, 'Auto-renewal keeps SAME license code');
  assert(yearlyRenewRes.body.renewed === true, 'Response indicates subscription expiry extended');

  // Cancel Subscription
  console.log('  Testing Subscription Cancellation...');
  const cancelRes = await postWebhook({
    event_type: 'subscription.canceled',
    data: { id: subIdYearly, status: 'canceled' }
  });
  assert(cancelRes.status === 200, 'Subscription cancellation webhook acknowledged 200');

  const d1CancelRow = wranglerSql(`SELECT status, revoke_reason FROM licenses WHERE license_code = '${yearlyCode}'`)[0].results[0];
  assert(d1CancelRow.status === 'revoked' && d1CancelRow.revoke_reason === 'subscription', 'D1 database status is revoked with reason=subscription');
  console.log('PLUS Yearly Purchase, Go Activation, Auto-Renewal & Cancel Test Passed!\n');

  // ----------------------------------------------------------------------
  // TEST PLAN 3: PRO Monthly (pri_01kyhmv79rkyncryce1wjg9582) + Chargeback Adjustment
  // ----------------------------------------------------------------------
  console.log('--- TEST PLAN 3: PRO Monthly Purchase, Go Activation & Chargeback Adjustment ---');
  const txnIdPro = 'txn_sdbx_pro_' + Date.now();
  const subIdPro = 'sub_sdbx_pro_' + Date.now();

  const proRes = await postWebhook({
    event_type: 'transaction.completed',
    data: {
      id: txnIdPro,
      subscription_id: subIdPro,
      customer: { email: testEmail },
      custom_data: { buyer_email: testEmail, lang: 'ko' },
      items: [{ price_id: PRICE_PRO_MONTHLY_ID, quantity: 1 }]
    }
  });

  assert(proRes.status === 200, 'PRO Monthly purchase webhook acknowledged 200');
  const proCode = proRes.body.license_code;
  assert(proCode && proCode.startsWith('EQT-PRO-'), 'Minted PRO Monthly license code');
  console.log(`  PRO Monthly Code: ${proCode}`);

  // Activate in Go engine & verify Tier=PRO
  const goResPro = activateInGoEngine(proCode);
  assert(goResPro.includes('SUCCESS: paid=true, tier=PRO'), 'Go engine activated PRO license with Tier=PRO');

  // Chargeback adjustment
  console.log('  Testing Chargeback Adjustment...');
  const adjustmentRes = await postWebhook({
    event_type: 'adjustment.created',
    data: { transaction_id: txnIdPro, action: 'chargeback' }
  });
  assert(adjustmentRes.status === 200 && adjustmentRes.body.revoke_reason === 'chargeback', 'License revoked on chargeback adjustment');

  const d1AdjRow = wranglerSql(`SELECT status, revoke_reason FROM licenses WHERE license_code = '${proCode}'`)[0].results[0];
  assert(d1AdjRow.status === 'revoked' && d1AdjRow.revoke_reason === 'chargeback', 'D1 database status is revoked with reason=chargeback');
  console.log('PRO Monthly Purchase, Go Activation & Chargeback Adjustment Test Passed!\n');

  // ----------------------------------------------------------------------
  // TEST 4: License Query i18n & Error Handling Check
  // ----------------------------------------------------------------------
  console.log('--- TEST 4: License Query Error i18n Verification ---');
  const queryMissing = await queryLicense('', 'zh');
  assert(queryMissing.status === 400 && queryMissing.body.error === '缺少 transaction_id 参数', 'i18n missing_transaction_id in Chinese');

  const queryMissingEn = await queryLicense('', 'en');
  assert(queryMissingEn.status === 400 && queryMissingEn.body.error === 'Missing transaction_id parameter', 'i18n missing_transaction_id in English');

  const queryNotFulfill = await queryLicense('txn_nonexistent_999', 'ja');
  assert(queryNotFulfill.status === 404 && queryNotFulfill.body.error.includes('ライセンスコード生成中'), 'i18n license_pending_fulfillment in Japanese');
  console.log('License Query Error i18n Verification Passed!\n');

  // Cleanup test rows (delete activations first due to FK constraint)
  wranglerSql(`DELETE FROM activations WHERE license_code IN ('${lifetimeCode}', '${yearlyCode}', '${proCode}')`);
  wranglerSql(`DELETE FROM licenses WHERE license_code IN ('${lifetimeCode}', '${yearlyCode}', '${proCode}')`);

  console.log('======================================================================');
  console.log('🎉 ALL MULTI-PLAN, REFUND, CANCEL & GO DRM E2E TESTS PASSED!');
  console.log('======================================================================');
}

main().catch(err => {
  console.error('❌ FULL LIFECYCLE E2E TEST FAILED:', err);
  process.exit(1);
});
