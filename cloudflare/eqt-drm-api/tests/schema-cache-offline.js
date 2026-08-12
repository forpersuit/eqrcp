/**
 * Offline unit tests for D1 schema ensure in-memory caching (WeakSet isolation & error classification):
 *   - Same DB instance: repeated ensure calls hit WeakSet cache (0 additional SQL queries)
 *   - Different DB instance: separate ensure calls execute independently (proper multi-instance isolation)
 *   - Duplicate column / already exists errors: marked as ensured in WeakSet cache (idempotent recovery)
 *   - Network / unreachable errors: NOT cached, allowing subsequent retry attempts
 *
 * Build:
 *   npx esbuild src/utils/auth.ts --bundle --alias:cloudflare:sockets=./tests/mocks/cloudflare-sockets-stub.js --outfile=tests/compiled/auth.js --platform=node --format=cjs
 *   npx esbuild src/utils/blacklist.ts --bundle --outfile=tests/compiled/blacklist.js --platform=node --format=cjs
 *   npx esbuild src/utils/error-logger.ts --bundle --outfile=tests/compiled/error-logger.js --platform=node --format=cjs
 *   npx esbuild src/utils/rate-limit.ts --bundle --outfile=tests/compiled/rate-limit.js --platform=node --format=cjs
 * Run:
 *   node tests/schema-cache-offline.js
 */
const path = require('path');
const fs = require('fs');

const authPath = path.join(__dirname, 'compiled', 'auth.js');
const blacklistPath = path.join(__dirname, 'compiled', 'blacklist.js');
const errorLoggerPath = path.join(__dirname, 'compiled', 'error-logger.js');
const rateLimitPath = path.join(__dirname, 'compiled', 'rate-limit.js');

if (!fs.existsSync(authPath) || !fs.existsSync(blacklistPath) || !fs.existsSync(errorLoggerPath) || !fs.existsSync(rateLimitPath)) {
  console.error("Compiled test bundles not found. Ensure esbuild builds them first.");
  process.exit(1);
}

const {
  ensureDrmTables,
  ensureDeviceIdColumn,
  ensureActivationNetworkColumns,
  ensureVerificationCodesCreatedAt,
  ensureDeviceRegistryTable,
  ensureLicenseUpgradesTable,
  ensureLicensePaddleTxnIndex,
  ensureLicenseSourceColumns,
} = require(authPath);

const { ensureManualBlacklistTable } = require(blacklistPath);
const { ensureAuditLogTable } = require(errorLoggerPath);
const { ensureRateLimitsTable } = require(rateLimitPath);

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

// --- Counting Mock D1 ---
class CountingMockD1 {
  constructor(options = {}) {
    this.prepareCount = 0;
    this.batchCount = 0;
    this.queries = [];
    this.failMode = options.failMode || null; // 'network' | 'duplicate_column' | 'already_exists'
    this.failMatch = options.failMatch || null; // RegExp or string
  }

  prepare(sql) {
    this.prepareCount++;
    this.queries.push({ type: 'prepare', sql });
    const self = this;
    const stmt = {
      bind: (...binds) => {
        return {
          run: async () => {
            self.queries.push({ type: 'run', sql, binds });
            self._checkFail(sql);
            return { meta: { changes: 1 } };
          },
          first: async () => null,
          all: async () => ({ results: [] }),
        };
      },
      run: async () => {
        self.queries.push({ type: 'run', sql });
        self._checkFail(sql);
        return { meta: { changes: 1 } };
      },
      first: async () => null,
      all: async () => ({ results: [] }),
    };
    return stmt;
  }

  async batch(statements) {
    this.batchCount++;
    this.queries.push({ type: 'batch', count: statements.length });
    if (this.failMode) {
      if (this.failMode === 'network') {
        throw new Error('D1_NETWORK_TIMEOUT: connection lost during batch execution');
      } else if (this.failMode === 'already_exists') {
        throw new Error('table already exists');
      }
    }
    return statements.map(() => ({ meta: { changes: 1 } }));
  }

  _checkFail(sql) {
    if (!this.failMode) return;
    if (this.failMatch && !this.failMatch.test(sql)) return;

    if (this.failMode === 'network') {
      throw new Error('D1_NETWORK_TIMEOUT: D1 service unavailable');
    } else if (this.failMode === 'duplicate_column') {
      throw new Error('duplicate column name: device_id');
    } else if (this.failMode === 'already_exists') {
      throw new Error('table or index already exists');
    }
  }
}

function makeEnv(db, overrides = {}) {
  return {
    DB: db,
    ...overrides,
  };
}

