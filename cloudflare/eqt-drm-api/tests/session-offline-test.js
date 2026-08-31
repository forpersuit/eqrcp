const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const esbuild = require('esbuild');

console.log("=== Running E2EE Session Cloudflare DRM Offline Tests ===");

// 1. Build TypeScript routes using esbuild
const tsSrcPath = path.join(__dirname, '..', 'src', 'routes', 'session.ts');
const compiledSessionPath = path.join(__dirname, 'compiled', 'session.js');
fs.mkdirSync(path.dirname(compiledSessionPath), { recursive: true });

esbuild.buildSync({
  entryPoints: [tsSrcPath],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: compiledSessionPath,
  external: ['node:sqlite']
});

const { handleSessionRoutes } = require(compiledSessionPath);

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

// SQLite backed D1 Mock Adapter
class SqliteD1Mock {
  constructor(db) {
    this.db = db;
  }
  prepare(sql) {
    const rawDb = this.db;
    return {
      bind: (...args) => ({
        first: async () => {
          try {
            const stmt = rawDb.prepare(sql);
            const row = stmt.get(...args);
            return row || null;
          } catch (e) {
            console.error("D1 Mock first error:", sql, e);
            return null;
          }
        },
        all: async () => {
          try {
            const stmt = rawDb.prepare(sql);
            const rows = stmt.all(...args);
            return { results: rows || [] };
          } catch (e) {
            console.error("D1 Mock all error:", sql, e);
            return { results: [] };
          }
        },
        run: async () => {
          try {
            const stmt = rawDb.prepare(sql);
            const res = stmt.run(...args);
            return { success: true, meta: { changes: res.changes } };
          } catch (e) {
            console.error("D1 Mock run error:", sql, e);
            return { success: false, meta: { changes: 0 } };
          }
        }
      }),
      run: async () => {
        try {
          rawDb.exec(sql);
          return { success: true, meta: { changes: 1 } };
        } catch (e) {
          console.error("D1 Mock direct run error:", sql, e);
          return { success: false, meta: { changes: 0 } };
        }
      }
    };
  }
}

