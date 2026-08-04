/**
 * Offline test for device_registry WRITE path — the data chain behind M3 live-device globe.
 *
 * Exercises the REAL bundled handleDrmRoutes + registerOrRefreshDevice against an
 * in-memory SQLite (node:sqlite) backed D1 mock, so the actual write logic
 * (fingerprint match, tier protection, 5-min debounce, COALESCE merge) is exercised.
 *
 * Build: npx esbuild src/routes/drm.ts --bundle \
 *   --alias:cloudflare:sockets=./tests/mocks/cloudflare-sockets-stub.js \
 *   --outfile=tests/compiled/drm.js --platform=node --format=cjs
 */
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const compiledDrmPath = path.join(__dirname, 'compiled', 'drm.js');
if (!fs.existsSync(compiledDrmPath)) {
  console.error("Compiled drm handler not found. Build with esbuild first.");
  process.exit(1);
}
const { handleDrmRoutes } = require(compiledDrmPath);

function assert(cond, msg) {
  if (!cond) throw new Error('ASSERT FAIL: ' + msg);
  console.log('  ✓ OK:', msg);
}

/** D1-shaped mock over a real in-memory SQLite database. */
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
    return { meta: { changes } };
  }
}

const env = {
  DB: null, // set below
  ED25519_PRIVATE_KEY: '8d97c60e4f66e2fb7a2b72738aee392620ba20339a328ffd563da816c9c2b883',
  // SMTP env vars left unset → sendDRMEmail skips (logs warning, no throw)
};
const ctx = {
  _pending: [],
  waitUntil(p) {
    if (p && typeof p.catch === 'function') {
      this._pending.push(p.catch(() => {}));
    }
  }
};

async function flushCtx() {
  await Promise.all(ctx._pending);
  ctx._pending = [];
}

/** Build a POST request to /api/v1/device/register with given body + cf geo headers. */
function registerReq(body, geoHeaders = {}) {
  return new Request('https://lic.eqt.net.im/api/v1/device/register', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-forwarded-for': '1.2.3.4',
      'cf-ipcountry': 'CN',
      'cf-ipcity': 'Shenzhen',
      'cf-region-code': 'GD',
      'cf-iplatitude': '22.54',
      'cf-iplongitude': '114.06',
      ...geoHeaders
    },
    body: JSON.stringify(body)
  });
}

/** Build a POST request to /api/v1/activate with given body + cf geo headers. */
function activateReq(body, geoHeaders = {}) {
  return new Request('https://lic.eqt.net.im/api/v1/activate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-forwarded-for': '1.2.3.4',
      'cf-ipcountry': 'CN',
      'cf-ipcity': 'Shenzhen',
      'cf-region-code': 'GD',
      'cf-iplatitude': '22.54',
      'cf-iplongitude': '114.06',
      ...geoHeaders
    },
    body: JSON.stringify(body)
  });
}

/** Create all tables needed by the DRM handler (licenses, activations, device_registry, etc.). */
function ensureAllTables(db) {
  db.db.exec(`
    CREATE TABLE IF NOT EXISTS licenses (
      license_code TEXT PRIMARY KEY,
      tier TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      max_devices INTEGER DEFAULT 2,
      expires_at TEXT,
      duration_days INTEGER DEFAULT NULL,
      buyer_email_hash TEXT DEFAULT NULL,
      buyer_email TEXT DEFAULT NULL,
      paddle_transaction_id TEXT DEFAULT NULL,
      paddle_subscription_id TEXT DEFAULT NULL,
      source TEXT DEFAULT NULL,
      revoked_at TEXT DEFAULT NULL,
      revoke_reason TEXT DEFAULT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS activations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      license_code TEXT NOT NULL,
      uuid_hash TEXT,
      cpu_hash TEXT,
      disk_hash TEXT,
      device_id TEXT DEFAULT NULL,
      activated_at TEXT NOT NULL,
      client_ip TEXT DEFAULT NULL,
      ip_country TEXT DEFAULT NULL,
      user_agent TEXT DEFAULT NULL,
      city TEXT DEFAULT NULL,
      region TEXT DEFAULT NULL,
      latitude REAL DEFAULT NULL,
      longitude REAL DEFAULT NULL
    );
    CREATE TABLE IF NOT EXISTS device_registry (
      device_id TEXT PRIMARY KEY,
      uuid_hash TEXT,
      cpu_hash TEXT,
      disk_hash TEXT,
      tier_label TEXT NOT NULL DEFAULT 'free',
      license_code TEXT DEFAULT NULL,
      email TEXT DEFAULT NULL,
      registered_at TEXT NOT NULL,
      last_seen_at TEXT,
      last_ip TEXT DEFAULT NULL,
      ip_country TEXT DEFAULT NULL,
      city TEXT DEFAULT NULL,
      region TEXT DEFAULT NULL,
      latitude REAL DEFAULT NULL,
      longitude REAL DEFAULT NULL,
      app_version TEXT DEFAULT NULL
    );
    CREATE TABLE IF NOT EXISTS system_error_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      level TEXT NOT NULL DEFAULT 'ERROR',
      category TEXT NOT NULL,
      error_message TEXT NOT NULL,
      context_json TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS rate_limits (
      key TEXT PRIMARY KEY,
      count INTEGER NOT NULL DEFAULT 1,
      window_start TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_registry_live ON device_registry(tier_label, last_seen_at);
    CREATE INDEX IF NOT EXISTS idx_registry_last_seen ON device_registry(last_seen_at);
    CREATE INDEX IF NOT EXISTS idx_registry_uuid ON device_registry(uuid_hash);
    CREATE INDEX IF NOT EXISTS idx_registry_cpu ON device_registry(cpu_hash);
    CREATE INDEX IF NOT EXISTS idx_registry_disk ON device_registry(disk_hash);
  `);
}

