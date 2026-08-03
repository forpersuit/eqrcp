import { Env } from '../types';
import { extractRequestLang, getApiTranslation, getDeviceNoticeTemplate } from '../i18n';
import { hexToUint8Array, bufToHex } from '../utils/crypto';
import { ensureDeviceIdColumn, ensureActivationNetworkColumns, ensureLicenseSourceColumns } from '../utils/auth';
import { matchFingerprint, checkAbusiveRefundBlacklist } from '../utils/blacklist';
import { sendDRMEmail, renderEmailWrapper } from '../services/smtp';
import { clientIpFromRequest, isDeviceRegisterRateLimited, recordDeviceRegisterRequest } from '../utils/rate-limit';
import { normalizeLicenseSource } from '../utils/license-source';
import { registerOrRefreshDevice } from '../utils/device-registry';


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
      return new Response(
        JSON.stringify({
          error: getApiTranslation("too_many_requests", reqLang) || "Too many registration attempts. Please try again later.",
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
      const lic = await env.DB.prepare("SELECT status FROM licenses WHERE license_code = ?").bind(license_code).first<any>();
      if (lic && lic.status === 'active') {
        tierLabel = 'paid';
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

    return new Response(JSON.stringify({
      device_id: reg.device_id,
      tier: reg.tier_label
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
    if (!uHash && !cHash && !dHash) {
      return new Response(JSON.stringify({ error: getApiTranslation("insufficient_hardware_permissions", reqLang) || "Insufficient hardware permissions (cannot read hardware fingerprints)" }), {
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

    // Promo (and admin codes that use dual-expiration): expires_at is redeem-by deadline
    const usesRedeemWindow =
      licenseSource === "promo" ||
      (licenseSource === "admin" &&
        license.duration_days !== null &&
        license.duration_days !== undefined &&
        license.expires_at &&
        license.expires_at !== "LIFETIME");

    if (usesRedeemWindow && license.expires_at && license.expires_at !== "LIFETIME") {
      const redeemBy = new Date(license.expires_at).getTime();
      if (!Number.isNaN(redeemBy) && redeemBy < Date.now()) {
        return new Response(JSON.stringify({
          error: getApiTranslation("license_redeem_expired", reqLang)
        }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
    }

    let baseExpiresAt = license.expires_at || "LIFETIME";
    if (license.duration_days !== null && license.duration_days !== undefined && Number(license.duration_days) >= 0) {
      baseExpiresAt = new Date(Date.now() + (Number(license.duration_days) * 86400 * 1000)).toISOString();
    } else if (license.expires_at && license.expires_at !== "LIFETIME") {
      const expires = new Date(license.expires_at);
      if (expires.getTime() < Date.now()) {
        return new Response(JSON.stringify({ error: getApiTranslation("license_expired", reqLang) }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
    }

    // Fetch existing activations for THIS license code
    const { results: activations } = await env.DB.prepare(
      "SELECT * FROM activations WHERE license_code = ?"
    ).bind(license_code).all<any>();

    let isAlreadyActivated = false;
    for (const act of activations) {
      if (matchFingerprint(
        uuid_hash || "", cpu_hash || "", disk_hash || "",
        act.uuid_hash || "", act.cpu_hash || "", act.disk_hash || ""
      )) {
        isAlreadyActivated = true;
        break;
      }
      // Also treat same device_id as already activated on this code
      if (device_id && act.device_id && act.device_id === device_id) {
        isAlreadyActivated = true;
        break;
      }
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

      // Insert new activation record (capture network meta for admin visibility / future geo)
      const net = activationClientMeta(request);
      const regRes = await registerOrRefreshDevice(env, {
        uuidHash: uuid_hash || "",
        cpuHash: cpu_hash || "",
        diskHash: disk_hash || "",
        tierLabel: 'paid',
        licenseCode: license_code,
        email: license.buyer_email || null,
        appVersion: body.app_version || null
      }, net);
      const authoritativeDeviceId = regRes.device_id || (device_id || "");

      const insRes = await env.DB.prepare(`
        INSERT INTO activations (
          license_code, uuid_hash, cpu_hash, disk_hash, device_id, activated_at,
          client_ip, ip_country, user_agent, city, region, latitude, longitude
        )
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        WHERE (SELECT COUNT(*) FROM activations WHERE license_code = ?) < ?
      `).bind(
        license_code,
        uuid_hash || "",
        cpu_hash || "",
        disk_hash || "",
        authoritativeDeviceId,
        new Date().toISOString(),
        net.client_ip,
        net.ip_country,
        net.user_agent,
        net.city,
        net.region,
        net.latitude,
        net.longitude,
        license_code,
        license.max_devices
      ).run();

      // If changes === 0, race condition hit max_devices limit -> Block overselling
      if (!insRes.meta || insRes.meta.changes === 0) {
        return new Response(JSON.stringify({ error: getApiTranslation("max_devices_reached", reqLang) }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
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
    const authoritativeDeviceId = finalReg.device_id;

    const remainingMs = stack.remainingMs;
    let finalExpiresAt = baseExpiresAt;
    // Purchase term stacking only (promo never stacks)
    if (licenseSource === "purchase" && finalExpiresAt !== "LIFETIME" && remainingMs > 0) {
      const newExpDate = new Date(finalExpiresAt);
      // Accumulate the remaining time of the old license
      const finalDate = new Date(newExpDate.getTime() + remainingMs);
      finalExpiresAt = finalDate.toISOString();
    }

    // Generate license signature
    const payloadStr = `${license_code}|${license.tier}|${uuid_hash || ""}|${cpu_hash || ""}|${disk_hash || ""}|${finalExpiresAt}|${license.max_devices}`;
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
    const verifyPayloadStr = `OK|${license_code}|${uuid_hash || ""}|${cpu_hash || ""}|${disk_hash || ""}|${currentTime}`;
    const verifyPayloadData = encoder.encode(verifyPayloadStr);
    const verifySignatureBuf = await crypto.subtle.sign("Ed25519", key, verifyPayloadData);
    const verifySignatureHex = bufToHex(verifySignatureBuf);

    let activatedCount = activations.length;
    if (!isAlreadyActivated) {
      activatedCount += 1;
    }

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
      verify_signature: verifySignatureHex
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

    const { results: activations } = await env.DB.prepare(
      "SELECT * FROM activations WHERE license_code = ?"
    ).bind(license_code).all<any>();

    let isActivatedDevice = false;
    for (const act of activations) {
      if (matchFingerprint(
        uuid_hash || "", cpu_hash || "", disk_hash || "",
        act.uuid_hash || "", act.cpu_hash || "", act.disk_hash || ""
      )) {
        isActivatedDevice = true;
        break;
      }
    }

    if (!isActivatedDevice) {
      return new Response(JSON.stringify({ error: getApiTranslation("device_not_activated", reqLang) }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    let baseExpiresAt = license.expires_at || "LIFETIME";
    if (license.duration_days !== null && license.duration_days !== undefined && Number(license.duration_days) >= 0) {
      baseExpiresAt = new Date(Date.now() + (Number(license.duration_days) * 86400 * 1000)).toISOString();
    }

    const currentTime = new Date().toISOString();
    const verifyPayloadStr = `OK|${license_code}|${uuid_hash || ""}|${cpu_hash || ""}|${disk_hash || ""}|${currentTime}`;
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

    // Also produce updated certificate signature for local cache renewal
    const certificatePayloadStr = `${license_code}|${license.tier}|${uuid_hash || ""}|${cpu_hash || ""}|${disk_hash || ""}|${baseExpiresAt}|${license.max_devices}`;
    const certificatePayloadData = encoder.encode(certificatePayloadStr);
    const certificateSignatureBuf = await crypto.subtle.sign("Ed25519", key, certificatePayloadData);
    const certificateSignatureHex = bufToHex(certificateSignatureBuf);

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
      signature: verifySignatureHex
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