async function runTests() {
  const sqlite = new DatabaseSync(':memory:');
  const d1 = new SqliteD1Mock(sqlite);

  // Initialize schema
  const schemaSql = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
  sqlite.exec(schemaSql);

  // Seed sample licenses
  sqlite.exec(`
    INSERT INTO licenses (license_code, tier, status, max_devices, expires_at, created_at)
    VALUES
      ('LIC-ACTIVE-PRO', 'PRO', 'active', 5, 'LIFETIME', '2026-01-01T00:00:00Z'),
      ('LIC-SUSPENDED', 'PLUS', 'suspended', 2, 'LIFETIME', '2026-01-01T00:00:00Z'),
      ('LIC-REVOKED', 'PRO', 'revoked', 5, 'LIFETIME', '2026-01-01T00:00:00Z'),
      ('LIC-EXPIRED', 'PRO', 'active', 5, '2020-01-01T00:00:00Z', '2019-01-01T00:00:00Z');
  `);

  const env = { DB: d1 };
  const ctx = { waitUntil: (p) => Promise.resolve(p) };
  const corsHeaders = { "Access-Control-Allow-Origin": "*" };

  // 1. Health Probe
  console.log("\n1. Testing Health Probe (HEAD /health & GET /api/v1/e2ee/session/health)");
  {
    const req = new Request("https://drm.eqt.im/health", { method: "HEAD" });
    const resp = await handleSessionRoutes(req, env, ctx, new URL(req.url), corsHeaders);
    assert(resp !== null, "Health HEAD response is not null");
    assertEqual(resp.status, 200, "Health HEAD status is 200");

    const req2 = new Request("https://drm.eqt.im/api/v1/e2ee/session/health", { method: "GET" });
    const resp2 = await handleSessionRoutes(req2, env, ctx, new URL(req2.url), corsHeaders);
    assert(resp2 !== null, "Health GET response is not null");
    assertEqual(resp2.status, 200, "Health GET status is 200");
    const body2 = await resp2.json();
    assertEqual(body2.status, "healthy", "Health status is healthy");
  }

  // 2. License Fail-Closed Validation
  console.log("\n2. Testing License Fail-Closed Gate (Rejects non-active / non-existent / expired)");
  const deviceId = "test-pc-hardware-001";
  const masterKeyB64 = "AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA=";
  const kAuthHash = "694274bd605eb866d866f5737fb9bc7d6778a09b4a586739581bcf7a73c7a496";
  const closeToken = "my-secret-close-token-123";

  // 2.1 Non-existent license
  {
    const req = new Request("https://drm.eqt.im/api/v1/e2ee/session/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        license_code: "NON-EXISTENT-LIC",
        device_id: deviceId,
        master_key_b64: masterKeyB64,
        close_token: closeToken,
        k_auth_hash: kAuthHash
      })
    });
    const resp = await handleSessionRoutes(req, env, ctx, new URL(req.url), corsHeaders);
    assertEqual(resp.status, 403, "Non-existent license rejected with 403");
    const b = await resp.json();
    assertEqual(b.error_code, "LICENSE_INACTIVE", "Non-existent license has error_code LICENSE_INACTIVE");
  }

  // 2.2 Suspended license
  {
    const req = new Request("https://drm.eqt.im/api/v1/e2ee/session/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        license_code: "LIC-SUSPENDED",
        device_id: deviceId,
        master_key_b64: masterKeyB64,
        close_token: closeToken,
        k_auth_hash: kAuthHash
      })
    });
    const resp = await handleSessionRoutes(req, env, ctx, new URL(req.url), corsHeaders);
    assertEqual(resp.status, 403, "Suspended license rejected with 403");
    const b = await resp.json();
    assertEqual(b.error_code, "LICENSE_INACTIVE", "Suspended license has error_code LICENSE_INACTIVE");
  }

  // 2.3 Revoked license
  {
    const req = new Request("https://drm.eqt.im/api/v1/e2ee/session/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        license_code: "LIC-REVOKED",
        device_id: deviceId,
        master_key_b64: masterKeyB64,
        close_token: closeToken,
        k_auth_hash: kAuthHash
      })
    });
    const resp = await handleSessionRoutes(req, env, ctx, new URL(req.url), corsHeaders);
    assertEqual(resp.status, 403, "Revoked license rejected with 403");
    const b = await resp.json();
    assertEqual(b.error_code, "LICENSE_INACTIVE", "Revoked license has error_code LICENSE_INACTIVE");
  }

  // 2.4 Expired license
  {
    const req = new Request("https://drm.eqt.im/api/v1/e2ee/session/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        license_code: "LIC-EXPIRED",
        device_id: deviceId,
        master_key_b64: masterKeyB64,
        close_token: closeToken,
        k_auth_hash: kAuthHash
      })
    });
    const resp = await handleSessionRoutes(req, env, ctx, new URL(req.url), corsHeaders);
    assertEqual(resp.status, 403, "Expired license rejected with 403");
    const b = await resp.json();
    assertEqual(b.error_code, "LICENSE_EXPIRED", "Expired license has error_code LICENSE_EXPIRED");
  }

  // 3. Valid Session Create & Claim (MasterKey Blind Relay & CAS Quota)
  console.log("\n3. Testing Valid Session Creation, TLS 1.3 Blind Relay & CAS Quota");
  let sendSessionId = "";
  {
    const req = new Request("https://drm.eqt.im/api/v1/e2ee/session/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        license_code: "LIC-ACTIVE-PRO",
        device_id: deviceId,
        mode: "send",
        master_key_b64: masterKeyB64,
        close_token: closeToken,
        k_auth_hash: kAuthHash,
        max_claims: 2 // Max 2 claims for testing
      })
    });
    const resp = await handleSessionRoutes(req, env, ctx, new URL(req.url), corsHeaders);
    assertEqual(resp.status, 200, "Active license session create returns 200");
    const body = await resp.json();
    assert(body.ok === true, "body.ok is true");
    assert(typeof body.session_id === 'string' && body.session_id.length > 0, "session_id is generated");
    sendSessionId = body.session_id;

    // Claim 1: Success
    const claim1Req = new Request(`https://drm.eqt.im/api/v1/e2ee/session/${sendSessionId}/claim`, { method: "POST" });
    const claim1Resp = await handleSessionRoutes(claim1Req, env, ctx, new URL(claim1Req.url), corsHeaders);
    assertEqual(claim1Resp.status, 200, "First claim returns 200");
    const claim1Body = await claim1Resp.json();
    assertEqual(claim1Body.master_key_b64, masterKeyB64, "Claim 1 returns exact master_key_b64");
    assertEqual(claim1Body.k_auth_hash, kAuthHash, "Claim 1 returns exact k_auth_hash");

    // Claim 2: Success
    const claim2Req = new Request(`https://drm.eqt.im/api/v1/e2ee/session/${sendSessionId}/claim`, { method: "POST" });
    const claim2Resp = await handleSessionRoutes(claim2Req, env, ctx, new URL(claim2Req.url), corsHeaders);
    assertEqual(claim2Resp.status, 200, "Second claim returns 200 (within max_claims=2)");

    // Claim 3: Quota Exceeded (403 limit_exceeded)
    const claim3Req = new Request(`https://drm.eqt.im/api/v1/e2ee/session/${sendSessionId}/claim`, { method: "POST" });
    const claim3Resp = await handleSessionRoutes(claim3Req, env, ctx, new URL(claim3Req.url), corsHeaders);
    assertEqual(claim3Resp.status, 403, "Third claim returns 403 Forbidden");
    const claim3Body = await claim3Resp.json();
    assertEqual(claim3Body.limit_exceeded, true, "Returns limit_exceeded: true");
    assertEqual(claim3Body.error_code, "CLAIM_LIMIT_EXCEEDED", "Quota exceeded returns error_code CLAIM_LIMIT_EXCEEDED");
  }

  // 4. Multi-mode concurrency on the same PC (D4: send and receive do not override each other)
  console.log("\n4. Testing Multi-Mode Concurrency (UNIQUE(device_id, mode))");
  let recvSessionId = "";
  {
    // Create a receive session on the same deviceId
    const req = new Request("https://drm.eqt.im/api/v1/e2ee/session/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        license_code: "LIC-ACTIVE-PRO",
        device_id: deviceId, // SAME deviceId
        mode: "receive",     // DIFFERENT mode
        master_key_b64: masterKeyB64,
        close_token: closeToken,
        k_auth_hash: kAuthHash,
        max_claims: 5
      })
    });
    const resp = await handleSessionRoutes(req, env, ctx, new URL(req.url), corsHeaders);
    assertEqual(resp.status, 200, "Receive session create on same device is 200");
    const body = await resp.json();
    recvSessionId = body.session_id;
    assert(recvSessionId !== sendSessionId, "Receive session has distinct session_id");

    // Verify both exist in DB
    const sendRow = sqlite.prepare("SELECT * FROM e2ee_sessions WHERE session_id = ?").get(sendSessionId);
    const recvRow = sqlite.prepare("SELECT * FROM e2ee_sessions WHERE session_id = ?").get(recvSessionId);
    assert(sendRow !== null && sendRow !== undefined, "Send session still exists in DB");
    assert(recvRow !== null && recvRow !== undefined, "Receive session exists concurrently in DB");
  }

  // 5. Deterministic Session Close & False Success Protection
  console.log("\n5. Testing Deterministic Session Close & False Success Rejection");
  {
    // 5.1 Close with invalid close token -> 404
    const wrongCloseReq = new Request("https://drm.eqt.im/api/v1/e2ee/session/close", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: recvSessionId,
        close_token: "wrong-close-token"
      })
    });
    const wrongCloseResp = await handleSessionRoutes(wrongCloseReq, env, ctx, new URL(wrongCloseReq.url), corsHeaders);
    assertEqual(wrongCloseResp.status, 404, "Wrong close token returns 404 (no false success)");

    // 5.2 Close non-existent session -> 404
    const nonExistCloseReq = new Request("https://drm.eqt.im/api/v1/e2ee/session/close", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: "non-existent-session-id",
        close_token: closeToken
      })
    });
    const nonExistCloseResp = await handleSessionRoutes(nonExistCloseReq, env, ctx, new URL(nonExistCloseReq.url), corsHeaders);
    assertEqual(nonExistCloseResp.status, 404, "Non-existent session returns 404");

    // 5.3 Valid close -> 200 OK
    const validCloseReq = new Request("https://drm.eqt.im/api/v1/e2ee/session/close", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: recvSessionId,
        close_token: closeToken
      })
    });
    const validCloseResp = await handleSessionRoutes(validCloseReq, env, ctx, new URL(validCloseReq.url), corsHeaders);
    assertEqual(validCloseResp.status, 200, "Valid close returns 200");
    const closeBody = await validCloseResp.json();
    assertEqual(closeBody.closed, true, "closed: true returned");

    // Verify row deleted from DB
    const checkRow = sqlite.prepare("SELECT * FROM e2ee_sessions WHERE session_id = ?").get(recvSessionId);
    assertEqual(checkRow, undefined, "Session row immediately deleted from DB");
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

runTests().catch(e => {
  console.error("Test execution failed:", e);
  process.exit(1);
});