/** Seed a license row for activate-path tests. */
async function seedLicense(db, overrides = {}) {
  await db.prepare(`
    INSERT INTO licenses (license_code, tier, status, max_devices, expires_at, buyer_email, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(
    overrides.license_code || 'EQT-TEST-001',
    overrides.tier || 'PLUS',
    overrides.status || 'active',
    overrides.max_devices ?? 2,
    overrides.expires_at || 'LIFETIME',
    overrides.buyer_email || 'buyer@test.com',
    overrides.created_at || new Date().toISOString()
  ).run();
}

/** Query device_registry rows for assertions. */
function queryRegistry(db) {
  const rows = db.db.prepare('SELECT * FROM device_registry ORDER BY device_id').all();
  return rows;
}

/** Query a single device_registry row by device_id. */
function queryRegistryById(db, deviceId) {
  return db.db.prepare('SELECT * FROM device_registry WHERE device_id = ?').get(deviceId) || null;
}

async function runTests() {
  console.log('==============================================');
  console.log('🚀 Device Registry WRITE Path Offline Tests');
  console.log('    (real handleDrmRoutes + registerOrRefreshDevice)');
  console.log('==============================================\n');

  // ============================================================
  // T1: Free device register — new device, with fingerprints
  // ============================================================
  console.log('Test 1: Free device register (new device, with fingerprints)...');
  const db1 = new SqliteD1Mock();
  ensureAllTables(db1);
  env.DB = db1;
  const res1 = await handleDrmRoutes(registerReq({
    uuid_hash: 'uuid-free-1',
    cpu_hash: 'cpu-free-1',
    disk_hash: 'disk-free-1',
    app_version: '1.0.0'
  }), env, ctx, new URL('https://lic.eqt.net.im/api/v1/device/register'), {});
  assert(res1.status === 200, '200 OK');
  const j1 = await res1.json();
  assert(j1.device_id && j1.device_id.length === 32, `device_id assigned (32 hex): ${j1.device_id}`);
  assert(j1.tier === 'free', 'tier = free');
  const rows1 = queryRegistry(db1);
  assert(rows1.length === 1, 'exactly 1 row in device_registry');
  assert(rows1[0].tier_label === 'free', 'tier_label = free');
  assert(rows1[0].uuid_hash === 'uuid-free-1', 'uuid_hash stored');
  assert(rows1[0].ip_country === 'CN', 'ip_country stored');
  assert(rows1[0].city === 'Shenzhen', 'city stored');
  assert(rows1[0].license_code === null, 'license_code = null (no license)');
  assert(rows1[0].email === null, 'email = null (no email)');
  await flushCtx();

  // ============================================================
  // T2: Free device register — no fingerprints → skipped
  // ============================================================
  console.log('\nTest 2: Free device register (no fingerprints → skipped)...');
  const db2 = new SqliteD1Mock();
  ensureAllTables(db2);
  env.DB = db2;
  const res2 = await handleDrmRoutes(registerReq({
    app_version: '1.0.0'
  }), env, ctx, new URL('https://lic.eqt.net.im/api/v1/device/register'), {});
  assert(res2.status === 200, '200 OK');
  const j2 = await res2.json();
  assert(j2.device_id === '' && j2.tier === 'free', 'empty device_id, tier=free (skipped)');
  const rows2 = queryRegistry(db2);
  assert(rows2.length === 0, '0 rows in device_registry (skipped)');
  await flushCtx();

  // ============================================================
  // T3: Paid device register — new device with license_code
  // ============================================================
  console.log('\nTest 3: Paid device register (new device, with license_code)...');
  const db3 = new SqliteD1Mock();
  ensureAllTables(db3);
  env.DB = db3;
  // Need a license row so the handler resolves tier=paid
  await seedLicense(db3, { license_code: 'EQT-PAID-REG' });
  const res3 = await handleDrmRoutes(registerReq({
    uuid_hash: 'uuid-paid-3',
    cpu_hash: 'cpu-paid-3',
    disk_hash: 'disk-paid-3',
    license_code: 'EQT-PAID-REG',
    app_version: '1.0.0'
  }), env, ctx, new URL('https://lic.eqt.net.im/api/v1/device/register'), {});
  assert(res3.status === 200, '200 OK');
  const j3 = await res3.json();
  assert(j3.tier === 'paid', 'tier = paid');
  const rows3 = queryRegistry(db3);
  assert(rows3.length === 1, 'exactly 1 row');
  assert(rows3[0].tier_label === 'paid', 'tier_label = paid');
  assert(rows3[0].license_code === 'EQT-PAID-REG', 'license_code stored');
  await flushCtx();

  // ============================================================
  // T4: Free → paid upgrade via re-register (tier protection: upgrade allowed)
  // ============================================================
  console.log('\nTest 4: Free → paid upgrade (re-register with license_code)...');
  const db4 = new SqliteD1Mock();
  ensureAllTables(db4);
  env.DB = db4;
  // First register as free
  const res4a = await handleDrmRoutes(registerReq({
    uuid_hash: 'uuid-up-4',
    cpu_hash: 'cpu-up-4',
    disk_hash: 'disk-up-4',
    app_version: '1.0.0'
  }), env, ctx, new URL('https://lic.eqt.net.im/api/v1/device/register'), {});
  const j4a = await res4a.json();
  const devId4 = j4a.device_id;
  assert(j4a.tier === 'free', 'initial tier = free');
  // Now re-register same device (same fingerprints) with a paid license_code
  await seedLicense(db4, { license_code: 'EQT-UPGRADE-4' });
  const res4b = await handleDrmRoutes(registerReq({
    uuid_hash: 'uuid-up-4',
    cpu_hash: 'cpu-up-4',
    disk_hash: 'disk-up-4',
    license_code: 'EQT-UPGRADE-4',
    app_version: '1.0.0'
  }), env, ctx, new URL('https://lic.eqt.net.im/api/v1/device/register'), {});
  assert(res4b.status === 200, '200 OK');
  const j4b = await res4b.json();
  assert(j4b.tier === 'paid', 'upgraded tier = paid');
  assert(j4b.device_id === devId4, 'same device_id retained');
  const row4 = queryRegistryById(db4, devId4);
  assert(row4.tier_label === 'paid', 'tier_label upgraded to paid');
  assert(row4.license_code === 'EQT-UPGRADE-4', 'license_code updated');
  await flushCtx();

  // ============================================================
  // T5: Paid → free NOT downgraded (tier protection)
  // ============================================================
  console.log('\nTest 5: Paid → free NOT downgraded (tier protection)...');
  const db5 = new SqliteD1Mock();
  ensureAllTables(db5);
  env.DB = db5;
  // First register as paid
  await seedLicense(db5, { license_code: 'EQT-PAID-5' });
  const res5a = await handleDrmRoutes(registerReq({
    uuid_hash: 'uuid-prot-5',
    cpu_hash: 'cpu-prot-5',
    disk_hash: 'disk-prot-5',
    license_code: 'EQT-PAID-5',
    app_version: '1.0.0'
  }), env, ctx, new URL('https://lic.eqt.net.im/api/v1/device/register'), {});
  const j5a = await res5a.json();
  const devId5 = j5a.device_id;
  assert(j5a.tier === 'paid', 'initial tier = paid');
  // Re-register same device WITHOUT license_code (free attempt)
  const res5b = await handleDrmRoutes(registerReq({
    uuid_hash: 'uuid-prot-5',
    cpu_hash: 'cpu-prot-5',
    disk_hash: 'disk-prot-5',
    app_version: '1.0.0'
  }), env, ctx, new URL('https://lic.eqt.net.im/api/v1/device/register'), {});
  assert(res5b.status === 200, '200 OK');
  const j5b = await res5b.json();
  assert(j5b.tier === 'paid', 'tier stays paid (not downgraded)');
  const row5 = queryRegistryById(db5, devId5);
  assert(row5.tier_label === 'paid', 'tier_label still paid');
  await flushCtx();

  // ============================================================
  // T6: 5-minute write debounce — last_seen_at NOT refreshed within window
  // ============================================================
  console.log('\nTest 6: 5-minute write debounce (last_seen_at not refreshed within window)...');
  const db6 = new SqliteD1Mock();
  ensureAllTables(db6);
  env.DB = db6;
  // Register device
  const res6a = await handleDrmRoutes(registerReq({
    uuid_hash: 'uuid-deb-6',
    cpu_hash: 'cpu-deb-6',
    disk_hash: 'disk-deb-6',
    app_version: '1.0.0'
  }), env, ctx, new URL('https://lic.eqt.net.im/api/v1/device/register'), {});
  const j6a = await res6a.json();
  const devId6 = j6a.device_id;
  const row6a = queryRegistryById(db6, devId6);
  const firstSeen = row6a.last_seen_at;
  // Re-register immediately (within 5 min debounce window) — last_seen_at should NOT change
  const res6b = await handleDrmRoutes(registerReq({
    uuid_hash: 'uuid-deb-6',
    cpu_hash: 'cpu-deb-6',
    disk_hash: 'disk-deb-6',
    app_version: '1.0.0'
  }), env, ctx, new URL('https://lic.eqt.net.im/api/v1/device/register'), {});
  assert(res6b.status === 200, '200 OK');
  const row6b = queryRegistryById(db6, devId6);
  assert(row6b.last_seen_at === firstSeen,
    `last_seen_at unchanged by debounce (${row6b.last_seen_at} === ${firstSeen})`);
  await flushCtx();

  // ============================================================
  // T7: Debounce bypass — tier change forces write regardless of time
  // ============================================================
  console.log('\nTest 7: Debounce bypass — tier change forces write...');
  const db7 = new SqliteD1Mock();
  ensureAllTables(db7);
  env.DB = db7;
  // Register as free
  const res7a = await handleDrmRoutes(registerReq({
    uuid_hash: 'uuid-tierchg-7',
    cpu_hash: 'cpu-tierchg-7',
    disk_hash: 'disk-tierchg-7',
    app_version: '1.0.0'
  }), env, ctx, new URL('https://lic.eqt.net.im/api/v1/device/register'), {});
  const j7a = await res7a.json();
  const devId7 = j7a.device_id;
  const row7a = queryRegistryById(db7, devId7);
  const firstSeen7 = row7a.last_seen_at;
  // Immediately re-register with paid license_code — tier change should bypass debounce
  await seedLicense(db7, { license_code: 'EQT-TIERCHG-7' });
  const res7b = await handleDrmRoutes(registerReq({
    uuid_hash: 'uuid-tierchg-7',
    cpu_hash: 'cpu-tierchg-7',
    disk_hash: 'disk-tierchg-7',
    license_code: 'EQT-TIERCHG-7',
    app_version: '1.0.0'
  }), env, ctx, new URL('https://lic.eqt.net.im/api/v1/device/register'), {});
  assert(res7b.status === 200, '200 OK');
  const j7b = await res7b.json();
  assert(j7b.tier === 'paid', 'tier upgraded to paid');
  const row7b = queryRegistryById(db7, devId7);
  assert(row7b.tier_label === 'paid', 'tier_label updated');
  // last_seen_at should have been refreshed because tier changed
  assert(row7b.last_seen_at !== firstSeen7,
    `last_seen_at refreshed on tier change (${row7b.last_seen_at} !== ${firstSeen7})`);
  await flushCtx();

  // ============================================================
  // T8: Debounce bypass — >5 min elapsed refreshes last_seen_at
  // ============================================================
  console.log('\nTest 8: Debounce bypass — >5 min elapsed refreshes last_seen_at...');
  const db8 = new SqliteD1Mock();
  ensureAllTables(db8);
  env.DB = db8;
  // Register device
  const res8a = await handleDrmRoutes(registerReq({
    uuid_hash: 'uuid-elap-8',
    cpu_hash: 'cpu-elap-8',
    disk_hash: 'disk-elap-8',
    app_version: '1.0.0'
  }), env, ctx, new URL('https://lic.eqt.net.im/api/v1/device/register'), {});
  const j8a = await res8a.json();
  const devId8 = j8a.device_id;
  // Manually backdate last_seen_at to 10 minutes ago (simulate elapsed debounce window)
  const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  db8.db.prepare('UPDATE device_registry SET last_seen_at = ? WHERE device_id = ?').run(tenMinAgo, devId8);
  const row8a = queryRegistryById(db8, devId8);
  assert(row8a.last_seen_at === tenMinAgo, 'last_seen_at backdated to 10 min ago');
  // Re-register — should refresh because >5 min elapsed
  const res8b = await handleDrmRoutes(registerReq({
    uuid_hash: 'uuid-elap-8',
    cpu_hash: 'cpu-elap-8',
    disk_hash: 'disk-elap-8',
    app_version: '1.0.0'
  }), env, ctx, new URL('https://lic.eqt.net.im/api/v1/device/register'), {});
  assert(res8b.status === 200, '200 OK');
  const row8b = queryRegistryById(db8, devId8);
  assert(row8b.last_seen_at !== tenMinAgo,
    `last_seen_at refreshed after debounce window (${row8b.last_seen_at} !== ${tenMinAgo})`);
  await flushCtx();

  // ============================================================
  // T9: Activate path writes device_registry (paid, new device)
  // ============================================================
  console.log('\nTest 9: Activate path writes device_registry (paid, new device)...');
  const db9 = new SqliteD1Mock();
  ensureAllTables(db9);
  env.DB = db9;
  await seedLicense(db9, { license_code: 'EQT-ACT-9', max_devices: 3 });
  const res9 = await handleDrmRoutes(activateReq({
    license_code: 'EQT-ACT-9',
    uuid_hash: 'uuid-act-9',
    cpu_hash: 'cpu-act-9',
    disk_hash: 'disk-act-9'
  }), env, ctx, new URL('https://lic.eqt.net.im/api/v1/activate'), {});
  assert(res9.status === 200, '200 OK');
  const j9 = await res9.json();
  assert(j9.license_code === 'EQT-ACT-9', 'activation license_code = EQT-ACT-9');
  assert(j9.device_id && j9.device_id.length === 32, `device_id assigned: ${j9.device_id}`);
  const rows9 = queryRegistry(db9);
  assert(rows9.length === 1, 'exactly 1 device_registry row from activate');
  assert(rows9[0].tier_label === 'paid', 'tier_label = paid');
  assert(rows9[0].license_code === 'EQT-ACT-9', 'license_code stored');
  assert(rows9[0].email === 'buyer@test.com', 'email propagated from license');
  await flushCtx();

  // ============================================================
  // T10: Activate path — re-activate refreshes registry (already activated device)
  // ============================================================
  console.log('\nTest 10: Activate path — re-activate refreshes registry (already activated device)...');
  const db10 = new SqliteD1Mock();
  ensureAllTables(db10);
  env.DB = db10;
  await seedLicense(db10, { license_code: 'EQT-REACT-10', max_devices: 3 });
  // First activation
  const res10a = await handleDrmRoutes(activateReq({
    license_code: 'EQT-REACT-10',
    uuid_hash: 'uuid-re-10',
    cpu_hash: 'cpu-re-10',
    disk_hash: 'disk-re-10'
  }), env, ctx, new URL('https://lic.eqt.net.im/api/v1/activate'), {});
  assert(res10a.status === 200, 'first activation 200 OK');
  const j10a = await res10a.json();
  const devId10 = j10a.device_id;
  const row10a = queryRegistryById(db10, devId10);
  const firstSeen10 = row10a.last_seen_at;
  // Backdate last_seen_at to 10 min ago so debounce doesn't block refresh
  const tenMinAgo10 = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  db10.db.prepare('UPDATE device_registry SET last_seen_at = ? WHERE device_id = ?').run(tenMinAgo10, devId10);
  // Re-activate (same fingerprints → already activated path)
  const res10b = await handleDrmRoutes(activateReq({
    license_code: 'EQT-REACT-10',
    uuid_hash: 'uuid-re-10',
    cpu_hash: 'cpu-re-10',
    disk_hash: 'disk-re-10'
  }), env, ctx, new URL('https://lic.eqt.net.im/api/v1/activate'), {});
  assert(res10b.status === 200, 're-activation 200 OK');
  const j10b = await res10b.json();
  assert(j10b.device_id === devId10, 'same device_id on re-activation');
  const row10b = queryRegistryById(db10, devId10);
  assert(row10b.last_seen_at !== tenMinAgo10,
    `last_seen_at refreshed on re-activate (${row10b.last_seen_at} !== ${tenMinAgo10})`);
  await flushCtx();

  // ============================================================
  // T11: Verify path also writes device_registry
  // ============================================================
  console.log('\nTest 11: Verify path writes device_registry (paid, existing activation)...');
  const db11 = new SqliteD1Mock();
  ensureAllTables(db11);
  env.DB = db11;
  await seedLicense(db11, { license_code: 'EQT-VFY-11', max_devices: 3 });
  // Activate first
  const res11a = await handleDrmRoutes(activateReq({
    license_code: 'EQT-VFY-11',
    uuid_hash: 'uuid-vfy-11',
    cpu_hash: 'cpu-vfy-11',
    disk_hash: 'disk-vfy-11'
  }), env, ctx, new URL('https://lic.eqt.net.im/api/v1/activate'), {});
  assert(res11a.status === 200, 'activation 200 OK');
  const j11a = await res11a.json();
  const devId11 = j11a.device_id;
  // Backdate last_seen_at to 10 min ago
  const tenMinAgo11 = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  db11.db.prepare('UPDATE device_registry SET last_seen_at = ? WHERE device_id = ?').run(tenMinAgo11, devId11);
  // Now verify
  const res11b = await handleDrmRoutes(new Request('https://lic.eqt.net.im/api/v1/verify', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-forwarded-for': '1.2.3.4',
      'cf-ipcountry': 'CN',
      'cf-ipcity': 'Shenzhen',
      'cf-region-code': 'GD',
      'cf-iplatitude': '22.54',
      'cf-iplongitude': '114.06'
    },
    body: JSON.stringify({
      license_code: 'EQT-VFY-11',
      uuid_hash: 'uuid-vfy-11',
      cpu_hash: 'cpu-vfy-11',
      disk_hash: 'disk-vfy-11',
      device_id: devId11
    })
  }), env, ctx, new URL('https://lic.eqt.net.im/api/v1/verify'), {});
  assert(res11b.status === 200, 'verify 200 OK');
  const row11b = queryRegistryById(db11, devId11);
  assert(row11b.last_seen_at !== tenMinAgo11,
    `last_seen_at refreshed on verify (${row11b.last_seen_at} !== ${tenMinAgo11})`);
  await flushCtx();

  // ============================================================
  // T12: COALESCE merge — re-register without license_code doesn't clear it
  // ============================================================
  console.log('\nTest 12: COALESCE merge — re-register without license_code does not clear it...');
  const db12 = new SqliteD1Mock();
  ensureAllTables(db12);
  env.DB = db12;
  await seedLicense(db12, { license_code: 'EQT-COAL-12' });
  // Register as paid with license_code
  const res12a = await handleDrmRoutes(registerReq({
    uuid_hash: 'uuid-coal-12',
    cpu_hash: 'cpu-coal-12',
    disk_hash: 'disk-coal-12',
    license_code: 'EQT-COAL-12',
    app_version: '1.0.0'
  }), env, ctx, new URL('https://lic.eqt.net.im/api/v1/device/register'), {});
  const j12a = await res12a.json();
  const devId12 = j12a.device_id;
  // Backdate last_seen_at to 10 min ago so debounce doesn't block
  const tenMinAgo12 = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  db12.db.prepare('UPDATE device_registry SET last_seen_at = ? WHERE device_id = ?').run(tenMinAgo12, devId12);
  // Re-register WITHOUT license_code — COALESCE should preserve existing license_code
  const res12b = await handleDrmRoutes(registerReq({
    uuid_hash: 'uuid-coal-12',
    cpu_hash: 'cpu-coal-12',
    disk_hash: 'disk-coal-12',
    app_version: '1.0.0'
  }), env, ctx, new URL('https://lic.eqt.net.im/api/v1/device/register'), {});
  assert(res12b.status === 200, '200 OK');
  const row12b = queryRegistryById(db12, devId12);
  assert(row12b.license_code === 'EQT-COAL-12',
    `license_code preserved via COALESCE (${row12b.license_code})`);
  await flushCtx();

  // ============================================================
  // T13: Fingerprint match — same device re-register returns same device_id
  // ============================================================
  console.log('\nTest 13: Fingerprint match — same device re-register returns same device_id...');
  const db13 = new SqliteD1Mock();
  ensureAllTables(db13);
  env.DB = db13;
  const res13a = await handleDrmRoutes(registerReq({
    uuid_hash: 'uuid-ident-13',
    cpu_hash: 'cpu-ident-13',
    disk_hash: 'disk-ident-13',
    app_version: '1.0.0'
  }), env, ctx, new URL('https://lic.eqt.net.im/api/v1/device/register'), {});
  const j13a = await res13a.json();
  const devId13 = j13a.device_id;
  // Backdate last_seen_at to 10 min ago
  const tenMinAgo13 = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  db13.db.prepare('UPDATE device_registry SET last_seen_at = ? WHERE device_id = ?').run(tenMinAgo13, devId13);
  // Re-register with same fingerprints
  const res13b = await handleDrmRoutes(registerReq({
    uuid_hash: 'uuid-ident-13',
    cpu_hash: 'cpu-ident-13',
    disk_hash: 'disk-ident-13',
    app_version: '1.0.0'
  }), env, ctx, new URL('https://lic.eqt.net.im/api/v1/device/register'), {});
  assert(res13b.status === 200, '200 OK');
  const j13b = await res13b.json();
  assert(j13b.device_id === devId13, `same device_id on re-register (${j13b.device_id} === ${devId13})`);
  await flushCtx();

  // ============================================================
  // T14: Fingerprint partial match — only 2 of 3 components match
  // ============================================================
  console.log('\nTest 14: Fingerprint partial match — 2 of 3 components match...');
  const db14 = new SqliteD1Mock();
  ensureAllTables(db14);
  env.DB = db14;
  // Register with all 3 fingerprints
  const res14a = await handleDrmRoutes(registerReq({
    uuid_hash: 'uuid-part-14',
    cpu_hash: 'cpu-part-14',
    disk_hash: 'disk-part-14',
    app_version: '1.0.0'
  }), env, ctx, new URL('https://lic.eqt.net.im/api/v1/device/register'), {});
  const j14a = await res14a.json();
  const devId14 = j14a.device_id;
  // Backdate last_seen_at
  const tenMinAgo14 = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  db14.db.prepare('UPDATE device_registry SET last_seen_at = ? WHERE device_id = ?').run(tenMinAgo14, devId14);
  // Re-register with only uuid + cpu (disk missing) — should still match (2 of 3)
  const res14b = await handleDrmRoutes(registerReq({
    uuid_hash: 'uuid-part-14',
    cpu_hash: 'cpu-part-14',
    app_version: '1.0.0'
  }), env, ctx, new URL('https://lic.eqt.net.im/api/v1/device/register'), {});
  assert(res14b.status === 200, '200 OK');
  const j14b = await res14b.json();
  assert(j14b.device_id === devId14, `same device_id with partial match (${j14b.device_id} === ${devId14})`);
  await flushCtx();

  // ============================================================
  // T15: Fingerprint mismatch — different device gets new device_id
  // ============================================================
  console.log('\nTest 15: Fingerprint mismatch — different device gets new device_id...');
  const db15 = new SqliteD1Mock();
  ensureAllTables(db15);
  env.DB = db15;
  const res15a = await handleDrmRoutes(registerReq({
    uuid_hash: 'uuid-first-15',
    cpu_hash: 'cpu-first-15',
    disk_hash: 'disk-first-15',
    app_version: '1.0.0'
  }), env, ctx, new URL('https://lic.eqt.net.im/api/v1/device/register'), {});
  const j15a = await res15a.json();
  const devId15a = j15a.device_id;
  // Different fingerprints → new device
  const res15b = await handleDrmRoutes(registerReq({
    uuid_hash: 'uuid-second-15',
    cpu_hash: 'cpu-second-15',
    disk_hash: 'disk-second-15',
    app_version: '1.0.0'
  }), env, ctx, new URL('https://lic.eqt.net.im/api/v1/device/register'), {});
  assert(res15b.status === 200, '200 OK');
  const j15b = await res15b.json();
  assert(j15b.device_id !== devId15a, 'different device_id for different fingerprints');
  const rows15 = queryRegistry(db15);
  assert(rows15.length === 2, '2 rows for 2 distinct devices');
  await flushCtx();

  // ============================================================
  // T16: Activate rate limit — 4th request returns 429 (§M4 P1)
  // ============================================================
  console.log('\nTest 16: Activate rate limit — 4th request returns 429...');
  const db16 = new SqliteD1Mock();
  ensureAllTables(db16);
  env.DB = db16;
  await seedLicense(db16, { license_code: 'EQT-RL-16', max_devices: 5 });
  for (let i = 1; i <= 4; i++) {
    const res = await handleDrmRoutes(activateReq({
      license_code: 'EQT-RL-16',
      uuid_hash: `uuid-rl-16-${i}`,
      cpu_hash: `cpu-rl-16-${i}`,
      disk_hash: `disk-rl-16-${i}`
    }), env, ctx, new URL('https://lic.eqt.net.im/api/v1/activate'), {});
    if (i <= 3) {
      assert(res.status === 200, `activate #${i} 200 OK`);
    } else {
      assert(res.status === 429, `activate #${i} returns 429`);
      const j = await res.json();
      assert(j.retry_after === 60, `retry_after=60 in 429 response (got ${j.retry_after})`);
    }
  }
  await flushCtx();

  // ============================================================
  // T17: Verify rate limit — 11th request returns 429 (§M4 P1)
  // ============================================================
  console.log('\nTest 17: Verify rate limit — 11th request returns 429...');
  const db17 = new SqliteD1Mock();
  ensureAllTables(db17);
  env.DB = db17;
  await seedLicense(db17, { license_code: 'EQT-RL-17', max_devices: 15 });
  // Activate first (needs a valid activation record for verify to pass)
  const res17act = await handleDrmRoutes(activateReq({
    license_code: 'EQT-RL-17',
    uuid_hash: 'uuid-rl-17',
    cpu_hash: 'cpu-rl-17',
    disk_hash: 'disk-rl-17'
  }), env, ctx, new URL('https://lic.eqt.net.im/api/v1/activate'), {});
  assert(res17act.status === 200, 'activate 200 OK for verify test setup');
  const j17act = await res17act.json();
  const devId17 = j17act.device_id;
  // Send 11 verify requests
  for (let i = 1; i <= 11; i++) {
    const res = await handleDrmRoutes(new Request('https://lic.eqt.net.im/api/v1/verify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': '1.2.3.4',
        'cf-ipcountry': 'CN',
        'cf-ipcity': 'Shenzhen',
        'cf-region-code': 'GD',
        'cf-iplatitude': '22.54',
        'cf-iplongitude': '114.06'
      },
      body: JSON.stringify({
        license_code: 'EQT-RL-17',
        uuid_hash: 'uuid-rl-17',
        cpu_hash: 'cpu-rl-17',
        disk_hash: 'disk-rl-17',
        device_id: devId17
      })
    }), env, ctx, new URL('https://lic.eqt.net.im/api/v1/verify'), {});
    if (i <= 10) {
      assert(res.status === 200, `verify #${i} 200 OK`);
    } else {
      assert(res.status === 429, `verify #${i} returns 429`);
      const j = await res.json();
      assert(j.retry_after === 60, `retry_after=60 in 429 response (got ${j.retry_after})`);
    }
  }
  await flushCtx();

  // ============================================================
  // T18: Register rate limit unaffected by activate/verify limits (§M4 P1)
  // ============================================================
  console.log('\nTest 18: Register rate limit unaffected by activate/verify limits...');
  const db18 = new SqliteD1Mock();
  ensureAllTables(db18);
  env.DB = db18;
  // Register should work fine (different key prefix from activate/verify)
  const res18 = await handleDrmRoutes(registerReq({
    uuid_hash: 'uuid-rl-18',
    cpu_hash: 'cpu-rl-18',
    disk_hash: 'disk-rl-18',
    app_version: '1.0.0'
  }), env, ctx, new URL('https://lic.eqt.net.im/api/v1/device/register'), {});
  assert(res18.status === 200, 'register 200 OK after activate/verify rate limit tests');
  await flushCtx();

  console.log('\n🎉🎉 ALL DEVICE REGISTRY WRITE PATH TESTS PASSED! 🎉🎉');
}

runTests().catch((err) => {
  console.error('\n❌ TEST RUN FAILED:', err);
  process.exit(1);
});
