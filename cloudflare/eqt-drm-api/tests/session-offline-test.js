const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

console.log("=== Running E2EE Session Cloudflare DRM Offline Tests ===");

// Load compiled handler
const compiledSessionPath = path.join(__dirname, 'compiled', 'session.js');
if (!fs.existsSync(compiledSessionPath)) {
  console.error("Compiled session handler not found. Building with esbuild...");
}

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

// SQLite backed D1 Adapter
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
            return { meta: { changes: res.changes } };
          } catch (e) {
            console.error("D1 Mock run error:", sql, e);
            return { meta: { changes: 0 } };
          }
        }
      }),
      run: async () => {
        try {
          rawDb.exec(sql);
          return { meta: { changes: 1 } };
        } catch (e) {
          console.error("D1 Mock direct run error:", sql, e);
          return { meta: { changes: 0 } };
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

  const env = { DB: d1 };
  const ctx = { waitUntil: (p) => Promise.resolve(p) };
  const corsHeaders = { "Access-Control-Allow-Origin": "*" };

  // 1. Health Probe
  console.log("\n1. Testing Health Probe (HEAD /health & GET /api/v1/session/health)");
  {
    const req = new Request("https://drm.eqt.im/health", { method: "HEAD" });
    const resp = await handleSessionRoutes(req, env, ctx, new URL(req.url), corsHeaders);
    assert(resp !== null, "Health HEAD response is not null");
    assertEqual(resp.status, 200, "Health HEAD status is 200");

    const req2 = new Request("https://drm.eqt.im/api/v1/session/health", { method: "GET" });
    const resp2 = await handleSessionRoutes(req2, env, ctx, new URL(req2.url), corsHeaders);
    assert(resp2 !== null, "Health GET response is not null");
    assertEqual(resp2.status, 200, "Health GET status is 200");
    const body2 = await resp2.json();
    assertEqual(body2.status, "healthy", "Health status is healthy");
  }

  // 2. Session Create
  console.log("\n2. Testing Session Create & Singleton Upsert");
  const deviceId = "test-hardware-dev-001";
  const claimToken = "0123456789abcdef0123456789abcdef";
  const claimTokenHash = crypto.createHash('sha256').update(claimToken).digest('hex');
  const masterKeyEnc = "BASE64_ENCRYPTED_MASTER_KEY_001";
  const kAuthHash = "694274bd605eb866d866f5737fb9bc7d6778a09b4a586739581bcf7a73c7a496";
  let sessionId1 = "";

  {
    const req = new Request("https://drm.eqt.im/api/v1/session/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        license_code: "EQT-PLUS-TEST-001",
        device_id: deviceId,
        claim_token_hash: claimTokenHash,
        encrypted_master_key: masterKeyEnc,
        k_auth_hash: kAuthHash
      })
    });
    const resp = await handleSessionRoutes(req, env, ctx, new URL(req.url), corsHeaders);
    assert(resp !== null, "Session create response is not null");
    assertEqual(resp.status, 200, "Session create status is 200");
    const body = await resp.json();
    assert(body.ok === true, "Session create ok is true");
    assert(typeof body.session_id === 'string' && body.session_id.length > 0, "session_id is returned");
    sessionId1 = body.session_id;
  }

  // 3. Session Claim (Success)
  console.log("\n3. Testing Session Claim (Success)");
  {
    const req = new Request(`https://drm.eqt.im/api/v1/session/claim?token=${claimToken}`, { method: "GET" });
    const resp = await handleSessionRoutes(req, env, ctx, new URL(req.url), corsHeaders);
    assert(resp !== null, "Session claim response is not null");
    assertEqual(resp.status, 200, "Session claim status is 200");
    const body = await resp.json();
    assertEqual(body.ok, true, "Claim ok is true");
    assertEqual(body.session_id, sessionId1, "Claim session_id matches created session");
    assertEqual(body.encrypted_master_key, masterKeyEnc, "Claim encrypted_master_key matches");
    assertEqual(body.k_auth_hash, kAuthHash, "Claim k_auth_hash matches");
  }

  // 4. Session Claim (Invalid Token -> 404)
  console.log("\n4. Testing Session Claim (Invalid Token -> 404)");
  {
    const req = new Request("https://drm.eqt.im/api/v1/session/claim?token=wrongtoken123", { method: "GET" });
    const resp = await handleSessionRoutes(req, env, ctx, new URL(req.url), corsHeaders);
    assertEqual(resp.status, 404, "Invalid token returns 404 Not Found");
  }

  // 5. Singleton Upsert (Second PC session replaces the first one on the same device_id)
  console.log("\n5. Testing Singleton Upsert (Same Device Replaces Old Session)");
  const claimToken2 = "fedcba9876543210fedcba9876543210";
  const claimTokenHash2 = crypto.createHash('sha256').update(claimToken2).digest('hex');
  let sessionId2 = "";

  {
    const req = new Request("https://drm.eqt.im/api/v1/session/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        license_code: "EQT-PLUS-TEST-001",
        device_id: deviceId, // SAME device_id
        claim_token_hash: claimTokenHash2,
        encrypted_master_key: "BASE64_ENCRYPTED_MASTER_KEY_002",
        k_auth_hash: kAuthHash
      })
    });
    const resp = await handleSessionRoutes(req, env, ctx, new URL(req.url), corsHeaders);
    assertEqual(resp.status, 200, "Second session create on same device is 200");
    const body = await resp.json();
    sessionId2 = body.session_id;
    assert(sessionId2 !== sessionId1, "New session_id generated");

    // Old token should now be 404
    const oldClaimReq = new Request(`https://drm.eqt.im/api/v1/session/claim?token=${claimToken}`, { method: "GET" });
    const oldClaimResp = await handleSessionRoutes(oldClaimReq, env, ctx, new URL(oldClaimReq.url), corsHeaders);
    assertEqual(oldClaimResp.status, 404, "Old token was overridden and returns 404");

    // New token works
    const newClaimReq = new Request(`https://drm.eqt.im/api/v1/session/claim?token=${claimToken2}`, { method: "GET" });
    const newClaimResp = await handleSessionRoutes(newClaimReq, env, ctx, new URL(newClaimReq.url), corsHeaders);
    assertEqual(newClaimResp.status, 200, "New token claim returns 200");
  }

  // 6. Session Close (Active deletion on PC quit)
  console.log("\n6. Testing Session Close (PC Quit)");
  {
    const req = new Request("https://drm.eqt.im/api/v1/session/close", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: sessionId2,
        k_auth_hash: kAuthHash
      })
    });
    const resp = await handleSessionRoutes(req, env, ctx, new URL(req.url), corsHeaders);
    assertEqual(resp.status, 200, "Session close status is 200");
    const body = await resp.json();
    assertEqual(body.closed, true, "Session closed flag is true");

    // Trying to claim closed session returns 404
    const claimReq = new Request(`https://drm.eqt.im/api/v1/session/claim?token=${claimToken2}`, { method: "GET" });
    const claimResp = await handleSessionRoutes(claimReq, env, ctx, new URL(claimReq.url), corsHeaders);
    assertEqual(claimResp.status, 404, "Closed session is immediately gone (404)");
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

runTests().catch(e => {
  console.error("Test execution failed:", e);
  process.exit(1);
});
