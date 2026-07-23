const https = require('https');
const { execSync } = require('child_process');

function execWranglerSQL(sql) {
  const cmd = `CLOUDFLARE_API_TOKEN="" npx wrangler d1 execute eqt-drm-db --remote --command "${sql.replace(/"/g, '\\"')}"`;
  return execSync(cmd, { cwd: '/home/yelon/develop/me/eqrcp/cloudflare/eqt-drm-api', stdio: 'pipe' }).toString();
}

function execWranglerJSON(sql) {
  const raw = execWranglerSQL(sql);
  const idx = raw.indexOf('[');
  if (idx !== -1) {
    return JSON.parse(raw.substring(idx));
  }
  return JSON.parse(raw);
}

async function makeRequest(path, headers = {}, body = null, method = 'POST') {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : '';
    const req = https.request({
      hostname: 'lic.eqt.net.im',
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

function logStep(stepNum, title) {
  console.log(`\n==================================================`);
  console.log(`[DRM E2E TEST STEP ${stepNum}] ${title}`);
  console.log(`==================================================`);
}

async function runFullDrmTestSuite() {
  const testLic = 'E2E-FULL-TEST-LIC-888';
  const foreignLic = 'E2E-FOREIGN-LIC-999';
  const testToken = 'E2E-TEST-SESSION-TOKEN-888';
  const testEmail = 'e2e@eqt.im';
  // SHA-256 of e2e@eqt.im / other-owner@eqt.im (must match Worker crypto)
  const testEmailHash = '441c9ea7824323f12e6ae207cb21f6c91c729965b8720a741ab113a8b91ca826';
  const foreignEmailHash = '4fd79813405831cafeed58a7c6b1acbfcfe8fa8c10043a6247a62fbd8d01ec26';
  const nowIso = new Date().toISOString();
  const futureIso = new Date(Date.now() + 86400000).toISOString();

  console.log("=== STARTING CLOUDFLARE DRM COMPREHENSIVE E2E VERIFICATION ===");
  console.log("Target Domain: https://lic.eqt.net.im");
  console.log("Timestamp:", nowIso);

  try {
    // 0. Environment Setup
    logStep(0, "DB Cleanup & Fixture Injection");
    execWranglerSQL(`DELETE FROM unbind_records WHERE license_code IN ('${testLic}', '${foreignLic}');`);
    execWranglerSQL(`DELETE FROM activations WHERE license_code IN ('${testLic}', '${foreignLic}');`);
    execWranglerSQL(`DELETE FROM user_sessions WHERE session_token = '${testToken}';`);
    execWranglerSQL(`DELETE FROM verification_codes WHERE email = '${testEmail}';`);
    execWranglerSQL(`DELETE FROM licenses WHERE license_code IN ('${testLic}', '${foreignLic}');`);

    execWranglerSQL(`INSERT INTO licenses (license_code, tier, status, max_devices, expires_at, buyer_email_hash, buyer_email, created_at) VALUES ('${testLic}', 'PLUS', 'active', 2, 'LIFETIME', '${testEmailHash}', '${testEmail}', '${nowIso}');`);
    execWranglerSQL(`INSERT INTO licenses (license_code, tier, status, max_devices, expires_at, buyer_email_hash, buyer_email, created_at) VALUES ('${foreignLic}', 'PLUS', 'active', 2, 'LIFETIME', '${foreignEmailHash}', 'other-owner@eqt.im', '${nowIso}');`);
    execWranglerSQL(`INSERT INTO user_sessions (session_token, email, expires_at) VALUES ('${testToken}', '${testEmail}', '${futureIso}');`);
    console.log("✓ Fixtures successfully injected in Cloudflare D1 (Max Devices: 2, ownership email set).");

    // 1. Device Activation (First Device)
    logStep(1, "First Device Activation (Device A)");
    const devA = {
      license_code: testLic,
      uuid_hash: 'uuid-hash-dev-A',
      cpu_hash: 'cpu-hash-dev-A',
      disk_hash: 'disk-hash-dev-A'
    };
    const actResA = await makeRequest('/api/v1/activate', {}, devA);
    console.log("Device A Status:", actResA.status);
    if (actResA.status !== 200 || !actResA.data.signature) {
      throw new Error("Device A activation failed! Response: " + JSON.stringify(actResA.data));
    }
    console.log("✓ Device A successfully activated. Ed25519 Signature length:", actResA.data.signature.length);

    // 1.1 Online reconciliation must return a complete re-signed certificate.
    // /api/v1/verify returns status/tier/certificate_signature/signature (hashes are in signed payload, not response body).
    logStep("1.1", "Online Reconciliation Certificate Integrity");
    const verifyResA = await makeRequest('/api/v1/verify', {}, devA);
    if (verifyResA.status !== 200 || verifyResA.data.status !== 'OK' ||
      !verifyResA.data.certificate_signature || !verifyResA.data.signature ||
      verifyResA.data.tier !== 'PLUS' || verifyResA.data.license_code !== testLic ||
      verifyResA.data.buyer_email !== testEmail) {
      throw new Error("Online reconciliation did not return a complete re-signed certificate: " + JSON.stringify(verifyResA.data));
    }
    console.log("✓ Online reconciliation returned a complete signed certificate.");

    // 2. Re-activation (Identical Device Fingerprint - Zero Quota Consumed)
    logStep(2, "Re-activation Test (Same Device A Re-bind)");
    const reActResA = await makeRequest('/api/v1/activate', {}, devA);
    console.log("Re-activation Status:", reActResA.status);
    if (reActResA.status !== 200 || !reActResA.data.signature) {
      throw new Error("Device A re-activation failed!");
    }
    const checkActs1 = execWranglerJSON(`SELECT COUNT(*) as count FROM activations WHERE license_code = '${testLic}';`);
    const actCount1 = checkActs1[0].results[0].count;
    console.log("Activations count in D1 after re-bind:", actCount1);
    if (actCount1 !== 1) {
      throw new Error(`Expected 1 activation record for re-bind, got ${actCount1}`);
    }
    console.log("✓ Re-activation verified: Zero quota consumed, activation count remained 1.");

    // 3. Second Device Activation (Device B)
    logStep(3, "Second Device Activation (Device B)");
    const devB = {
      license_code: testLic,
      uuid_hash: 'uuid-hash-dev-B',
      cpu_hash: 'cpu-hash-dev-B',
      disk_hash: 'disk-hash-dev-B'
    };
    const actResB = await makeRequest('/api/v1/activate', {}, devB);
    console.log("Device B Status:", actResB.status);
    if (actResB.status !== 200 || !actResB.data.signature) {
      throw new Error("Device B activation failed!");
    }
    console.log("✓ Device B successfully activated.");

    // 4. Over-limit Device Activation (Device C - Max limit reached)
    logStep(4, "Over-limit Activation Interception (Device C when max=2)");
    const devC = {
      license_code: testLic,
      uuid_hash: 'uuid-hash-dev-C',
      cpu_hash: 'cpu-hash-dev-C',
      disk_hash: 'disk-hash-dev-C',
      lang: 'zh'
    };
    const actResC = await makeRequest('/api/v1/activate', {}, devC);
    console.log("Device C Status:", actResC.status, "Error Response:", actResC.data);
    if (actResC.status !== 403 || !actResC.data.error || (!actResC.data.error.includes("上限") && !actResC.data.error.includes("limit"))) {
      throw new Error("Over-limit activation check failed!");
    }
    console.log("✓ Over-limit activation successfully intercepted (403).");

    // Fetch Activation IDs for unbind test
    const actsListRaw = execWranglerJSON(`SELECT id, uuid_hash FROM activations WHERE license_code = '${testLic}' ORDER BY id ASC;`);
    const actsList = actsListRaw[0].results;
    console.log("Current Active Devices in D1:", actsList);
    const actIdA = actsList[0].id;
    const actIdB = actsList[1].id;

    // 5. Unbind Device A
    logStep(5, "Unbind Device A via User Portal API");
    const unbindResA = await makeRequest('/api/v1/user/unbind-device', { 'Authorization': `Bearer ${testToken}` }, {
      license_code: testLic,
      activation_id: actIdA,
      lang: 'zh'
    });
    console.log("Unbind Device A Status:", unbindResA.status, "Message:", unbindResA.data);
    if (unbindResA.status !== 200 || !unbindResA.data.success || unbindResA.data.remaining_unbinds !== 3) {
      throw new Error("Unbind Device A failed! Response: " + JSON.stringify(unbindResA.data));
    }
    console.log("✓ Device A unbound successfully. Remaining unbind quota: 3.");

    // 6. Bind New Device C after Unbind
    logStep(6, "Bind New Device C after Unbinding Device A");
    const actResC2 = await makeRequest('/api/v1/activate', {}, devC);
    console.log("Device C Activation Status after freed slot:", actResC2.status);
    if (actResC2.status !== 200 || !actResC2.data.signature) {
      throw new Error("Binding Device C after unbind failed!");
    }
    console.log("✓ Device C bound successfully into freed slot.");

    // 7. Test Yearly 4-Times Unbind Limit Interception
    logStep(7, "Yearly 4-Times Unbind Limit Interception Test");
    // Inject 3 mock unbind records (making total 4 unbinds)
    execWranglerSQL(`INSERT INTO unbind_records (license_code, activation_id, unbound_at) VALUES ('${testLic}', 2, '${nowIso}'), ('${testLic}', 3, '${nowIso}'), ('${testLic}', 4, '${nowIso}');`);

    // Fetch Device B or C activation ID to attempt 5th unbind
    const actsList2Raw = execWranglerJSON(`SELECT id FROM activations WHERE license_code = '${testLic}' LIMIT 1;`);
    const actIdRem = actsList2Raw[0].results[0].id;

    const unbindResLimitZh = await makeRequest('/api/v1/user/unbind-device', { 'Authorization': `Bearer ${testToken}` }, {
      license_code: testLic,
      activation_id: actIdRem,
      lang: 'zh'
    });
    console.log("5th Unbind Status (Chinese):", unbindResLimitZh.status, "Error:", unbindResLimitZh.data);
    if (unbindResLimitZh.status !== 403 || !unbindResLimitZh.data.error.includes("达到4次解绑设备上限")) {
      throw new Error("Yearly 4-times unbind limit interception failed (Chinese)!");
    }

    const unbindResLimitJa = await makeRequest('/api/v1/user/unbind-device', { 'Authorization': `Bearer ${testToken}` }, {
      license_code: testLic,
      activation_id: actIdRem,
      lang: 'ja'
    });
    console.log("5th Unbind Status (Japanese i18n):", unbindResLimitJa.status, "Error:", unbindResLimitJa.data);
    if (unbindResLimitJa.status !== 403 || !unbindResLimitJa.data.error.includes("上限")) {
      throw new Error("Yearly 4-times unbind limit interception failed (Japanese)!");
    }
    console.log("✓ 4-Times unbind limit and multi-language i18n verified 100%.");

    // 8. Portal Login Purchase Check & Pricing Bypass Test
    logStep(8, "Portal Login Purchase Check vs Pricing Send-Code Test");
    const unpurchasedEmail = 'unpurchased-e2e-user@eqt.im';

    // 8.1 Portal login send-code for unpurchased email should be rejected
    const portalAuthRes = await makeRequest('/api/v1/auth/send-code', {}, {
      email: unpurchasedEmail,
      lang: 'zh'
    });
    console.log("Portal Login Send-Code (Unpurchased Email) Status:", portalAuthRes.status, "Error:", portalAuthRes.data);
    if (portalAuthRes.status !== 400 || !portalAuthRes.data.error || !portalAuthRes.data.error.includes("未找到该邮箱的购买记录")) {
      throw new Error("Portal login send-code failed to reject unpurchased email! Response: " + JSON.stringify(portalAuthRes.data));
    }
    console.log("✓ Portal login correctly blocked unpurchased email before sending verification code.");

    // 8.2 Checkout send-code for pricing flow (unpurchased email should be allowed)
    const checkoutRes = await makeRequest('/api/v1/checkout/send-code', {}, {
      email: unpurchasedEmail,
      lang: 'zh'
    });
    console.log("Checkout Send-Code (Pricing Flow) Status:", checkoutRes.status, "Data:", checkoutRes.data);
    if (checkoutRes.status !== 200 || !checkoutRes.data.success) {
      throw new Error("Checkout send-code failed for pricing email verification! Response: " + JSON.stringify(checkoutRes.data));
    }
    console.log("✓ Checkout send-code (pricing flow) allowed unpurchased email without purchase check.");

    // 9. Cross-user unbind ownership rejection
    logStep(9, "Portal Unbind Ownership Guard (foreign license)");
    execWranglerSQL(`INSERT INTO activations (license_code, uuid_hash, cpu_hash, disk_hash, activated_at) VALUES ('${foreignLic}', 'uuid-foreign', 'cpu-foreign', 'disk-foreign', '${nowIso}');`);
    const foreignActsRaw = execWranglerJSON(`SELECT id FROM activations WHERE license_code = '${foreignLic}' LIMIT 1;`);
    const foreignActId = foreignActsRaw[0].results[0].id;
    const foreignUnbindRes = await makeRequest('/api/v1/user/unbind-device', { 'Authorization': `Bearer ${testToken}` }, {
      license_code: foreignLic,
      activation_id: foreignActId,
      lang: 'zh'
    });
    console.log("Foreign Unbind Status:", foreignUnbindRes.status, "Error:", foreignUnbindRes.data);
    if (foreignUnbindRes.status !== 403 || !foreignUnbindRes.data.error || !String(foreignUnbindRes.data.error).includes("无权")) {
      throw new Error("Cross-user unbind should be 403 not_license_owner! Response: " + JSON.stringify(foreignUnbindRes.data));
    }
    const foreignStillBound = execWranglerJSON(`SELECT COUNT(*) as count FROM activations WHERE license_code = '${foreignLic}';`);
    if (Number(foreignStillBound[0].results[0].count) !== 1) {
      throw new Error("Foreign activation must remain after ownership rejection");
    }
    console.log("✓ Cross-user unbind correctly rejected with ownership guard.");

    // 10. Portal send-code 60s rate limit (inject recent code; no real SMTP for second call)
    logStep(10, "Portal Send-Code 60s Rate Limit");
    const rateCodeExp = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    execWranglerSQL(`INSERT OR REPLACE INTO verification_codes (email, code, expires_at, created_at) VALUES ('${testEmail}', '111111', '${rateCodeExp}', '${nowIso}');`);
    const rateLimitRes = await makeRequest('/api/v1/auth/send-code', {}, {
      email: testEmail,
      lang: 'zh'
    });
    console.log("Portal Send-Code Rate Limit Status:", rateLimitRes.status, "Error:", rateLimitRes.data);
    if (rateLimitRes.status !== 429 || !rateLimitRes.data.error || !String(rateLimitRes.data.error).includes("60")) {
      throw new Error("Portal send-code rate limit failed! Response: " + JSON.stringify(rateLimitRes.data));
    }
    console.log("✓ Portal send-code 60s rate limit enforced (429).");

    // 11. Logout invalidates session
    logStep(11, "Portal Logout Invalidates Session");
    const logoutRes = await makeRequest('/api/v1/auth/logout', { 'Authorization': `Bearer ${testToken}` }, {});
    if (logoutRes.status !== 200 || !logoutRes.data.success) {
      throw new Error("Logout failed: " + JSON.stringify(logoutRes.data));
    }
    const licensesAfterLogout = await makeRequest('/api/v1/user/licenses', { 'Authorization': `Bearer ${testToken}` }, null, 'GET');
    if (licensesAfterLogout.status !== 401) {
      throw new Error("Session should be invalid after logout, got: " + licensesAfterLogout.status);
    }
    console.log("✓ Logout deleted session; subsequent licenses call returns 401.");

    console.log("\n==================================================");
    console.log("🎉🎉 ALL DRM E2E TESTS PASSED DETERMINISTICALLY! 🎉🎉");
    console.log("==================================================");

  } finally {
    console.log("\n[Teardown] Cleaning up test fixtures from D1...");
    try {
      execWranglerSQL(`DELETE FROM unbind_records WHERE license_code IN ('${testLic}', '${foreignLic}');`);
      execWranglerSQL(`DELETE FROM activations WHERE license_code IN ('${testLic}', '${foreignLic}');`);
      execWranglerSQL(`DELETE FROM user_sessions WHERE session_token = '${testToken}';`);
      execWranglerSQL(`DELETE FROM verification_codes WHERE email IN ('${testEmail}', 'unpurchased-e2e-user@eqt.im');`);
      execWranglerSQL(`DELETE FROM licenses WHERE license_code IN ('${testLic}', '${foreignLic}');`);
    } catch (teardownErr) {
      console.error("[Teardown] partial failure:", teardownErr.message || teardownErr);
    }
    console.log("[Teardown] Cleanup completed.");
  }
}

runFullDrmTestSuite().catch(err => {
  console.error("\n❌ E2E TEST SUITE FAILED:", err);
  process.exit(1);
});
