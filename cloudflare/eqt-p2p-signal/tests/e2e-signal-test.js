/**
 * E2E Contract & Integration Test Suite for eqt-p2p-signal Worker
 */

const assert = require('assert');
const http = require('http');

// Simple mock runner in Node.js
const workerModule = require('../src/index.ts');

// Minimal mock environment
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
          if (code === 'EQT-PRO-EXPIRED-2026') {
            return { license_code: code, tier: 'PRO', status: 'active', expires_at: '2020-01-01T00:00:00Z' };
          }
          return null;
        }
      })
    })
  }
};

async function testSuite() {
  console.log('🧪 Starting E2E Tests for eqt-p2p-signal Worker...\n');
  const fetchFn = workerModule.default.fetch;

  // Helper request function
  async function request(path, options = {}) {
    const headers = new Headers(options.headers || {});
    const req = new Request(`http://localhost${path}`, {
      method: options.method || 'GET',
      headers: headers,
      body: options.body ? JSON.stringify(options.body) : null
    });
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
  assert.strictEqual(healthRes.json.status, 'ok');
  assert.strictEqual(healthRes.json.service, 'eqt-p2p-signal');
  console.log('   ✅ Health Probe passed.');

  // Test 2: Missing License Code
  console.log('2. Testing /room/create without License Code...');
  const noLicRes = await request('/api/v1/p2p/room/create', { method: 'POST' });
  assert.strictEqual(noLicRes.status, 400);
  assert.strictEqual(noLicRes.json.error, 'missing_license_code');
  console.log('   ✅ Missing License Code correctly rejected (400).');

  // Test 3: Plus License (Non-Pro) Rejection
  console.log('3. Testing /room/create with Non-Pro License (PLUS)...');
  const plusRes = await request('/api/v1/p2p/room/create', {
    method: 'POST',
    headers: { 'X-License-Code': 'EQT-PLUS-VALID-2026' }
  });
  assert.strictEqual(plusRes.status, 403);
  assert.strictEqual(plusRes.json.error, 'pro_tier_required');
  console.log('   ✅ Plus Tier License correctly rejected for Pro P2P (403).');

  // Test 4: Expired Pro License Rejection
  console.log('4. Testing /room/create with Expired Pro License...');
  const expRes = await request('/api/v1/p2p/room/create', {
    method: 'POST',
    headers: { 'X-License-Code': 'EQT-PRO-EXPIRED-2026' }
  });
  assert.strictEqual(expRes.status, 403);
  assert.strictEqual(expRes.json.error, 'license_expired');
  console.log('   ✅ Expired Pro License correctly rejected (403).');

  // Test 5: Valid Pro License Room Creation
  console.log('5. Testing /room/create with Valid Pro License...');
  const createRes = await request('/api/v1/p2p/room/create', {
    method: 'POST',
    headers: { 'X-License-Code': 'EQT-PRO-VALID-2026' }
  });
  assert.strictEqual(createRes.status, 200);
  assert.strictEqual(createRes.json.code, 200);
  const { room_id, host_token, client_token, stun_servers } = createRes.json.data;
  assert.ok(room_id && room_id.length === 8);
  assert.ok(host_token.startsWith('tok_host_'));
  assert.ok(client_token.startsWith('tok_client_'));
  assert.ok(Array.isArray(stun_servers) && stun_servers.includes('stun:stun.qq.com:3478'));
  console.log(`   ✅ Room created successfully! Room ID: ${room_id}`);

  // Test 6: Join Room
  console.log('6. Testing /room/join...');
  const joinRes = await request('/api/v1/p2p/room/join', {
    method: 'POST',
    body: { room_id }
  });
  assert.strictEqual(joinRes.status, 200);
  assert.strictEqual(joinRes.json.data.client_token, client_token);
  console.log('   ✅ Join room passed.');

  // Test 7: Push & Poll Signaling (Offer -> Answer)
  console.log('7. Testing Signaling Exchange (Push SDP Offer -> Poll -> Push Answer -> Poll)...');
  
  // Host pushes Offer
  const offerPayload = JSON.stringify({ type: 'offer', sdp: 'v=0\r\ntest-sdp-offer' });
  const pushOfferRes = await request('/api/v1/p2p/signal/push', {
    method: 'POST',
    headers: { 'X-Room-Token': host_token },
    body: { room_id, type: 'offer', payload: offerPayload }
  });
  assert.strictEqual(pushOfferRes.status, 200);

  // Client polls Offer
  const clientPollRes = await request(`/api/v1/p2p/signal/poll?room_id=${room_id}&since=0`, {
    headers: { 'X-Room-Token': client_token }
  });
  assert.strictEqual(clientPollRes.status, 200);
  assert.strictEqual(clientPollRes.json.data.signals.length, 1);
  assert.strictEqual(clientPollRes.json.data.signals[0].sender, 'host');
  assert.strictEqual(clientPollRes.json.data.signals[0].payload, offerPayload);

  // Client pushes Answer
  const answerPayload = JSON.stringify({ type: 'answer', sdp: 'v=0\r\ntest-sdp-answer' });
  const pushAnswerRes = await request('/api/v1/p2p/signal/push', {
    method: 'POST',
    headers: { 'X-Room-Token': client_token },
    body: { room_id, type: 'answer', payload: answerPayload }
  });
  assert.strictEqual(pushAnswerRes.status, 200);

  // Host polls Answer
  const hostPollRes = await request(`/api/v1/p2p/signal/poll?room_id=${room_id}&since=0`, {
    headers: { 'X-Room-Token': host_token }
  });
  assert.strictEqual(hostPollRes.status, 200);
  assert.strictEqual(hostPollRes.json.data.signals.length, 1);
  assert.strictEqual(hostPollRes.json.data.signals[0].sender, 'client');
  assert.strictEqual(hostPollRes.json.data.signals[0].payload, answerPayload);

  console.log('   ✅ SDP Offer/Answer signaling exchange passed.');

  // Test 8: Room Destruction
  console.log('8. Testing /room destruction...');
  const destroyRes = await request(`/api/v1/p2p/room?room_id=${room_id}`, {
    method: 'DELETE',
    headers: { 'X-Room-Token': host_token }
  });
  assert.strictEqual(destroyRes.status, 200);

  // Verify Room is gone
  const pollAfterDestroy = await request(`/api/v1/p2p/signal/poll?room_id=${room_id}&since=0`, {
    headers: { 'X-Room-Token': host_token }
  });
  assert.strictEqual(pollAfterDestroy.status, 404);
  console.log('   ✅ Room destruction verified.');

  console.log('\n🎉 ALL E2E CONTRACT TESTS PASSED DETERMINISTICALLY!');
}

testSuite().catch((err) => {
  console.error('❌ E2E Test Failed:', err);
  process.exit(1);
});
