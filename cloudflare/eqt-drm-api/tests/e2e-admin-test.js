const http = require('http');
const https = require('https');
const { URL } = require('url');
const { spawn } = require('child_process');
const path = require('path');

const TARGET_URL = process.env.TEST_TARGET_URL || 'http://127.0.0.1:8787';
const ADMIN_SECRET = process.env.TEST_ADMIN_SECRET || 'test-admin-secret';

console.log("=== EQT ADMIN API CONTRACT E2E TEST SUITE ===");
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

    const req = client.request(fullUrl, {
      method: method,
      headers: reqHeaders
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

async function ensureServerRunning() {
  try {
    await makeRequest('/api/v1/admin/health', 'GET');
    console.log("✓ Target server is already active at", TARGET_URL);
    return null;
  } catch (e) {
    console.log("No running server detected. Auto-launching local wrangler dev...");
    const projectRoot = path.join(__dirname, '..');
    const child = spawn('npx', ['wrangler', 'dev', '--local', '--port', '8787', '--var', `ADMIN_SECRET:${ADMIN_SECRET}`], {
      cwd: projectRoot,
      stdio: 'pipe',
      env: { ...process.env, CLOUDFLARE_API_TOKEN: "" }
    });

    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 600));
      try {
        await makeRequest('/api/v1/admin/health', 'GET');
        console.log("✓ Local wrangler dev server successfully spawned and ready.");
        return child;
      } catch (err) {
        // Polling until ready
      }
    }
    child.kill('SIGKILL');
    throw new Error("Timed out waiting for wrangler dev server to respond.");
  }
}

