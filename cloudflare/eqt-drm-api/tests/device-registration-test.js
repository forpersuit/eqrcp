const https = require('https');
const crypto = require('crypto');

function makeRequest(path, headers = {}, body = null, method = 'POST') {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : '';
    const hostname = process.env.TARGET_HOST || 'lic.eqt.net.im';
    const req = https.request({
      hostname: hostname,
      port: 443,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        ...headers,
      }
    }, (res) => {
      let respData = '';
      res.on('data', chunk => respData += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(respData) });
        } catch (e) {
          resolve({ status: res.statusCode, raw: respData });
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(15000, () => {
      req.destroy(new Error(`Request timed out: ${method} ${path}`));
    });
    if (data) req.write(data);
    req.end();
  });
}

/** Pure JS unit test for fingerprint matching rule & device_id generator */
function matchRegistryFingerprint(reqUuid, reqCpu, reqDisk, dbUuid, dbCpu, dbDisk) {
  const reqU = (reqUuid || '').trim();
  const reqC = (reqCpu || '').trim();
  const reqD = (reqDisk || '').trim();
  const dbU = (dbUuid || '').trim();
  const dbC = (dbCpu || '').trim();
  const dbD = (dbDisk || '').trim();

  let compareCount = 0;
  if (reqU && dbU) {
    if (reqU !== dbU) return false;
    compareCount++;
  }
  if (reqC && dbC) {
    if (reqC !== dbC) return false;
    compareCount++;
  }
  if (reqD && dbD) {
    if (reqD !== dbD) return false;
    compareCount++;
  }
  return compareCount > 0;
}

function runLocalFingerprintTests() {
  console.log('===> [1/4] Running Local Fingerprint Matching & Logic Tests...');

  // 1. Same non-empty components must match
  if (!matchRegistryFingerprint('u1', 'c1', 'd1', 'u1', 'c1', 'd1')) {
    throw new Error('Identical fingerprints failed to match');
  }

  // 2. Partial overlap with missing fields must match
  if (!matchRegistryFingerprint('u1', '', 'd1', 'u1', 'c2_diff_but_empty_req', 'd1')) {
    throw new Error('Overlap with missing components failed to match');
  }

  // 3. Conflict in any shared non-empty component must fail
  if (matchRegistryFingerprint('u1', 'c1', 'd1', 'u1', 'c_DIFFERENT', 'd1')) {
    throw new Error('Conflicting component should have been rejected');
  }

  // 4. All empty must fail
  if (matchRegistryFingerprint('', '', '', '', '', '')) {
    throw new Error('All empty components should not match');
  }

  console.log('✓ Local Fingerprint Logic Tests Passed!');
}

async function runOnlineEndpointTests() {
  console.log('===> [2/4] Running Live Device Registration Endpoints Tests...');

  const randomHash = () => crypto.createHash('sha256').update(Math.random().toString()).digest('hex');
  const u1 = randomHash();
  const c1 = randomHash();
  const d1 = randomHash();

  // Test 1: First-time device registration
  const reg1 = await makeRequest('/api/v1/device/register', {}, {
    uuid_hash: u1,
    cpu_hash: c1,
    disk_hash: d1,
    app_version: '1.18.0',
    lang: 'zh'
  });

  console.log(`[DEBUG] Endpoint Response: status=${reg1.status}, data=`, reg1.data || reg1.raw);

  if (reg1.status !== 200 || !reg1.data || !reg1.data.device_id || reg1.data.tier !== 'free') {
    throw new Error(`Device register failed: status=${reg1.status}, data=${JSON.stringify(reg1.data || reg1.raw)}`);
  }
  const assignedDeviceId = reg1.data.device_id;
  console.log(`✓ First-time register OK! Assigned device_id: ${assignedDeviceId}`);

  // Test 2: Second registration with SAME fingerprints -> Must reuse same device_id
  const reg2 = await makeRequest('/api/v1/device/register', {}, {
    uuid_hash: u1,
    cpu_hash: c1,
    disk_hash: d1,
    app_version: '1.18.0',
    lang: 'zh'
  });

  if (reg2.status !== 200 || reg2.data.device_id !== assignedDeviceId) {
    throw new Error(`Device register reuse failed! Expected ${assignedDeviceId}, got ${reg2.data.device_id}`);
  }
  console.log(`✓ Re-register reuse OK! Reused device_id: ${reg2.data.device_id}`);

  // Test 3: Registration with DIFFERENT fingerprints -> Must assign new device_id
  const u2 = randomHash();
  const reg3 = await makeRequest('/api/v1/device/register', {}, {
    uuid_hash: u2,
    cpu_hash: randomHash(),
    disk_hash: randomHash(),
    app_version: '1.18.0'
  });
  if (reg3.status !== 200 || reg3.data.device_id === assignedDeviceId) {
    throw new Error(`Device register separation failed! Got duplicate ID: ${reg3.data.device_id}`);
  }
  console.log(`✓ Different device registration OK! Assigned new device_id: ${reg3.data.device_id}`);

  // Test 4: All-empty fingerprints check-in (free) -> Skip registration
  const regEmpty = await makeRequest('/api/v1/device/register', {}, {
    uuid_hash: '',
    cpu_hash: '',
    disk_hash: ''
  });
  if (regEmpty.status !== 200 || regEmpty.data.device_id !== '') {
    throw new Error(`All-empty register should skip registration, got: ${JSON.stringify(regEmpty.data)}`);
  }
  console.log(`✓ All-empty check-in skip OK!`);
}

async function runZeroComponentActivationTest() {
  console.log('===> [3/4] Running 0-Component Activation Rejection Test...');
  const res = await makeRequest('/api/v1/activate', {}, {
    license_code: 'TEST-DUMMY-CODE',
    uuid_hash: '',
    cpu_hash: '',
    disk_hash: ''
  });

  if (res.status !== 400 || !res.data.error) {
    throw new Error(`Expected 400 rejection for 0-component activation, got status ${res.status}`);
  }
  console.log(`✓ 0-component activation rejection OK! Error: "${res.data.error}"`);
}

async function runRateLimitTest() {
  console.log('===> [4/4] Running IP+Fingerprint Device Register Rate Limit Test...');
  const randomHash = () => crypto.createHash('sha256').update(Math.random().toString()).digest('hex');
  const u = randomHash();
  const c = randomHash();
  const d = randomHash();

  let blocked = false;
  for (let i = 0; i < 12; i++) {
    const res = await makeRequest('/api/v1/device/register', {}, {
      uuid_hash: u,
      cpu_hash: c,
      disk_hash: d
    });
    if (res.status === 429 && res.data?.reason_key === 'rate_limited') {
      blocked = true;
      break;
    }
  }

  if (!blocked) {
    throw new Error('Rate limiter failed to block excessive registration requests!');
  }
  console.log('✓ IP+Fingerprint rate limit successfully triggered 429 Too Many Requests!');
}

async function main() {
  try {
    runLocalFingerprintTests();
    await runOnlineEndpointTests();
    await runZeroComponentActivationTest();
    await runRateLimitTest();
    console.log('\n========================================');
    console.log('🎉 ALL M1 DEVICE REGISTRATION TESTS PASSED!');
    console.log('========================================');
  } catch (err) {
    console.error('\n❌ TEST FAILED:', err.message);
    process.exit(1);
  }
}

main();
