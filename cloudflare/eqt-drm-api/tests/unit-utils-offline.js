/**
 * Offline unit tests for utility modules:
 *   - error-logger.ts: logSystemError, sendTelegramAlert, rate limiting
 *   - rate-limit.ts: logRateLimitHit, rateLimitStatus
 *
 * Build:
 *   npx esbuild src/utils/error-logger.ts --bundle --outfile=tests/compiled/error-logger.js --platform=node --format=cjs
 *   npx esbuild src/utils/rate-limit.ts --bundle --outfile=tests/compiled/rate-limit.js --platform=node --format=cjs
 * Run:
 *   node tests/unit-utils-offline.js
 */
const path = require('path');
const fs = require('fs');

const errorLoggerPath = path.join(__dirname, 'compiled', 'error-logger.js');
const rateLimitPath = path.join(__dirname, 'compiled', 'rate-limit.js');

if (!fs.existsSync(errorLoggerPath) || !fs.existsSync(rateLimitPath)) {
  console.error("Compiled modules not found. Build with esbuild first:");
  console.error("  npx esbuild src/utils/error-logger.ts --bundle --outfile=tests/compiled/error-logger.js --platform=node --format=cjs");
  console.error("  npx esbuild src/utils/rate-limit.ts --bundle --outfile=tests/compiled/rate-limit.js --platform=node --format=cjs");
  process.exit(1);
}

const { logSystemError, ensureAuditLogTable, getSafeUserErrorMessage } = require(errorLoggerPath);
const { logRateLimitHit, rateLimitStatus } = require(rateLimitPath);

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    console.error(`  ✗ ${msg}`);
  }
}

