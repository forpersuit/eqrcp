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

const API = 'https://lic.eqt.net.im';

function wranglerSql(sql) {
  const out = execSync(
    `CLOUDFLARE_API_TOKEN="" npx wrangler d1 execute eqt-drm-db --remote --command ${JSON.stringify(sql)} --json`,
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
    `UPDATE licenses SET status='active', revoked_at=NULL, revoke_reason=NULL, source='test' WHERE license_code='${testCode}'`
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
    `UPDATE licenses SET status='active', revoked_at=NULL, revoke_reason=NULL, source='test' WHERE license_code='${testCode}'`
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
  if (testRow) {
    assert(testRow.refundable === false, 'test code refundable=false in list');
    assert(testRow.source === 'test', 'test code source=test in list');
  }

  wranglerSql(`DELETE FROM user_sessions WHERE session_token='${token}'`);
  console.log('=== all checks passed ===');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
