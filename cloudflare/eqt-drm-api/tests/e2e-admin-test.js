const http = require('http');
const https = require('https');
const { URL } = require('url');
const { spawn, execSync } = require('child_process');
const path = require('path');

const TARGET_URL = process.env.TEST_TARGET_URL || 'http://127.0.0.1:8787';
const LOCAL_JWT = process.env.TEST_ADMIN_JWT || 'local.admin@eqt.net.im';
const PROJECT_ROOT = path.join(__dirname, '..');

/** Health config keys required by docs/admin/api-contract.md + admin SPA */
const REQUIRED_HEALTH_CONFIG_KEYS = [
  'db_status',
  'smtp_configured',
  'paddle_configured',
  'r2_configured'
];
const REQUIRED_HEALTH_METRIC_KEYS = [
  'total_licenses',
  'active_licenses',
  'today_activations',
  'total_error_logs',
  'errors_24h'
];

console.log('=== EQT ADMIN API CONTRACT E2E TEST SUITE ===');
console.log(`Target URL: ${TARGET_URL}`);
console.log(`Timestamp: ${new Date().toISOString()}`);

function makeRequest(pathStr, method = 'GET', headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const fullUrl = new URL(pathStr, TARGET_URL);
    const client = fullUrl.protocol === 'https:' ? https : http;
    const postData = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : '';

    const reqHeaders = {
      'Content-Type': 'application/json',
      ...headers
    };
    if (postData) {
      reqHeaders['Content-Length'] = Buffer.byteLength(postData);
    }

    const req = client.request(
      fullUrl,
      {
        method: method,
        headers: reqHeaders
      },
      (res) => {
        let respData = '';
        res.on('data', (chunk) => (respData += chunk));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, data: JSON.parse(respData), headers: res.headers });
          } catch (e) {
            resolve({ status: res.statusCode, raw: respData, headers: res.headers });
          }
        });
      }
    );

    req.on('error', reject);
    req.setTimeout(8000, () => {
      req.destroy(new Error(`Timeout connecting to ${method} ${pathStr}`));
    });

    if (postData) req.write(postData);
    req.end();
  });
}

function logStep(stepNum, title) {
  console.log(`\n==================================================`);
  console.log(`[ADMIN E2E TEST STEP ${stepNum}] ${title}`);
  console.log(`==================================================`);
}

function authHeaders() {
  return { 'Cf-Access-Jwt-Assertion': LOCAL_JWT };
}

/** Insert a row into local D1 (wrangler --local). Used when activate needs Ed25519. */
function insertLocalActivation(licenseCode, deviceId) {
  const now = new Date().toISOString();
  const sql =
    `INSERT INTO activations (license_code, uuid_hash, cpu_hash, disk_hash, device_id, activated_at) ` +
    `VALUES ('${licenseCode}', 'uuid-e2e-hash-001', 'cpu-e2e-hash-001', 'disk-e2e-hash-001', '${deviceId}', '${now}')`;
  execSync(`npx wrangler d1 execute eqt-drm-db --local --command "${sql.replace(/"/g, '\\"')}"`, {
    cwd: PROJECT_ROOT,
    stdio: 'pipe',
    env: { ...process.env, CLOUDFLARE_API_TOKEN: '' }
  });
}

function insertLocalErrorLog(level, category, message) {
  const now = new Date().toISOString();
  const msg = message.replace(/'/g, "''");
  const sql =
    `INSERT INTO system_error_logs (level, category, error_message, context_json, created_at) ` +
    `VALUES ('${level}', '${category}', '${msg}', '{"e2e":true}', '${now}')`;
  execSync(`npx wrangler d1 execute eqt-drm-db --local --command "${sql.replace(/"/g, '\\"')}"`, {
    cwd: PROJECT_ROOT,
    stdio: 'pipe',
    env: { ...process.env, CLOUDFLARE_API_TOKEN: '' }
  });
}

async function ensureServerRunning() {
  // Probe public index (no admin auth) so readiness never burns rate-limit budget.
  try {
    await makeRequest('/', 'GET');
    console.log('✓ Target server is already active at', TARGET_URL);
    return null;
  } catch (e) {
    console.log('No running server detected. Auto-launching local wrangler dev...');
    const child = spawn(
      'npx',
      [
        'wrangler', 'dev', '--local', '--port', '8787',
        '--var', 'CF_ACCESS_TEAM_DOMAIN:local.dev',
        '--var', 'CF_ACCESS_AUD:local-dev',
        '--var', 'CF_ACCESS_ALLOWED_EMAILS:admin@eqt.net.im'
      ],
      {
        cwd: PROJECT_ROOT,
        stdio: 'pipe',
        env: { ...process.env, CLOUDFLARE_API_TOKEN: '' }
      }
    );

    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 600));
      try {
        await makeRequest('/', 'GET');
        console.log('✓ Local wrangler dev server successfully spawned and ready.');
        return child;
      } catch (err) {
        // keep polling
      }
    }
    child.kill('SIGKILL');
    throw new Error('Timed out waiting for wrangler dev server to respond.');
  }
}

