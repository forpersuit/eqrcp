import { Env, MAX_YEARLY_UNBINDS, ONE_YEAR_MS } from '../types';
import { extractRequestLang, getApiTranslation, getDeviceNoticeTemplate } from '../i18n';
import { hexToUint8Array, bufToHex } from '../utils/crypto';
import { ensureDeviceIdColumn, ensureActivationNetworkColumns, ensureLicenseSourceColumns, ensureBetaTestersTable, isDeviceAuthorizedForDev } from '../utils/auth';
import { isTestEnvironment } from '../utils/env-guard';
import { matchFingerprint, countMatchingFingerprints, checkAbusiveRefundBlacklist } from '../utils/blacklist';
import { sendDRMEmail, renderEmailWrapper } from '../services/smtp';
import { clientIpFromRequest, isDeviceRegisterRateLimited, recordDeviceRegisterRequest, isD1RateLimited, logRateLimitHit } from '../utils/rate-limit';
import { normalizeLicenseSource } from '../utils/license-source';
import { registerOrRefreshDevice } from '../utils/device-registry';
import { checkAbuseAfterActivation } from '../utils/abuse-detection';

export function evaluateLicenseExpiration(
  license: {
    source?: string | null;
    paddle_transaction_id?: string | null;
    duration_days?: number | null;
    expires_at?: string | null;
  },
  baseExpiresAtInput?: string | null,
  activatedAt?: string | null
): {
  usesRedeemWindow: boolean;
  effectiveExpiresAt: string;
  isRedeemExpired: boolean;
  isExpired: boolean;
} {
  const licenseSource = normalizeLicenseSource(license.source, license.paddle_transaction_id);
  const usesRedeemWindow = Boolean(
    licenseSource === "promo" ||
    (licenseSource === "admin" &&
      license.duration_days !== null &&
      license.duration_days !== undefined &&
      license.expires_at !== null &&
      license.expires_at !== undefined &&
      license.expires_at !== "" &&
      license.expires_at !== "LIFETIME")
  );

  let isRedeemExpired = false;
  if (usesRedeemWindow && license.expires_at && license.expires_at !== "LIFETIME") {
    const redeemBy = new Date(license.expires_at).getTime();
    if (!Number.isNaN(redeemBy) && redeemBy < Date.now()) {
      isRedeemExpired = true;
    }
  }

  let effectiveExpiresAt = baseExpiresAtInput || license.expires_at || "LIFETIME";

  if (
    usesRedeemWindow &&
    license.duration_days !== null &&
    license.duration_days !== undefined &&
    Number(license.duration_days) >= 0 &&
    effectiveExpiresAt !== "LIFETIME"
  ) {
    const baseTimeMs = activatedAt ? new Date(activatedAt).getTime() : Date.now();
    effectiveExpiresAt = new Date(baseTimeMs + Number(license.duration_days) * 86400 * 1000).toISOString();
  }

  let isExpired = false;
  if (effectiveExpiresAt && effectiveExpiresAt !== "LIFETIME") {
    const expiresMs = new Date(effectiveExpiresAt).getTime();
    if (!Number.isNaN(expiresMs) && expiresMs < Date.now()) {
      isExpired = true;
    }
  }

  return {
    usesRedeemWindow,
    effectiveExpiresAt,
    isRedeemExpired,
    isExpired,
  };
}

// Sandbox constraint gate: test licenses are constrained in EVERY environment;
// in test environments ALL licenses are constrained (covers Paddle sandbox purchases).
function needsSandboxConstraint(licenseSource: string, env: Env, url?: URL): boolean {
  return licenseSource === "test" || isTestEnvironment(env, url);
}

