/**
 * Offline unit tests for D1 lightweight exponential backoff retry mechanism:
 *   - isRetryableD1Error error classification (transient timeouts vs permanent constraints)
 *   - withD1Retry execution and exponential delay verification
 *   - withD1Retry max attempts reached throws last error
 *   - withD1Retry non-retryable error throws immediately on attempt 1 (no delay)
 *   - wrapD1WithRetry transparent proxy: .first(), .all(), .run(), .raw(), .batch(), .exec()
 *   - wrapD1WithRetry idempotency (WeakMap cache returns identical proxy)
 *   - Statement unwrapping for batch execution
 */
const path = require('path');
const fs = require('fs');

const d1RetryPath = path.join(__dirname, 'compiled', 'd1-retry.js');

if (!fs.existsSync(d1RetryPath)) {
  console.error("Compiled d1-retry.js bundle not found. Run esbuild first.");
  process.exit(1);
}

const {
  isRetryableD1Error,
  withD1Retry,
  wrapD1WithRetry
} = require(d1RetryPath);

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

(async () => {
  console.log('============================================================');
  console.log('🚀 D1 Exponential Backoff Retry Offline Unit Tests');
  console.log('============================================================\n');

  // ------------------------------------------------------------
  // Test Suite 1: Error Classification (isRetryableD1Error)
  // ------------------------------------------------------------
  console.log('=== Suite 1: Error Classification (isRetryableD1Error) ===');
  {
    // Transient errors that SHOULD retry:
    assert(
      isRetryableD1Error(new Error("D1_ERROR: D1 DB storage operation exceeded timeout which caused object to be reset.")),
      "Identifies D1 storage operation timeout reset as retryable"
    );
    assert(
      isRetryableD1Error(new Error("D1_NETWORK_TIMEOUT: connection lost during batch execution")),
      "Identifies D1 network timeout as retryable"
    );
    assert(
      isRetryableD1Error(new Error("Error: network connection lost")),
      "Identifies network connection lost as retryable"
    );
    assert(
      isRetryableD1Error(new Error("database is locked (sqlite_busy)")),
      "Identifies sqlite_busy as retryable"
    );
    assert(
      isRetryableD1Error(new Error("fetch failed")),
      "Identifies fetch failed as retryable"
    );
    assert(
      isRetryableD1Error({ cause: new Error("D1_RESET") }),
      "Identifies cause with D1_RESET as retryable"
    );

    // Non-retryable errors that MUST fail immediately:
    assert(
      !isRetryableD1Error(new Error("UNIQUE constraint failed: licenses.license_code")),
      "Rejects UNIQUE constraint violation (non-retryable)"
    );
    assert(
      !isRetryableD1Error(new Error("FOREIGN KEY constraint failed")),
      "Rejects FOREIGN KEY constraint violation (non-retryable)"
    );
    assert(
      !isRetryableD1Error(new Error("NOT NULL constraint failed")),
      "Rejects NOT NULL constraint violation (non-retryable)"
    );
    assert(
      !isRetryableD1Error(new Error("syntax error in SQL statement")),
      "Rejects SQL syntax error (non-retryable)"
    );
    assert(
      !isRetryableD1Error(null),
      "Rejects null error safely"
    );
  }

  // ------------------------------------------------------------
  // Test Suite 2: withD1Retry Execution & Exponential Backoff
  // ------------------------------------------------------------
  console.log('\n=== Suite 2: withD1Retry Logic & Delays ===');
  {
    // Case 2A: Transient failure on attempt 1, success on attempt 2
    let attemptsA = 0;
    const delaysA = [];
    const resA = await withD1Retry(async () => {
      attemptsA++;
      if (attemptsA === 1) {
        throw new Error("D1 DB storage operation exceeded timeout which caused object to be reset.");
      }
      return { ok: true, data: 42 };
    }, {
      baseDelayMs: 20,
      maxDelayMs: 200,
      onRetry: (_err, att, delay) => delaysA.push({ att, delay })
    });

    assertEqual(resA.data, 42, "Returns operation result on retry recovery");
    assertEqual(attemptsA, 2, "Executed 2 attempts (1 failure + 1 recovery)");
    assertEqual(delaysA.length, 1, "Recorded 1 retry delay event");
    assert(delaysA[0].delay >= 20, "Retry delay >= baseDelayMs");

    // Case 2B: Transient failure persists through all retries -> throws last error
    let attemptsB = 0;
    let thrownB = null;
    try {
      await withD1Retry(async () => {
        attemptsB++;
        throw new Error("D1 DB storage operation exceeded timeout which caused object to be reset.");
      }, {
        maxRetries: 2,
        baseDelayMs: 10,
        maxDelayMs: 50
      });
    } catch (err) {
      thrownB = err;
    }
    assertEqual(attemptsB, 3, "Executed max attempts (1 initial + 2 retries = 3)");
    assert(thrownB && /exceeded timeout/.test(thrownB.message), "Throws last error when max retries exceeded");

    // Case 2C: Non-retryable error fails immediately without retrying
    let attemptsC = 0;
    let thrownC = null;
    try {
      await withD1Retry(async () => {
        attemptsC++;
        throw new Error("UNIQUE constraint failed: licenses.license_code");
      }, {
        maxRetries: 2,
        baseDelayMs: 10
      });
    } catch (err) {
      thrownC = err;
    }
    assertEqual(attemptsC, 1, "Non-retryable error halts immediately on attempt 1 (0 retries)");
    assert(thrownC && /UNIQUE constraint failed/.test(thrownC.message), "Preserves non-retryable error message");
  }

  // ------------------------------------------------------------
  // Test Suite 3: wrapD1WithRetry Transparent Proxy
  // ------------------------------------------------------------
  console.log('\n=== Suite 3: wrapD1WithRetry Transparent Proxy ===');
  {
    class MockD1Database {
      constructor() {
        this.runCalls = 0;
        this.firstCalls = 0;
        this.allCalls = 0;
        this.batchCalls = 0;
        this.execCalls = 0;
        this.failFirstCount = 0;
      }

      prepare(sql) {
        const self = this;
        return {
          sql,
          bind(...binds) {
            return {
              sql,
              binds,
              async first() {
                self.firstCalls++;
                if (self.failFirstCount > 0) {
                  self.failFirstCount--;
                  throw new Error("D1 DB storage operation exceeded timeout which caused object to be reset.");
                }
                return { count: 1, email: binds[0] };
              },
              async all() {
                self.allCalls++;
                return { results: [{ id: 1 }] };
              },
              async run() {
                self.runCalls++;
                return { meta: { changes: 1 } };
              },
              async raw() {
                return [[1, "test"]];
              }
            };
          }
        };
      }

      async batch(statements) {
        this.batchCalls++;
        return statements.map(() => ({ meta: { changes: 1 } }));
      }

      async exec(sql) {
        this.execCalls++;
        return { count: 1, duration: 2 };
      }
    }

    const mockDb = new MockD1Database();
    const wrappedDb = wrapD1WithRetry(mockDb, { baseDelayMs: 10, maxDelayMs: 50 });

    // 1. Idempotency test (WeakMap cache returns same instance)
    const wrappedDbAgain = wrapD1WithRetry(mockDb);
    assert(wrappedDb === wrappedDbAgain, "wrapD1WithRetry returns identical proxy instance for same DB");
    assert(wrapD1WithRetry(wrappedDb) === wrappedDb, "wrapD1WithRetry on already wrapped DB is a no-op");

    // 2. .first() with transient failure recovery
    mockDb.failFirstCount = 1; // 1st call fails with timeout, 2nd call succeeds
    const firstRes = await wrappedDb.prepare("SELECT * FROM licenses WHERE email = ?").bind("tmp@301098.xyz").first();
    assertEqual(firstRes.email, "tmp@301098.xyz", ".first() successfully recovered and returned data");
    assertEqual(mockDb.firstCalls, 2, ".first() triggered transparent retry (2 calls total)");

    // 3. .all(), .run(), .batch(), .exec() transparent pass-through
    const allRes = await wrappedDb.prepare("SELECT * FROM licenses").bind().all();
    assertEqual(allRes.results.length, 1, ".all() returns expected results");

    const runRes = await wrappedDb.prepare("INSERT INTO table VALUES (?)").bind("val").run();
    assertEqual(runRes.meta.changes, 1, ".run() returns expected meta");

    const batchRes = await wrappedDb.batch([
      wrappedDb.prepare("UPDATE a SET x=1"),
      wrappedDb.prepare("UPDATE b SET y=2")
    ]);
    assertEqual(batchRes.length, 2, ".batch() accepts wrapped prepared statements and unrolls correctly");

    const execRes = await wrappedDb.exec("PRAGMA foreign_keys = ON;");
    assertEqual(execRes.count, 1, ".exec() executes cleanly");
  }

  console.log(`\n============================================================`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log(`============================================================`);

  if (failed > 0) {
    process.exit(1);
  }
})();