async function runAdminTestSuite() {
  let createdLicenseCode = null;
  let activationId = null;

  // 1. Auth — Access JWT only
  logStep(1, 'Authentication Fail-Closed (Access JWT required)');
  const noAuthRes = await makeRequest('/api/v1/admin/health', 'GET');
  console.log('No Auth Header Status:', noAuthRes.status, 'Response:', noAuthRes.data);
  if (noAuthRes.status !== 401 && noAuthRes.status !== 503) {
    throw new Error(`Expected 401/503 for missing JWT, got ${noAuthRes.status}`);
  }
  console.log('✓ Missing Cf-Access-Jwt-Assertion rejected.');

  const secretHeaderRes = await makeRequest('/api/v1/admin/health', 'GET', {
    'X-Admin-Secret': 'should-not-work-anymore'
  });
  if (secretHeaderRes.status === 200) {
    throw new Error('X-Admin-Secret must not grant access after secret removal');
  }
  console.log('✓ X-Admin-Secret alone rejected (status', secretHeaderRes.status + ').');

  const badJwtRes = await makeRequest('/api/v1/admin/health', 'GET', {
    'Cf-Access-Jwt-Assertion': 'local.not-allowed@example.com'
  });
  if (badJwtRes.status === 200) {
    throw new Error('Disallowed local.dev email must not authenticate');
  }
  console.log('✓ Disallowed local JWT rejected (status', badJwtRes.status + ').');

  // 2. Health contract keys + live probes shape
  logStep(2, 'System Health Probe + Config Key Contract + probes');
  const healthRes = await makeRequest('/api/v1/admin/health', 'GET', authHeaders());
  console.log('Health Status:', healthRes.status, 'Metrics:', healthRes.data.metrics);
  console.log('Probes:', JSON.stringify(healthRes.data.probes));
  if (healthRes.status !== 200 || !healthRes.data.success || !healthRes.data.config) {
    throw new Error(`System health probe failed: ${JSON.stringify(healthRes.data)}`);
  }
  for (const key of REQUIRED_HEALTH_CONFIG_KEYS) {
    if (!(key in healthRes.data.config)) {
      throw new Error(`health.config missing required key: ${key}`);
    }
  }
  for (const key of REQUIRED_HEALTH_METRIC_KEYS) {
    if (!(key in healthRes.data.metrics)) {
      throw new Error(`health.metrics missing required key: ${key}`);
    }
  }
  if (typeof healthRes.data.config.smtp_configured !== 'boolean') {
    throw new Error('smtp_configured must be boolean');
  }
  if (typeof healthRes.data.config.paddle_configured !== 'boolean') {
    throw new Error('paddle_configured must be boolean');
  }
  if (typeof healthRes.data.config.r2_configured !== 'boolean') {
    throw new Error('r2_configured must be boolean');
  }
  if (!healthRes.data.probes || !healthRes.data.probes.smtp || !healthRes.data.probes.db) {
    throw new Error(`health.probes.smtp/db required: ${JSON.stringify(healthRes.data.probes)}`);
  }
  for (const name of ['smtp', 'paddle', 'db']) {
    const p = healthRes.data.probes[name];
    if (typeof p.ok !== 'boolean' || typeof p.latency_ms !== 'number') {
      throw new Error(`probe ${name} invalid shape: ${JSON.stringify(p)}`);
    }
  }
  if (!Array.isArray(healthRes.data.recent_events)) {
    throw new Error('health.recent_events must be an array');
  }
  if (!healthRes.data.probes.db.ok) {
    throw new Error(`D1 probe must pass on local wrangler: ${JSON.stringify(healthRes.data.probes.db)}`);
  }
  console.log('✓ Health config/metrics/probes/recent_events contract OK.');
  // 3. Generate
  logStep(3, 'Manual License Generation (POST /admin/generate with buyer_email)');
  const genRes = await makeRequest('/api/v1/admin/generate', 'POST', authHeaders(), {
    tier: 'PLUS',
    max_devices: 2,
    expires_in_days: 30,
    buyer_email: 'testbuyer@example.com',
    send_email: false
  });
  console.log('Generate License Status:', genRes.status, 'Data:', genRes.data);
  if (
    genRes.status !== 200 ||
    !genRes.data.success ||
    !genRes.data.license_code ||
    genRes.data.buyer_email !== 'testbuyer@example.com'
  ) {
    throw new Error(`Generate license failed: ${JSON.stringify(genRes.data)}`);
  }
  createdLicenseCode = genRes.data.license_code;
  console.log(`✓ License generated: ${createdLicenseCode}`);

  // 4. Search
  logStep(4, 'License Listing & Search (GET /admin/licenses)');
  const searchRes = await makeRequest(
    `/api/v1/admin/licenses?q=${encodeURIComponent(createdLicenseCode)}`,
    'GET',
    authHeaders()
  );
  console.log('Search Status:', searchRes.status, 'Result Count:', searchRes.data.licenses?.length);
  if (searchRes.status !== 200 || !searchRes.data.licenses?.length) {
    throw new Error(`Search license failed: ${JSON.stringify(searchRes.data)}`);
  }
  const foundLic = searchRes.data.licenses.find((l) => l.license_code === createdLicenseCode);
  if (!foundLic) {
    throw new Error(`Created license not found in search results`);
  }
  if (!Array.isArray(foundLic.activations)) {
    throw new Error('activations array missing on license row');
  }
  console.log('✓ License search by code returned created license with activations array.');

  // 5. Insert activation (local D1) + list devices
  logStep(5, 'Insert Activation + List Devices (real activation_id path prep)');
  const deviceId = `e2e-device-${Date.now()}`;
  insertLocalActivation(createdLicenseCode, deviceId);
  // brief settle for local d1
  await new Promise((r) => setTimeout(r, 300));

  const afterActSearch = await makeRequest(
    `/api/v1/admin/licenses?q=${encodeURIComponent(createdLicenseCode)}`,
    'GET',
    authHeaders()
  );
  const licWithAct = afterActSearch.data.licenses?.find((l) => l.license_code === createdLicenseCode);
  if (!licWithAct || !licWithAct.activations?.length) {
    throw new Error(
      `Expected at least 1 activation after D1 insert, got: ${JSON.stringify(licWithAct)}`
    );
  }
  activationId = licWithAct.activations[0].id;
  if (!Number.isFinite(Number(activationId))) {
    throw new Error(`Invalid activation id: ${activationId}`);
  }
  console.log(
    `✓ Activation present: id=${activationId}, devices=${licWithAct.active_devices_count}`
  );

  // 6. Unbind by activation_id
  logStep(6, 'Unbind Single Device by activation_id');
  const unbindOneRes = await makeRequest('/api/v1/admin/unbind', 'POST', authHeaders(), {
    license_code: createdLicenseCode,
    activation_id: activationId
  });
  console.log('Unbind Status:', unbindOneRes.status, 'Response:', unbindOneRes.data);
  if (
    unbindOneRes.status !== 200 ||
    !unbindOneRes.data.success ||
    Number(unbindOneRes.data.unbound_activation_id) !== Number(activationId)
  ) {
    throw new Error(`Unbind by activation_id failed: ${JSON.stringify(unbindOneRes.data)}`);
  }

  const afterUnbind = await makeRequest(
    `/api/v1/admin/licenses?q=${encodeURIComponent(createdLicenseCode)}`,
    'GET',
    authHeaders()
  );
  const licAfter = afterUnbind.data.licenses?.find((l) => l.license_code === createdLicenseCode);
  const stillThere = licAfter?.activations?.some((a) => Number(a.id) === Number(activationId));
  if (stillThere) {
    throw new Error(`Activation ${activationId} still present after unbind`);
  }
  console.log('✓ activation_id unbind removed device row from list.');

  // 7. Unbind all (empty clear path)
  logStep(7, 'Unbind All Devices (clear path without activation_id)');
  insertLocalActivation(createdLicenseCode, `e2e-device-all-${Date.now()}`);
  await new Promise((r) => setTimeout(r, 300));
  const unbindAllRes = await makeRequest('/api/v1/admin/unbind', 'POST', authHeaders(), {
    license_code: createdLicenseCode
  });
  if (unbindAllRes.status !== 200 || !unbindAllRes.data.success) {
    throw new Error(`Unbind all failed: ${JSON.stringify(unbindAllRes.data)}`);
  }
  const afterClear = await makeRequest(
    `/api/v1/admin/licenses?q=${encodeURIComponent(createdLicenseCode)}`,
    'GET',
    authHeaders()
  );
  const licCleared = afterClear.data.licenses?.find((l) => l.license_code === createdLicenseCode);
  if ((licCleared?.activations?.length || 0) !== 0) {
    throw new Error(`Expected 0 activations after clear-all, got ${licCleared?.activations?.length}`);
  }
  console.log('✓ Clear-all unbind emptied activations.');

  // 8. Revoke 404 + success
  logStep(8, 'Revoke Non-Existent (404) + Existing License');
  const nonExistRevokeRes = await makeRequest('/api/v1/admin/revoke', 'POST', authHeaders(), {
    license_code: 'EQT-NONEXISTENT-CODE-99999'
  });
  if (nonExistRevokeRes.status !== 404) {
    throw new Error(`Expected 404 for non-existent license revoke, got ${nonExistRevokeRes.status}`);
  }
  console.log('✓ 404 for non-existent revoke.');

  const revokeRes = await makeRequest('/api/v1/admin/revoke', 'POST', authHeaders(), {
    license_code: createdLicenseCode
  });
  if (revokeRes.status !== 200 || !revokeRes.data.success || revokeRes.data.status !== 'revoked') {
    throw new Error(`Revoke license failed: ${JSON.stringify(revokeRes.data)}`);
  }
  console.log('✓ License revoked.');

  // 9. Error logs filter + clear
  logStep(9, 'Error Logs Server-Side Filter + Clear');
  insertLocalErrorLog('CRITICAL', 'SERVER_EXCEPTION', 'e2e-critical-marker-alpha');
  insertLocalErrorLog('WARN', 'SMTP_ERROR', 'e2e-warn-marker-beta');
  await new Promise((r) => setTimeout(r, 300));

  const critRes = await makeRequest(
    '/api/v1/admin/error-logs?level=CRITICAL&limit=50&offset=0',
    'GET',
    authHeaders()
  );
  if (critRes.status !== 200 || typeof critRes.data.total !== 'number') {
    throw new Error(`Fetch CRITICAL logs failed: ${JSON.stringify(critRes.data)}`);
  }
  const critHit = (critRes.data.logs || []).some(
    (l) => l.level === 'CRITICAL' && String(l.error_message).includes('e2e-critical-marker-alpha')
  );
  if (!critHit) {
    throw new Error(`CRITICAL filter did not return inserted e2e log: ${JSON.stringify(critRes.data)}`);
  }

  const qRes = await makeRequest(
    '/api/v1/admin/error-logs?q=e2e-warn-marker-beta&limit=20',
    'GET',
    authHeaders()
  );
  const qHit = (qRes.data.logs || []).some((l) =>
    String(l.error_message).includes('e2e-warn-marker-beta')
  );
  if (!qHit) {
    throw new Error(`q= filter did not return inserted warn log: ${JSON.stringify(qRes.data)}`);
  }

  const catRes = await makeRequest(
    '/api/v1/admin/error-logs?category=SMTP_ERROR&limit=50',
    'GET',
    authHeaders()
  );
  const catHit = (catRes.data.logs || []).every((l) => l.category === 'SMTP_ERROR');
  if (!catHit || !(catRes.data.logs || []).length) {
    throw new Error(`category filter failed: ${JSON.stringify(catRes.data)}`);
  }
  console.log('✓ level / category / q filters return expected rows.');

  const clearRes = await makeRequest('/api/v1/admin/error-logs', 'DELETE', authHeaders());
  if (clearRes.status !== 200 || !clearRes.data.success) {
    throw new Error(`Clear error logs failed: ${JSON.stringify(clearRes.data)}`);
  }
  // POST clear alias
  const clearAlias = await makeRequest('/api/v1/admin/error-logs/clear', 'POST', authHeaders());
  if (clearAlias.status !== 200 || !clearAlias.data.success) {
    throw new Error(`POST clear alias failed: ${JSON.stringify(clearAlias.data)}`);
  }
  console.log('✓ DELETE + POST clear alias OK.');

  // CORS preflight DELETE
  const optRes = await makeRequest('/api/v1/admin/error-logs', 'OPTIONS', {
    Origin: 'http://localhost:3001',
    'Access-Control-Request-Method': 'DELETE',
    'Access-Control-Request-Headers': 'Content-Type, Cf-Access-Jwt-Assertion'
  });
  const allowMethods = String(
    optRes.headers['access-control-allow-methods'] || optRes.headers['Access-Control-Allow-Methods'] || ''
  );
  if (!/DELETE/i.test(allowMethods) && optRes.status !== 204 && optRes.status !== 200) {
    // some workers return 204 empty; if methods header present must include DELETE
    console.log('OPTIONS status:', optRes.status, 'Allow-Methods:', allowMethods);
  }
  if (allowMethods && !/DELETE/i.test(allowMethods)) {
    throw new Error(`CORS Allow-Methods missing DELETE: ${allowMethods}`);
  }
  console.log('✓ CORS OPTIONS allows DELETE (or empty handled by worker). Methods:', allowMethods || '(empty)');

  // 10. Audit logs
  logStep(10, 'Fetch Admin Operation Audit Logs');
  const auditRes = await makeRequest('/api/v1/admin/audit-logs?limit=50', 'GET', authHeaders());
  console.log(
    'Audit Logs Status:',
    auditRes.status,
    'Logs Count:',
    auditRes.data.logs?.length,
    'Total:',
    auditRes.data.total
  );
  if (auditRes.status !== 200 || !auditRes.data.success || !Array.isArray(auditRes.data.logs)) {
    throw new Error(`Fetch audit logs failed: ${JSON.stringify(auditRes.data)}`);
  }
  if (auditRes.data.logs.length === 0) {
    throw new Error('Expected admin audit logs for high-privilege actions, got 0');
  }
  const actions = auditRes.data.logs.map((l) => l.action);
  for (const need of ['GENERATE', 'UNBIND', 'REVOKE', 'CLEAR_LOGS']) {
    if (!actions.includes(need)) {
      throw new Error(`Expected audit action ${need} in recent logs, got: ${actions.join(',')}`);
    }
  }
  console.log('✓ Audit logs contain GENERATE/UNBIND/REVOKE/CLEAR_LOGS.');

  function parseDetails(row) {
    if (!row?.details_json) return null;
    try {
      return JSON.parse(row.details_json);
    } catch {
      return null;
    }
  }

  const genAudit = auditRes.data.logs.find(
    (l) => l.action === 'GENERATE' && String(l.target_id) === createdLicenseCode
  );
  const genD = parseDetails(genAudit);
  if (!genD || genD.tier !== 'PLUS' || genD.license_code !== createdLicenseCode || genD.status !== 'active') {
    throw new Error(`GENERATE audit details incomplete: ${JSON.stringify(genD)}`);
  }
  if (genD.max_devices == null || !('email_sent' in genD) || !('expires_at' in genD)) {
    throw new Error(`GENERATE audit missing fields: ${JSON.stringify(genD)}`);
  }

  const unbindSingle = auditRes.data.logs.find((l) => {
    if (l.action !== 'UNBIND') return false;
    const d = parseDetails(l);
    return d && d.mode === 'single' && d.license_code === createdLicenseCode;
  });
  const u1 = parseDetails(unbindSingle);
  if (
    !u1 ||
    u1.counts_toward_user_quota !== false ||
    Number(u1.unbound_count) !== 1 ||
    !u1.device_snapshot ||
    u1.device_snapshot.id == null
  ) {
    throw new Error(`UNBIND single audit details incomplete: ${JSON.stringify(u1)}`);
  }

  const unbindAll = auditRes.data.logs.find((l) => {
    if (l.action !== 'UNBIND') return false;
    const d = parseDetails(l);
    return d && d.mode === 'clear_all' && d.license_code === createdLicenseCode;
  });
  const u2 = parseDetails(unbindAll);
  if (!u2 || u2.counts_toward_user_quota !== false || !Array.isArray(u2.devices_snapshot)) {
    throw new Error(`UNBIND clear_all audit details incomplete: ${JSON.stringify(u2)}`);
  }

  const revAudit = auditRes.data.logs.find(
    (l) => l.action === 'REVOKE' && String(l.target_id) === createdLicenseCode
  );
  const revD = parseDetails(revAudit);
  if (!revD || revD.new_status !== 'revoked' || !('previous_status' in revD) || !('activations_snapshot' in revD)) {
    throw new Error(`REVOKE audit details incomplete: ${JSON.stringify(revD)}`);
  }

  const clearAudit = auditRes.data.logs.find((l) => l.action === 'CLEAR_LOGS');
  const clearD = parseDetails(clearAudit);
  if (!clearD || typeof clearD.cleared_error_log_count !== 'number') {
    throw new Error(`CLEAR_LOGS audit details incomplete: ${JSON.stringify(clearD)}`);
  }
  console.log('✓ Audit details_json enriched for GENERATE/UNBIND/REVOKE/CLEAR_LOGS.');

  // Manual blacklist
  logStep('BL', 'Manual blacklist email + device');
  const blEmail = `e2e-ban-${Date.now()}@example.com`;
  const blAdd = await makeRequest('/api/v1/admin/blacklist', 'POST', authHeaders(), {
    kind: 'email',
    email: blEmail,
    reason: 'e2e-test'
  });
  if (blAdd.status !== 200 || !blAdd.data?.entry?.id) {
    throw new Error(`blacklist add failed: ${JSON.stringify(blAdd.data)}`);
  }
  const blId = blAdd.data.entry.id;
  const blDev = await makeRequest('/api/v1/admin/blacklist', 'POST', authHeaders(), {
    kind: 'device',
    device_id: `DEV-E2E-${Date.now()}`,
    reason: 'e2e-device'
  });
  if (blDev.status !== 200 || !blDev.data?.entry?.id) {
    throw new Error(`blacklist device add failed: ${JSON.stringify(blDev.data)}`);
  }
  const blList = await makeRequest(
    '/api/v1/admin/blacklist?q=' + encodeURIComponent(blEmail),
    'GET',
    authHeaders()
  );
  if (blList.status !== 200 || !(blList.data.entries || []).some((e) => e.id === blId)) {
    throw new Error('blacklist list missing new email entry');
  }
  const blDel = await makeRequest(`/api/v1/admin/blacklist/${blId}`, 'DELETE', authHeaders());
  if (blDel.status !== 200 || blDel.data?.entry?.active !== 0) {
    throw new Error(`blacklist unban failed: ${JSON.stringify(blDel.data)}`);
  }
  console.log('✓ Manual blacklist add/list/unban ok.');

  console.log('\n==================================================');
  console.log('🎉🎉 ALL ADMIN API CONTRACT TESTS PASSED DETERMINISTICALLY! 🎉🎉');
  console.log('==================================================');
}

async function main() {
  let child = null;
  try {
    child = await ensureServerRunning();
    await runAdminTestSuite();
  } catch (err) {
    console.error('\n❌ ADMIN E2E TEST SUITE FAILED:', err);
    process.exitCode = 1;
  } finally {
    if (child) {
      console.log('[Teardown] Terminating auto-launched wrangler process...');
      child.kill('SIGINT');
      setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch (_) {}
      }, 2000);
    }
  }
}

main();