function assertEqual(actual, expected, msg) {
  if (actual === expected) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    console.error(`  ✗ ${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// --- Mock D1 ---
class MockD1 {
  constructor() {
    this.rows = [];
    this.lastSQL = '';
    this.lastBinds = [];
  }

  prepare(sql) {
    this.lastSQL = sql;
    const self = this;
    return {
      run: async () => {
        self.rows.push({ sql, binds: [] });
        return { meta: { changes: 1 } };
      },
      first: async () => null,
      all: async () => ({ results: [] }),
      bind: (...binds) => {
        self.lastBinds = binds;
        return {
          run: async () => {
            self.rows.push({ sql, binds });
            return { meta: { changes: 1 } };
          },
          first: async () => null,
          all: async () => ({ results: [] }),
        };
      },
    };
  }
}

// --- Mock Env ---
function makeEnv(db, overrides = {}) {
  return {
    DB: db,
    TELEGRAM_BOT_TOKEN: overrides.telegramToken || 'test-bot-token',
    TELEGRAM_CHAT_ID: overrides.telegramChatId || 'test-chat-id',
    ...overrides,
  };
}

// ============================================================
// Test Suite: logSystemError
// ============================================================
console.log('\n=== logSystemError ===');

(async () => {
  // Test 1: Writes to D1 with trace_id
  {
    const db = new MockD1();
    const env = makeEnv(db);
    await logSystemError(env, 'TEST', 'ERROR', new Error('boom'), { foo: 'bar' }, 'trace-123');
    const insertCall = db.rows.find(r => r.sql.includes('INSERT INTO system_error_logs'));
    assert(!!insertCall, 'INSERT INTO system_error_logs was called');
    if (insertCall) {
      assert(insertCall.sql.includes('trace_id'), 'INSERT includes trace_id column');
      assertEqual(insertCall.binds[0], 'ERROR', 'binds[0] = level');
      assertEqual(insertCall.binds[1], 'TEST', 'binds[1] = category');
      assert(insertCall.binds[2].includes('boom'), 'binds[2] = error message');
      assertEqual(insertCall.binds[5], 'trace-123', 'binds[5] = trace_id');
    }
  }

  // Test 2: Sends Telegram alert for CRITICAL level with escaped HTML
  {
    const db = new MockD1();
    const env = makeEnv(db);
    let telegramCalled = false;
    let telegramBody = null;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, opts) => {
      telegramCalled = true;
      telegramBody = JSON.parse(opts.body);
      return { ok: true };
    };
    await logSystemError(env, 'SERVER_EXCEPTION', 'CRITICAL', new Error('fatal <script>error</script>'), { secret_key: 'supersecrettoken123' });
    assert(telegramCalled, 'fetch to Telegram API was called for CRITICAL');
    if (telegramBody) {
      assertEqual(telegramBody.chat_id, 'test-chat-id', 'Telegram chat_id is set');
      assert(telegramBody.text.includes('[CRITICAL]'), 'Telegram message contains CRITICAL');
      assert(telegramBody.text.includes('SERVER_EXCEPTION'), 'Telegram message contains category');
      assert(telegramBody.text.includes('&lt;script&gt;'), 'Telegram message escapes HTML characters');
      assert(!telegramBody.text.includes('supersecrettoken123'), 'Telegram message redacts sensitive secret in context');
    }
    globalThis.fetch = originalFetch;
  }

  // Test 3: Rate-limits Telegram alerts to max 3 per window per category
  {
    const db = new MockD1();
    const env = makeEnv(db);
    let fetchCount = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      fetchCount++;
      return { ok: true };
    };
    // 3 calls should trigger fetch
    await logSystemError(env, 'RATE_LIMIT_TEST', 'CRITICAL', new Error('1'), {});
    await logSystemError(env, 'RATE_LIMIT_TEST', 'CRITICAL', new Error('2'), {});
    await logSystemError(env, 'RATE_LIMIT_TEST', 'CRITICAL', new Error('3'), {});
    // 4th call with same category should be rate-limited
    await logSystemError(env, 'RATE_LIMIT_TEST', 'CRITICAL', new Error('4'), {});
    assertEqual(fetchCount, 3, '4th CRITICAL alert with same category is rate-limited (max 3/window)');
    globalThis.fetch = originalFetch;
  }

  // Test 4: Different categories have independent rate limit buckets
  {
    const db = new MockD1();
    const env = makeEnv(db);
    let fetchCount = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      fetchCount++;
      return { ok: true };
    };
    await logSystemError(env, 'CAT_A', 'CRITICAL', new Error('a'), {});
    await logSystemError(env, 'CAT_B', 'CRITICAL', new Error('b'), {});
    assertEqual(fetchCount, 2, 'Different categories have independent rate limit buckets');
    globalThis.fetch = originalFetch;
  }

  // Test 5: Sends Telegram for Money Path ERROR levels (PADDLE_, SMTP_EMAIL_FAIL), but NOT for non-money-path ERROR
  {
    const db = new MockD1();
    const env = makeEnv(db);
    let fetchCount = 0;
    let lastBody = null;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, opts) => {
      fetchCount++;
      lastBody = JSON.parse(opts.body);
      return { ok: true };
    };
    // Non-money-path ERROR -> no alert
    await logSystemError(env, 'GENERIC_UI', 'ERROR', new Error('minor error'), {});
    assertEqual(fetchCount, 0, 'No Telegram alert for generic non-money-path ERROR level');

    // Money path ERROR (PADDLE_WEBHOOK) -> should alert
    await logSystemError(env, 'PADDLE_WEBHOOK', 'ERROR', new Error('webhook missing table'), { transaction_id: 'txn_123' });
    assertEqual(fetchCount, 1, 'Telegram alert sent for Money Path PADDLE_WEBHOOK ERROR');
    assert(lastBody && lastBody.text.includes('PADDLE_WEBHOOK'), 'Message includes PADDLE_WEBHOOK category');

    // Money path ERROR (SMTP_EMAIL_FAIL) -> should alert
    await logSystemError(env, 'SMTP_EMAIL_FAIL', 'ERROR', new Error('smtp drop'), { to: 'user@test.com' });
    assertEqual(fetchCount, 2, 'Telegram alert sent for Money Path SMTP_EMAIL_FAIL ERROR');

    globalThis.fetch = originalFetch;
  }

  // Test 6: Handles missing Telegram config gracefully
  {
    const db = new MockD1();
    const env = makeEnv(db, { telegramToken: undefined, telegramChatId: undefined });
    // Override after makeEnv
    env.TELEGRAM_BOT_TOKEN = '';
    env.TELEGRAM_CHAT_ID = '';
    let fetchCalled = false;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      fetchCalled = true;
      return { ok: true };
    };
    await logSystemError(env, 'TEST', 'CRITICAL', new Error('no token'), {});
    assert(!fetchCalled, 'No Telegram alert when token is empty');
    globalThis.fetch = originalFetch;
  }

  // ============================================================
  // Test Suite: logRateLimitHit
  // ============================================================
  console.log('\n=== logRateLimitHit ===');

  // Test 7: Writes WARN entry to system_error_logs
  {
    const db = new MockD1();
    const env = makeEnv(db);
    await logRateLimitHit(env, 'DEVICE_REGISTER', 'key-123', { uuid_hash: 'abc' });
    const insertCall = db.rows.find(r => r.sql.includes('INSERT INTO system_error_logs'));
    assert(!!insertCall, 'INSERT INTO system_error_logs was called');
    if (insertCall) {
      assertEqual(insertCall.binds[0], 'WARN', 'binds[0] = WARN level');
      assertEqual(insertCall.binds[1], 'RATE_LIMIT_DEVICE_REGISTER', 'binds[1] = RATE_LIMIT_ category');
      assert(insertCall.binds[2].includes('key-123'), 'binds[2] = error message with key');
    }
  }

  // ============================================================
  // Test Suite: rateLimitStatus
  // ============================================================
  console.log('\n=== rateLimitStatus ===');

  // Test 8: Returns three bucket types with correct structure
  {
    const status = rateLimitStatus();
    assert(!!status, 'rateLimitStatus() returns a value');
    assert(!!status.adminAuth, 'status has adminAuth');
    assert(!!status.otpVerify, 'status has otpVerify');
    assert(!!status.deviceRegister, 'status has deviceRegister');
    assert(typeof status.adminAuth.window_ms === 'number', 'adminAuth.window_ms is number');
    assert(typeof status.adminAuth.max_fails === 'number', 'adminAuth.max_fails is number');
    assert(typeof status.adminAuth.active_buckets === 'number', 'adminAuth.active_buckets is number');
    assert(typeof status.otpVerify.window_ms === 'number', 'otpVerify.window_ms is number');
    assert(typeof status.otpVerify.max_fails === 'number', 'otpVerify.max_fails is number');
    assert(typeof status.otpVerify.active_buckets === 'number', 'otpVerify.active_buckets is number');
    assert(typeof status.deviceRegister.window_ms === 'number', 'deviceRegister.window_ms is number');
    assert(typeof status.deviceRegister.max_requests === 'number', 'deviceRegister.max_requests is number');
    assert(typeof status.deviceRegister.active_buckets === 'number', 'deviceRegister.active_buckets is number');
    assertEqual(status.adminAuth.window_ms, 300000, 'adminAuth window is 5 min (300000ms)');
    assertEqual(status.adminAuth.max_fails, 10, 'adminAuth max_fails is 10');
    assertEqual(status.otpVerify.window_ms, 900000, 'otpVerify window is 15 min (900000ms)');
    assertEqual(status.otpVerify.max_fails, 8, 'otpVerify max_fails is 8');
    assertEqual(status.deviceRegister.window_ms, 60000, 'deviceRegister window is 1 min (60000ms)');
    assertEqual(status.deviceRegister.max_requests, 10, 'deviceRegister max_requests is 10');
  }

  // ============================================================
  // Test Suite: getSafeUserErrorMessage
  // ============================================================
  console.log('\n=== getSafeUserErrorMessage ===');

  // Test 9: Masks internal error patterns
  {
    const defaultMsg = 'Service temporarily unavailable. Please try again later.';
    assertEqual(getSafeUserErrorMessage('D1_ERROR: connection failed'), defaultMsg, 'Masks D1_ERROR');
    assertEqual(getSafeUserErrorMessage('SQLITE error: no such table'), defaultMsg, 'Masks SQLITE error');
    assertEqual(getSafeUserErrorMessage('UNIQUE constraint failed'), defaultMsg, 'Masks UNIQUE constraint');
    assertEqual(getSafeUserErrorMessage('TypeError: Cannot read property'), defaultMsg, 'Masks TypeError');
    assertEqual(getSafeUserErrorMessage(''), defaultMsg, 'Empty string returns default');
    assertEqual(getSafeUserErrorMessage(null), defaultMsg, 'null returns default');
  }

  // Test 10: Passes through safe messages
  {
    assertEqual(getSafeUserErrorMessage('Invalid license code'), 'Invalid license code', 'Passes through safe message');
    assertEqual(getSafeUserErrorMessage('Device not found'), 'Device not found', 'Passes through device not found');
    assertEqual(getSafeUserErrorMessage('Rate limit exceeded'), 'Rate limit exceeded', 'Passes through rate limit message');
  }

  // ============================================================
  // Summary
  // ============================================================
  const total = passed + failed;
  console.log(`\n=== Results: ${passed}/${total} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
})();
