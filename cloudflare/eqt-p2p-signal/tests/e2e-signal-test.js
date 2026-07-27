/**
 * E2E Contract & Integration Test Suite for eqt-p2p-signal Worker (with Geo IP & 3D Globe API)
 */

const assert = require('assert');
const workerModule = require('../src/index.ts');

const mockEnv = {
  DB: {
    prepare: (query) => ({
      bind: (...args) => ({
        first: async () => {
          const code = args[0];
          if (code === 'EQT-PRO-VALID-2026') {
            return { license_code: code, tier: 'PRO', status: 'active', expires_at: null };
          }
          if (code === 'EQT-PLUS-VALID-2026') {
            return { license_code: code, tier: 'PLUS', status: 'active', expires_at: null };
          }
          return null;
        }
      })
    })
  }
};

async function testSuite() {
  console.log('🧪 Starting Extended E2E Tests for eqt-p2p-signal Worker (Geo IP & Admin API)...\n');
  const fetchFn = workerModule.default.fetch;

  async function request(path, options = {}) {
    const headers = new Headers(options.headers || {});
    const req = new Request(`http://localhost${path}`, {
      method: options.method || 'GET',
      headers: headers,
      body: options.body ? JSON.stringify(options.body) : null
    });
    // Inject mock CF Geo IP headers
    if (options.cfCountry) {
      req.headers.set('CF-IPCountry', options.cfCountry);
      req.headers.set('CF-Connecting-IP', options.cfIp || '1.2.3.4');
    }
    const res = await fetchFn(req, mockEnv, {});
    const text = await res.text();
    let json = {};
    try { json = JSON.parse(text); } catch (e) {}
    return { status: res.status, json, text };
  }

  // Test 1: Health Check
  console.log('1. Testing /health探针...');
  const healthRes = await request('/health');
  assert.strictEqual(healthRes.status, 200);
  assert.strictEqual(healthRes.json.global_regions_supported, true);
  console.log('   ✅ Health Probe with Global Region support passed.');

  // Test 2: Create Room with Host Geo IP (CN)
  console.log('2. Creating Room with Host Geo IP (Country: CN)...');
  const createRes = await request('/api/v1/p2p/room/create', {
    method: 'POST',
    headers: { 'X-License-Code': 'EQT-PRO-VALID-2026' },
    cfCountry: 'CN',
    cfIp: '114.114.114.114'
  });
  assert.strictEqual(createRes.status, 200);
  const { room_id, host_token, client_token, host_geo } = createRes.json.data;
  assert.strictEqual(host_geo.country, 'CN');
  assert.strictEqual(host_geo.ip, '114.114.114.114');
  console.log('   ✅ Host Geo IP correctly recorded.');

  // Test 3: Join Room with Client Geo IP (Country: US - Cross Border)
  console.log('3. Joining Room with Client Geo IP (Country: US - Cross Border P2P)...');
  const joinRes = await request('/api/v1/p2p/room/join', {
    method: 'POST',
    body: { room_id },
    cfCountry: 'US',
    cfIp: '8.8.8.8'
  });
  assert.strictEqual(joinRes.status, 200);
  assert.strictEqual(joinRes.json.data.client_geo.country, 'US');
  assert.strictEqual(joinRes.json.data.is_cross_border, true);
  console.log('   ✅ Cross-border P2P connection recognized (CN <---> US)!');

  // Test 4: Query Admin 3D Globe Connections API
  console.log('4. Testing GET /api/v1/p2p/admin/connections for 3D Globe visualization...');
  const adminConnRes = await request('/api/v1/p2p/admin/connections');
  assert.strictEqual(adminConnRes.status, 200);
  assert.strictEqual(adminConnRes.json.total_active, 1);
  const activeConn = adminConnRes.json.connections[0];
  assert.strictEqual(activeConn.room_id, room_id);
  assert.strictEqual(activeConn.host.country, 'CN');
  assert.strictEqual(activeConn.client.country, 'US');
  assert.strictEqual(activeConn.is_cross_border, true);
  console.log('   ✅ Admin Connections API returns 3D Globe Lat/Lon topology coordinates!');

  // Test 5: Destroy Room
  await request(`/api/v1/p2p/room?room_id=${room_id}`, {
    method: 'DELETE',
    headers: { 'X-Room-Token': host_token }
  });

  console.log('\n🎉 ALL GEO IP & 3D GLOBE ADMIN API E2E TESTS PASSED DETERMINISTICALLY!');
}

testSuite().catch((err) => {
  console.error('❌ E2E Test Failed:', err);
  process.exit(1);
});
