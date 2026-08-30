/**
 * Offline Tests for Download Telemetry (§5.1, §5.2, §7, §8 in docs/future/20260830)
 * 
 * Runs real bundled route handlers (handleTelemetryRoutes, handleAdminRoutes, and worker.scheduled)
 * against an in-memory SQLite (node:sqlite) instance using the real schema.sql.
 * 
 * Verifies:
 * 1. Exact placeholder binding order and column value placement in download_records (preventing off-by-one errors)
 * 2. Fail-loud behavior when TELEMETRY_SALT is missing (P1: returns 500, no write)
 * 3. 5-second atomic deduplication via INSERT ... WHERE NOT EXISTS
 * 4. G1 Rate limiting (60 requests per minute per IP)
 * 5. G2 Input validation (version format, filename format, JSON body)
 * 6. Admin Globe latest_version query semantic ordering (P2: uses MAX(created_at) row version instead of lexical MAX(version))
 * 7. Phase 4 daily aggregation scheduled cron atomic batch transaction (P2: INSERT ON CONFLICT + DELETE)
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

// Load compiled modules
const compiledTelemetryPath = fs.existsSync(path.join(__dirname, 'compiled', 'routes', 'telemetry.js'))
  ? path.join(__dirname, 'compiled', 'routes', 'telemetry.js')
  : path.join(__dirname, 'compiled', 'telemetry.js');

const compiledAdminPath = fs.existsSync(path.join(__dirname, 'compiled', 'routes', 'admin.js'))
  ? path.join(__dirname, 'compiled', 'routes', 'admin.js')
  : path.join(__dirname, 'compiled', 'admin.js');

const compiledIndexPath = path.join(__dirname, 'compiled', 'index.js');

if (!fs.existsSync(compiledTelemetryPath) || !fs.existsSync(compiledAdminPath) || !fs.existsSync(compiledIndexPath)) {
  console.error("Compiled modules not found. Run esbuild compilation first.");
  process.exit(1);
}

const { handleTelemetryRoutes } = require(compiledTelemetryPath);
const { handleAdminRoutes } = require(compiledAdminPath);
const worker = require(compiledIndexPath).default;

console.log('=== REAL SQLITE TELEMETRY & GLOBE & ARCHIVE OFFLINE TEST ===\n');

class SqliteD1Mock {
  constructor() {
    this.rawDb = new DatabaseSync(':memory:');
    const schema = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf-8');
    this.rawDb.exec(schema);
  }

  prepare(sql) {
    const rawDb = this.rawDb;
    const makeStmt = (binds = []) => ({
      _sql: sql,
      _binds: binds,
      bind(...newBinds) {
        return makeStmt(newBinds);
      },
      first: async () => {
        const stmt = rawDb.prepare(sql);
        const rows = stmt.all(...binds);
        return rows.length > 0 ? rows[0] : null;
      },
      all: async () => {
        const stmt = rawDb.prepare(sql);
        const rows = stmt.all(...binds);
        return { results: rows };
      },
      run: async () => {
        const stmt = rawDb.prepare(sql);
        const info = stmt.run(...binds);
        return { success: true, meta: { changes: Number(info.changes) } };
      },
      raw: async () => {
        const stmt = rawDb.prepare(sql);
        return stmt.all(...binds);
      }
    });
    return makeStmt([]);
  }

  async batch(stmts) {
    this.rawDb.exec('BEGIN IMMEDIATE');
    try {
      const results = [];
      for (const s of stmts) {
        const stmt = this.rawDb.prepare(s._sql);
        const info = stmt.run(...(s._binds || []));
        results.push({ success: true, meta: { changes: Number(info.changes) } });
      }
      this.rawDb.exec('COMMIT');
      return results;
    } catch (e) {
      this.rawDb.exec('ROLLBACK');
      throw e;
    }
  }

  async exec(sql) {
    return this.rawDb.exec(sql);
  }
}

function createMockCtx() {
  const promises = [];
  return {
    waitUntil(promise) {
      promises.push(promise);
    },
    async drain() {
      await Promise.all(promises);
    }
  };
}

let passed = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(err);
    process.exit(1);
  }
}

async function sha256Hex(str) {
  return crypto.createHash('sha256').update(str).digest('hex');
}

(async function runAllTests() {
  const TEST_SALT = 'telemetry_secret_salt_2026_xyz';
  const corsHeaders = { 'Access-Control-Allow-Origin': '*' };

  // =========================================================================
  // Test Group 1: Exact Placeholder Binding Order & Column Alignment (Real SQLite)
  // =========================================================================
  await test('Exact placeholder binding order & column values match SQLite schema', async () => {
    const db = new SqliteD1Mock();
    const env = { DB: db, TELEMETRY_SALT: TEST_SALT };
    const ctx = createMockCtx();

    const clientIp = '198.51.100.42';
    const payload = {
      version: 'v1.36.25',
      filename: 'EQT-v1.36.25-windows-amd64.zip',
      source: 'website',
      user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) EQTClient/1.0',
      referer: 'https://eqt.net.im/download'
    };

    const headers = new Headers({
      'Content-Type': 'application/json',
      'cf-connecting-ip': clientIp,
      'cf-ipcountry': 'US',
      'cf-ipcity': 'San Jose',
      'cf-region-code': 'CA',
      'cf-iplatitude': '37.3382',
      'cf-iplongitude': '-121.8863'
    });

    const request = new Request('https://lic.eqt.net.im/api/v1/telemetry/download', {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });
    // Double channel geo test: request.cf.colo
    (request).cf = { colo: 'SJC' };

    const url = new URL(request.url);
    const res = await handleTelemetryRoutes(request, env, ctx, url, corsHeaders);

    assert.strictEqual(res.status, 204, 'Telemetry should return 204 No Content');
    await ctx.drain(); // Wait for asynchronous DB insert

    // Query real SQLite table
    const rows = db.rawDb.prepare('SELECT * FROM download_records').all();
    assert.strictEqual(rows.length, 1, 'Exactly one row should be inserted');
    const row = rows[0];

    const expectedHash = await sha256Hex(`${clientIp}:${TEST_SALT}`);

    // Verify EVERY single column to guarantee NO off-by-one placeholder shifting!
    assert.strictEqual(row.version, 'v1.36.25', 'version must match');
    assert.strictEqual(row.filename, 'EQT-v1.36.25-windows-amd64.zip', 'filename must match');
    assert.strictEqual(row.client_ip_hash, expectedHash, 'client_ip_hash must be SHA256(ip:salt)');
    assert.strictEqual(row.ip_country, 'US', 'ip_country must match');
    assert.strictEqual(row.colo, 'SJC', 'colo must match');
    assert.strictEqual(row.city, 'San Jose', 'city must match');
    assert.strictEqual(row.region, 'CA', 'region must match');
    assert.strictEqual(row.latitude, 37.3382, 'latitude must match');
    assert.strictEqual(row.longitude, -121.8863, 'longitude must match');
    assert.strictEqual(row.user_agent, payload.user_agent, 'user_agent must match');
    assert.strictEqual(row.referer, payload.referer, 'referer must match');
    assert.strictEqual(row.source, 'website', 'source must match');
    assert.ok(row.created_at && !isNaN(new Date(row.created_at).getTime()), 'created_at must be valid ISO date string');
  });

  // =========================================================================
  // Test Group 2: P1 Fail-Loud on Missing TELEMETRY_SALT
  // =========================================================================
  await test('P1: Reject write and return 500 fail-loud if TELEMETRY_SALT is missing or empty', async () => {
    const db = new SqliteD1Mock();
    // TELEMETRY_SALT omitted
    const env = { DB: db };
    const ctx = createMockCtx();

    const request = new Request('https://lic.eqt.net.im/api/v1/telemetry/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': '1.2.3.4' },
      body: JSON.stringify({ version: 'v1.36.25', filename: 'EQT-v1.36.25-windows-amd64.zip' })
    });

    const url = new URL(request.url);
    const res = await handleTelemetryRoutes(request, env, ctx, url, corsHeaders);

    assert.strictEqual(res.status, 500, 'Must return 500 when TELEMETRY_SALT is not configured');
    const data = await res.json();
    assert.strictEqual(data.error, 'Telemetry service misconfigured');
    await ctx.drain();

    const rows = db.rawDb.prepare('SELECT * FROM download_records').all();
    assert.strictEqual(rows.length, 0, 'No record must be written when salt is missing');
  });

  // =========================================================================
  // Test Group 3: 5-Second Atomic Deduplication
  // =========================================================================
  await test('5-second atomic deduplication prevents rapid duplicate inserts', async () => {
    const db = new SqliteD1Mock();
    const env = { DB: db, TELEMETRY_SALT: TEST_SALT };

    const sendReq = async () => {
      const ctx = createMockCtx();
      const req = new Request('https://lic.eqt.net.im/api/v1/telemetry/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': '10.0.0.1' },
        body: JSON.stringify({ version: 'v1.36.25', filename: 'EQT-v1.36.25-windows-amd64.zip' })
      });
      const res = await handleTelemetryRoutes(req, env, ctx, new URL(req.url), corsHeaders);
      assert.strictEqual(res.status, 204);
      await ctx.drain();
    };

    // Send first request
    await sendReq();
    // Send second identical request immediately
    await sendReq();

    const rows = db.rawDb.prepare('SELECT * FROM download_records').all();
    assert.strictEqual(rows.length, 1, 'Only 1 record should exist due to 5s deduplication');
  });

  // =========================================================================
  // Test Group 4: G1 Rate Limiting (60 req/min)
  // =========================================================================
  await test('G1: Rate limiting triggers 429 on >60 requests per minute per IP', async () => {
    const db = new SqliteD1Mock();
    const env = { DB: db, TELEMETRY_SALT: TEST_SALT };

    const ip = '172.16.0.99';
    for (let i = 0; i < 60; i++) {
      const ctx = createMockCtx();
      const req = new Request('https://lic.eqt.net.im/api/v1/telemetry/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': ip },
        body: JSON.stringify({ version: 'v1.36.25', filename: `file_${i}.zip` })
      });
      const res = await handleTelemetryRoutes(req, env, ctx, new URL(req.url), corsHeaders);
      assert.strictEqual(res.status, 204);
    }

    // 61st request from same IP -> 429
    const ctx = createMockCtx();
    const req61 = new Request('https://lic.eqt.net.im/api/v1/telemetry/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': ip },
      body: JSON.stringify({ version: 'v1.36.25', filename: 'file_61.zip' })
    });
    const res61 = await handleTelemetryRoutes(req61, env, ctx, new URL(req61.url), corsHeaders);
    assert.strictEqual(res61.status, 429, '61st request within 1 min must be 429 Too Many Requests');
  });

  // =========================================================================
  // Test Group 5: G2 Strict Input Validation
  // =========================================================================
  await test('G2: Strict input validation rejects malformed version or filename', async () => {
    const db = new SqliteD1Mock();
    const env = { DB: db, TELEMETRY_SALT: TEST_SALT };

    const invalidCases = [
      { body: { version: 'invalid-ver', filename: 'valid.zip' }, desc: 'invalid version' },
      { body: { version: 'v1.0.0', filename: '../traversal.exe' }, desc: 'path traversal filename' },
      { body: { version: 'v1.0.0', filename: 'file with spaces.zip' }, desc: 'filename with spaces' },
      { body: 'broken json{', isRaw: true, desc: 'malformed JSON' }
    ];

    for (const c of invalidCases) {
      const ctx = createMockCtx();
      const req = new Request('https://lic.eqt.net.im/api/v1/telemetry/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': '1.1.1.1' },
        body: c.isRaw ? c.body : JSON.stringify(c.body)
      });
      const res = await handleTelemetryRoutes(req, env, ctx, new URL(req.url), corsHeaders);
      assert.strictEqual(res.status, 400, `Expected 400 for ${c.desc}`);
    }
  });

  // =========================================================================
  // Test Group 6: P2 Admin Globe Query Semantic Ordering (latest_version)
  // =========================================================================
  await test('P2: Globe latest_version reflects MAX(created_at) row instead of lexical MAX(version)', async () => {
    const db = new SqliteD1Mock();
    const env = {
      DB: db,
      CF_ACCESS_TEAM_DOMAIN: 'local.dev',
      CF_ACCESS_AUD: 'local-dev',
      CF_ACCESS_ALLOWED_EMAILS: 'admin@eqt.net.im'
    };
    const ctx = createMockCtx();

    const now = Date.now();
    const olderTime = new Date(now - 100000).toISOString();
    const newerTime = new Date(now - 10000).toISOString();

    // Insert older download with v1.36.9 (lexically > v1.36.25, but chronologically older)
    db.rawDb.prepare(`
      INSERT INTO download_records (version, filename, ip_country, region, city, latitude, longitude, source, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('v1.36.9', 'EQT-v1.36.9-windows-amd64.zip', 'US', 'CA', 'San Jose', 37.3382, -121.8863, 'website', olderTime);

    // Insert newer download with v1.36.25 (chronologically newer)
    db.rawDb.prepare(`
      INSERT INTO download_records (version, filename, ip_country, region, city, latitude, longitude, source, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('v1.36.25', 'EQT-v1.36.25-windows-amd64.zip', 'US', 'CA', 'San Jose', 37.3382, -121.8863, 'website', newerTime);

    // Request admin globe endpoint
    const req = new Request('https://lic.eqt.net.im/api/v1/admin/downloads/globe?window=24h', {
      method: 'GET',
      headers: {
        'Cf-Access-Jwt-Assertion': 'local.admin@eqt.net.im',
        'cf-access-authenticated-user-email': 'admin@eqt.net.im'
      }
    });

    const res = await handleAdminRoutes(req, env, ctx, new URL(req.url), corsHeaders);
    assert.strictEqual(res.status, 200, 'Admin globe query should return 200');
    const data = await res.json();

    assert.strictEqual(data.success, true);
    assert.strictEqual(data.locations.length, 1);
    const loc = data.locations[0];

    assert.strictEqual(loc.country, 'US');
    assert.strictEqual(loc.download_count, 2);
    assert.strictEqual(loc.latest_download_at, newerTime);
    // Correct semantic version from MAX(created_at) row
    assert.strictEqual(loc.latest_version, 'v1.36.25', 'latest_version must be v1.36.25 (latest downloaded) and NOT v1.36.9 (lexical max)');
  });

  // =========================================================================
  // Test Group 7: P2 Scheduled 90-day Archiving Atomic Batch Transaction
  // =========================================================================
  await test('P2: Scheduled daily archiving uses atomic D1 batch transaction without duplicate accumulation', async () => {
    const db = new SqliteD1Mock();
    const env = { DB: db };
    const ctx = createMockCtx();

    const ninetyFiveDaysAgo = new Date(Date.now() - 95 * 24 * 60 * 60 * 1000).toISOString();
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();

    // Insert 3 records older than 90 days
    db.rawDb.prepare(`
      INSERT INTO download_records (version, filename, ip_country, source, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run('v1.35.0', 'file1.zip', 'DE', 'website', ninetyFiveDaysAgo);

    db.rawDb.prepare(`
      INSERT INTO download_records (version, filename, ip_country, source, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run('v1.35.0', 'file2.zip', 'DE', 'website', ninetyFiveDaysAgo);

    db.rawDb.prepare(`
      INSERT INTO download_records (version, filename, ip_country, source, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run('v1.36.0', 'file3.zip', 'JP', 'website', ninetyFiveDaysAgo);

    // Insert 1 recent record (10 days ago, should NOT be archived or deleted)
    db.rawDb.prepare(`
      INSERT INTO download_records (version, filename, ip_country, source, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run('v1.36.25', 'file4.zip', 'US', 'website', tenDaysAgo);

    // Trigger scheduled cron
    await worker.scheduled({ cron: '5 3 * * *' }, env, ctx);

    // Verify daily_download_stats
    const stats = db.rawDb.prepare('SELECT * FROM daily_download_stats ORDER BY version, ip_country').all();
    assert.strictEqual(stats.length, 2, 'Two aggregated stat rows should be created');
    assert.strictEqual(stats[0].version, 'v1.35.0');
    assert.strictEqual(stats[0].ip_country, 'DE');
    assert.strictEqual(stats[0].download_cnt, 2);

    assert.strictEqual(stats[1].version, 'v1.36.0');
    assert.strictEqual(stats[1].ip_country, 'JP');
    assert.strictEqual(stats[1].download_cnt, 1);

    // Verify detailed download_records: 3 old deleted, 1 recent retained
    const remaining = db.rawDb.prepare('SELECT * FROM download_records').all();
    assert.strictEqual(remaining.length, 1, 'Only the recent record should remain');
    assert.strictEqual(remaining[0].version, 'v1.36.25');

    // Run scheduled cron again to verify idempotency (no duplicate counting on empty / next run)
    await worker.scheduled({ cron: '5 3 * * *' }, env, ctx);

    const statsAfter = db.rawDb.prepare('SELECT * FROM daily_download_stats ORDER BY version, ip_country').all();
    assert.strictEqual(statsAfter[0].download_cnt, 2, 'Download count must not duplicate on subsequent cron execution');
  });

  console.log(`\n🎉 All ${passed} SQLite telemetry & globe & archive tests passed cleanly!`);
})();