// Real-time tester whitelist check. The whitelist is the single authority for
// "registered & still allowed": deleting a whitelist entry immediately blocks
// activation/refresh. Never trusts the client-supplied device_id.
async function assertSandboxTesterAllowed(
  env: Env,
  buyerEmail: string | null | undefined,
  authoritativeDeviceId: string,
  reqLang: string,
  corsHeaders: Record<string, string>
): Promise<Response | null> {
  await ensureBetaTestersTable(env);
  const email = (buyerEmail || "").trim().toLowerCase();
  if (!email) {
    return new Response(JSON.stringify({
      error: getApiTranslation("unauthorized_test_device", reqLang) || "This test license has no registered tester email"
    }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
  const tester = await env.DB.prepare(
    "SELECT * FROM sandbox_beta_testers WHERE LOWER(email) = ? AND status = 'active'"
  ).bind(email).first<any>();
  if (!tester) {
    return new Response(JSON.stringify({
      error: getApiTranslation("unauthorized_test_device", reqLang) || "This test license is not registered for any sandbox tester"
    }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
  const registeredDeviceId = (tester.device_id || "").trim();
  if (!registeredDeviceId) {
    return new Response(JSON.stringify({
      error: getApiTranslation("unauthorized_test_device", reqLang) || "This test license is bound to a tester entry without a bound device"
    }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
  if (authoritativeDeviceId !== registeredDeviceId) {
    return new Response(JSON.stringify({
      error: getApiTranslation("unauthorized_test_device", reqLang) || `This test license is restricted to authorized device: ${registeredDeviceId}`
    }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
  return null;
}



function activationClientMeta(request: Request): {
  client_ip: string | null;
  ip_country: string | null;
  user_agent: string | null;
  city: string | null;
  region: string | null;
  latitude: number | null;
  longitude: number | null;
} {
  const ip = clientIpFromRequest(request);
  const client_ip = ip && ip !== "unknown" ? ip : null;
  const cf = (request as any).cf;

  const countryRaw = (request.headers.get("cf-ipcountry") || cf?.country || "").trim().toUpperCase();
  const ip_country = countryRaw && countryRaw !== "XX" && countryRaw !== "T1"
    ? countryRaw.slice(0, 8)
    : (countryRaw || null);

  const ua = (request.headers.get("user-agent") || "").trim();
  const user_agent = ua ? ua.slice(0, 256) : null;

  // Double-channel extraction: HTTP headers OR request.cf object
  const cityRaw = request.headers.get("cf-ipcity") || request.headers.get("cf-city") || cf?.city || "";
  const city = cityRaw ? String(cityRaw).trim().slice(0, 64) : null;

  const regionRaw = request.headers.get("cf-region-code") || request.headers.get("cf-region") || cf?.regionCode || cf?.region || "";
  const region = regionRaw ? String(regionRaw).trim().slice(0, 64) : null;

  const latHeader = request.headers.get("cf-iplatitude") || request.headers.get("cf-latitude");
  const lngHeader = request.headers.get("cf-iplongitude") || request.headers.get("cf-longitude");
  const latNum = parseFloat(latHeader || cf?.latitude);
  const lngNum = parseFloat(lngHeader || cf?.longitude);
  const latitude = !isNaN(latNum) ? latNum : null;
  const longitude = !isNaN(lngNum) ? lngNum : null;

  return { client_ip, ip_country, user_agent, city, region, latitude, longitude };
}

/**
 * Other active licenses already bound to this physical device.
 * Prefer device_id; never match empty fingerprint fields (SQL `col = ''` would false-positive).
 * Fall back to 3-of-2 fingerprint match in application code.
 */
async function findPeerActiveLicensesOnDevice(
  env: Env,
  licenseCode: string,
  deviceId: string,
  uuidHash: string,
  cpuHash: string,
  diskHash: string
): Promise<any[]> {
  const peers: any[] = [];
  const seen = new Set<string>();

  const pushUnique = (rows: any[] | null | undefined) => {
    for (const row of rows || []) {
      if (!row?.license_code || row.license_code === licenseCode) continue;
      if (seen.has(row.license_code)) continue;
      seen.add(row.license_code);
      peers.push(row);
    }
  };

  const dev = (deviceId || "").trim();
  if (dev) {
    const byDevice = await env.DB.prepare(`
      SELECT l.license_code, l.expires_at, l.tier, l.duration_days, l.source, l.paddle_transaction_id, l.status
      FROM activations a
      JOIN licenses l ON a.license_code = l.license_code
      WHERE a.device_id = ? AND l.license_code != ? AND l.status = 'active'
    `).bind(dev, licenseCode).all<any>();
    pushUnique(byDevice.results);
  }

  // Fingerprint candidates: only non-empty equality (avoids matching blank cpu_hash rows)
  const clauses: string[] = [];
  const binds: string[] = [];
  if (uuidHash) {
    clauses.push("a.uuid_hash = ?");
    binds.push(uuidHash);
  }
  if (cpuHash) {
    clauses.push("a.cpu_hash = ?");
    binds.push(cpuHash);
  }
  if (diskHash) {
    clauses.push("a.disk_hash = ?");
    binds.push(diskHash);
  }

  if (clauses.length > 0) {
    const sql = `
      SELECT a.uuid_hash, a.cpu_hash, a.disk_hash,
             l.license_code, l.expires_at, l.tier, l.duration_days, l.source, l.paddle_transaction_id, l.status
      FROM activations a
      JOIN licenses l ON a.license_code = l.license_code
      WHERE l.license_code != ? AND l.status = 'active'
        AND (${clauses.join(" OR ")})
    `;
    const cand = await env.DB.prepare(sql).bind(licenseCode, ...binds).all<any>();
    for (const row of cand.results || []) {
      if (!matchFingerprint(
        uuidHash || "", cpuHash || "", diskHash || "",
        row.uuid_hash || "", row.cpu_hash || "", row.disk_hash || ""
      )) {
        continue;
      }
      pushUnique([row]);
    }
  }

  return peers;
}

function evaluateStacking(
  peerLicenses: any[],
  licenseTier: string,
  licenseSource: string,
  baseExpiresAt: string,
  durationDays: number | null | undefined,
  reqLang: string = "en"
): { remainingMs: number; hasSameTierLifetime: boolean; blockReason: string | null } {
  // All cross-code stacking is strictly disabled by product policy.
  // Users must unbind existing active license on device before activating a different license code.
  if (peerLicenses && peerLicenses.length > 0) {
    return {
      remainingMs: 0,
      hasSameTierLifetime: false,
      blockReason: getApiTranslation("cross_code_stacking_blocked", reqLang)
    };
  }

  return { remainingMs: 0, hasSameTierLifetime: false, blockReason: null };
}

export async function checkAndApplyPendingUpgrade(
  env: Env,
  licenseCode: string,
  currentExpiresAt: string
): Promise<string> {
  if (currentExpiresAt === "LIFETIME") return "LIFETIME";

  try {
    const upgrade = await env.DB.prepare(`
      SELECT id, effective_at FROM license_upgrades
      WHERE target_license_code = ? AND status = 'pending'
      ORDER BY id ASC LIMIT 1
    `).bind(licenseCode).first<any>();

    if (upgrade && upgrade.effective_at) {
      const effectiveTime = new Date(upgrade.effective_at).getTime();
      if (!isNaN(effectiveTime) && effectiveTime <= Date.now()) {
        // Lazy flip to LIFETIME (idempotent WHERE clause)
        await env.DB.prepare(`
          UPDATE licenses SET expires_at = 'LIFETIME', duration_days = NULL
          WHERE license_code = ? AND expires_at != 'LIFETIME'
        `).bind(licenseCode).run();

        await env.DB.prepare(`
          UPDATE license_upgrades SET status = 'applied' WHERE id = ?
        `).bind(upgrade.id).run();

        return "LIFETIME";
      }
    }
  } catch (err) {
    console.error("Error in checkAndApplyPendingUpgrade:", err);
  }

  return currentExpiresAt;
}

export async function handleDrmRoutes(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  url: URL,
  corsHeaders: Record<string, string>
): Promise<Response | null> {
  // 0.5 Device registration (Free anonymous device check-in & ID generation)
  if (url.pathname === "/api/v1/device/register" && request.method === "POST") {
    const body: any = await request.json().catch(() => ({}));
    const reqLang = extractRequestLang(request, body);
    const { uuid_hash, cpu_hash, disk_hash, app_version, license_code } = body;

    const uHash = (uuid_hash || "").trim();
    const cHash = (cpu_hash || "").trim();
    const dHash = (disk_hash || "").trim();
    const net = activationClientMeta(request);

    // Rate-limiting check (§5.4 IP + Fingerprint Key)
    const clientIp = clientIpFromRequest(request);
    if (isDeviceRegisterRateLimited(clientIp, uHash, cHash, dHash)) {
      ctx.waitUntil(logRateLimitHit(env, 'DEVICE_REGISTER', `reg:${clientIp}`, { uuid_hash: uHash.slice(0, 8) }));
      return new Response(
        JSON.stringify({
          error: getApiTranslation("too_many_requests", reqLang) || "Too many registration attempts. Please try again later.",
          retry_after: 60,
          reason_key: "rate_limited"
        }),
        {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        }
      );
    }
    recordDeviceRegisterRequest(clientIp, uHash, cHash, dHash);

    // Blacklist check for provided hardware fingerprints
    if (uHash || cHash || dHash) {
      const blacklistCheck = await checkAbusiveRefundBlacklist(
        env,
        null,
        uHash,
        cHash,
        dHash
      );
      if (blacklistCheck.isAbusive) {
        return new Response(JSON.stringify({
          error: getApiTranslation("blacklist_device", reqLang) || blacklistCheck.reason
        }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
    }

    let tierLabel: 'free' | 'paid' = 'free';
    if (license_code) {
      const lic = await env.DB.prepare("SELECT * FROM licenses WHERE license_code = ?").bind(license_code).first<any>();
      if (lic && lic.status === 'active') {
        const evalRes = evaluateLicenseExpiration(lic, lic.expires_at || "LIFETIME");
        if (!evalRes.isExpired && !evalRes.isRedeemExpired) {
          tierLabel = 'paid';
        }
      }
    }

    const reg = await registerOrRefreshDevice(env, {
      uuidHash: uHash,
      cpuHash: cHash,
      diskHash: dHash,
      appVersion: app_version || null,
      tierLabel: tierLabel,
      licenseCode: license_code || null
    }, net);

    const isDev = await isDeviceAuthorizedForDev(env, reg.device_id);

    return new Response(JSON.stringify({
      device_id: reg.device_id,
      tier: reg.tier_label,
      is_dev: isDev
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  // 1. Activating a device
  if (url.pathname === "/api/v1/activate" && request.method === "POST") {
    await ensureDeviceIdColumn(env);
    await ensureActivationNetworkColumns(env);
    await ensureLicenseSourceColumns(env);
    const body: any = await request.json();
    const reqLang = extractRequestLang(request, body);
    const { license_code, uuid_hash, cpu_hash, disk_hash, device_id } = body;

    if (!license_code) {
      return new Response(JSON.stringify({ error: getApiTranslation("missing_license_code", reqLang) }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const uHash = (uuid_hash || "").trim();
    const cHash = (cpu_hash || "").trim();
    const dHash = (disk_hash || "").trim();
    const nonEmptyFpCount = (uHash ? 1 : 0) + (cHash ? 1 : 0) + (dHash ? 1 : 0);
    if (nonEmptyFpCount < 2) {
      return new Response(JSON.stringify({
        error: getApiTranslation("insufficient_hardware_permissions", reqLang) || "Insufficient hardware permissions (requires at least 2 valid hardware fingerprints)"
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Query the license
    const license = await env.DB.prepare(
      "SELECT * FROM licenses WHERE license_code = ?"
    ).bind(license_code).first<any>();

    if (!license) {
      return new Response(JSON.stringify({ error: getApiTranslation("license_not_found", reqLang) }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    if (license.status !== "active") {
      return new Response(JSON.stringify({ error: getApiTranslation("license_suspended_or_revoked", reqLang) }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // A3: D1-persistent rate limit — max 3 activate attempts per license_code per minute (§M4 P1)
    if (await isD1RateLimited(env, `activate:${license_code}`, 3, 60000)) {
      ctx.waitUntil(logRateLimitHit(env, 'ACTIVATE', `activate:${license_code}`, { license_code }));
      return new Response(JSON.stringify({
        error: getApiTranslation("rate_limit_exceeded", reqLang),
        retry_after: 60
      }), {
        status: 429,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const licenseSource = normalizeLicenseSource(license.source, license.paddle_transaction_id);

    // Gate A email + Gate B device (rolling 365d, activated purchase refunds/chargebacks only)
    const blacklistCheck = await checkAbusiveRefundBlacklist(
      env,
      license.buyer_email_hash || null,
      uuid_hash || "",
      cpu_hash || "",
      disk_hash || "",
      { deviceId: device_id || null }
    );
    if (blacklistCheck.isAbusive) {
      const key = blacklistCheck.reasonKey || (blacklistCheck.kind === 'device' ? 'blacklist_device' : 'blacklist_email');
      return new Response(JSON.stringify({
        error: getApiTranslation(key, reqLang) || blacklistCheck.reason,
        reason_key: key,
        blacklist_kind: blacklistCheck.kind
      }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    let baseExpiresAt = license.expires_at || "LIFETIME";

    // Initial expiration check before DB mutations
    const initialEval = evaluateLicenseExpiration(license, baseExpiresAt);
    if (initialEval.isRedeemExpired) {
      return new Response(JSON.stringify({
        error: getApiTranslation("license_redeem_expired", reqLang)
      }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
    if (initialEval.isExpired) {
      return new Response(JSON.stringify({ error: getApiTranslation("license_expired", reqLang) }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Apply pending upgrade if license is valid
    baseExpiresAt = await checkAndApplyPendingUpgrade(env, license_code, baseExpiresAt);
    const evalResult = evaluateLicenseExpiration(license, baseExpiresAt);
    baseExpiresAt = evalResult.effectiveExpiresAt;

    // Fetch existing activations for THIS license code
    const { results: activations } = await env.DB.prepare(
      "SELECT * FROM activations WHERE license_code = ?"
    ).bind(license_code).all<any>();

    let isAlreadyActivated = false;
    let matchedActivation: any = null;
    for (const act of activations) {
      if (matchFingerprint(
        uHash, cHash, dHash,
        act.uuid_hash || "", act.cpu_hash || "", act.disk_hash || ""
      )) {
        isAlreadyActivated = true;
        matchedActivation = act;
        break;
      }
      // Also treat same device_id as already activated on this code
      if (device_id && act.device_id && act.device_id === device_id) {
        isAlreadyActivated = true;
        matchedActivation = act;
        break;
      }
    }

    if (isAlreadyActivated && matchedActivation?.activated_at) {
      baseExpiresAt = evaluateLicenseExpiration(license, baseExpiresAt, matchedActivation.activated_at).effectiveExpiresAt;
    }

    // Sandbox gate: resolve authoritative device_id and enforce the real-time tester whitelist
    // for every sandbox-constrained request (including already-activated re-activations), so
    // deleting a whitelist entry immediately blocks activation/refresh.
    const sandboxConstrained = needsSandboxConstraint(licenseSource, env, url);
    let authoritativeDeviceId = "";
    const net = activationClientMeta(request);
    if (sandboxConstrained || !isAlreadyActivated) {
      const regRes = await registerOrRefreshDevice(env, {
        uuidHash: uuid_hash || "",
        cpuHash: cpu_hash || "",
        diskHash: disk_hash || "",
        tierLabel: 'free',
        appVersion: body.app_version || null
      }, net);
      authoritativeDeviceId = regRes.device_id || "";
    }
    if (sandboxConstrained) {
      const denied = await assertSandboxTesterAllowed(env, license.buyer_email, authoritativeDeviceId, reqLang, corsHeaders);
      if (denied) return denied;
    }

    // Peer licenses on this device — stacking decision BEFORE writing a new activation row
    const peerLicenses = await findPeerActiveLicensesOnDevice(
      env,
      license_code,
      device_id || "",
      uuid_hash || "",
      cpu_hash || "",
      disk_hash || ""
    );
    const stack = evaluateStacking(
      peerLicenses,
      license.tier,
      licenseSource,
      baseExpiresAt,
      license.duration_days,
      reqLang
    );
    if (stack.blockReason && !isAlreadyActivated) {
      return new Response(JSON.stringify({ error: stack.blockReason }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // If not already activated, check limit and insert new activation
    if (!isAlreadyActivated) {
      if (activations.length >= license.max_devices) {
        return new Response(JSON.stringify({ error: getApiTranslation("max_devices_reached", reqLang) }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      const traceId = request.headers.get('X-Trace-Id') || null;

      const insRes = await env.DB.prepare(`
        INSERT INTO activations (
          license_code, uuid_hash, cpu_hash, disk_hash, device_id, activated_at,
          client_ip, ip_country, user_agent, city, region, latitude, longitude, trace_id
        )
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        WHERE (SELECT COUNT(*) FROM activations WHERE license_code = ?) < ?
          AND NOT EXISTS (
            SELECT 1 FROM activations
            WHERE license_code = ?
              AND (
                (? != '' AND device_id = ?)
                OR (
                  ((CASE WHEN ? != '' AND uuid_hash = ? THEN 1 ELSE 0 END) +
                   (CASE WHEN ? != '' AND cpu_hash = ? THEN 1 ELSE 0 END) +
                   (CASE WHEN ? != '' AND disk_hash = ? THEN 1 ELSE 0 END)) >= 2
                )
              )
          )
      `).bind(
        license_code,
        uHash,
        cHash,
        dHash,
        authoritativeDeviceId,
        new Date().toISOString(),
        net.client_ip,
        net.ip_country,
        net.user_agent,
        net.city,
        net.region,
        net.latitude,
        net.longitude,
        traceId,
        license_code,
        license.max_devices,
        license_code,
        authoritativeDeviceId,
        authoritativeDeviceId,
        uHash,
        uHash,
        cHash,
        cHash,
        dHash,
        dHash
      ).run();

      // If changes === 0, either max_devices was reached or device was already inserted (e.g. D1 retry timeout)
      if (!insRes.meta || insRes.meta.changes === 0) {
        const { results: currentActs } = await env.DB.prepare(
          "SELECT * FROM activations WHERE license_code = ?"
        ).bind(license_code).all<any>();

        let concurrentMatch = false;
        for (const act of currentActs) {
          if (matchFingerprint(
            uHash, cHash, dHash,
            act.uuid_hash || "", act.cpu_hash || "", act.disk_hash || ""
          ) || (authoritativeDeviceId && act.device_id === authoritativeDeviceId)) {
            concurrentMatch = true;
            matchedActivation = act;
            break;
          }
        }

        if (!concurrentMatch) {
          return new Response(JSON.stringify({ error: getApiTranslation("max_devices_reached", reqLang) }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }
      }

      // Send activation notification email to the buyer asynchronously
      if (license.buyer_email) {
        const currentDevicesCount = activations.length + 1;
        const actTimeStr = new Date().toLocaleString();
        const devHashSummary = uuid_hash ? uuid_hash.substring(0, 8) + "..." : (cpu_hash ? cpu_hash.substring(0, 8) + "..." : "Default");
        
        const t = getDeviceNoticeTemplate(reqLang);
        const emailHtml = renderEmailWrapper(t.boundTitle, t.boundBody(license_code, actTimeStr, devHashSummary, currentDevicesCount, license.max_devices));
        ctx.waitUntil(sendDRMEmail(env, license.buyer_email, t.boundSubject, emailHtml));
      }

      // Run abuse detection asynchronously (P2 #15)
      ctx.waitUntil(checkAbuseAfterActivation(
        env, license_code, license.max_devices,
        uuid_hash || "", cpu_hash || "", disk_hash || "",
        net.client_ip
      ));
    } else {
      // Refresh registry active status for already activated device
      const net = activationClientMeta(request);
      ctx.waitUntil(registerOrRefreshDevice(env, {
        uuidHash: uuid_hash || "",
        cpuHash: cpu_hash || "",
        diskHash: disk_hash || "",
        tierLabel: 'paid',
        licenseCode: license_code,
        email: license.buyer_email || null,
        appVersion: body.app_version || null
      }, net));

      // Run abuse detection asynchronously (P2 #15)
      ctx.waitUntil(checkAbuseAfterActivation(
        env, license_code, license.max_devices,
        uuid_hash || "", cpu_hash || "", disk_hash || "",
        net.client_ip
      ));
    }

    // Ensure we fetch authoritative device_id for response
    const netMeta = activationClientMeta(request);
    const finalReg = await registerOrRefreshDevice(env, {
      uuidHash: uuid_hash || "",
      cpuHash: cpu_hash || "",
      diskHash: disk_hash || "",
      tierLabel: 'paid',
      licenseCode: license_code,
      email: license.buyer_email || null,
      appVersion: body.app_version || null
    }, netMeta);
    authoritativeDeviceId = finalReg.device_id;

    const remainingMs = stack.remainingMs;
    let finalExpiresAt = baseExpiresAt;
    // Purchase term stacking only (promo never stacks)
    if (licenseSource === "purchase" && finalExpiresAt !== "LIFETIME" && remainingMs > 0) {
      const newExpDate = new Date(finalExpiresAt);
      // Accumulate the remaining time of the old license
      const finalDate = new Date(newExpDate.getTime() + remainingMs);
      finalExpiresAt = finalDate.toISOString();
    }

    // Generate license signature (V2 payload including device_id)
    const payloadStr = `${license_code}|${license.tier}|${uuid_hash || ""}|${cpu_hash || ""}|${disk_hash || ""}|${authoritativeDeviceId}|${finalExpiresAt}|${license.max_devices}`;
    const encoder = new TextEncoder();
    const payloadData = encoder.encode(payloadStr);

    const privateKeyHex = env.ED25519_PRIVATE_KEY;
    if (!privateKeyHex) {
      throw new Error("ED25519_PRIVATE_KEY is not configured in Workers Environment Variables");
    }
    const privateKeyBytes = hexToUint8Array(privateKeyHex);
    
    const pkcs8Bytes = new Uint8Array(16 + privateKeyBytes.length);
    pkcs8Bytes.set([0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20]);
    pkcs8Bytes.set(privateKeyBytes, 16);

    const key = await crypto.subtle.importKey(
      "pkcs8",
      pkcs8Bytes,
      { name: "Ed25519" },
      true,
      ["sign"]
    );

    const signatureBuf = await crypto.subtle.sign("Ed25519", key, payloadData);
    const signatureHex = bufToHex(signatureBuf);

    const currentTime = new Date().toISOString();
    const verifyPayloadStr = `OK|${license_code}|${uuid_hash || ""}|${cpu_hash || ""}|${disk_hash || ""}|${authoritativeDeviceId || ""}|${currentTime}`;
    const verifyPayloadData = encoder.encode(verifyPayloadStr);
    const verifySignatureBuf = await crypto.subtle.sign("Ed25519", key, verifyPayloadData);
    const verifySignatureHex = bufToHex(verifySignatureBuf);

    let activatedCount = activations.length;
    if (!isAlreadyActivated) {
      activatedCount += 1;
    }

    const isDev = await isDeviceAuthorizedForDev(env, authoritativeDeviceId);

    return new Response(JSON.stringify({
      license_code: license_code,
      tier: license.tier,
      uuid_hash: uuid_hash || "",
      cpu_hash: cpu_hash || "",
      disk_hash: disk_hash || "",
      device_id: authoritativeDeviceId,
      expires_at: finalExpiresAt,
      max_devices: license.max_devices,
      activated_devices: activatedCount,
      buyer_email: license.buyer_email || "",
      signature: signatureHex,
      last_online_sync_time: currentTime,
      verify_signature: verifySignatureHex,
      is_dev: isDev
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  // 1.5. Verifying / Syncing license status (Always-Sync & 7-day grace period verification)
  if (url.pathname === "/api/v1/verify" && request.method === "POST") {
    const body: any = await request.json();
    const reqLang = extractRequestLang(request, body);
    const { license_code, uuid_hash, cpu_hash, disk_hash } = body;

    if (!license_code) {
      return new Response(JSON.stringify({ error: getApiTranslation("missing_license_code", reqLang) }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const license = await env.DB.prepare(
      "SELECT * FROM licenses WHERE license_code = ?"
    ).bind(license_code).first<any>();

    if (!license) {
      return new Response(JSON.stringify({ error: getApiTranslation("license_not_found", reqLang) }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    if (license.status !== "active") {
      return new Response(JSON.stringify({ error: getApiTranslation("license_suspended_or_revoked", reqLang) }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // A3: D1-persistent rate limit — max 10 verify attempts per license_code per minute (§M4 P1)
    if (await isD1RateLimited(env, `verify:${license_code}`, 10, 60000)) {
      ctx.waitUntil(logRateLimitHit(env, 'VERIFY', `verify:${license_code}`, { license_code }));
      return new Response(JSON.stringify({
        error: getApiTranslation("rate_limit_exceeded", reqLang),
        retry_after: 60
      }), {
        status: 429,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const blacklistCheck = await checkAbusiveRefundBlacklist(
      env,
      license.buyer_email_hash || null,
      uuid_hash || "",
      cpu_hash || "",
      disk_hash || "",
      { deviceId: (body as any).device_id || null }
    );
    if (blacklistCheck.isAbusive) {
      const key = blacklistCheck.reasonKey || (blacklistCheck.kind === 'device' ? 'blacklist_device' : 'blacklist_email');
      return new Response(JSON.stringify({
        error: getApiTranslation(key, reqLang) || blacklistCheck.reason,
        reason_key: key,
        blacklist_kind: blacklistCheck.kind
      }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const licenseSource = normalizeLicenseSource(license.source, license.paddle_transaction_id);
    let baseExpiresAt = license.expires_at || "LIFETIME";

    // Initial expiration check before checking device activation or DB mutations
    const initialEval = evaluateLicenseExpiration(license, baseExpiresAt);
    if (initialEval.isRedeemExpired) {
      return new Response(JSON.stringify({
        error: getApiTranslation("license_redeem_expired", reqLang)
      }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
    if (initialEval.isExpired) {
      return new Response(JSON.stringify({ error: getApiTranslation("license_expired", reqLang) }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const uHash = (uuid_hash || "").trim();
    const cHash = (cpu_hash || "").trim();
    const dHash = (disk_hash || "").trim();
    const nonEmptyFpCount = (uHash ? 1 : 0) + (cHash ? 1 : 0) + (dHash ? 1 : 0);
    if (nonEmptyFpCount < 2) {
      return new Response(JSON.stringify({
        error: getApiTranslation("insufficient_hardware_permissions", reqLang) || "Insufficient hardware permissions (requires at least 2 valid hardware fingerprints)"
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const { results: activations } = await env.DB.prepare(
      "SELECT * FROM activations WHERE license_code = ?"
    ).bind(license_code).all<any>();

    let matchedActivation: any = null;
    for (const act of activations) {
      const fpMatches = countMatchingFingerprints(
        uHash, cHash, dHash,
        act.uuid_hash || "", act.cpu_hash || "", act.disk_hash || ""
      );
      // Standard match: at least 2 of 3 fingerprints match
      if (fpMatches >= 2) {
        matchedActivation = act;
        break;
      }
      // Hardware drift tolerance: device_id matches AND at least 1 fingerprint matches (prevents 0-match clone attacks)
      if ((body as any).device_id && act.device_id && act.device_id === (body as any).device_id) {
        if (fpMatches >= 1) {
          matchedActivation = act;
          break;
        }
      }
    }

    if (!matchedActivation) {
      return new Response(JSON.stringify({ error: getApiTranslation("device_not_activated", reqLang) }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    baseExpiresAt = await checkAndApplyPendingUpgrade(env, license_code, baseExpiresAt);
    const evalResult = evaluateLicenseExpiration(license, baseExpiresAt, matchedActivation.activated_at);
    if (evalResult.isExpired) {
      return new Response(JSON.stringify({ error: getApiTranslation("license_expired", reqLang) }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
    baseExpiresAt = evalResult.effectiveExpiresAt;

    const net = activationClientMeta(request);
    const regResult = await registerOrRefreshDevice(env, {
      uuidHash: uuid_hash || "",
      cpuHash: cpu_hash || "",
      diskHash: disk_hash || "",
      tierLabel: 'paid',
      licenseCode: license_code,
      email: license.buyer_email || null,
      appVersion: body.app_version || null
    }, net);

    const activeDeviceId = regResult.device_id || "";

    // Real-time tester whitelist gate on refresh: a deleted whitelist entry stops license renewal.
    if (needsSandboxConstraint(licenseSource, env, url)) {
      const denied = await assertSandboxTesterAllowed(env, license.buyer_email, activeDeviceId, reqLang, corsHeaders);
      if (denied) return denied;
    }

    const currentTime = new Date().toISOString();
    const verifyPayloadStr = `OK|${license_code}|${uuid_hash || ""}|${cpu_hash || ""}|${disk_hash || ""}|${activeDeviceId}|${currentTime}`;
    const encoder = new TextEncoder();
    const verifyPayloadData = encoder.encode(verifyPayloadStr);

    const privateKeyHex = env.ED25519_PRIVATE_KEY;
    if (!privateKeyHex) {
      throw new Error("ED25519_PRIVATE_KEY is not configured in Workers Environment Variables");
    }
    const privateKeyBytes = hexToUint8Array(privateKeyHex);
    
    const pkcs8Bytes = new Uint8Array(16 + privateKeyBytes.length);
    pkcs8Bytes.set([0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20]);
    pkcs8Bytes.set(privateKeyBytes, 16);

    const key = await crypto.subtle.importKey(
      "pkcs8",
      pkcs8Bytes,
      { name: "Ed25519" },
      true,
      ["sign"]
    );

    const verifySignatureBuf = await crypto.subtle.sign("Ed25519", key, verifyPayloadData);
    const verifySignatureHex = bufToHex(verifySignatureBuf);

    // Also produce updated certificate signature for local cache renewal (V2 payload format)
    const certificatePayloadStr = `${license_code}|${license.tier}|${uuid_hash || ""}|${cpu_hash || ""}|${disk_hash || ""}|${activeDeviceId}|${baseExpiresAt}|${license.max_devices}`;
    const certificatePayloadData = encoder.encode(certificatePayloadStr);
    const certificateSignatureBuf = await crypto.subtle.sign("Ed25519", key, certificatePayloadData);
    const certificateSignatureHex = bufToHex(certificateSignatureBuf);

    const isDev = await isDeviceAuthorizedForDev(env, activeDeviceId || regResult.device_id);

    return new Response(JSON.stringify({
      status: "OK",
      license_code: license_code,
      tier: license.tier,
      uuid_hash: uuid_hash || "",
      cpu_hash: cpu_hash || "",
      disk_hash: disk_hash || "",
      device_id: regResult.device_id || "",
      max_devices: license.max_devices || 2,
      activated_devices: activations.length,
      expires_at: baseExpiresAt,
      buyer_email: license.buyer_email || "",
      certificate_signature: certificateSignatureHex,
      current_time: currentTime,
      signature: verifySignatureHex,
      is_dev: isDev
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  // 1.6 Dedicated dev device status query
  if (url.pathname === "/api/v1/dev/check-device" && request.method === "POST") {
    const body: any = await request.json().catch(() => ({}));
    const devId = (body.device_id || "").trim();
    const isDev = await isDeviceAuthorizedForDev(env, devId);
    return new Response(JSON.stringify({
      success: true,
      device_id: devId,
      is_dev: isDev
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  // 1.8 Unbind device from client (self-deactivation with valid fingerprints or device_id)
  if (url.pathname === "/api/v1/device/unbind" && request.method === "POST") {
    const body: any = await request.json().catch(() => ({}));
    const reqLang = extractRequestLang(request, body);
    const { license_code, device_id, uuid_hash, cpu_hash, disk_hash } = body;

    if (!license_code) {
      return new Response(JSON.stringify({ error: getApiTranslation("missing_license_code", reqLang) }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const uHash = (uuid_hash || "").trim();
    const cHash = (cpu_hash || "").trim();
    const dHash = (disk_hash || "").trim();
    const dId = (device_id || "").trim();

    if (!dId && ((uHash ? 1 : 0) + (cHash ? 1 : 0) + (dHash ? 1 : 0) < 2)) {
      return new Response(JSON.stringify({
        error: getApiTranslation("insufficient_hardware_permissions", reqLang) || "Insufficient hardware identifiers"
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    if (await isD1RateLimited(env, `unbind:${license_code}`, 10, 60000)) {
      return new Response(JSON.stringify({ error: getApiTranslation("rate_limit_exceeded", reqLang) }), {
        status: 429,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const { results: activations } = await env.DB.prepare(
      "SELECT id, device_id, uuid_hash, cpu_hash, disk_hash FROM activations WHERE license_code = ?"
    ).bind(license_code).all<any>();

    let matchedAct: any = null;
    for (const act of activations) {
      if (matchFingerprint(
        uHash, cHash, dHash,
        act.uuid_hash || "", act.cpu_hash || "", act.disk_hash || ""
      )) {
        matchedAct = act;
        break;
      }
      if (dId && act.device_id && act.device_id === dId) {
        matchedAct = act;
        break;
      }
    }

    if (!matchedAct) {
      return new Response(JSON.stringify({ success: true, message: "Device was not active on this license" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Atomic unbind: INSERT unbind_records ONLY IF quota not reached and not already recorded (eliminates TOCTOU and retry duplicate deduction)
    const oneYearAgoISO = new Date(Date.now() - ONE_YEAR_MS).toISOString();
    const nowIso = new Date().toISOString();

    const insertResult = await env.DB.prepare(`
      INSERT INTO unbind_records (license_code, activation_id, unbound_at)
      SELECT ?, ?, ?
      WHERE (
        SELECT COUNT(*) FROM unbind_records
        WHERE license_code = ? AND unbound_at >= ?
      ) < ?
      AND NOT EXISTS (
        SELECT 1 FROM unbind_records
        WHERE license_code = ? AND activation_id = ?
      )
    `).bind(license_code, matchedAct.id, nowIso, license_code, oneYearAgoISO, MAX_YEARLY_UNBINDS, license_code, matchedAct.id).run();

    if (!insertResult.meta || insertResult.meta.changes === 0) {
      const alreadyRecorded = await env.DB.prepare(
        "SELECT id FROM unbind_records WHERE license_code = ? AND activation_id = ?"
      ).bind(license_code, matchedAct.id).first<any>();

      if (!alreadyRecorded) {
        return new Response(JSON.stringify({
          error: getApiTranslation("unbind_limit_reached", reqLang) || "Annual unbind quota reached"
        }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
    }

    // Quota slot claimed atomically: delete activation and update device_registry in batch
    const cleanupBatch = [
      env.DB.prepare("DELETE FROM activations WHERE id = ? AND license_code = ?").bind(matchedAct.id, license_code)
    ];
    if (matchedAct.device_id) {
      cleanupBatch.push(
        env.DB.prepare("UPDATE device_registry SET tier_label = 'free', license_code = NULL, email = NULL WHERE device_id = ?").bind(matchedAct.device_id)
      );
    }
    await env.DB.batch(cleanupBatch);

    const unbindCheck = await env.DB.prepare(
      "SELECT COUNT(*) as count FROM unbind_records WHERE license_code = ? AND unbound_at >= ?"
    ).bind(license_code, oneYearAgoISO).first<any>();
    const unbindCount = (unbindCheck && typeof unbindCheck.count === 'number') ? unbindCheck.count : ((unbindCheck && unbindCheck.count != null) ? Number(unbindCheck.count) : 0);
    const remainingUnbinds = Math.max(0, MAX_YEARLY_UNBINDS - unbindCount);

    return new Response(JSON.stringify({
      success: true,
      message: getApiTranslation("unbind_success", reqLang) || "Device unbound successfully",
      remaining_unbinds: remainingUnbinds
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  // 3. Update checking endpoint (caches results for 1 hour to prevent Rate Limits)
  if (url.pathname === "/api/v1/update/check" && request.method === "GET") {
    const cacheUrl = new URL(request.url);
    const cacheKey = new Request(cacheUrl.toString(), request);
    const cache = caches.default;
    
    let response = await cache.match(cacheKey);
    if (response) {
      return response;
    }

    const repo = env.GITHUB_REPO || "forpersuit/eqrcp";
    const ghUrl = `https://api.github.com/repos/${repo}/releases/latest`;
    
    const headers: Record<string, string> = {
      "User-Agent": "EQT-Update-Worker",
      "Accept": "application/vnd.github+json",
    };
    
    if (env.GITHUB_TOKEN) {
      headers["Authorization"] = `Bearer ${env.GITHUB_TOKEN}`;
    }

    const ghRes = await fetch(ghUrl, { headers });
    if (!ghRes.ok) {
      return new Response(JSON.stringify({ error: `Failed to fetch latest release from GitHub: ${ghRes.statusText}` }), {
        status: ghRes.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const release: any = await ghRes.json();

    // Download URLs must point at R2 CDN only (never GitHub asset URLs).
    const r2PublicUrl = env.R2_PUBLIC_URL;
    if (!r2PublicUrl) {
      return new Response(JSON.stringify({
        error: "R2_PUBLIC_URL is not configured; update assets require R2 CDN"
      }), {
        status: 503,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
    const base = r2PublicUrl.endsWith('/') ? r2PublicUrl.slice(0, -1) : r2PublicUrl;
    const result = {
      version: release.tag_name,
      published_at: release.published_at,
      changelog: release.body || "",
      assets: (release.assets || []).map((asset: any) => {
        return {
          name: asset.name,
          download_url: `${base}/downloads/${release.tag_name}/${asset.name}`,
          size: asset.size
        };
      })
    };

    response = new Response(JSON.stringify(result), {
      status: 200,
      headers: { 
        ...corsHeaders, 
        "Content-Type": "application/json",
        "Cache-Control": "public, s-maxage=3600"
      }
    });

    ctx.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  }

  return null;
}
