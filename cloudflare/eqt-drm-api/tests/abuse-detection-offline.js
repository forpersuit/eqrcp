/**
 * Offline unit tests for abuse-detection.ts
 *
 * Tests the three detection rules with mocked D1:
 *   R1 — License activation count threshold
 *   R2 — Device fingerprint reuse across licenses
 *   R3 — IP-based activation rate
 *
 * Build:
 *   npx esbuild src/utils/abuse-detection.ts --bundle --outfile=tests/compiled/abuse-detection.js --platform=node --format=cjs
 * Run:
 *   node tests/abuse-detection-offline.js
 */
const path = require('path');
const fs = require('fs');

const compiledPath = path.join(__dirname, 'compiled', 'abuse-detection.js');

if (!fs.existsSync(compiledPath)) {
  console.error("Compiled module not found. Build with esbuild first:");
  console.error("  npx esbuild src/utils/abuse-detection.ts --bundle --outfile=tests/compiled/abuse-detection.js --platform=node --format=cjs");
  process.exit(1);
}

const mod = require(compiledPath);
const {
  checkLicenseActivationCount,
  checkDeviceFingerprintReuse,
  checkIpActivationRate,
  checkAbuseAfterActivation,
} = mod;

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${label}`);
  }
}

// ── Mock D1 helpers ────────────────────────────────────────

function makeMockDb(firstResult, runResult, allResult) {
  const stmt = {
    _sql: '',
    _binds: [],
    bind(...args) {
      this._binds = args;
      return this;
    },
    first(opts) {
      return Promise.resolve(typeof firstResult === 'function' ? firstResult(this._sql, this._binds) : firstResult);
    },
    run() {
      return Promise.resolve(runResult || { meta: { changes: 1, last_row_id: 1 } });
    },
    all() {
      return Promise.resolve(allResult || { results: [] });
    },
  };
  return {
    prepare(sql) {
      stmt._sql = sql;
      return stmt;
    },
  };
}

function makeEnv(firstResult) {
  return {
    DB: makeMockDb(firstResult),
    TELEGRAM_BOT_TOKEN: 'test',
    TELEGRAM_CHAT_ID: 'test',
  };
}

// ── R1: License Activation Count ────────────────────────────

console.log('\n=== R1: checkLicenseActivationCount ===');

(async () => {
  // R1a: Below threshold (5 activations, max_devices=2 → threshold=6)
  let env = makeEnv({ count: 5 });
  let r = await checkLicenseActivationCount(env, 'EQT-TEST-001', 2);
  assert(!r.triggered, '5 activations on max_devices=2 → not triggered');

  // R1b: At threshold (6 activations, max_devices=2 → threshold=6)
  env = makeEnv({ count: 6 });
  r = await checkLicenseActivationCount(env, 'EQT-TEST-001', 2);
  assert(r.triggered, '6 activations on max_devices=2 → triggered at threshold');
  assert(!r.autoBlacklist, 'R1 autoBlacklist is false (alert only)');
  assert(r.reason.includes('6 devices'), 'R1 reason mentions device count');

  // R1c: Above threshold (15 activations, max_devices=5 → threshold=15)
  env = makeEnv({ count: 15 });
  r = await checkLicenseActivationCount(env, 'EQT-TEST-002', 5);
  assert(r.triggered, '15 activations on max_devices=5 → triggered (multiplier)');

  // R1d: Below multiplier threshold (14 activations, max_devices=5 → threshold=15)
  env = makeEnv({ count: 14 });
  r = await checkLicenseActivationCount(env, 'EQT-TEST-002', 5);
  assert(!r.triggered, '14 activations on max_devices=5 → not triggered (below multiplier)');

  // R1e: Zero activations
  env = makeEnv({ count: 0 });
  r = await checkLicenseActivationCount(env, 'EQT-TEST-003', 2);
  assert(!r.triggered, '0 activations → not triggered');

  // R1f: Null result from DB
  env = makeEnv(null);
  r = await checkLicenseActivationCount(env, 'EQT-TEST-004', 2);
  assert(!r.triggered, 'null DB result → not triggered');

  // ── R2: Device Fingerprint Reuse ────────────────────────────

  console.log('\n=== R2: checkDeviceFingerprintReuse ===');

  // R2a: Below threshold (3 licenses, threshold=5)
  env = makeEnv({ count: 3 });
  r = await checkDeviceFingerprintReuse(env, 'uuid-abc', 'cpu-123', 'disk-xyz');
  assert(!r.triggered, '3 licenses with same fingerprint → not triggered');

  // R2b: At threshold (5 licenses)
  env = makeEnv({ count: 5 });
  r = await checkDeviceFingerprintReuse(env, 'uuid-abc', 'cpu-123', 'disk-xyz');
  assert(r.triggered, '5 licenses with same fingerprint → triggered at threshold');
  assert(r.autoBlacklist, 'R2 autoBlacklist is true');

  // R2c: Above threshold (8 licenses)
  env = makeEnv({ count: 8 });
  r = await checkDeviceFingerprintReuse(env, 'uuid-abc', 'cpu-123', 'disk-xyz');
  assert(r.triggered, '8 licenses with same fingerprint → triggered');

  // R2d: All empty hashes → skip
  env = makeEnv({ count: 99 });
  r = await checkDeviceFingerprintReuse(env, '', '', '');
  assert(!r.triggered, 'all empty hashes → not triggered (skip)');

  // R2e: Only one non-empty hash
  env = makeEnv({ count: 5 });
  r = await checkDeviceFingerprintReuse(env, 'uuid-abc', '', '');
  assert(r.triggered, 'single non-empty hash matching 5 licenses → triggered');

  // R2f: Null DB result
  env = makeEnv(null);
  r = await checkDeviceFingerprintReuse(env, 'uuid-abc', 'cpu-123', 'disk-xyz');
  assert(!r.triggered, 'null DB result → not triggered');

  // ── R3: IP Activation Rate ─────────────────────────────────

  console.log('\n=== R3: checkIpActivationRate ===');

  // R3a: Below threshold (2 licenses, threshold=3)
  env = makeEnv({ count: 2 });
  r = await checkIpActivationRate(env, '1.2.3.4');
  assert(!r.triggered, '2 licenses from same IP → not triggered');

  // R3b: At threshold (3 licenses)
  env = makeEnv({ count: 3 });
  r = await checkIpActivationRate(env, '1.2.3.4');
  assert(r.triggered, '3 licenses from same IP → triggered at threshold');
  assert(!r.autoBlacklist, 'R3 autoBlacklist is false (alert only)');

  // R3c: Above threshold (5 licenses)
  env = makeEnv({ count: 5 });
  r = await checkIpActivationRate(env, '1.2.3.4');
  assert(r.triggered, '5 licenses from same IP → triggered');

  // R3d: null IP → skip
  env = makeEnv({ count: 99 });
  r = await checkIpActivationRate(env, null);
  assert(!r.triggered, 'null IP → not triggered (skip)');

  // R3e: 'unknown' IP → skip
  env = makeEnv({ count: 99 });
  r = await checkIpActivationRate(env, 'unknown');
  assert(!r.triggered, "'unknown' IP → not triggered (skip)");

  // R3f: '127.0.0.1' → skip
  env = makeEnv({ count: 99 });
  r = await checkIpActivationRate(env, '127.0.0.1');
  assert(!r.triggered, "'127.0.0.1' → not triggered (skip)");

  // R3g: Null DB result
  env = makeEnv(null);
  r = await checkIpActivationRate(env, '1.2.3.4');
  assert(!r.triggered, 'null DB result → not triggered');

  // ── Results ────────────────────────────────────────────────

  console.log(`\n=== Results: ${passed}/${passed + failed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
})();
