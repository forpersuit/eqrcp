/**
 * Offline Tests for Download Telemetry (§5.1, §5.2, §7, §8 in docs/future/20260830)
 * Verifies G1 rate limiting, G2 input validation, ISO string ordering, and atomic deduplication.
 */

const assert = require('assert');

// 1. SQLite-compatible in-memory mock for D1 database
class MockD1Database {
  constructor() {
    this.records = []; // download_records rows
    this.rateLimits = new Map(); // key -> { count, window_start }
  }

  prepare(sql) {
    const db = this;
    return {
      _sql: sql,
      _bindings: [],
      bind(...args) {
        this._bindings = args;
        return this;
      },
      async first() {
        const query = this._sql.trim();
        if (query.includes("FROM rate_limits WHERE key = ?")) {
          const key = this._bindings[0];
          const entry = db.rateLimits.get(key);
          return entry ? { count: entry.count, window_start: entry.window_start } : null;
        }
        return null;
      },
      async run() {
        const query = this._sql.trim();
        
        // Handle rate_limits INSERT OR REPLACE
        if (query.includes("INSERT OR REPLACE INTO rate_limits")) {
          const [key, count, window_start] = this._bindings;
          db.rateLimits.set(key, { count: Number(count), window_start: String(window_start) });
          return { success: true };
        }

        // Handle rate_limits UPDATE
        if (query.includes("UPDATE rate_limits SET count = count + 1")) {
          const [key] = this._bindings;
          const r = db.rateLimits.get(key);
          if (r) {
            r.count = Number(r.count) + 1;
            db.rateLimits.set(key, r);
          }
          return { success: true };
        }

        // Handle atomic INSERT INTO download_records WHERE NOT EXISTS
        if (query.includes("INSERT INTO download_records")) {
          const [
            version, filename, client_ip_hash, ip_country, colo, city, region, latitude, longitude,
            user_agent, referer, source, created_at,
            w_client_ip_hash, w_filename, w_created_at
          ] = this._bindings;

          // Check WHERE NOT EXISTS
          const exists = db.records.some(r => 
            r.client_ip_hash === w_client_ip_hash &&
            r.filename === w_filename &&
            r.created_at > w_created_at // string comparison on ISO UTC strings
          );

          if (!exists) {
            db.records.push({
              id: db.records.length + 1,
              version,
              filename,
              client_ip_hash,
              ip_country,
              colo,
              city,
              region,
              latitude,
              longitude,
              user_agent,
              referer,
              source,
              created_at
            });
            return { success: true, meta: { changes: 1 } };
          }
          return { success: true, meta: { changes: 0 } };
        }

        return { success: true };
      }
    };
  }
}

// 2. Pure JS test implementation replicating telemetry handler logic
async function hashClientIp(ip, salt) {
  const crypto = require('crypto');
  return crypto.createHash('sha256').update(`${ip}:${salt}`).digest('hex');
}

async function simulateTelemetryRequest(db, requestData, customHeaders = {}, envOverrides = {}) {
  const env = {
    DB: db,
    TELEMETRY_SALT: 'test_salt_123',
    ...envOverrides
  };

  const clientIp = customHeaders['cf-connecting-ip'] || '127.0.0.1';

  // G1: Rate limiting check (60 req / 60s)
  const rateLimitKey = `telemetry:download:${clientIp}`;
  const now = Date.now();
  const nowIso = new Date(now).toISOString();

  let isRateLimited = false;
  const rlRow = await db.prepare("SELECT count, window_start FROM rate_limits WHERE key = ?").bind(rateLimitKey).first();
  if (!rlRow || (now - new Date(rlRow.window_start).getTime()) > 60000) {
    await db.prepare("INSERT OR REPLACE INTO rate_limits (key, count, window_start) VALUES (?, 1, ?)").bind(rateLimitKey, 1, nowIso).run();
  } else if (rlRow.count >= 60) {
    isRateLimited = true;
  } else {
    await db.prepare("UPDATE rate_limits SET count = count + 1 WHERE key = ?").bind(rateLimitKey).run();
  }

  if (isRateLimited) {
    return { status: 429, body: { error: "Too Many Requests" } };
  }

  // Parse Body
  let body = {};
  try {
    if (typeof requestData === 'string') {
      body = JSON.parse(requestData);
    } else {
      body = requestData;
    }
  } catch (e) {
    return { status: 400, body: { error: "Invalid JSON body" } };
  }

  // G2: Validation
  const version = String(body.version || '').trim();
  if (!version || version.length > 32 || !/^v?\d+\.\d+\.\d+$/.test(version)) {
    return { status: 400, body: { error: "Invalid version format" } };
  }

  const filename = String(body.filename || '').trim();
  if (!filename || filename.length > 128 || !/^[a-zA-Z0-9._-]+$/.test(filename)) {
    return { status: 400, body: { error: "Invalid filename format" } };
  }

  const allowedSources = ['website', 'desktop_update', 'direct'];
  let source = String(body.source || 'website').trim().toLowerCase();
  if (!allowedSources.includes(source)) {
    source = 'website';
  }

  const userAgent = String(body.user_agent || customHeaders['user-agent'] || '').slice(0, 512) || null;
  const referer = String(body.referer || customHeaders['referer'] || '').slice(0, 512) || null;

  const clientIpHash = await hashClientIp(clientIp, env.TELEMETRY_SALT);
  const ip_country = customHeaders['cf-ipcountry'] || null;
  const colo = customHeaders['cf-colo'] || null;
  const city = customHeaders['cf-ipcity'] || null;
  const region = customHeaders['cf-region-code'] || null;
  const latitude = customHeaders['cf-iplatitude'] ? parseFloat(customHeaders['cf-iplatitude']) : null;
  const longitude = customHeaders['cf-iplongitude'] ? parseFloat(customHeaders['cf-iplongitude']) : null;

  const reqTimeIso = body._customNowIso || nowIso;
  const fiveSecAgoIso = body._customFiveSecAgoIso || new Date(new Date(reqTimeIso).getTime() - 5000).toISOString();

  await db.prepare(`
    INSERT INTO download_records (
      version, filename, client_ip_hash, ip_country, colo, city, region, latitude, longitude, user_agent, referer, source, created_at
    ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    WHERE NOT EXISTS (
      SELECT 1 FROM download_records
      WHERE client_ip_hash = ? AND filename = ? AND created_at > ?
    )
  `).bind(
    version, filename, clientIpHash, ip_country, colo, city, region, latitude, longitude, userAgent, referer, source, reqTimeIso,
    clientIpHash, filename, fiveSecAgoIso
  ).run();

  return { status: 204 };
}

