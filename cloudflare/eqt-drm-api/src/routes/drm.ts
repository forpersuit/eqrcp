import { Env } from '../types';
import { extractRequestLang, getDeviceNoticeTemplate } from '../i18n';
import { hexToUint8Array, bufToHex } from '../utils/crypto';
import { ensureDeviceIdColumn, ensureActivationNetworkColumns, ensureLicenseSourceColumns } from '../utils/auth';
import { matchFingerprint, checkAbusiveRefundBlacklist } from '../utils/blacklist';
import { sendDRMEmail, renderEmailWrapper } from '../services/smtp';
import { clientIpFromRequest } from '../utils/rate-limit';
import { normalizeLicenseSource } from '../utils/license-source';

function activationClientMeta(request: Request): {
  client_ip: string | null;
  ip_country: string | null;
  user_agent: string | null;
} {
  const ip = clientIpFromRequest(request);
  const client_ip = ip && ip !== "unknown" ? ip : null;
  const countryRaw = (request.headers.get("cf-ipcountry") || "").trim().toUpperCase();
  const ip_country = countryRaw && countryRaw !== "XX" && countryRaw !== "T1"
    ? countryRaw.slice(0, 8)
    : (countryRaw || null);
  const ua = (request.headers.get("user-agent") || "").trim();
  const user_agent = ua ? ua.slice(0, 256) : null;
  return { client_ip, ip_country, user_agent };
}

