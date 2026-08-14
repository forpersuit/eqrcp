/**
 * Offline test for GET /api/v1/user/licenses pagination.
 *
 * Runs the REAL bundled handlePortalRoutes against an in-memory SQLite (node:sqlite)
 * backed D1 mock to ensure SQL COUNT and LIMIT/OFFSET behaves accurately.
 */
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const compiledPortalPath = path.join(__dirname, 'compiled', 'portal.js');
if (!fs.existsSync(compiledPortalPath)) {
  console.error("Compiled portal handler not found. Build with esbuild first.");
  process.exit(1);
}
const { handlePortalRoutes } = require(compiledPortalPath);

function assert(cond, msg) {
  if (!cond) throw new Error('ASSERT FAIL: ' + msg);
  console.log('  ✓ OK:', msg);
}

class SqliteD1Mock {
  constructor() {
    this.db = new DatabaseSync(':memory:');
    this.db.exec('PRAGMA foreign_keys = OFF');
  }
  _mk(sql, binds) {
    return {
      all: async () => {
        const rows = this.db.prepare(sql).all(...binds);
        return { results: rows };
      },
      first: async () => {
        const rows = this.db.prepare(sql).all(...binds);
        return rows.length ? rows[0] : null;
      },
      run: async () => {
        const info = this.db.prepare(sql).run(...binds);
        return { meta: { changes: Number(info.changes) } };
      },
      __sql: sql,
      __binds: binds
    };
  }
  prepare(sql) {
    const base = this._mk(sql, []);
    base.bind = (...binds) => this._mk(sql, binds);
    return base;
  }
  async batch(stmts) {
    let changes = 0;
    for (const s of stmts) {
      const info = this.db.prepare(s.__sql).run(...(s.__binds || []));
      changes += Number(info.changes);
    }
    return [{ meta: { changes } }];
  }
}

