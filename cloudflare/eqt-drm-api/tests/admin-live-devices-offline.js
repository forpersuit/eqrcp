/**
 * Offline test for §3.9 GET /api/v1/admin/devices/live (M3 live-device globe endpoint).
 *
 * Runs the REAL bundled handleAdminRoutes against an in-memory SQLite (node:sqlite)
 * backed D1 mock, so the actual aggregate SQL (SUM/CASE WHEN/GROUP BY) and the
 * license_code-grouped arcs logic are exercised — not a string-match fake.
 *
 * Build: npx esbuild src/routes/admin.ts --bundle \
 *   --alias:cloudflare:sockets=./tests/mocks/cloudflare-sockets-stub.js \
 *   --outfile=tests/compiled/admin.js --platform=node --format=cjs
 */
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const compiledAdminPath = path.join(__dirname, 'compiled', 'admin.js');
if (!fs.existsSync(compiledAdminPath)) {
  console.error("Compiled admin handler not found. Build with esbuild first (npm run test:admin:live).");
  process.exit(1);
}
const { handleAdminRoutes } = require(compiledAdminPath);

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

const LOCAL_JWT = 'local.admin@eqt.net.im';
const env = {
  DB: null, // set below
  CF_ACCESS_TEAM_DOMAIN: 'local.dev',
  CF_ACCESS_AUD: 'local-dev',
  CF_ACCESS_ALLOWED_EMAILS: '*'
};
const ctx = {
  _pending: [],
  waitUntil(p) {
    if (p && typeof p.catch === 'function') {
      this._pending.push(p.catch(() => {}));
    }
  }
};

async function flushAudit() {
  await Promise.all(ctx._pending);
  ctx._pending = [];
}

function adminGet(db, url, headers = {}) {
  const req = new Request(url, { method: 'GET', headers: { 'Cf-Access-Jwt-Assertion': LOCAL_JWT, ...headers } });
  return handleAdminRoutes(req, env, ctx, new URL(url), {});
}

const NOW = Date.now();
function ago(minutes) {
  return new Date(NOW - minutes * 60 * 1000).toISOString();
}