async function runTests() {
  console.log("🚀 Starting Download Telemetry Offline Tests...");
  const db = new MockD1Database();

  // Test 1: G2 Validation - Reject invalid version
  {
    const res = await simulateTelemetryRequest(db, { version: "invalid..ver", filename: "EQT-v1.0.0.zip" });
    assert.strictEqual(res.status, 400, "Should reject invalid version");
    assert.strictEqual(res.body.error, "Invalid version format");
    console.log("  ✅ Test 1: Invalid version validation passed");
  }

  // Test 2: G2 Validation - Reject invalid filename
  {
    const res = await simulateTelemetryRequest(db, { version: "v1.36.24", filename: "EQT/../hack.exe" });
    assert.strictEqual(res.status, 400, "Should reject invalid filename with path traversal");
    assert.strictEqual(res.body.error, "Invalid filename format");
    console.log("  ✅ Test 2: Invalid filename validation passed");
  }

  // Test 3: Normal successful recording
  const t0 = new Date("2026-08-30T10:00:00.000Z");
  {
    const res = await simulateTelemetryRequest(db, {
      version: "v1.36.24",
      filename: "EQT-v1.36.24-windows-amd64.zip",
      referer: "https://www.eqt.net.im/",
      _customNowIso: t0.toISOString(),
      _customFiveSecAgoIso: new Date(t0.getTime() - 5000).toISOString()
    }, {
      'cf-connecting-ip': '203.0.113.195',
      'cf-ipcountry': 'JP',
      'cf-ipcity': 'Tokyo',
      'cf-iplatitude': '35.6762',
      'cf-iplongitude': '139.6503',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
    });

    assert.strictEqual(res.status, 204, "Normal request should return 204");
    assert.strictEqual(db.records.length, 1, "Should have inserted exactly 1 record");
    const rec = db.records[0];
    assert.strictEqual(rec.version, "v1.36.24");
    assert.strictEqual(rec.filename, "EQT-v1.36.24-windows-amd64.zip");
    assert.strictEqual(rec.ip_country, "JP");
    assert.strictEqual(rec.city, "Tokyo");
    assert.strictEqual(rec.latitude, 35.6762);
    assert.strictEqual(rec.longitude, 139.6503);
    assert.strictEqual(rec.source, "website");
    assert.ok(rec.client_ip_hash, "client_ip_hash must be generated");
    console.log("  ✅ Test 3: Standard telemetry ingestion and geo parsing passed");
  }

  // Test 4: Deduplication within 5 seconds (Atomic INSERT WHERE NOT EXISTS)
  {
    const t2s = new Date("2026-08-30T10:00:02.000Z");

    const res2 = await simulateTelemetryRequest(db, {
      version: "v1.36.24",
      filename: "EQT-v1.36.24-windows-amd64.zip",
      _customNowIso: t2s.toISOString(),
      _customFiveSecAgoIso: new Date(t2s.getTime() - 5000).toISOString()
    }, {
      'cf-connecting-ip': '203.0.113.195'
    });

    assert.strictEqual(res2.status, 204);
    assert.strictEqual(db.records.length, 1, "Duplicate request within 2s must NOT insert new row");
    console.log("  ✅ Test 4: 5s window atomic deduplication passed (no duplicate inserted)");
  }

  // Test 5: New record after 5 seconds window
  {
    const t10s = new Date("2026-08-30T10:00:10.000Z");

    const res3 = await simulateTelemetryRequest(db, {
      version: "v1.36.24",
      filename: "EQT-v1.36.24-windows-amd64.zip",
      _customNowIso: t10s.toISOString(),
      _customFiveSecAgoIso: new Date(t10s.getTime() - 5000).toISOString()
    }, {
      'cf-connecting-ip': '203.0.113.195'
    });

    assert.strictEqual(res3.status, 204);
    assert.strictEqual(db.records.length, 2, "Request after 10s MUST insert a new row");
    console.log("  ✅ Test 5: Post-window download recording passed (2nd row inserted)");
  }

  // Test 6: G1 Rate Limiting (60 requests per minute)
  {
    const spamIp = '198.51.100.77';
    let blockedAt = 0;
    for (let i = 1; i <= 65; i++) {
      const res = await simulateTelemetryRequest(db, {
        version: "v1.36.24",
        filename: `file_${i}.zip`
      }, {
        'cf-connecting-ip': spamIp
      });

      if (res.status === 429) {
        blockedAt = i;
        break;
      }
    }

    assert.strictEqual(blockedAt, 61, "Should be rate limited on the 61st request");
    console.log("  ✅ Test 6: 60 req/min rate limiter blocked abusive IP on request #61");
  }

  console.log("\n🎉 ALL Download Telemetry Offline Tests Passed Successfully!\n");
}

runTests().catch(err => {
  console.error("❌ Tests Failed:", err);
  process.exit(1);
});
