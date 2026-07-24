/**
 * Closed-loop DRM simulation against production API + remote D1.
 * Scenarios: source gates, unactivated refund, blacklist ≥3, cleanup.
 *
 *   node tests/closed-loop-simulation.js
 */
const { execSync } = require('child_process');
const crypto = require('crypto');
const https = require('https');

const API = 'https://lic.eqt.net.im';
const DEVICE = '220b0d36b727';
const TAG = 'CLSIM';

function wrangler(sql) {
  // Single-line SQL only — wrangler --command mangles escaped newlines from JSON.stringify.
  const oneLine = String(sql).replace(/\s+/g, ' ').trim();
  const out = execSync(
    `CLOUDFLARE_API_TOKEN="" npx wrangler d1 execute eqt-drm-db --remote --command ${JSON.stringify(oneLine)}`,
    { encoding: 'utf8', maxBuffer: 12 * 1024 * 1024 }
  );
  return out;
}

function wranglerJson(sql) {
  const oneLine = String(sql).replace(/\s+/g, ' ').trim();
  const out = execSync(
    `CLOUDFLARE_API_TOKEN="" npx wrangler d1 execute eqt-drm-db --remote --command ${JSON.stringify(oneLine)} --json`,
    { encoding: 'utf8', maxBuffer: 12 * 1024 * 1024 }
  );
  const i = out.indexOf('[');
  if (i < 0) throw new Error('no json: ' + out.slice(0, 400));
  return JSON.parse(out.slice(i));
}

