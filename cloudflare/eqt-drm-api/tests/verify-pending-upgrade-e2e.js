/**
 * §6.7 pending-upgrade PRODUCTION E2E against the deployed Worker + remote D1.
 *
 * Covers the parts that are E2E-feasible WITHOUT the production Paddle webhook secret:
 *   A) Partial unique index atomic enforcement (DB-level "at most one pending per license" guarantee)
 *   B) Lazy flip through the REAL /api/v1/verify route (checkAndApplyPendingUpgrade integration)
 *
 * The webhook INSERT / idempotent-redelivery / refund-window-block / refund-revocation paths
 * require a valid production Paddle webhook signature and are therefore covered offline
 * (tests/verify-pending-lifetime-upgrade-offline.js, real handlers + HMAC + mock D1).
 *
 *   node tests/verify-pending-upgrade-e2e.js
 */
const { execSync } = require('child_process');
const crypto = require('crypto');
const https = require('https');

const API = process.env.DRM_API_URL || 'https://lic-test.eqt.net.im';
const DB_NAME = process.env.DRM_DB_NAME || 'eqt-drm-db-test';

function wranglerJson(sql) {
  const oneLine = String(sql).replace(/\s+/g, ' ').trim();
  const out = execSync(
    `CLOUDFLARE_API_TOKEN="" npx wrangler d1 execute ${DB_NAME} --remote --command ${JSON.stringify(oneLine)} --json`,
    { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, env: { ...process.env, CLOUDFLARE_API_TOKEN: '' } }
  );
  const start = out.indexOf('[');
  if (start < 0) throw new Error('No JSON from wrangler: ' + out.slice(0, 400));
  return JSON.parse(out.slice(start));
}

