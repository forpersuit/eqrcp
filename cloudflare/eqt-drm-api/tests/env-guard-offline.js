/**
 * Offline Unit Test for Fail-Safe Environment Guard & Paddle Alignment (§assertEnvironmentAlignment)
 * Runs with Node.js directly using esbuild compiled module.
 */
const { execSync } = require('child_process');
const path = require('path');
const assert = require('assert');

console.log('=== ENVIRONMENT GUARD & FAIL-SAFE DEFENSE OFFLINE TEST ===');

// 1. Bundle src/utils/env-guard.ts using esbuild
const COMPILED_DIR = path.join(__dirname, 'compiled');
const OUT_FILE = path.join(COMPILED_DIR, 'env-guard.js');

execSync(`npx esbuild src/utils/env-guard.ts --bundle --outfile=${OUT_FILE} --platform=node --format=cjs`, {
  cwd: path.join(__dirname, '..'),
  stdio: 'inherit'
});

const { assertEnvironmentAlignment, isTestEnvironment } = require(OUT_FILE);

const PROD_LIFETIME = 'pri_01kyd2nbsmg44rjmvf4vbetgwj';
const PROD_YEARLY = 'pri_01kydyzmn1pc29npe377dxtq96';
const SANDBOX_LIFETIME = 'pri_01kyhmkv4ppj10r4cdgw3sv48p';
const SANDBOX_YEARLY = 'pri_01kxymxqngex49tg65wb0701pc';

const PROD_URL = new URL('https://lic.eqt.net.im/api/v1/paddle/webhook');
const TEST_URL = new URL('https://lic-test.eqt.net.im/api/v1/paddle/webhook');
const LOCAL_URL = new URL('http://127.0.0.1:8787/api/v1/paddle/webhook');

let passed = 0;

