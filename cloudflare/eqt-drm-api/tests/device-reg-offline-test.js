const crypto = require('crypto');

// 1. Pure JS Fingerprint match tester (3-of-2 weighted model)
function countMatchingFingerprints(clientUuid, clientCpu, clientDisk, storedUuid, storedCpu, storedDisk) {
  let matches = 0;
  if (clientUuid && storedUuid && clientUuid === storedUuid) matches++;
  if (clientCpu && storedCpu && clientCpu === storedCpu) matches++;
  if (clientDisk && storedDisk && clientDisk === storedDisk) matches++;
  return matches;
}

function matchRegistryFingerprint(reqUuid, reqCpu, reqDisk, dbUuid, dbCpu, dbDisk) {
  return countMatchingFingerprints(reqUuid, reqCpu, reqDisk, dbUuid, dbCpu, dbDisk) >= 2;
}

// 2. Pure JS Random Device ID generator
function generateRandomDeviceId() {
  return crypto.randomBytes(16).toString('hex');
}

// 3. Mock In-Memory D1 Database for device_registry
class MockD1DB {
  constructor() {
    this.deviceRegistry = new Map(); // device_id -> row
  }

  async registerOrRefresh(params, net) {
    const uuid = (params.uuidHash || '').trim();
    const cpu = (params.cpuHash || '').trim();
    const disk = (params.diskHash || '').trim();
    const tier = params.tierLabel || 'free';
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();

    if (!uuid && !cpu && !disk) {
      if (tier === 'free') {
        return { device_id: '', tier_label: 'free', skipped: true };
      }
      throw new Error('insufficient_hardware_permissions');
    }

    // Coarse + Fine filter
    let matchedRow = null;
    for (const row of this.deviceRegistry.values()) {
      if (matchRegistryFingerprint(uuid, cpu, disk, row.uuid_hash || '', row.cpu_hash || '', row.disk_hash || '')) {
        matchedRow = row;
        break;
      }
    }

    if (matchedRow) {
      const lastSeenMs = matchedRow.last_seen_at ? new Date(matchedRow.last_seen_at).getTime() : 0;
      const writeDebounceMs = 5 * 60 * 1000;
      const shouldUpdate = !lastSeenMs || (nowMs - lastSeenMs >= writeDebounceMs) || (tier === 'paid' && matchedRow.tier_label !== 'paid');

      if (shouldUpdate) {
        matchedRow.last_seen_at = nowIso;
        if (tier === 'paid') matchedRow.tier_label = 'paid';
        if (params.licenseCode) matchedRow.license_code = params.licenseCode;
        if (params.email) matchedRow.email = params.email;
        matchedRow.write_count = (matchedRow.write_count || 0) + 1;
      }
      return { device_id: matchedRow.device_id, tier_label: matchedRow.tier_label, updated: shouldUpdate };
    }

    // New device
    const newDeviceId = generateRandomDeviceId();
    const newRow = {
      device_id: newDeviceId,
      uuid_hash: uuid || null,
      cpu_hash: cpu || null,
      disk_hash: disk || null,
      tier_label: tier,
      license_code: params.licenseCode || null,
      email: params.email || null,
      registered_at: nowIso,
      last_seen_at: nowIso,
      write_count: 1
    };
    this.deviceRegistry.set(newDeviceId, newRow);
    return { device_id: newDeviceId, tier_label: tier, updated: true };
  }
}