async function runAdminTestSuite() {
  let createdLicenseCode = null;

  // 1. Auth Interception Check (Missing / Invalid Header)
  logStep(1, "Authentication Fail-Closed Interception");
  const noAuthRes = await makeRequest('/api/v1/admin/health', 'GET');
  console.log("No Auth Header Status:", noAuthRes.status, "Response:", noAuthRes.data);
  if (noAuthRes.status !== 401 && noAuthRes.status !== 503) {
    throw new Error(`Expected 401/503 for missing admin secret header, got ${noAuthRes.status}`);
  }
  console.log("✓ Correctly intercepted request with missing X-Admin-Secret header.");

  const wrongAuthRes = await makeRequest('/api/v1/admin/health', 'GET', {
    'X-Admin-Secret': 'invalid-secret-key-12345'
  });
  console.log("Invalid Auth Header Status:", wrongAuthRes.status);
  if (wrongAuthRes.status !== 401) {
    throw new Error(`Expected 401 for wrong admin secret, got ${wrongAuthRes.status}`);
  }
  console.log("✓ Correctly intercepted request with wrong X-Admin-Secret header.");

  // 2. Health Probe Check
  logStep(2, "System Health Probe Check");
  const healthRes = await makeRequest('/api/v1/admin/health', 'GET', {
    'X-Admin-Secret': ADMIN_SECRET
  });
  console.log("Health Status:", healthRes.status, "Metrics:", healthRes.data.metrics);
  if (healthRes.status !== 200 || !healthRes.data.success || !healthRes.data.config) {
    throw new Error(`System health probe failed: ${JSON.stringify(healthRes.data)}`);
  }
  console.log("✓ Health probe returned valid metrics and config badges.");

  // 3. Manual License Generation
  logStep(3, "Manual License Generation (POST /admin/generate with buyer_email)");
  const genRes = await makeRequest('/api/v1/admin/generate', 'POST', {
    'X-Admin-Secret': ADMIN_SECRET
  }, {
    tier: 'PLUS',
    max_devices: 2,
    expires_in_days: 30,
    buyer_email: 'testbuyer@example.com',
    send_email: false
  });
  console.log("Generate License Status:", genRes.status, "Data:", genRes.data);
  if (genRes.status !== 200 || !genRes.data.success || !genRes.data.license_code || genRes.data.buyer_email !== 'testbuyer@example.com') {
    throw new Error(`Generate license failed: ${JSON.stringify(genRes.data)}`);
  }
  createdLicenseCode = genRes.data.license_code;
  console.log(`✓ License generated successfully with buyer_email: ${createdLicenseCode}`);

  // 4. Search Licenses (Batch IN activations query test)
  logStep(4, "License Listing & Search (GET /admin/licenses - Optimized Batch Query)");
  const searchRes = await makeRequest(`/api/v1/admin/licenses?q=testbuyer@example.com`, 'GET', {
    'X-Admin-Secret': ADMIN_SECRET
  });
  console.log("Search Status:", searchRes.status, "Result Count:", searchRes.data.licenses?.length);
  if (searchRes.status !== 200 || !searchRes.data.licenses || searchRes.data.licenses.length === 0) {
    throw new Error(`Search license failed: ${JSON.stringify(searchRes.data)}`);
  }
  const foundLic = searchRes.data.licenses[0];
  if (foundLic.license_code !== createdLicenseCode) {
    throw new Error(`Found license code mismatch! Expected ${createdLicenseCode}, got ${foundLic.license_code}`);
  }
  console.log("✓ License search by buyer_email successfully returned created license.");

  // 5. Revoke Non-Existent License (404 Check)
  logStep(5, "Revoke Non-Existent License (404 Check)");
  const nonExistRevokeRes = await makeRequest('/api/v1/admin/revoke', 'POST', {
    'X-Admin-Secret': ADMIN_SECRET
  }, {
    license_code: 'EQT-NONEXISTENT-CODE-99999'
  });
  console.log("Revoke Non-Existent Status:", nonExistRevokeRes.status, "Response:", nonExistRevokeRes.data);
  if (nonExistRevokeRes.status !== 404) {
    throw new Error(`Expected 404 for non-existent license revoke, got ${nonExistRevokeRes.status}`);
  }
  console.log("✓ Correctly returned 404 for revoking non-existent license.");

  // 6. Revoke License
  logStep(6, "Revoke Existing License (POST /admin/revoke)");
  const revokeRes = await makeRequest('/api/v1/admin/revoke', 'POST', {
    'X-Admin-Secret': ADMIN_SECRET
  }, {
    license_code: createdLicenseCode
  });
  console.log("Revoke Status:", revokeRes.status, "Response:", revokeRes.data);
  if (revokeRes.status !== 200 || !revokeRes.data.success || revokeRes.data.status !== 'revoked') {
    throw new Error(`Revoke license failed: ${JSON.stringify(revokeRes.data)}`);
  }
  console.log("✓ License status successfully updated to revoked.");

  // 7. Unbind Device Test
  logStep(7, "Unbind Device Test (POST /admin/unbind)");
  const unbindRes = await makeRequest('/api/v1/admin/unbind', 'POST', {
    'X-Admin-Secret': ADMIN_SECRET
  }, {
    license_code: createdLicenseCode
  });
  console.log("Unbind Status:", unbindRes.status, "Response:", unbindRes.data);
  if (unbindRes.status !== 200 || !unbindRes.data.success) {
    throw new Error(`Unbind device failed: ${JSON.stringify(unbindRes.data)}`);
  }
  console.log("✓ Admin device unbind executed successfully.");

  // 8. Fetch & Clear System Error Logs (Server-side Filter & Pagination)
  logStep(8, "Fetch & Clear Error Logs (Server-Side Filter & Pagination)");
  const logsRes = await makeRequest('/api/v1/admin/error-logs?level=ALL&limit=10&offset=0', 'GET', {
    'X-Admin-Secret': ADMIN_SECRET
  });
  console.log("Fetch Error Logs Status:", logsRes.status, "Data:", {
    count: logsRes.data.logs?.length,
    total: logsRes.data.total,
    limit: logsRes.data.limit,
    offset: logsRes.data.offset
  });
  if (logsRes.status !== 200 || !logsRes.data.logs || typeof logsRes.data.total !== 'number') {
    throw new Error(`Fetch error logs failed: ${JSON.stringify(logsRes.data)}`);
  }

  const clearRes = await makeRequest('/api/v1/admin/error-logs', 'DELETE', {
    'X-Admin-Secret': ADMIN_SECRET
  });
  console.log("Clear Error Logs Status:", clearRes.status, "Response:", clearRes.data);
  if (clearRes.status !== 200 || !clearRes.data.success) {
    throw new Error(`Clear error logs failed: ${JSON.stringify(clearRes.data)}`);
  }
  console.log("✓ Server-side error logs filter, total count & clear executed successfully.");

  // 9. Fetch Admin Operation Audit Logs
  logStep(9, "Fetch Admin Operation Audit Logs (GET /admin/audit-logs)");
  const auditRes = await makeRequest('/api/v1/admin/audit-logs?limit=20', 'GET', {
    'X-Admin-Secret': ADMIN_SECRET
  });
  console.log("Audit Logs Status:", auditRes.status, "Logs Count:", auditRes.data.logs?.length, "Total:", auditRes.data.total);
  if (auditRes.status !== 200 || !auditRes.data.success || !Array.isArray(auditRes.data.logs)) {
    throw new Error(`Fetch audit logs failed: ${JSON.stringify(auditRes.data)}`);
  }
  if (auditRes.data.logs.length === 0) {
    throw new Error(`Expected admin audit logs to be recorded for high-privilege actions, but got 0`);
  }
  console.log("✓ Admin operation audit logs successfully queried with actions logged:", auditRes.data.logs.map(l => l.action).join(', '));

  console.log("\n==================================================");
  console.log("🎉🎉 ALL ADMIN API CONTRACT TESTS PASSED DETERMINISTICALLY! 🎉🎉");
  console.log("==================================================");

}

async function main() {
  let child = null;
  try {
    child = await ensureServerRunning();
    await runAdminTestSuite();
  } catch (err) {
    console.error("\n❌ ADMIN E2E TEST SUITE FAILED:", err);
    process.exitCode = 1;
  } finally {
    if (child) {
      console.log("[Teardown] Terminating auto-launched wrangler process...");
      child.kill('SIGINT');
    }
  }
}

main();