async function seedDevice(db, row) {
  await db.prepare(`
    INSERT INTO device_registry (
      device_id, uuid_hash, tier_label, license_code, email,
      registered_at, last_seen_at, last_ip, ip_country, city, region, latitude, longitude
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    row.device_id,
    row.uuid_hash || null,
    row.tier_label || 'free',
    row.license_code || null,
    row.email || null,
    ago(600),
    row.last_seen_at,
    row.last_ip || '1.2.3.4',
    row.ip_country || null,
    row.city || null,
    row.region || null,
    row.latitude ?? null,
    row.longitude ?? null
  ).run();
}

async function runTests() {
  console.log('========================================');
  console.log('🚀 M3 /api/v1/admin/devices/live Offline Tests (real SQL + real handler)');
  console.log('========================================\n');

  const db = new SqliteD1Mock();
  env.DB = db;

  // Fire one request so requireAdminAuth -> ensureDrmTables creates the schema,
  // then seed rows relative to now.
  await adminGet(db, 'https://lic.eqt.net.im/api/v1/admin/devices/live?window=1h');

  // --- Seed device_registry ---
  // EQT-PAID-1: two paid devices, CN/Shanghai + US/NY (both active in last 1h) -> 1 cross-region arc
  await seedDevice(db, { device_id: 'devA', uuid_hash: 'aaa', tier_label: 'paid', license_code: 'EQT-PAID-1', email: 'a@x.com', last_seen_at: ago(2), ip_country: 'CN', city: 'Shanghai', region: 'SH', latitude: 31.23, longitude: 121.47 });
  await seedDevice(db, { device_id: 'devB', uuid_hash: 'bbb', tier_label: 'paid', license_code: 'EQT-PAID-1', email: 'a@x.com', last_seen_at: ago(5), ip_country: 'US', city: 'New York', region: 'NY', latitude: 40.7, longitude: -74.0 });
  // Same city as devA but free -> groups into the same Shanghai dot (paid 1 / free 1)
  await seedDevice(db, { device_id: 'devF1', uuid_hash: 'fff', tier_label: 'free', license_code: null, last_seen_at: ago(3), ip_country: 'CN', city: 'Shanghai', region: 'SH', latitude: 31.23, longitude: 121.47 });
  // Single-device paid code -> no arc
  await seedDevice(db, { device_id: 'devC', uuid_hash: 'ccc', tier_label: 'paid', license_code: 'EQT-PAID-2', email: 'c@x.com', last_seen_at: ago(4), ip_country: 'CN', city: 'Beijing', region: 'BJ', latitude: 39.9, longitude: 116.4 });
  // Paid device with geo missing (proxy/VPN XX) -> excluded from locations AND totals
  await seedDevice(db, { device_id: 'devG', uuid_hash: 'ggg', tier_label: 'paid', license_code: 'EQT-PAID-1', email: 'a@x.com', last_seen_at: ago(6), ip_country: 'XX', city: null, region: null, latitude: null, longitude: null });
  // Stale paid device (2 days old) -> in 7d window, out of 1h
  await seedDevice(db, { device_id: 'devD', uuid_hash: 'ddd', tier_label: 'paid', license_code: 'EQT-PAID-3', email: 'd@x.com', last_seen_at: ago(2 * 24 * 60), ip_country: 'US', city: 'Los Angeles', region: 'CA', latitude: 34.05, longitude: -118.24 });

  // --- T1: window=1h&arcs=1 ---
  console.log('Test 1: window=1h&arcs=1 — aggregation, paid/free split, license_code arcs, geo-subset totals...');
  const res1 = await adminGet(db, 'https://lic.eqt.net.im/api/v1/admin/devices/live?window=1h&arcs=1');
  assert(res1.status === 200, '200 OK');
  const j1 = await res1.json();
  assert(j1.window === '1h', 'window echoed as 1h');

  const sh = j1.locations.find((l) => l.country === 'CN' && l.city === 'Shanghai');
  assert(sh && sh.total_count === 2 && sh.paid_count === 1 && sh.free_count === 1, 'CN/Shanghai aggregates devA(paid)+devF1(free) into one dot (total 2, paid 1, free 1)');
  assert(j1.locations.find((l) => l.country === 'US' && l.city === 'New York')?.total_count === 1, 'US/New York dot present (paid 1)');
  assert(j1.locations.find((l) => l.country === 'CN' && l.city === 'Beijing')?.total_count === 1, 'CN/Beijing dot present');
  assert(!j1.locations.some((l) => l.city === 'Los Angeles'), 'Stale US/LA device excluded from 1h window');

  // P1 decision: total = windowed devices WITH full geo info (geo-null XX device excluded)
  assert(j1.total_active_devices === 4, 'total_active_devices = 4 (Shanghai 2 + NY 1 + Beijing 1; geo-null + stale excluded)');
  assert(j1.total_paid_devices === 3 && j1.total_free_devices === 1, 'total paid=3 free=1');

  assert(j1.cross_region_arcs.length === 1, 'Exactly 1 cross-region arc');
  const arc = j1.cross_region_arcs[0];
  assert(arc.license_code === 'EQT-PAID-1', 'Arc keyed by license_code (not device_id)');
  const arcCountries = [arc.from_country, arc.to_country].sort().join(',');
  assert(arcCountries === 'CN,US', 'Arc connects CN <-> US (either direction — ordering is non-semantic)');

  // --- T2: window=7d includes the stale device ---
  console.log('\nTest 2: window=7d widens the active set...');
  const res2 = await adminGet(db, 'https://lic.eqt.net.im/api/v1/admin/devices/live?window=7d&arcs=1');
  const j2 = await res2.json();
  assert(j2.window === '7d', 'window echoed as 7d');
  assert(j2.total_active_devices === 5, '7d total = 5 (adds stale US/LA device)');
  assert(j2.locations.some((l) => l.city === 'Los Angeles'), 'Stale device appears in 7d locations');
  assert(j2.cross_region_arcs.length === 1, '7d still exactly 1 arc (LA device belongs to single-device code)');

  // --- T3: invalid window falls back to 1h ---
  console.log('\nTest 3: invalid window value defaults to 1h...');
  const res3 = await adminGet(db, 'https://lic.eqt.net.im/api/v1/admin/devices/live?window=bad');
  const j3 = await res3.json();
  assert(j3.window === '1h', 'invalid window defaults to 1h');
  assert(j3.total_active_devices === 4, 'defaulted 1h total = 4');

  // --- T4: arcs omitted -> no second scan, empty arcs ---
  console.log('\nTest 4: arcs param omitted -> cross_region_arcs empty...');
  const res4 = await adminGet(db, 'https://lic.eqt.net.im/api/v1/admin/devices/live?window=1h');
  const j4 = await res4.json();
  assert(Array.isArray(j4.cross_region_arcs) && j4.cross_region_arcs.length === 0, 'arcs=0 yields empty array (no raw scan)');

  // --- T5: auth fail-closed ---
  console.log('\nTest 5: missing Access JWT rejected...');
  const reqNoAuth = new Request('https://lic.eqt.net.im/api/v1/admin/devices/live?window=1h', { method: 'GET' });
  const res5b = await handleAdminRoutes(reqNoAuth, env, ctx, new URL(reqNoAuth.url), {});
  assert(res5b.status === 401, '401 without Cf-Access-Jwt-Assertion');

  // --- T6: audit trail written for the live query ---
  console.log('\nTest 6: QUERY_LIVE_DEVICES audit row persisted...');
  await flushAudit();
  const rows = (await db.prepare("SELECT * FROM admin_audit_logs WHERE action = 'QUERY_LIVE_DEVICES'").all()).results;
  assert(rows.length >= 2, `audit rows recorded (${rows.length})`);
  const latest = rows[rows.length - 1];
  const details = JSON.parse(latest.details_json || '{}');
  assert(details.total_active_devices === 4, 'audit details carry total_active_devices=4');

  console.log('\n🎉🎉 ALL /api/v1/admin/devices/live OFFLINE TESTS PASSED DETERMINISTICALLY! 🎉🎉');
}

runTests().catch((err) => {
  console.error('\n❌ TEST RUN FAILED:', err);
  process.exit(1);
});
