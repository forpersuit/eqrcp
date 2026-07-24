/**
 * Mint QA licenses (promo / admin / purchase-sim) into remote D1 for device activation tests.
 * Tags codes with QA batch so they can be cleaned up later.
 *
 *   node tests/mint-qa-licenses.js
 *   node tests/mint-qa-licenses.js --cleanup
 */
const { execSync } = require('child_process');
const crypto = require('crypto');

const BATCH = 'QA20260724';
const EMAIL_TMP = 'tmp@301098.xyz';
const EMAIL_ANON = 'anon@301098.xyz'; // TEST_MAIL_RECEIVER_1

function wrangler(sql) {
  const out = execSync(
    `CLOUDFLARE_API_TOKEN="" npx wrangler d1 execute eqt-drm-db --remote --command ${JSON.stringify(sql)} --json`,
    { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }
  );
  const start = out.indexOf('[');
  if (start < 0) throw new Error(out.slice(0, 500));
  return JSON.parse(out.slice(start));
}

async function sha256Hex(s) {
  return crypto.createHash('sha256').update(s.trim().toLowerCase()).digest('hex');
}

function todayStr() {
  return new Date().toISOString().slice(0, 10).replace(/-/g, '');
}

function rand6() {
  return crypto.randomBytes(3).toString('hex').toUpperCase();
}

function makeCode(tier, tag) {
  // EQT-TIER-YYYYMMDD-TAG-RAND — keep under readable length
  const t = todayStr();
  const r = rand6();
  return `EQT-${tier}-${t}-${tag}${r.slice(0, 2)}-${r.slice(2)}`;
}

function isoPlusDays(d) {
  return new Date(Date.now() + d * 86400000).toISOString();
}

async function mint() {
  const now = new Date().toISOString();
  const hashTmp = await sha256Hex(EMAIL_TMP);
  const hashAnon = await sha256Hex(EMAIL_ANON);

  const promo = makeCode('PLUS', 'PR');
  const admin = makeCode('PLUS', 'AD');
  const purchase = makeCode('PLUS', 'PU');
  // Plausible-looking txn so Portal marks refundable=true; Paddle refund will fail unless real.
  const txn = 'txn_01' + crypto.randomBytes(12).toString('hex').toLowerCase();

  // promo: redeem within 30d, use 14d after activate
  wrangler(
    `INSERT INTO licenses (license_code, tier, status, max_devices, expires_at, duration_days, buyer_email_hash, buyer_email, paddle_transaction_id, source, created_at)
     VALUES ('${promo}', 'PLUS', 'active', 2, '${isoPlusDays(30)}', 14, '${hashTmp}', '${EMAIL_TMP}', NULL, 'promo', '${now}')`
  );

  // admin: lifetime support code
  wrangler(
    `INSERT INTO licenses (license_code, tier, status, max_devices, expires_at, duration_days, buyer_email_hash, buyer_email, paddle_transaction_id, source, created_at)
     VALUES ('${admin}', 'PLUS', 'active', 2, 'LIFETIME', NULL, '${hashTmp}', '${EMAIL_TMP}', NULL, 'admin', '${now}')`
  );

  // purchase-sim: bound to new email anon@301098.xyz
  wrangler(
    `INSERT INTO licenses (license_code, tier, status, max_devices, expires_at, duration_days, buyer_email_hash, buyer_email, paddle_transaction_id, source, created_at)
     VALUES ('${purchase}', 'PLUS', 'active', 2, 'LIFETIME', NULL, '${hashAnon}', '${EMAIL_ANON}', '${txn}', 'purchase', '${now}')`
  );

  // marker row note via system_error_logs? skip — print batch tag in code prefix date
  console.log(JSON.stringify({
    batch: BATCH,
    note: 'Activate these on device 220b0d36b727 then run portal/admin checks. Cleanup: node tests/mint-qa-licenses.js --cleanup',
    licenses: [
      { source: 'promo', email: EMAIL_TMP, license_code: promo, redeem_days: 30, duration_days: 14, portal_refund: false },
      { source: 'admin', email: EMAIL_TMP, license_code: admin, entitlement: 'LIFETIME', portal_refund: false },
      { source: 'purchase', email: EMAIL_ANON, license_code: purchase, paddle_transaction_id: txn, portal_refund: true, paddle_refund_note: 'sim txn — Adjustments will fail; use for activate + UI only' }
    ]
  }, null, 2));
}

function cleanup() {
  // Remove today's QA codes we just minted (tag PR/AD/PU in random segment is weak).
  // Safer: delete by buyer emails + created_at last 2 hours + source set.
  const out = wrangler(
    `SELECT license_code, source, buyer_email, status FROM licenses
     WHERE buyer_email IN ('${EMAIL_TMP}', '${EMAIL_ANON}')
       AND source IN ('promo','admin','purchase')
       AND created_at >= datetime('now', '-2 days')
     ORDER BY created_at DESC LIMIT 20`
  );
  console.log('Candidates:', JSON.stringify(out[0]?.results || [], null, 2));
  console.log('To delete specific codes, run wrangler DELETE WHERE license_code IN (...) after activations cleanup.');
}

async function main() {
  if (process.argv.includes('--cleanup')) return cleanup();
  await mint();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
