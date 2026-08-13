/**
 * Smoke verification for license source / revoke_reason / refund gates.
 * Usage (from cloudflare/eqt-drm-api):
 *   node tests/verify-license-source.js
 *
 * Requires network to lic.eqt.net.im and wrangler auth for D1 inserts.
 */
const { execSync } = require('child_process');
const crypto = require('crypto');
const https = require('https');

const API = process.env.DRM_API_URL || 'https://lic-test.eqt.net.im';
const DB_NAME = process.env.DRM_DB_NAME || 'eqt-drm-db-test';

function wranglerSql(sql) {
  const out = execSync(
    `CLOUDFLARE_API_TOKEN="" npx wrangler d1 execute ${DB_NAME} --remote --command ${JSON.stringify(sql)} --json`,
    { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }
  );
  // wrangler may print non-json logs; find last JSON array
  const start = out.indexOf('[');
  if (start < 0) throw new Error('No JSON from wrangler: ' + out.slice(0, 400));
  return JSON.parse(out.slice(start));
}

function request(method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const u = new URL(path, API);
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
          ...headers
        }
      },
      (res) => {
        let buf = '';
        res.on('data', (c) => (buf += c));
        res.on('end', () => {
          let json = null;
          try {
            json = JSON.parse(buf);
          } catch {
            json = { raw: buf };
          }
          resolve({ status: res.statusCode, json });
        });
      }
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function assert(cond, msg) {
  if (!cond) throw new Error('ASSERT: ' + msg);
  console.log('  OK', msg);
}