(async () => {
  console.log('============================================================');
  console.log('🚀 D1 Schema Ensure WeakSet In-Memory Caching Offline Tests');
  console.log('============================================================\n');

  // ------------------------------------------------------------
  // Test Suite 1: ensureDrmTables single vs multi instance cache
  // ------------------------------------------------------------
  console.log('=== Suite 1: ensureDrmTables Cache Hit & Multi-DB Isolation ===');
  {
    const db1 = new CountingMockD1();
    const env1 = makeEnv(db1);

    // 1st call on db1: should execute batch and prepare calls
    await ensureDrmTables(env1);
    const initialBatch1 = db1.batchCount;
    const initialPrepare1 = db1.prepareCount;
    assert(initialBatch1 > 0, `db1 1st call executed batch (${initialBatch1} batches)`);
    assert(initialPrepare1 > 0, `db1 1st call executed prepare (${initialPrepare1} prepares)`);

    // 2nd call on db1: should hit WeakSet cache with ZERO new queries
    await ensureDrmTables(env1);
    assertEqual(db1.batchCount, initialBatch1, 'db1 2nd call batchCount unchanged (cache hit)');
    assertEqual(db1.prepareCount, initialPrepare1, 'db1 2nd call prepareCount unchanged (cache hit)');

    // 3rd call on db1
    await ensureDrmTables(env1);
    assertEqual(db1.batchCount, initialBatch1, 'db1 3rd call batchCount unchanged');
    assertEqual(db1.prepareCount, initialPrepare1, 'db1 3rd call prepareCount unchanged');

    // db2: fresh instance -> must execute fresh schema ensure (DB isolation)
    const db2 = new CountingMockD1();
    const env2 = makeEnv(db2);
    await ensureDrmTables(env2);
    assert(db2.batchCount > 0, `db2 1st call executed batch (${db2.batchCount} batches) independently`);
    assert(db2.prepareCount > 0, `db2 1st call executed prepare (${db2.prepareCount} prepares) independently`);

    // db2 2nd call: cache hit
    const initialBatch2 = db2.batchCount;
    const initialPrepare2 = db2.prepareCount;
    await ensureDrmTables(env2);
    assertEqual(db2.batchCount, initialBatch2, 'db2 2nd call batchCount unchanged');
    assertEqual(db2.prepareCount, initialPrepare2, 'db2 2nd call prepareCount unchanged');

    // db1 remains untouched
    assertEqual(db1.batchCount, initialBatch1, 'db1 was not affected by db2 operations');
  }

  // ------------------------------------------------------------
  // Test Suite 2: Individual ensure helper caching
  // ------------------------------------------------------------
  console.log('\n=== Suite 2: Individual Ensure Functions WeakSet Caching ===');
  {
    // ensureDeviceIdColumn
    const dbCol = new CountingMockD1();
    await ensureDeviceIdColumn(makeEnv(dbCol));
    assertEqual(dbCol.prepareCount, 1, 'ensureDeviceIdColumn 1st call prepares 1 statement');
    await ensureDeviceIdColumn(makeEnv(dbCol));
    assertEqual(dbCol.prepareCount, 1, 'ensureDeviceIdColumn 2nd call hits cache');

    // ensureVerificationCodesCreatedAt
    const dbVc = new CountingMockD1();
    await ensureVerificationCodesCreatedAt(makeEnv(dbVc));
    assertEqual(dbVc.prepareCount, 1, 'ensureVerificationCodesCreatedAt 1st call prepares 1 statement');
    await ensureVerificationCodesCreatedAt(makeEnv(dbVc));
    assertEqual(dbVc.prepareCount, 1, 'ensureVerificationCodesCreatedAt 2nd call hits cache');

    // ensureDeviceRegistryTable
    const dbReg = new CountingMockD1();
    await ensureDeviceRegistryTable(makeEnv(dbReg));
    assertEqual(dbReg.batchCount, 1, 'ensureDeviceRegistryTable 1st call executes batch');
    await ensureDeviceRegistryTable(makeEnv(dbReg));
    assertEqual(dbReg.batchCount, 1, 'ensureDeviceRegistryTable 2nd call hits cache');

    // ensureLicenseUpgradesTable
    const dbUpg = new CountingMockD1();
    await ensureLicenseUpgradesTable(makeEnv(dbUpg));
    assertEqual(dbUpg.batchCount, 1, 'ensureLicenseUpgradesTable 1st call executes batch');
    await ensureLicenseUpgradesTable(makeEnv(dbUpg));
    assertEqual(dbUpg.batchCount, 1, 'ensureLicenseUpgradesTable 2nd call hits cache');

    // ensureManualBlacklistTable
    const dbBl = new CountingMockD1();
    await ensureManualBlacklistTable(makeEnv(dbBl));
    const blPrepares = dbBl.prepareCount;
    assert(blPrepares >= 4, `ensureManualBlacklistTable 1st call prepares table + indexes (${blPrepares})`);
    await ensureManualBlacklistTable(makeEnv(dbBl));
    assertEqual(dbBl.prepareCount, blPrepares, 'ensureManualBlacklistTable 2nd call hits cache');

    // ensureAuditLogTable
    const dbLog = new CountingMockD1();
    await ensureAuditLogTable(makeEnv(dbLog));
    assertEqual(dbLog.prepareCount, 1, 'ensureAuditLogTable 1st call prepares statement');
    await ensureAuditLogTable(makeEnv(dbLog));
    assertEqual(dbLog.prepareCount, 1, 'ensureAuditLogTable 2nd call hits cache');

    // ensureRateLimitsTable
    const dbRl = new CountingMockD1();
    await ensureRateLimitsTable(makeEnv(dbRl));
    assertEqual(dbRl.prepareCount, 1, 'ensureRateLimitsTable 1st call prepares statement');
    await ensureRateLimitsTable(makeEnv(dbRl));
    assertEqual(dbRl.prepareCount, 1, 'ensureRateLimitsTable 2nd call hits cache');
  }

  // ------------------------------------------------------------
  // Test Suite 3: Error Classification & Retry Semantics
  // ------------------------------------------------------------
  console.log('\n=== Suite 3: Error Classification & Retry Behavior ===');
  {
    // Case 3A: "duplicate column" error should be treated as already ensured -> CACHED
    const dbDupCol = new CountingMockD1({ failMode: 'duplicate_column' });
    await ensureDeviceIdColumn(makeEnv(dbDupCol));
    assertEqual(dbDupCol.prepareCount, 1, '1st call encountered duplicate column error');
    // 2nd call should hit cache and NOT query again
    await ensureDeviceIdColumn(makeEnv(dbDupCol));
    assertEqual(dbDupCol.prepareCount, 1, '2nd call after duplicate column hits cache (not retried)');

    // Case 3B: "network/fatal" error should NOT be cached -> RETRIED
    const dbFail = new CountingMockD1({ failMode: 'network' });
    await ensureDeviceIdColumn(makeEnv(dbFail));
    assertEqual(dbFail.prepareCount, 1, '1st call failed with network error');

    // 2nd call should RETRY because network error was not cached
    await ensureDeviceIdColumn(makeEnv(dbFail));
    assertEqual(dbFail.prepareCount, 2, '2nd call retried execution after previous network error');

    // If network error resolves, 3rd call succeeds and caches
    dbFail.failMode = null;
    await ensureDeviceIdColumn(makeEnv(dbFail));
    assertEqual(dbFail.prepareCount, 3, '3rd call succeeded when network recovered');

    // 4th call should now hit cache
    await ensureDeviceIdColumn(makeEnv(dbFail));
    assertEqual(dbFail.prepareCount, 3, '4th call hits cache after successful recovery');

    // Case 3C: "table already exists" error on batch should be CACHED
    const dbDupBatch = new CountingMockD1({ failMode: 'already_exists' });
    await ensureDeviceRegistryTable(makeEnv(dbDupBatch));
    assertEqual(dbDupBatch.batchCount, 1, '1st batch call encountered already_exists error');
    await ensureDeviceRegistryTable(makeEnv(dbDupBatch));
    assertEqual(dbDupBatch.batchCount, 1, '2nd batch call hits cache (not retried)');

    // Case 3D: "network error" on batch should NOT be cached -> RETRIED
    const dbFailBatch = new CountingMockD1({ failMode: 'network' });
    await ensureDeviceRegistryTable(makeEnv(dbFailBatch));
    assertEqual(dbFailBatch.batchCount, 1, '1st batch call failed with network error');
    await ensureDeviceRegistryTable(makeEnv(dbFailBatch));
    assertEqual(dbFailBatch.batchCount, 2, '2nd batch call retried after network error');
  }

  // ------------------------------------------------------------
  // Test Suite 4: Null / undefined / invalid env.DB guard
  // ------------------------------------------------------------
  console.log('\n=== Suite 4: Guard Against Missing or Invalid DB ===');
  {
    // Calling ensure with null/undefined env.DB should gracefully return without error
    let noThrow = true;
    try {
      await ensureDrmTables({});
      await ensureDeviceIdColumn({});
      await ensureManualBlacklistTable({});
      await ensureAuditLogTable({});
      await ensureRateLimitsTable({});
    } catch (err) {
      noThrow = false;
      console.error('Unexpected error on empty env:', err);
    }
    assert(noThrow, 'all ensure functions return gracefully when env.DB is missing');
  }

  console.log(`\n============================================================`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log(`============================================================`);

  if (failed > 0) {
    process.exit(1);
  }
})();