function sha256(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

function request(method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const u = new URL(path, API);
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname,
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
          let json = {};
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
  if (!cond) throw new Error('FAIL: ' + msg);
  console.log('  OK', msg);
}

function code(kind, n) {
  const r = crypto.randomBytes(2).toString('hex').toUpperCase();
  return `EQT-PLUS-CLSIM-${kind}${n}-${r}`;
}

function txn() {
  return 'txn_01cl' + crypto.randomBytes(10).toString('hex');
}

function nowIso() {
  return new Date().toISOString();
}

function insertPurchase({ licenseCode, email, activated }) {
  const hash = sha256(email.toLowerCase());
  const t = txn();
  const created = nowIso();
  wrangler(
    `INSERT OR REPLACE INTO licenses (license_code, tier, status, max_devices, expires_at, duration_days, buyer_email_hash, buyer_email, paddle_transaction_id, source, created_at)
     VALUES ('${licenseCode}', 'PLUS', 'active', 2, 'LIFETIME', NULL, '${hash}', '${email}', '${t}', 'purchase', '${created}')`
  );
  if (activated) {
    const fp = {
      uuid: sha256('uuid:' + email + licenseCode).slice(0, 32),
      cpu: sha256('cpu:' + email + licenseCode).slice(0, 32),
      disk: sha256('disk:' + email + licenseCode).slice(0, 32)
    };
    wrangler(
      `INSERT INTO activations (license_code, uuid_hash, cpu_hash, disk_hash, device_id, activated_at)
       VALUES ('${licenseCode}', '${fp.uuid}', '${fp.cpu}', '${fp.disk}', 'sim-dev-${email.slice(0, 6)}', '${created}')`
    );
    return fp;
  }
  return null;
}

function revokeRefund(licenseCode) {
  wrangler(
    `UPDATE licenses SET status='revoked', revoked_at='${nowIso()}', revoke_reason='refund' WHERE license_code='${licenseCode}'`
  );
}

async function activateApi(licenseCode, deviceId, fp) {
  return request('POST', '/api/v1/activate', {
    license_code: licenseCode,
    uuid_hash: fp.uuid,
    cpu_hash: fp.cpu,
    disk_hash: fp.disk,
    device_id: deviceId,
    lang: 'zh'
  });
}

function cleanupSim() {
  console.log('\n[cleanup] removing CLSIM fixtures + device QA rows…');
  // activations for sim devices and user test device on CLSIM/QA codes
  wrangler(`DELETE FROM activations WHERE license_code LIKE 'EQT-PLUS-CLSIM-%' OR license_code LIKE 'EQT-PLUS-20260724-%'`);
  wrangler(`DELETE FROM unbind_records WHERE license_code LIKE 'EQT-PLUS-CLSIM-%' OR license_code LIKE 'EQT-PLUS-20260724-%'`);
  wrangler(`DELETE FROM licenses WHERE license_code LIKE 'EQT-PLUS-CLSIM-%' OR license_code LIKE 'EQT-PLUS-20260724-%'`);
  // user device residual
  wrangler(`DELETE FROM activations WHERE device_id = '${DEVICE}'`);
  console.log('  OK cleanup done');
}

async function main() {
  console.log('=== closed-loop simulation (threshold ≥3) ===\n');
  cleanupSim();

  const emailClean = 'clsim-clean@301098.xyz';
  const emailAbuse = 'clsim-abuse@301098.xyz';
  const emailOther = 'clsim-other@301098.xyz';

  // --- A: unactivated refunds do NOT count (mint 5 unactivated refunds) ---
  console.log('\n[A] unactivated purchase refunds ×5 → not blacklisted');
  for (let i = 1; i <= 5; i++) {
    const c = code('UA', i);
    insertPurchase({ licenseCode: c, email: emailClean, activated: false });
    revokeRefund(c);
  }
  const cClean = code('OK', 1);
  insertPurchase({ licenseCode: cClean, email: emailClean, activated: false });
  const rA = await activateApi(cClean, 'sim-clean-dev', {
    uuid: sha256('u-clean').slice(0, 32),
    cpu: sha256('c-clean').slice(0, 32),
    disk: sha256('d-clean').slice(0, 32)
  });
  assert(rA.status === 200 && rA.json.signature, 'unactivated refunds do not block activate (emailClean)');

  // checkout email gate should also pass
  const checkoutA = await request('POST', '/api/v1/checkout/send-code', {
    email: emailClean,
    lang: 'zh'
  });
  assert(checkoutA.status === 200 || checkoutA.status === 429, 'checkout send-code not 403 for clean email (got ' + checkoutA.status + ')');

  // --- B: 2 activated refunds → still OK ---
  console.log('\n[B] activated refunds ×2 → still allowed');
  for (let i = 1; i <= 2; i++) {
    const c = code('A2', i);
    insertPurchase({ licenseCode: c, email: emailAbuse, activated: true });
    revokeRefund(c);
  }
  const cB = code('BOK', 1);
  insertPurchase({ licenseCode: cB, email: emailAbuse, activated: false });
  const rB = await activateApi(cB, 'sim-abuse-dev', {
    uuid: sha256('u-abuse').slice(0, 32),
    cpu: sha256('c-abuse').slice(0, 32),
    disk: sha256('d-abuse').slice(0, 32)
  });
  assert(rB.status === 200, '2 activated refunds still allow activate');

  // --- C: 3rd activated refund → email blacklisted ---
  console.log('\n[C] activated refunds ×3 → email blacklisted');
  const c3 = code('A3', 3);
  insertPurchase({ licenseCode: c3, email: emailAbuse, activated: true });
  revokeRefund(c3);

  const cC = code('BLK', 1);
  insertPurchase({ licenseCode: cC, email: emailAbuse, activated: false });
  const rC = await activateApi(cC, 'sim-abuse-dev2', {
    uuid: sha256('u-abuse2').slice(0, 32),
    cpu: sha256('c-abuse2').slice(0, 32),
    disk: sha256('d-abuse2').slice(0, 32)
  });
  assert(rC.status === 403, '3 activated refunds block activate');
  assert(
    String(rC.json.error || '').includes('3') || String(rC.json.reason_key || '') === 'blacklist_email' || String(rC.json.error || '').includes('限制') || String(rC.json.error || '').includes('restricted'),
    'block reason is email blacklist: ' + JSON.stringify(rC.json)
  );

  const checkoutC = await request('POST', '/api/v1/checkout/send-code', {
    email: emailAbuse,
    lang: 'zh'
  });
  assert(checkoutC.status === 403, 'checkout send-code blocked for blacklisted email');

  // --- D: device blacklist (3 activated refunds on same fingerprints) ---
  console.log('\n[D] device fingerprint hits ×3 → device blacklisted for other email');
  const devFp = {
    uuid: sha256('device-shared-uuid').slice(0, 32),
    cpu: sha256('device-shared-cpu').slice(0, 32),
    disk: sha256('device-shared-disk').slice(0, 32)
  };
  for (let i = 1; i <= 3; i++) {
    const c = code('DX', i);
    const email = `clsim-dx${i}@301098.xyz`;
    const hash = sha256(email);
    const t = txn();
    const created = nowIso();
    wrangler(
      `INSERT OR REPLACE INTO licenses (license_code, tier, status, max_devices, expires_at, duration_days, buyer_email_hash, buyer_email, paddle_transaction_id, source, created_at)
       VALUES ('${c}', 'PLUS', 'active', 2, 'LIFETIME', NULL, '${hash}', '${email}', '${t}', 'purchase', '${created}')`
    );
    wrangler(
      `INSERT INTO activations (license_code, uuid_hash, cpu_hash, disk_hash, device_id, activated_at)
       VALUES ('${c}', '${devFp.uuid}', '${devFp.cpu}', '${devFp.disk}', 'sim-shared-device', '${created}')`
    );
    revokeRefund(c);
  }
  const cOther = code('OTH', 1);
  insertPurchase({ licenseCode: cOther, email: emailOther, activated: false });
  const rD = await activateApi(cOther, 'sim-shared-device', devFp);
  assert(rD.status === 403, 'device blacklist blocks other email on same fp');
  assert(
    String(rD.json.reason_key || '') === 'blacklist_device' || String(rD.json.error || '').includes('设备') || String(rD.json.error || '').includes('device'),
    'device blacklist message: ' + JSON.stringify(rD.json)
  );

  // --- E: promo not refundable via portal semantics (refundable flag via list needs session; check source gate with test session) ---
  console.log('\n[E] promo/admin source gates');
  const promo = code('PR', 1);
  const hashTmp = sha256('tmp@301098.xyz');
  wrangler(
    `INSERT OR REPLACE INTO licenses (license_code, tier, status, max_devices, expires_at, duration_days, buyer_email_hash, buyer_email, source, created_at)
     VALUES ('${promo}', 'PLUS', 'active', 2, '${new Date(Date.now() + 30 * 864e5).toISOString()}', 14, '${hashTmp}', 'tmp@301098.xyz', 'promo', '${nowIso()}')`
  );
  const token = crypto.randomBytes(24).toString('hex');
  wrangler(
    `INSERT OR REPLACE INTO user_sessions (session_token, email, expires_at) VALUES ('${token}', 'tmp@301098.xyz', '${new Date(Date.now() + 864e5).toISOString()}')`
  );
  const rPromoRefund = await request(
    'POST',
    '/api/v1/user/refund',
    { license_code: promo, lang: 'zh' },
    { Authorization: `Bearer ${token}` }
  );
  assert(rPromoRefund.status === 400, 'promo portal refund rejected');
  wrangler(`DELETE FROM user_sessions WHERE session_token='${token}'`);

  // --- F: lifetime stack on user device path (API) ---
  console.log('\n[F] lifetime stack: second lifetime same tier blocked');
  const life1 = code('L1', 1);
  const life2 = code('L2', 1);
  const lifeEmail = 'clsim-life@301098.xyz';
  insertPurchase({ licenseCode: life1, email: lifeEmail, activated: false });
  insertPurchase({ licenseCode: life2, email: lifeEmail, activated: false });
  const lifeFp = {
    uuid: sha256('life-u').slice(0, 32),
    cpu: sha256('life-c').slice(0, 32),
    disk: sha256('life-d').slice(0, 32)
  };
  const rL1 = await activateApi(life1, 'sim-life-dev', lifeFp);
  assert(rL1.status === 200, 'first lifetime activates');
  const rL2 = await activateApi(life2, 'sim-life-dev', lifeFp);
  assert(rL2.status === 403, 'second lifetime same tier blocked');
  assert(String(rL2.json.error || '').toLowerCase().includes('lifetime') || String(rL2.json.error || '').includes('stack'), 'stack message: ' + JSON.stringify(rL2.json));

  cleanupSim();

  // ensure user device clean
  const left = wranglerJson(`SELECT COUNT(*) AS c FROM activations WHERE device_id='${DEVICE}'`);
  const c = left[0]?.results?.[0]?.c ?? left[0]?.results?.[0]?.C;
  assert(Number(c) === 0, 'user device activations cleared');

  console.log('\n=== ALL CLOSED-LOOP SCENARIOS PASSED ===\n');
}

main().catch((e) => {
  console.error(e);
  try {
    cleanupSim();
  } catch (_) {}
  process.exit(1);
});