export async function handleDrmRoutes(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  url: URL,
  corsHeaders: Record<string, string>
): Promise<Response | null> {
  // 1. Activating a device
  if (url.pathname === "/api/v1/activate" && request.method === "POST") {
    await ensureDeviceIdColumn(env);
    await ensureActivationNetworkColumns(env);
    await ensureLicenseSourceColumns(env);
    const body: any = await request.json();
    const reqLang = extractRequestLang(request, body);
    const { license_code, uuid_hash, cpu_hash, disk_hash, device_id } = body;

    if (!license_code) {
      return new Response(JSON.stringify({ error: "Missing license_code" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Query the license
    const license = await env.DB.prepare(
      "SELECT * FROM licenses WHERE license_code = ?"
    ).bind(license_code).first<any>();

    if (!license) {
      return new Response(JSON.stringify({ error: "Invalid license code" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    if (license.status !== "active") {
      return new Response(JSON.stringify({ error: "License is suspended or revoked" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const licenseSource = normalizeLicenseSource(license.source, license.paddle_transaction_id);

    // Check for abusive refund blacklists (both email hash and device fingerprint)
    const blacklistCheck = await checkAbusiveRefundBlacklist(
      env,
      license.buyer_email_hash || null,
      uuid_hash || "",
      cpu_hash || "",
      disk_hash || ""
    );
    if (blacklistCheck.isAbusive) {
      return new Response(JSON.stringify({ error: blacklistCheck.reason }), {
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
          error: "This license code has passed its redeem deadline and can no longer be activated."
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
        return new Response(JSON.stringify({ error: "License has expired" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
    }

    // Fetch existing activations
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
    }

    // If not already activated, check limit and insert new activation
    if (!isAlreadyActivated) {
      if (activations.length >= license.max_devices) {
        return new Response(JSON.stringify({ error: `Activation limit reached (max ${license.max_devices} devices)` }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      // Insert new activation record (capture network meta for admin visibility / future geo)
      const net = activationClientMeta(request);
      await env.DB.prepare(
        "INSERT INTO activations (license_code, uuid_hash, cpu_hash, disk_hash, device_id, activated_at, client_ip, ip_country, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).bind(
        license_code,
        uuid_hash || "",
        cpu_hash || "",
        disk_hash || "",
        device_id || "",
        new Date().toISOString(),
        net.client_ip,
        net.ip_country,
        net.user_agent
      ).run();

      // Send activation notification email to the buyer asynchronously
      if (license.buyer_email) {
        const currentDevicesCount = activations.length + 1;
        const actTimeStr = new Date().toLocaleString();
        const devHashSummary = uuid_hash ? uuid_hash.substring(0, 8) + "..." : (cpu_hash ? cpu_hash.substring(0, 8) + "..." : "Default");
        
        const t = getDeviceNoticeTemplate(reqLang);
        const emailHtml = renderEmailWrapper(t.boundTitle, t.boundBody(license_code, actTimeStr, devHashSummary, currentDevicesCount, license.max_devices));
        ctx.waitUntil(sendDRMEmail(env, license.buyer_email, t.boundSubject, emailHtml));
      }
    }

    // Calculate dynamic expiration if the device has other active and unexpired license activations
    let remainingMs = 0;
    const nowMs = Date.now();
    let hasSameTierLifetime = false;

    // Find existing activations for this device fingerprint
    const activeDevices = await env.DB.prepare(`
      SELECT l.expires_at, l.tier, l.duration_days, l.source, l.paddle_transaction_id FROM activations a
      JOIN licenses l ON a.license_code = l.license_code
      WHERE (a.uuid_hash = ? OR a.cpu_hash = ? OR a.disk_hash = ?)
        AND l.license_code != ?
        AND l.status = 'active'
    `).bind(uuid_hash || "", cpu_hash || "", disk_hash || "", license_code).all<any>();

    if (activeDevices.results && activeDevices.results.length > 0) {
      for (const item of activeDevices.results) {
        const itemIsLifetime =
          item.expires_at === "LIFETIME" ||
          (item.duration_days === null && item.expires_at === "LIFETIME");
        // Certificate may store absolute LIFETIME on device; also treat null duration + LIFETIME row
        const certLifetime = item.expires_at === "LIFETIME";
        if (certLifetime && item.tier === license.tier) {
          hasSameTierLifetime = true;
        }
        if (certLifetime || itemIsLifetime) {
          if (item.tier === license.tier) {
            remainingMs = -1;
            break;
          }
          continue;
        }
        // Promo never stacks remaining time from other codes
        if (licenseSource === "promo") {
          continue;
        }
        if (item.expires_at) {
          const expTime = new Date(item.expires_at).getTime();
          if (expTime > nowMs) {
            const diff = expTime - nowMs;
            if (diff > remainingMs) {
              remainingMs = diff;
            }
          }
        }
      }
    }

    // Lifetime same-tier: cannot stack another code of the same tier
    if (hasSameTierLifetime || remainingMs === -1) {
      const newIsLifetime =
        baseExpiresAt === "LIFETIME" ||
        (license.duration_days === null && (license.expires_at === "LIFETIME" || !license.expires_at));
      if (newIsLifetime || licenseSource === "promo" || remainingMs === -1) {
        return new Response(JSON.stringify({
          error: "This device already has a lifetime license of the same tier; stacking is not allowed."
        }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
    }

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
    const { license_code, uuid_hash, cpu_hash, disk_hash } = body;

    if (!license_code) {
      return new Response(JSON.stringify({ error: "Missing license_code" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const license = await env.DB.prepare(
      "SELECT * FROM licenses WHERE license_code = ?"
    ).bind(license_code).first<any>();

    if (!license) {
      return new Response(JSON.stringify({ error: "Invalid license code" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    if (license.status !== "active") {
      return new Response(JSON.stringify({ error: "License is suspended or revoked" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const blacklistCheck = await checkAbusiveRefundBlacklist(
      env,
      license.buyer_email_hash || null,
      uuid_hash || "",
      cpu_hash || "",
      disk_hash || ""
    );
    if (blacklistCheck.isAbusive) {
      return new Response(JSON.stringify({ error: blacklistCheck.reason }), {
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
      return new Response(JSON.stringify({ error: "This device is not activated under the provided license" }), {
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

    return new Response(JSON.stringify({
      status: "OK",
      license_code: license_code,
      tier: license.tier,
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
