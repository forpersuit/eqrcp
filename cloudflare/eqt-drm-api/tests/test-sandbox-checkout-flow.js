/**
 * End-to-End Test for Paddle Sandbox Checkout Fulfillment & Client License Activation.
 */
const crypto = require('crypto');
const https = require('https');
const { execSync } = require('child_process');

const WORKER_URL = 'https://lic.eqt.net.im';
const WEBHOOK_SECRET = 'pdl_ntfset_01kxypg9ghrbrymheqbcjxhzt5_2AXS+FE+VGHMCShesn7R6E17ThC0VZyl';

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
        resolve({ status: res.statusCode, body: JSON.parse(data) });
      });
    });

    req.on('error', reject);
    req.write(rawBody);
    req.end();
  });
}

function queryLicense(txnId) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${WORKER_URL}/api/v1/paddle/license-query?transaction_id=${txnId}`);
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({ status: res.statusCode, body: JSON.parse(data) });
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

function assert(cond, msg) {
  if (!cond) throw new Error('ASSERT FAIL: ' + msg);
  console.log('  ✅ OK:', msg);
}

async function main() {
  console.log('===========================================================');
  console.log('=== EQT Paddle Sandbox Purchase & Activation E2E Flow ===');
  console.log('===========================================================\n');

  const testEmail = 'tmp@301098.xyz';
  const txnIdYearly = 'txn_sdbx_yearly_' + Date.now();
  const subIdYearly = 'sub_sdbx_yearly_' + Date.now();
  const yearlyPriceId = 'pri_01kxymxqngex49tg65wb0701pc'; // Plus Yearly

  // 1. Simulate Paddle transaction.completed webhook for Plus Yearly
  console.log('1. Simulating Plus Yearly initial purchase webhook...');
  const yearlyPayload = {
    event_type: 'transaction.completed',
    data: {
      id: txnIdYearly,
      subscription_id: subIdYearly,
      customer_id: 'ctm_sdbx_001',
      customer: { email: testEmail },
      custom_data: { buyer_email: testEmail, lang: 'zh' },
      items: [{ price_id: yearlyPriceId, quantity: 1 }]
    }
  };

  const yearlyRes = await postWebhook(yearlyPayload);
  assert(yearlyRes.status === 200, 'Webhook acknowledged with 200');
  assert(yearlyRes.body.license_code && yearlyRes.body.license_code.startsWith('EQT-PLUS-'), 'Minted valid EQT Plus license code');

  const initialCode = yearlyRes.body.license_code;
  console.log(`  Generated License Code: ${initialCode}`);

  // 2. Poll client license-query API (browser modal behavior)
  console.log('\n2. Testing client license-query polling API...');
  const queryRes = await queryLicense(txnIdYearly);
  assert(queryRes.status === 200, 'license-query API returned 200 OK');
  assert(queryRes.body.license_code === initialCode, 'Query returned matching license code');
  assert(queryRes.body.tier === 'PLUS', 'License tier is PLUS');
  assert(queryRes.body.status === 'active', 'License status is active');

  // 3. Verify D1 database record
  console.log('\n3. Verifying D1 database license record...');
  const d1Row = wranglerSql(`SELECT * FROM licenses WHERE license_code = '${initialCode}'`)[0].results[0];
  assert(d1Row.buyer_email === testEmail, 'Buyer email recorded correctly');
  assert(d1Row.tier === 'PLUS', 'Tier is PLUS');
  assert(d1Row.paddle_subscription_id === subIdYearly, 'Subscription ID linked');

  // 4. Test Subscription Renewal (same subId, new transaction ID)
  console.log('\n4. Simulating Plus Yearly auto-renewal webhook (cycle 2)...');
  const txnIdYearlyRenew = 'txn_sdbx_yearly_renew_' + Date.now();
  const yearlyRenewPayload = {
    event_type: 'transaction.completed',
    data: {
      id: txnIdYearlyRenew,
      subscription_id: subIdYearly,
      customer_id: 'ctm_sdbx_001',
      customer: { email: testEmail },
      custom_data: { buyer_email: testEmail, lang: 'zh' },
      items: [{ price_id: yearlyPriceId, quantity: 1 }]
    }
  };

  const yearlyRenewRes = await postWebhook(yearlyRenewPayload);
  assert(yearlyRenewRes.status === 200, 'Renewal Webhook acknowledged 200');
  assert(yearlyRenewRes.body.license_code === initialCode, 'License code remains UNCHANGED on renewal');
  assert(yearlyRenewRes.body.renewed === true, 'Response indicates subscription extended');

  // 5. Test PRO Monthly Purchase & Activation
  console.log('\n5. Simulating PRO Monthly initial purchase webhook...');
  const txnIdPro = 'txn_sdbx_pro_' + Date.now();
  const subIdPro = 'sub_sdbx_pro_' + Date.now();
  const proPriceId = 'pri_01kyhmv79rkyncryce1wjg9582'; // Pro Monthly

  const proPayload = {
    event_type: 'transaction.completed',
    data: {
      id: txnIdPro,
      subscription_id: subIdPro,
      customer_id: 'ctm_sdbx_002',
      customer: { email: testEmail },
      custom_data: { buyer_email: testEmail, lang: 'en' },
      items: [{ price_id: proPriceId, quantity: 1 }]
    }
  };

  const proRes = await postWebhook(proPayload);
  assert(proRes.status === 200, 'PRO Webhook acknowledged 200');
  assert(proRes.body.license_code && proRes.body.license_code.startsWith('EQT-PRO-'), 'Minted valid EQT PRO license code');

  console.log(`  Generated PRO License Code: ${proRes.body.license_code}`);

  // Cleanup test rows
  wranglerSql(`DELETE FROM licenses WHERE paddle_subscription_id IN ('${subIdYearly}', '${subIdPro}')`);

  console.log('\n===========================================================');
  console.log('🎉 ALL PADDLE SANDBOX PURCHASE & ACTIVATION TESTS PASSED!');
  console.log('===========================================================');
}

main().catch(err => {
  console.error('❌ E2E TEST FAILED:', err);
  process.exit(1);
});