function runTest(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

// Group 1: isTestEnvironment resolution
runTest('isTestEnvironment correctly identifies test environments', () => {
  assert.strictEqual(isTestEnvironment({ ENVIRONMENT: 'test' }), true);
  assert.strictEqual(isTestEnvironment({ ENVIRONMENT: 'production' }, TEST_URL), true);
  assert.strictEqual(isTestEnvironment({ ENVIRONMENT: 'production' }, LOCAL_URL), true);
  assert.strictEqual(isTestEnvironment({ ENVIRONMENT: 'production' }, PROD_URL), false);
  assert.strictEqual(isTestEnvironment({}, PROD_URL), false);
});

// Group 2: Production Guard (Live mode)
runTest('Production Worker with valid Live keys, prices, and TELEMETRY_SALT passes', () => {
  const validProdEnv = {
    ENVIRONMENT: 'production',
    PADDLE_API_KEY: 'pdl_live_apikey_1234567890abcdef',
    PADDLE_PRICE_ID_PLUS_LIFETIME: PROD_LIFETIME,
    PADDLE_PRICE_ID_PLUS_YEARLY: PROD_YEARLY,
    TELEMETRY_SALT: 'prod_telemetry_salt_secret_123'
  };
  assert.doesNotThrow(() => assertEnvironmentAlignment(validProdEnv, PROD_URL));
});

runTest('Production Worker blocks Sandbox API Key (Fail-Fast)', () => {
  const badProdEnv = {
    ENVIRONMENT: 'production',
    PADDLE_API_KEY: 'pdl_sdbx_apikey_1234567890abcdef',
    PADDLE_PRICE_ID_PLUS_LIFETIME: PROD_LIFETIME,
    PADDLE_PRICE_ID_PLUS_YEARLY: PROD_YEARLY,
    TELEMETRY_SALT: 'prod_telemetry_salt_secret_123'
  };
  assert.throws(() => assertEnvironmentAlignment(badProdEnv, PROD_URL), /CRITICAL SECURITY CONFIG MISMATCH.*Production worker must not use Paddle sandbox key/);
});

runTest('Production Worker blocks Sandbox Price IDs (Fail-Fast)', () => {
  const badPriceProdEnv = {
    ENVIRONMENT: 'production',
    PADDLE_API_KEY: 'pdl_live_apikey_1234567890abcdef',
    PADDLE_PRICE_ID_PLUS_LIFETIME: SANDBOX_LIFETIME,
    PADDLE_PRICE_ID_PLUS_YEARLY: PROD_YEARLY,
    TELEMETRY_SALT: 'prod_telemetry_salt_secret_123'
  };
  assert.throws(() => assertEnvironmentAlignment(badPriceProdEnv, PROD_URL), /CRITICAL CONFIG MISMATCH.*Production worker must not be configured with Paddle Sandbox price IDs/);
});

runTest('Production Worker blocks missing TELEMETRY_SALT (Fail-Fast)', () => {
  const missingSaltProdEnv = {
    ENVIRONMENT: 'production',
    PADDLE_API_KEY: 'pdl_live_apikey_1234567890abcdef',
    PADDLE_PRICE_ID_PLUS_LIFETIME: PROD_LIFETIME,
    PADDLE_PRICE_ID_PLUS_YEARLY: PROD_YEARLY
  };
  assert.throws(() => assertEnvironmentAlignment(missingSaltProdEnv, PROD_URL), /CRITICAL SECURITY CONFIG MISMATCH.*Production worker must have TELEMETRY_SALT configured/);
});

// Group 3: Test Worker Guard (Sandbox mode)
runTest('Test Worker with valid Sandbox keys and prices passes', () => {
  const validTestEnv = {
    ENVIRONMENT: 'test',
    PADDLE_API_KEY: 'pdl_sdbx_apikey_1234567890abcdef',
    PADDLE_PRICE_ID_PLUS_LIFETIME: SANDBOX_LIFETIME,
    PADDLE_PRICE_ID_PLUS_YEARLY: SANDBOX_YEARLY
  };
  assert.doesNotThrow(() => assertEnvironmentAlignment(validTestEnv, TEST_URL));
});

runTest('Test Worker blocks Live Paddle API Key (Fail-Fast)', () => {
  const badTestEnv = {
    ENVIRONMENT: 'test',
    PADDLE_API_KEY: 'pdl_live_apikey_1234567890abcdef',
    PADDLE_PRICE_ID_PLUS_LIFETIME: SANDBOX_LIFETIME,
    PADDLE_PRICE_ID_PLUS_YEARLY: SANDBOX_YEARLY
  };
  assert.throws(() => assertEnvironmentAlignment(badTestEnv, TEST_URL), /CRITICAL SECURITY CONFIG MISMATCH.*Test worker must not use Paddle live key/);
});

runTest('Test Worker with ENVIRONMENT=test blocks Live Price IDs (Fail-Fast)', () => {
  const badPriceTestEnv = {
    ENVIRONMENT: 'test',
    PADDLE_API_KEY: 'pdl_sdbx_apikey_1234567890abcdef',
    PADDLE_PRICE_ID_PLUS_LIFETIME: PROD_LIFETIME,
    PADDLE_PRICE_ID_PLUS_YEARLY: SANDBOX_YEARLY
  };
  assert.throws(() => assertEnvironmentAlignment(badPriceTestEnv, TEST_URL), /CRITICAL CONFIG MISMATCH.*Test worker must not be configured with Paddle Live production price IDs/);
});

// Group 4: Check if --env-file loaded .env.test variables
runTest('.env.test environment variables loaded successfully via --env-file', () => {
  console.log(`    [Env Verify] process.env.ENVIRONMENT = ${process.env.ENVIRONMENT}`);
  console.log(`    [Env Verify] process.env.DRM_HOSTNAME = ${process.env.DRM_HOSTNAME}`);
  assert.ok(process.env.DRM_HOSTNAME, 'DRM_HOSTNAME must be present from .env.test');
  assert.ok(process.env.PADDLE_SANDBOX_EQT || process.env.PADDLE_API_KEY, 'PADDLE key must be loaded from .env.test');
});

console.log(`\n🎉 All ${passed} environment guard test cases passed cleanly!`);