function wranglerTry(sql) {
  const oneLine = String(sql).replace(/\s+/g, ' ').trim();
  try {
    const out = execSync(
      `CLOUDFLARE_API_TOKEN="" npx wrangler d1 execute ${DB_NAME} --remote --command ${JSON.stringify(oneLine)} --json`,
      { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, env: { ...process.env, CLOUDFLARE_API_TOKEN: '' }, stdio: ['ignore', 'pipe', 'pipe'] }
    );
    return { ok: true, out };
  } catch (e) {
    return { ok: false, err: String(e.stderr || e.stdout || e) };
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error('ASSERT FAIL: ' + msg);
  console.log('  ✓', msg);
}

function request(method, path, body) {
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
          ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {})
        }
      },
      (res) => {
        let buf = '';
        res.on('data', (c) => (buf += c));
        res.on('end', () => {
          let json = {};
          try { json = JSON.parse(buf); } catch (e) { /* keep {} */ }
          resolve({ status: res.statusCode, data: json });
        });
      }
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function main() {
  console.log('=== §6.7 Pending-Upgrade Production E2E ===');
  const nowIso = new Date().toISOString();
  const pastIso = new Date(Date.now() - 86400000).toISOString(); // 1 day ago → lazy flip eligible
  const futureIso = new Date(Date.now() + 30 * 86400000).toISOString(); // +30d → not expired
  const code = 'EQT-PLUS-UPGE2E-' + crypto.randomBytes(3).toString('hex').toUpperCase();
  const uuid = 'upge2e-' + crypto.randomBytes(10).toString('hex');
  const cpu = 'upge2e-cpu-' + crypto.randomBytes(6).toString('hex');
  const disk = 'upge2e-disk-' + crypto.randomBytes(6).toString('hex');
  const email = 'upge2e@example.com';

  try {
    // ---- Setup: license + activation + pending upgrade with past effective_at
    console.log('\n[setup] license + activation + past-effective pending upgrade...');
    wranglerJson(`INSERT INTO licenses (license_code, tier, status, max_devices, expires_at, duration_days, buyer_email, paddle_transaction_id, source, created_at) VALUES ('${code}','PLUS','active',2,'${futureIso}',365,'${email}','txn_upge2e_init','purchase','${nowIso}')`);
    wranglerJson(`INSERT INTO activations (license_code, uuid_hash, cpu_hash, disk_hash, device_id, activated_at) VALUES ('${code}','${uuid}','${cpu}','${disk}',NULL,'${nowIso}')`);
    wranglerJson(`INSERT INTO license_upgrades (user_email, target_license_code, lifetime_txn_id, purchased_at, effective_at, status, created_at) VALUES ('${email}','${code}','txn_upge2e_l1','${nowIso}','${pastIso}','pending','${nowIso}')`);
    console.log('  ✓ setup done');

    // ---- Test A: partial unique index atomic enforcement (the N3 DB-level guarantee)
    console.log('\n[Test A] partial unique index rejects a second pending row for the same code...');
    const dup = wranglerTry(`INSERT INTO license_upgrades (user_email, target_license_code, lifetime_txn_id, purchased_at, effective_at, status, created_at) VALUES ('${email}','${code}','txn_upge2e_l2','${nowIso}','${pastIso}','pending','${nowIso}')`);
    assert(dup.ok === false && /UNIQUE constraint failed/i.test(dup.err), 'Second pending row for same code rejected by idx_upgrades_target (UNIQUE constraint)');
    const sameTxn = wranglerTry(`INSERT INTO license_upgrades (user_email, target_license_code, lifetime_txn_id, purchased_at, effective_at, status, created_at) VALUES ('${email}','${code}','txn_upge2e_l1','${nowIso}','${pastIso}','pending','${nowIso}')`);
    assert(sameTxn.ok === false && /UNIQUE constraint failed/i.test(sameTxn.err), 'Same lifetime_txn_id re-insert rejected by idx_upgrades_lifetime_txn');
    const pendingCount = wranglerJson(`SELECT COUNT(*) c FROM license_upgrades WHERE target_license_code = '${code}' AND status = 'pending'`)[0].results[0].c;
    assert(pendingCount === 1, `Exactly one pending row remains (got ${pendingCount})`);

    // ---- Test B: lazy flip triggered through the REAL /api/v1/verify route
    console.log('\n[Test B] lazy flip triggered by real /api/v1/verify...');
    const res = await request('POST', '/api/v1/verify', { license_code: code, uuid_hash: uuid, cpu_hash: cpu, disk_hash: disk });
    assert(res.status === 200, 'verify returned 200 (real route exercised checkAndApplyPendingUpgrade)');
    const lic = wranglerJson(`SELECT expires_at, duration_days FROM licenses WHERE license_code = '${code}'`)[0].results[0];
    assert(lic.expires_at === 'LIFETIME', 'license expires_at flipped to LIFETIME in production DB');
    assert(lic.duration_days === null, 'duration_days cleared to NULL');
    const applied = wranglerJson(`SELECT status FROM license_upgrades WHERE lifetime_txn_id = 'txn_upge2e_l1'`)[0].results[0];
    assert(applied.status === 'applied', 'pending upgrade row marked applied');

    console.log('\n=== ALL §6.7 PRODUCTION E2E CHECKS PASSED ===');
  } finally {
    // ---- Teardown
    console.log('\n[teardown] removing fixtures...');
    wranglerTry(`DELETE FROM license_upgrades WHERE target_license_code = '${code}'`);
    wranglerTry(`DELETE FROM activations WHERE license_code = '${code}'`);
    wranglerTry(`DELETE FROM licenses WHERE license_code = '${code}'`);
    wranglerTry(`DELETE FROM device_registry WHERE license_code = '${code}'`);
    const left = wranglerJson(`SELECT (SELECT COUNT(*) FROM licenses WHERE license_code='${code}') + (SELECT COUNT(*) FROM activations WHERE license_code='${code}') + (SELECT COUNT(*) FROM license_upgrades WHERE target_license_code='${code}') AS n`)[0].results[0].n;
    console.log(`  cleanup: remaining fixture rows = ${left}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