async function main() {
  console.log('=== license-source smoke verify ===');
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + 86400000).toISOString();
  const email = 'tmp@301098.xyz';

  wranglerSql(
    `INSERT INTO user_sessions (session_token, email, expires_at) VALUES ('${token}', '${email}', '${expires}')`
  );

  // Ensure columns exist (worker also ensures)
  try {
    wranglerSql(`ALTER TABLE licenses ADD COLUMN revoke_reason TEXT DEFAULT NULL`);
  } catch (_) {
    /* exists */
  }

  // 1) test license still local-refundable
  const testCode = 'EQT-PLUS-20260721-ZQFCAN-A451';
  wranglerSql(
    `UPDATE licenses SET status='active', revoked_at=NULL, revoke_reason=NULL, source='test', buyer_email='${email}', paddle_transaction_id='txn_test_smoke_001' WHERE license_code='${testCode}'`
  );
  const r1 = await request('POST', '/api/v1/user/refund', { license_code: testCode, lang: 'zh' }, {
    Authorization: `Bearer ${token}`
  });
  assert(r1.status === 200 && r1.json.local_only === true, 'test source local refund 200');
  const row1 = wranglerSql(
    `SELECT status, revoke_reason, source FROM licenses WHERE license_code='${testCode}'`
  );
  const lic1 = row1[0].results[0];
  assert(lic1.status === 'revoked' && lic1.revoke_reason === 'test', 'test revoke_reason=test');

  // restore test code
  wranglerSql(
    `UPDATE licenses SET status='active', revoked_at=NULL, revoke_reason=NULL, source='test', buyer_email='${email}', paddle_transaction_id='txn_test_smoke_001' WHERE license_code='${testCode}'`
  );

  // 2) admin/promo not refundable — pick any admin source row with buyer email if present
  const adminPick = wranglerSql(
    `SELECT license_code FROM licenses WHERE source='admin' AND status='active' AND (buyer_email='${email}' OR buyer_email_hash IS NOT NULL) LIMIT 1`
  );
  const adminCode = adminPick[0]?.results?.[0]?.license_code;
  if (adminCode) {
    // ensure ownership for session email if needed
    wranglerSql(`UPDATE licenses SET buyer_email='${email}' WHERE license_code='${adminCode}'`);
    const r2 = await request('POST', '/api/v1/user/refund', { license_code: adminCode, lang: 'zh' }, {
      Authorization: `Bearer ${token}`
    });
    assert(r2.status === 400, 'admin source refund rejected 400');
    assert(
      String(r2.json.error || '').includes('活动') || String(r2.json.error || '').includes('promo') || String(r2.json.error || '').includes('non-purchase') || String(r2.json.error || '').includes('不支持'),
      'admin refund error is source-gated: ' + r2.json.error
    );
  } else {
    console.log('  SKIP admin refund gate (no admin license owned by test email)');
  }

  // 3) licenses list exposes refundable flag
  const list = await request('GET', '/api/v1/user/licenses', null, {
    Authorization: `Bearer ${token}`
  });
  assert(list.status === 200 && Array.isArray(list.json.licenses), 'licenses list 200');
  const testRow = (list.json.licenses || []).find((l) => l.license_code === testCode);
  if (!testRow) {
    console.error('DEBUG testRow missing. list.json.licenses codes:', (list.json.licenses || []).map(x => ({ code: x.license_code, email: x.buyer_email })));
  }
  assert(!!testRow, 'found testRow in licenses list');
  assert(testRow.refundable === false, 'test code refundable=false in list');
  assert(testRow.auto_renew === 0, 'test code auto_renew normalized to 0 for non-purchase in list');
  assert(testRow.auto_renew_toggleable === false, 'test code auto_renew_toggleable=false in list');
  assert(testRow.source === 'test', 'test code source=test in list');

  // 3.5) toggle-auto-renew endpoint enforces 403 guard for non-purchase
  const rToggle = await request('POST', '/api/v1/user/toggle-auto-renew', {
    license_code: testCode,
    auto_renew: false
  }, { Authorization: `Bearer ${token}` });
  assert(rToggle.status === 403, 'toggle-auto-renew endpoint rejects test code with 403');

  // 4) cancel-subscription local path for synthetic sub id
  wranglerSql(
    `UPDATE licenses SET status='active', revoked_at=NULL, revoke_reason=NULL, source='test', paddle_subscription_id='sub_test_cancel_e2e' WHERE license_code='${testCode}'`
  );
  const list2 = await request('GET', '/api/v1/user/licenses', null, {
    Authorization: `Bearer ${token}`
  });
  const testRow2 = (list2.json.licenses || []).find((l) => l.license_code === testCode);
  assert(testRow2 && testRow2.cancellable === true, 'test code with sub_test_ is cancellable');
  const rCancel = await request('POST', '/api/v1/user/cancel-subscription', {
    license_code: testCode,
    lang: 'zh'
  }, { Authorization: `Bearer ${token}` });
  assert(rCancel.status === 200 && rCancel.json.local_only === true, 'cancel-subscription local 200');
  const rowCancel = wranglerSql(
    `SELECT status, revoke_reason FROM licenses WHERE license_code='${testCode}'`
  );
  const licCancel = rowCancel[0].results[0];
  assert(
    licCancel.status === 'revoked' && licCancel.revoke_reason === 'subscription',
    'cancel revoke_reason=subscription'
  );
  // 5) Verify expired license rejection on /register and /verify
  wranglerSql(
    `UPDATE licenses SET status='active', expires_at='2020-01-01T00:00:00Z', source='test', paddle_subscription_id=NULL WHERE license_code='${testCode}'`
  );
  const rExpVerify = await request('POST', '/api/v1/verify', {
    license_code: testCode,
    uuid_hash: 'u111111111111111111111111111111111111111111111111111111111111111',
    cpu_hash: 'c11111111111111111111111111111111111111111111111111111111111111',
    disk_hash: 'd11111111111111111111111111111111111111111111111111111111111111'
  });
  assert(rExpVerify.status === 403 && rExpVerify.json.error.includes('expired'), 'expired code returns 403 on /verify');

  const rExpRegister = await request('POST', '/api/v1/register', {
    license_code: testCode,
    uuid_hash: 'u111111111111111111111111111111111111111111111111111111111111111',
    cpu_hash: 'c11111111111111111111111111111111111111111111111111111111111111',
    disk_hash: 'd11111111111111111111111111111111111111111111111111111111111111'
  });
  assert(rExpRegister.status === 403 && rExpRegister.json.error.includes('expired'), 'expired code returns 403 on /register');

  wranglerSql(
    `UPDATE licenses SET status='active', expires_at=NULL, source='test', paddle_subscription_id=NULL WHERE license_code='${testCode}'`
  );

  wranglerSql(`DELETE FROM user_sessions WHERE session_token='${token}'`);
  console.log('=== all checks passed ===');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