async function runTests() {
  console.log('========================================');
  console.log('🚀 Running Offline M1 Device Registration Tests...');
  console.log('========================================\n');

  const db = new MockD1DB();
  const net = { client_ip: '127.0.0.1', ip_country: 'CN', user_agent: 'EQT-Test' };

  // Test 1: Anonymous free device registration
  console.log('Test 1: Anonymous free device registration...');
  const dev1 = await db.registerOrRefresh({ uuidHash: 'uuid-101', cpuHash: 'cpu-101', diskHash: 'disk-101' }, net);
  if (!dev1.device_id || dev1.device_id.length !== 32 || dev1.tier_label !== 'free') {
    throw new Error(`Test 1 Failed: unexpected output ${JSON.stringify(dev1)}`);
  }
  console.log(`  ✓ Registered free device with random 32-hex ID: ${dev1.device_id}`);

  // Test 2: Repeat registration with SAME fingerprints -> Reuse device_id
  console.log('\nTest 2: Repeat registration with SAME fingerprints...');
  const dev2 = await db.registerOrRefresh({ uuidHash: 'uuid-101', cpuHash: 'cpu-101', diskHash: 'disk-101' }, net);
  if (dev2.device_id !== dev1.device_id) {
    throw new Error(`Test 2 Failed: expected ${dev1.device_id}, got ${dev2.device_id}`);
  }
  if (dev2.updated) {
    throw new Error(`Test 2 Failed: 5-minute write debounce should have skipped update!`);
  }
  console.log(`  ✓ Reused device_id ${dev2.device_id} and write debounce successfully prevented DB update!`);

  // Test 3: Registration with partial overlap fingerprints -> Reuse device_id
  console.log('\nTest 3: Registration with partial overlap fingerprints...');
  const dev3 = await db.registerOrRefresh({ uuidHash: 'uuid-101', cpuHash: '', diskHash: 'disk-101' }, net);
  if (dev3.device_id !== dev1.device_id) {
    throw new Error(`Test 3 Failed: expected ${dev1.device_id}, got ${dev3.device_id}`);
  }
  console.log(`  ✓ Partial overlap matched existing device_id!`);

  // Test 4A: 1 component changed (2 of 3 match) -> Hardware drift tolerance reuses device_id
  console.log('\nTest 4A: 1 component changed (2 of 3 match)...');
  const dev4a = await db.registerOrRefresh({ uuidHash: 'uuid-101', cpuHash: 'cpu-DIFFERENT', diskHash: 'disk-101' }, net);
  if (dev4a.device_id !== dev1.device_id) {
    throw new Error(`Test 4A Failed: 2 matching components should reuse device_id!`);
  }
  console.log(`  ✓ 1 changed component (2 matches) successfully reused device_id: ${dev4a.device_id}`);

  // Test 4B: 2 components changed (only 1 match) -> Assign new device_id
  console.log('\nTest 4B: 2 components changed (only 1 match)...');
  const dev4b = await db.registerOrRefresh({ uuidHash: 'uuid-101', cpuHash: 'cpu-DIFFERENT-1', diskHash: 'disk-DIFFERENT-2' }, net);
  if (dev4b.device_id === dev1.device_id) {
    throw new Error(`Test 4B Failed: only 1 matching component should create new device!`);
  }
  console.log(`  ✓ Distinct hardware (<2 matches) properly created distinct device_id: ${dev4b.device_id}`);

  // Test 5: All-empty components for free -> Skip registration
  console.log('\nTest 5: All-empty components for free check-in...');
  const dev5 = await db.registerOrRefresh({ uuidHash: '', cpuHash: '', diskHash: '' }, net);
  if (!dev5.skipped || dev5.device_id !== '') {
    throw new Error(`Test 5 Failed: all-empty components should skip registration!`);
  }
  console.log(`  ✓ All-empty components skipped registration gracefully.`);

  // Test 6: All-empty components for paid -> Reject with 0-component error
  console.log('\nTest 6: All-empty components for paid activation...');
  let errorCaught = false;
  try {
    await db.registerOrRefresh({ uuidHash: '', cpuHash: '', diskHash: '', tierLabel: 'paid' }, net);
  } catch (e) {
    errorCaught = true;
  }
  if (!errorCaught) {
    throw new Error(`Test 6 Failed: paid activation with 0 components should throw error!`);
  }
  console.log(`  ✓ 0-component paid activation properly rejected!`);

  // Test 7: Upgrading free device to paid tier
  console.log('\nTest 7: Upgrading free device to paid tier...');
  const dev7 = await db.registerOrRefresh({
    uuidHash: 'uuid-101',
    cpuHash: 'cpu-101',
    diskHash: 'disk-101',
    tierLabel: 'paid',
    licenseCode: 'EQT-PLUS-2026-TEST',
    email: 'user@example.com'
  }, net);
  if (dev7.device_id !== dev1.device_id || dev7.tier_label !== 'paid') {
    throw new Error(`Test 7 Failed: failed to upgrade device to paid tier`);
  }
  console.log(`  ✓ Free device ${dev7.device_id} successfully upgraded to paid tier!`);

  console.log('\n========================================');
  console.log('🎉 ALL OFFLINE M1 DRM TESTS PASSED PERFECTLY!');
  console.log('========================================\n');
}

runTests().catch(err => {
  console.error('\n❌ TEST FAILED:', err);
  process.exit(1);
});
