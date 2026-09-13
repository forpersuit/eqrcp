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
const { DatabaseSync } = require('node:sqlite');

const errorLoggerPath = path.join(__dirname, 'compiled', 'error-logger.js');
const rateLimitPath = path.join(__dirname, 'compiled', 'rate-limit.js');

if (!fs.existsSync(errorLoggerPath) || !fs.existsSync(rateLimitPath)) {
  console.error("Compiled modules not found. Build with esbuild first:");
  console.error("  npx esbuild src/utils/error-logger.ts --bundle --outfile=tests/compiled/error-logger.js --platform=node --format=cjs");
  console.error("  npx esbuild src/utils/rate-limit.ts --bundle --outfile=tests/compiled/rate-limit.js --platform=node --format=cjs");
  process.exit(1);
}

const { logSystemError, ensureAuditLogTable, getSafeUserErrorMessage } = require(errorLoggerPath);
const { logRateLimitHit, rateLimitStatus, reserveD1RateLimit, releaseD1RateLimit, isD1RateLimited } = require(rateLimitPath);

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

// --- Mock D1 backed by SQLite ---
class MockD1 {
  constructor() {
    this.rows = [];
    this.lastSQL = '';
    this.lastBinds = [];
    this.db = new DatabaseSync(':memory:');
    this.db.exec('PRAGMA foreign_keys = OFF');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS rate_limits (
        key TEXT PRIMARY KEY,
        count INTEGER NOT NULL DEFAULT 1,
        window_start TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS system_error_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        level TEXT NOT NULL DEFAULT 'ERROR',
        category TEXT NOT NULL,
        error_message TEXT NOT NULL,
        context_json TEXT,
        created_at TEXT NOT NULL,
        trace_id TEXT
      );
    `);
  }

  get rateLimits() {
    const self = this;
    return {
      get(key) {
        const row = self.db.prepare('SELECT count, window_start FROM rate_limits WHERE key = ?').get(key);
        return row || null;
      },
      set(key, val) {
        self.db.prepare('INSERT OR REPLACE INTO rate_limits (key, count, window_start) VALUES (?, ?, ?)').run(key, val.count, val.window_start);
      }
    };
  }

  _mk(sql, binds) {
    const self = this;
    return {
      all: async () => {
        self.rows.push({ sql, binds });
        const stmt = self.db.prepare(sql);
        return { results: stmt.all(...binds) };
      },
      first: async () => {
        self.rows.push({ sql, binds });
        const stmt = self.db.prepare(sql);
        const row = stmt.get(...binds);
        return row || null;
      },
      run: async () => {
        self.rows.push({ sql, binds });
        const stmt = self.db.prepare(sql);
        const res = stmt.run(...binds);
        return { success: true, meta: { changes: res.changes } };
      },
      bind: (...args) => self._mk(sql, args)
    };
  }

  prepare(sql) {
    this.lastSQL = sql;
    return this._mk(sql, []);
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
  // Test Suite: Two-Phase Rate Limiting (2PC Hold & Release)
  // ============================================================
  console.log('\n=== Two-Phase Rate Limiting (2PC) ===');

  // Test 11: Reservation, exhaustion, rollback, and idempotency
  {
    const db = new MockD1();
    const env = makeEnv(db);
    const key = 'test_2pc:node123';
    const windowMs = 60 * 1000;
    const maxAttempts = 3;

    // First attempt: hold slot 1
    const r1 = await reserveD1RateLimit(env, key, maxAttempts, windowMs);
    assert(r1.allowed === true, 'r1 allowed');
    assertEqual(r1.count, 1, 'r1 count = 1');
    assertEqual(r1.remaining, 2, 'r1 remaining = 2');

    // Second attempt: hold slot 2
    const r2 = await reserveD1RateLimit(env, key, maxAttempts, windowMs);
    assert(r2.allowed === true, 'r2 allowed');
    assertEqual(r2.count, 2, 'r2 count = 2');
    assertEqual(r2.remaining, 1, 'r2 remaining = 1');

    // Third attempt: hold slot 3 (max capacity)
    const r3 = await reserveD1RateLimit(env, key, maxAttempts, windowMs);
    assert(r3.allowed === true, 'r3 allowed');
    assertEqual(r3.count, 3, 'r3 count = 3');
    assertEqual(r3.remaining, 0, 'r3 remaining = 0');

    // Fourth attempt: capacity exhausted
    const r4 = await reserveD1RateLimit(env, key, maxAttempts, windowMs);
    assert(r4.allowed === false, 'r4 rejected due to rate limit');
    assertEqual(r4.remaining, 0, 'r4 remaining = 0');

    // Rollback r3 (downstream failure simulation)
    await r3.release();
    const stateAfterRelease = db.rateLimits.get(key);
    assertEqual(stateAfterRelease.count, 2, 'count decremented from 3 to 2 after release');

    // Retry should now succeed and reclaim the slot
    const r3Retry = await reserveD1RateLimit(env, key, maxAttempts, windowMs);
    assert(r3Retry.allowed === true, 'r3Retry succeeds after rollback');
    assertEqual(r3Retry.count, 3, 'count returns to 3');

    // Double release idempotency check
    await r3.release(); // Should be a no-op because r3 was already released
    const stateAfterDoubleRelease = db.rateLimits.get(key);
    assertEqual(stateAfterDoubleRelease.count, 3, 'count does not double-decrement on duplicate release call');
  }

  // Test 12: Atomic Reservation Concurrency Under Exhaustion (R39-1 / E1)
  {
    const db = new MockD1();
    const env = makeEnv(db);
    const key = 'test_conc:node_exhaustion';
    const windowMs = 60 * 1000;
    const maxAttempts = 3;

    // Pre-seed count = 2 (1 slot remaining)
    const nowIso = new Date().toISOString();
    db.rateLimits.set(key, { count: 2, window_start: nowIso });

    // 10 concurrent requests race for the single remaining slot
    const results = await Promise.all(
      Array.from({ length: 10 }, () => reserveD1RateLimit(env, key, maxAttempts, windowMs))
    );

    const allowed = results.filter(r => r.allowed);
    const rejected = results.filter(r => !r.allowed && r.retryAfter > 0);

    assert(
      allowed.length === 1 && rejected.length === 9,
      `T12: Concurrency test allows exactly 1 slot (got ${allowed.length}) and rejects 9 with retryAfter`
    );
    const finalCount = db.rateLimits.get(key).count;
    assertEqual(finalCount, 3, 'T12: Final DB count is exactly maxAttempts=3 (no over-increment inflation)');
  }

  // Test 12.1: Empty row concurrency (R39-14 / E10) - 3 concurrent requests at empty row (max=3)
  {
    const db = new MockD1();
    const env = makeEnv(db);
    const key = 'test_conc:empty_row_3';
    const windowMs = 60 * 1000;
    const maxAttempts = 3;

    const results = await Promise.all(
      Array.from({ length: 3 }, () => reserveD1RateLimit(env, key, maxAttempts, windowMs))
    );

    const allowed = results.filter(r => r.allowed);
    assert(allowed.length === 3, `T12.1: Empty row + 3 concurrent requests (max=3) allows all 3 (got ${allowed.length})`);
    const finalCount = db.rateLimits.get(key).count;
    assertEqual(finalCount, 3, 'T12.1: Final DB count is exactly 3');
  }

  // Test 12.2: Empty row concurrency (R39-14 / E10) - 10 concurrent requests at empty row (max=10)
  {
    const db = new MockD1();
    const env = makeEnv(db);
    const key = 'test_conc:empty_row_10';
    const windowMs = 60 * 1000;
    const maxAttempts = 10;

    const results = await Promise.all(
      Array.from({ length: 10 }, () => reserveD1RateLimit(env, key, maxAttempts, windowMs))
    );

    const allowed = results.filter(r => r.allowed);
    assert(allowed.length === 10, `T12.2: Empty row + 10 concurrent requests (max=10) allows all 10 (got ${allowed.length})`);
    const finalCount = db.rateLimits.get(key).count;
    assertEqual(finalCount, 10, 'T12.2: Final DB count is exactly 10');
  }

  // Test 12.3: Expired window concurrency (R39-14 / E10) - 3 concurrent requests on expired row
  {
    const db = new MockD1();
    const env = makeEnv(db);
    const key = 'test_conc:expired_window';
    const windowMs = 60 * 1000;
    const maxAttempts = 3;

    // Seed expired window (2 hours ago) with full count
    const expiredIso = new Date(Date.now() - 7200 * 1000).toISOString();
    db.rateLimits.set(key, { count: 3, window_start: expiredIso });

    const results = await Promise.all(
      Array.from({ length: 3 }, () => reserveD1RateLimit(env, key, maxAttempts, windowMs))
    );

    const allowed = results.filter(r => r.allowed);
    assert(allowed.length === 3, `T12.3: Expired window + 3 concurrent requests (max=3) resets and allows all 3 (got ${allowed.length})`);
    const finalCount = db.rateLimits.get(key).count;
    assertEqual(finalCount, 3, 'T12.3: Final DB count is reset and incremented to 3');
  }

  // Test 12.4: Full quota rejection concurrency - 5 concurrent requests on exhausted row
  {
    const db = new MockD1();
    const env = makeEnv(db);
    const key = 'test_conc:fully_exhausted';
    const windowMs = 60 * 1000;
    const maxAttempts = 3;

    // Seed active window with count = 3
    const nowIso = new Date().toISOString();
    db.rateLimits.set(key, { count: 3, window_start: nowIso });

    const results = await Promise.all(
      Array.from({ length: 5 }, () => reserveD1RateLimit(env, key, maxAttempts, windowMs))
    );

    const allowed = results.filter(r => r.allowed);
    const rejected = results.filter(r => !r.allowed && r.retryAfter > 0);
    assert(allowed.length === 0 && rejected.length === 5, `T12.4: Exhausted quota correctly rejects all 5 concurrent requests`);
    const finalCount = db.rateLimits.get(key).count;
    assertEqual(finalCount, 3, 'T12.4: Final DB count remains 3');
  }

  // Test 13: Window-Guarded Rollback Protection (R39-3 / E3)
  {
    const db = new MockD1();
    const env = makeEnv(db);
    const key = 'test_guard:window_isolation';
    const windowMs = 60 * 1000;
    const maxAttempts = 3;

    // Window 1: Reserve a slot
    const rOld = await reserveD1RateLimit(env, key, maxAttempts, windowMs);
    assert(rOld.allowed === true, 'rOld reserved in Window 1');
    const oldWindowStart = rOld.windowStart;

    // Simulate time advancing to Window 2: New window created with count = 1
    const newWindowStart = new Date(Date.now() + 120000).toISOString();
    db.rateLimits.set(key, { count: 1, window_start: newWindowStart });

    // Late release of rOld from Window 1 arrives
    await rOld.release();

    // Verify: Window 2's count must NOT be decremented to 0
    const stateAfterLateRelease = db.rateLimits.get(key);
    assertEqual(
      stateAfterLateRelease.count,
      1,
      'T13: Late release from expired window does NOT erode new window count (window_start guard works)'
    );
  }

  // ============================================================
  // Summary
  // ============================================================
  const total = passed + failed;
  console.log(`\n=== Results: ${passed}/${total} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
})();