async function run() {
  console.log('=== Running Portal Licenses Pagination Offline Tests ===\n');

  const d1 = new SqliteD1Mock();
  const schemaSql = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
  d1.db.exec(schemaSql);

  const testEmail = 'alice@example.com';
  const testToken = 'valid-user-session-token-12345';
  const expiresAt = new Date(Date.now() + 86400 * 1000).toISOString();

  // 1. Insert user session
  d1.db.prepare(`
    INSERT INTO user_sessions (session_token, email, expires_at)
    VALUES (?, ?, ?)
  `).run(testToken, testEmail, expiresAt);

  // 2. Insert 12 licenses for test user (with descending timestamps)
  const nowMs = Date.now();
  for (let i = 1; i <= 12; i++) {
    const code = `EQT-PLUS-20260815-ALICE${String(i).padStart(2, '0')}`;
    const createdAt = new Date(nowMs - (100 - i) * 60000).toISOString(); // i=12 is newest
    d1.db.prepare(`
      INSERT INTO licenses (license_code, tier, max_devices, buyer_email, created_at, status, source)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(code, 'PLUS', 3, testEmail, createdAt, 'active', 'purchase');
  }

  // 3. Insert 3 licenses for another user (bob)
  for (let i = 1; i <= 3; i++) {
    const code = `EQT-PRO-20260815-BOB${String(i).padStart(2, '0')}`;
    d1.db.prepare(`
      INSERT INTO licenses (license_code, tier, max_devices, buyer_email, created_at, status, source)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(code, 'PRO', 5, 'bob@example.com', new Date().toISOString(), 'active', 'purchase');
  }

  const env = {
    DB: d1,
    ENVIRONMENT: 'test',
    JWT_SECRET: 'test-secret',
    ED25519_PRIVATE_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
  };
  const ctx = { waitUntil: (p) => Promise.resolve(p) };
  const corsHeaders = { 'Access-Control-Allow-Origin': '*' };

  // TEST 1: Default call without pagination params (backward compatibility)
  {
    console.log('[Test 1] GET /api/v1/user/licenses (unpaginated backward compat)');
    const url = new URL('https://lic.eqt.net.im/api/v1/user/licenses');
    const req = new Request(url.toString(), {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${testToken}`
      }
    });

    const res = await handlePortalRoutes(req, env, ctx, url, corsHeaders);
    assert(res && res.status === 200, 'Status is 200');
    const data = await res.json();
    assert(data.success === true, 'Response success is true');
    assert(data.total === 12, 'data.total is 12');
    assert(data.licenses.length === 12, 'Returns all 12 licenses');
    assert(data.licenses[0].license_code === 'EQT-PLUS-20260815-ALICE12', 'First item is newest (ALICE12)');
  }

  // TEST 2: Page 1 with limit=5, offset=0
  {
    console.log('[Test 2] GET /api/v1/user/licenses?limit=5&offset=0 (Page 1)');
    const url = new URL('https://lic.eqt.net.im/api/v1/user/licenses?limit=5&offset=0');
    const req = new Request(url.toString(), {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${testToken}`
      }
    });

    const res = await handlePortalRoutes(req, env, ctx, url, corsHeaders);
    assert(res && res.status === 200, 'Status is 200');
    const data = await res.json();
    assert(data.total === 12, 'data.total is 12');
    assert(data.limit === 5, 'data.limit is 5');
    assert(data.offset === 0, 'data.offset is 0');
    assert(data.licenses.length === 5, 'Returns 5 licenses on page 1');
    assert(data.licenses[0].license_code === 'EQT-PLUS-20260815-ALICE12', 'Page 1 first item is ALICE12');
    assert(data.licenses[4].license_code === 'EQT-PLUS-20260815-ALICE08', 'Page 1 fifth item is ALICE08');
  }

  // TEST 3: Page 2 with limit=5, offset=5
  {
    console.log('[Test 3] GET /api/v1/user/licenses?limit=5&offset=5 (Page 2)');
    const url = new URL('https://lic.eqt.net.im/api/v1/user/licenses?limit=5&offset=5');
    const req = new Request(url.toString(), {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${testToken}`
      }
    });

    const res = await handlePortalRoutes(req, env, ctx, url, corsHeaders);
    const data = await res.json();
    assert(data.total === 12, 'data.total is 12');
    assert(data.limit === 5, 'data.limit is 5');
    assert(data.offset === 5, 'data.offset is 5');
    assert(data.licenses.length === 5, 'Returns 5 licenses on page 2');
    assert(data.licenses[0].license_code === 'EQT-PLUS-20260815-ALICE07', 'Page 2 first item is ALICE07');
    assert(data.licenses[4].license_code === 'EQT-PLUS-20260815-ALICE03', 'Page 2 fifth item is ALICE03');
  }

  // TEST 4: Page 3 with limit=5, offset=10 (last partial page)
  {
    console.log('[Test 4] GET /api/v1/user/licenses?limit=5&offset=10 (Page 3)');
    const url = new URL('https://lic.eqt.net.im/api/v1/user/licenses?limit=5&offset=10');
    const req = new Request(url.toString(), {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${testToken}`
      }
    });

    const res = await handlePortalRoutes(req, env, ctx, url, corsHeaders);
    const data = await res.json();
    assert(data.total === 12, 'data.total is 12');
    assert(data.licenses.length === 2, 'Returns remaining 2 licenses on page 3');
    assert(data.licenses[0].license_code === 'EQT-PLUS-20260815-ALICE02', 'Page 3 first item is ALICE02');
    assert(data.licenses[1].license_code === 'EQT-PLUS-20260815-ALICE01', 'Page 3 second item is ALICE01');
  }

  // TEST 5: Out of range offset=20
  {
    console.log('[Test 5] GET /api/v1/user/licenses?limit=5&offset=20 (Out of range)');
    const url = new URL('https://lic.eqt.net.im/api/v1/user/licenses?limit=5&offset=20');
    const req = new Request(url.toString(), {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${testToken}`
      }
    });

    const res = await handlePortalRoutes(req, env, ctx, url, corsHeaders);
    const data = await res.json();
    assert(data.total === 12, 'data.total is 12');
    assert(data.licenses.length === 0, 'Returns 0 licenses for out of range offset');
  }

  console.log('\n============================================================');
  console.log('All 5 Portal Licenses Pagination Offline Tests PASSED!');
  console.log('============================================================');
}

run().catch(err => {
  console.error('Test failed with error:', err);
  process.exit(1);
});
