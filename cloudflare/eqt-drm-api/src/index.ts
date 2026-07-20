export interface Env {
  DB: D1Database;
  ED25519_PRIVATE_KEY: string; // 64-char hex string (32 bytes raw private key)
  ADMIN_SECRET?: string;       // Secret header to allow manually generating licenses
  GITHUB_TOKEN?: string;       // Optional token to prevent GitHub Rate Limit
  GITHUB_REPO?: string;        // Optional repository path, default 'forpersuit/eqrcp'
  R2_PUBLIC_URL?: string;      // Optional public CDN url for R2 assets download redirection
  PADDLE_WEBHOOK_SECRET?: string; // Webhook secret key from Paddle notifications dashboard
}

const PRICE_LIFETIME_ID = "pri_01kxymyma34hgmndccwswheta3";
const PRICE_YEARLY_ID = "pri_01kxymxqngex49tg65wb0701pc";

// Helper to verify Paddle Billing webhook signatures
async function verifyPaddleSignature(
  rawBody: string,
  signatureHeader: string | null,
  secretKey: string
): Promise<boolean> {
  if (!signatureHeader || !secretKey) return false;

  const parts = signatureHeader.split(";");
  if (parts.length !== 2) return false;

  const timestampPart = parts.find(p => p.startsWith("ts="));
  const signaturePart = parts.find(p => p.startsWith("h1="));

  if (!timestampPart || !signaturePart) return false;

  const ts = timestampPart.split("=")[1];
  const h1 = signaturePart.split("=")[1];

  if (!ts || !h1) return false;

  // Validate timestamp drift (5 minutes / 300 seconds limit)
  const timestampInt = parseInt(ts) * 1000;
  if (isNaN(timestampInt)) return false;
  const currentTime = Date.now();
  if (Math.abs(currentTime - timestampInt) > 300 * 1000) {
    return false;
  }

  const encoder = new TextEncoder();
  const keyData = encoder.encode(secretKey);
  const messageData = encoder.encode(`${ts}:${rawBody}`);

  const key = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signatureBuf = await crypto.subtle.sign("HMAC", key, messageData);
  const signatureHex = Array.prototype.map.call(
    new Uint8Array(signatureBuf),
    (x: number) => ('00' + x.toString(16)).slice(-2)
  ).join('');

  return signatureHex === h1;
}

// Helper to convert hex string to Uint8Array
function hexToUint8Array(hex: string): Uint8Array {
  hex = hex.trim();
  if (hex.length % 2 !== 0) {
    throw new Error("Invalid hex string");
  }
  const array = new Uint8Array(hex.length / 2);
  for (let i = 0; i < array.length; i++) {
    array[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return array;
}

// Helper to convert array buffer to hex string
function bufToHex(buffer: ArrayBuffer): string {
  return Array.prototype.map.call(new Uint8Array(buffer), x => ('00' + x.toString(16)).slice(-2)).join('');
}

// Perform 3-of-2 matching check between client hashes and a stored activation record
function matchFingerprint(
  clientUuid: string, clientCpu: string, clientDisk: string,
  storedUuid: string, storedCpu: string, storedDisk: string
): boolean {
  let matches = 0;
  if (clientUuid && storedUuid && clientUuid === storedUuid) matches++;
  if (clientCpu && storedCpu && clientCpu === storedCpu) matches++;
  if (clientDisk && storedDisk && clientDisk === storedDisk) matches++;
  return matches >= 2;
}

// Helper to fetch latest release from GitHub
async function fetchLatestRelease(env: Env): Promise<any> {
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
    return { error: `Failed to fetch latest release from GitHub: ${ghRes.statusText}` };
  }

  return await ghRes.json();
}

// Handler for requests targeted to download.eqt.net.im
async function handleDownloadDomain(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  corsHeaders: any
): Promise<Response> {
  const url = new URL(request.url);
  const pathname = url.pathname;

  // 1. Root path -> Redirect to official homepage
  if (pathname === "/" || pathname === "") {
    return Response.redirect("https://www.eqt.net.im", 302);
  }

  // 2. GET /update-metadata.json
  if (pathname === "/update-metadata.json" && (request.method === "GET" || request.method === "HEAD")) {
    const cacheKey = new Request(url.toString(), request);
    const cache = caches.default;
    let response = await cache.match(cacheKey);
    if (response) {
      return response;
    }

    const latestRelease = await fetchLatestRelease(env);
    if (latestRelease.error) {
      return new Response(JSON.stringify({ error: latestRelease.error }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const version = latestRelease.tag_name;
    const result = {
      version: version,
      published_at: latestRelease.published_at,
      changelog: latestRelease.body || "",
      assets: (latestRelease.assets || []).map((asset: any) => {
        return {
          name: asset.name,
          download_url: `https://download.eqt.net.im/downloads/${version}/${asset.name}`,
          size: asset.size
        };
      })
    };

    response = new Response(JSON.stringify(result), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        "Cache-Control": "public, s-maxage=60" // Cache in edge for 1 minute
      }
    });

    ctx.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  }

  // 3. GET /downloads/:version/:filename
  // Pattern: /downloads/([^/]+)/(.+)
  const downloadMatch = pathname.match(/^\/downloads\/([^/]+)\/(.+)$/);
  if (downloadMatch && (request.method === "GET" || request.method === "HEAD")) {
    let version = downloadMatch[1];
    const filename = downloadMatch[2];

    if (version === "latest") {
      const latestRelease = await fetchLatestRelease(env);
      if (latestRelease.error) {
        return new Response(JSON.stringify({ error: latestRelease.error }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
      version = latestRelease.tag_name;
    }

    let redirectUrl = `https://github.com/forpersuit/eqrcp/releases/download/${version}/${filename}`;
    if (env.R2_PUBLIC_URL) {
      const base = env.R2_PUBLIC_URL.endsWith('/') ? env.R2_PUBLIC_URL.slice(0, -1) : env.R2_PUBLIC_URL;
      redirectUrl = `${base}/downloads/${version}/${filename}`;
    }
    return Response.redirect(redirectUrl, 302);
  }

  // Fallback: redirect any unmatched downloads domain requests to the main website
  return Response.redirect("https://www.eqt.net.im", 302);
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // CORS Headers
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Admin-Secret",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // Route request to download handler if host matches download.eqt.net.im,
      // or if pathname matches download routes (to support dev/testing on workers.dev or localhost).
      if (
        url.hostname === "download.eqt.net.im" ||
        url.hostname.endsWith(".workers.dev") ||
        url.hostname === "localhost" ||
        url.hostname === "127.0.0.1" ||
        url.pathname === "/update-metadata.json" ||
        url.pathname.startsWith("/downloads/")
      ) {
        return await handleDownloadDomain(request, env, ctx, corsHeaders);
      }

      // 1. Activating a device
      if (url.pathname === "/api/v1/activate" && request.method === "POST") {
        const body: any = await request.json();
        const { license_code, uuid_hash, cpu_hash, disk_hash } = body;

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

          // Insert new activation record
          await env.DB.prepare(
            "INSERT INTO activations (license_code, uuid_hash, cpu_hash, disk_hash, activated_at) VALUES (?, ?, ?, ?, ?)"
          ).bind(
            license_code,
            uuid_hash || "",
            cpu_hash || "",
            disk_hash || "",
            new Date().toISOString()
          ).run();
        }

        // Calculate dynamic expiration if the device has other active and unexpired license activations
        let remainingMs = 0;
        const nowMs = Date.now();
        
        // Find existing activations for this device fingerprint
        const activeDevices = await env.DB.prepare(`
          SELECT l.expires_at FROM activations a
          JOIN licenses l ON a.license_code = l.license_code
          WHERE (a.uuid_hash = ? OR a.cpu_hash = ? OR a.disk_hash = ?)
            AND l.license_code != ?
            AND l.status = 'active'
        `).bind(uuid_hash || "", cpu_hash || "", disk_hash || "", license_code).all<any>();

        if (activeDevices.results && activeDevices.results.length > 0) {
          for (const item of activeDevices.results) {
            if (item.expires_at === "LIFETIME") {
              remainingMs = -1; // Already has a lifetime license, no need to accumulate
              break;
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

        let finalExpiresAt = baseExpiresAt;
        if (finalExpiresAt !== "LIFETIME" && remainingMs > 0) {
          const newExpDate = new Date(finalExpiresAt);
          // Accumulate the remaining time of the old license
          const finalDate = new Date(newExpDate.getTime() + remainingMs);
          finalExpiresAt = finalDate.toISOString();
        }

        // Generate license signature
        // Formulate the raw payload: license_code|tier|uuid_hash|cpu_hash|disk_hash|expires_at|max_devices
        const payloadStr = `${license_code}|${license.tier}|${uuid_hash || ""}|${cpu_hash || ""}|${disk_hash || ""}|${finalExpiresAt}|${license.max_devices}`;
        const encoder = new TextEncoder();
        const payloadData = encoder.encode(payloadStr);

        // Import the private key (Ed25519)
        const privateKeyHex = env.ED25519_PRIVATE_KEY;
        if (!privateKeyHex) {
          throw new Error("ED25519_PRIVATE_KEY is not configured in Workers Environment Variables");
        }
        const privateKeyBytes = hexToUint8Array(privateKeyHex);
        
        // Convert 32-byte raw private key (seed) to PKCS8 format for SubtleCrypto
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

        // Sign the payload
        const signatureBuf = await crypto.subtle.sign("Ed25519", key, payloadData);
        const signatureHex = bufToHex(signatureBuf);

        // Generate verification signature for sync/lease check (unified with verify endpoint)
        const currentTime = new Date().toISOString();
        const verifyPayloadStr = `OK|${license_code}|${uuid_hash || ""}|${cpu_hash || ""}|${disk_hash || ""}|${currentTime}`;
        const verifyPayloadData = encoder.encode(verifyPayloadStr);
        const verifySignatureBuf = await crypto.subtle.sign("Ed25519", key, verifyPayloadData);
        const verifySignatureHex = bufToHex(verifySignatureBuf);

        // Calculate the actual activated devices count (including this one)
        let activatedCount = activations.length;
        if (!isAlreadyActivated) {
          activatedCount += 1;
        }

        // Return signed license
        return new Response(JSON.stringify({
          license_code: license_code,
          tier: license.tier,
          uuid_hash: uuid_hash || "",
          cpu_hash: cpu_hash || "",
          disk_hash: disk_hash || "",
          expires_at: finalExpiresAt,
          max_devices: license.max_devices,
          activated_devices: activatedCount,
          signature: signatureHex,
          // New verification fields for always-sync 7-day grace period
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

        // Query the license status
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

        // Check if this device is registered/activated under this license (3-of-2 matching check)
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

        // Generate verification signature containing server timestamp
        const currentTime = new Date().toISOString();
        // Formulate the raw verify payload: OK|license_code|uuid_hash|cpu_hash|disk_hash|current_time
        const verifyPayloadStr = `OK|${license_code}|${uuid_hash || ""}|${cpu_hash || ""}|${disk_hash || ""}|${currentTime}`;
        const encoder = new TextEncoder();
        const verifyPayloadData = encoder.encode(verifyPayloadStr);

        // Import the private key (Ed25519)
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

        const signatureBuf = await crypto.subtle.sign("Ed25519", key, verifyPayloadData);
        const signatureHex = bufToHex(signatureBuf);

        return new Response(JSON.stringify({
          status: "OK",
          license_code: license_code,
          current_time: currentTime,
          signature: signatureHex
        }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      // 2. Admin Endpoint: Manual license generation for test/issue
      if (url.pathname === "/api/v1/admin/generate" && request.method === "POST") {
        const adminSecret = request.headers.get("X-Admin-Secret");
        if (!env.ADMIN_SECRET || adminSecret !== env.ADMIN_SECRET) {
          return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        const body: any = await request.json();
        const { tier, max_devices, expires_in_days, duration_days } = body;

        if (tier !== "PLUS" && tier !== "PRO") {
          return new Response(JSON.stringify({ error: "Invalid tier. Must be 'PLUS' or 'PRO'" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        // Generate high entropy random coupon code: EQT-{TIER}-{YYYYMMDD}-{12-random-chars}
        const todayStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
        const randBytes = new Uint8Array(6);
        crypto.getRandomValues(randBytes);
        const randStr = Array.from(randBytes, b => ('00' + b.toString(16)).slice(-2)).join('').toUpperCase();
        const licenseCode = `EQT-${tier}-${todayStr}-${randStr}`;

        let expiresAt = "LIFETIME";
        if (expires_in_days) {
          const expDate = new Date();
          expDate.setDate(expDate.getDate() + Number(expires_in_days));
          expiresAt = expDate.toISOString();
        }

        const maxDev = max_devices ? Number(max_devices) : 2;
        const durDays = duration_days !== undefined ? Number(duration_days) : null;

        await env.DB.prepare(
          "INSERT INTO licenses (license_code, tier, status, max_devices, expires_at, duration_days, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
        ).bind(
          licenseCode,
          tier,
          "active",
          maxDev,
          expiresAt,
          durDays,
          new Date().toISOString()
        ).run();

        return new Response(JSON.stringify({
          license_code: licenseCode,
          tier: tier,
          max_devices: maxDev,
          expires_at: expiresAt,
          duration_days: durDays,
          status: "active"
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
        
        const r2PublicUrl = env.R2_PUBLIC_URL;
        const result = {
          version: release.tag_name,
          published_at: release.published_at,
          changelog: release.body || "",
          assets: (release.assets || []).map((asset: any) => {
            let downloadUrl = asset.browser_download_url;
            if (r2PublicUrl) {
              const base = r2PublicUrl.endsWith('/') ? r2PublicUrl.slice(0, -1) : r2PublicUrl;
              downloadUrl = `${base}/downloads/${release.tag_name}/${asset.name}`;
            }
            return {
              name: asset.name,
              download_url: downloadUrl,
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

      // 3.5.1 Paddle Webhook: fulfillment and cancellation/refund
      if (url.pathname === "/api/v1/paddle/webhook" && request.method === "POST") {
        const rawBody = await request.text();
        const signature = request.headers.get("paddle-signature");
        const webhookSecret = env.PADDLE_WEBHOOK_SECRET;

        if (!webhookSecret) {
          return new Response(JSON.stringify({ error: "Paddle Webhook secret is not configured" }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        const isValid = await verifyPaddleSignature(rawBody, signature, webhookSecret);
        if (!isValid) {
          return new Response(JSON.stringify({ error: "Invalid signature" }), {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        const event = JSON.parse(rawBody);
        const eventType = event.event_type;
        const data = event.data;

        if (eventType === "transaction.completed") {
          const transactionId = data.id;
          const subscriptionId = data.subscription_id || null;
          const buyerEmail = data.customer?.email || data.billing_details?.email_address || "";

          // Check if already processed
          const existing = await env.DB.prepare(
            "SELECT license_code FROM licenses WHERE paddle_transaction_id = ?"
          ).bind(transactionId).first<any>();

          if (existing) {
            return new Response(JSON.stringify({ message: "Transaction already processed", license_code: existing.license_code }), {
              status: 200,
              headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
          }

          // Extract Price ID
          const items = data.items || [];
          let matchedPriceId = "";
          for (const item of items) {
            const priceId = item.price?.id || item.price_id;
            if (priceId === PRICE_LIFETIME_ID || priceId === PRICE_YEARLY_ID) {
              matchedPriceId = priceId;
              break;
            }
          }

          if (!matchedPriceId) {
            return new Response(JSON.stringify({ message: "No matching EQT pricing items in transaction" }), {
              status: 200,
              headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
          }

          // Set Tier and expiration based on price ID
          const tier = "PLUS";
          let expiresAt = "LIFETIME";
          let durationDays: number | null = null;

          if (matchedPriceId === PRICE_YEARLY_ID) {
            durationDays = 365;
            expiresAt = new Date(Date.now() + 365 * 86400 * 1000).toISOString();
          }

          // Generate license code
          const todayStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
          const charSet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
          let randStr = "";
          const randBytes = new Uint8Array(6);
          crypto.getRandomValues(randBytes);
          for (let i = 0; i < 6; i++) {
            randStr += charSet[randBytes[i] % charSet.length];
          }

          const checkSumPayload = `${tier}-${todayStr}-${randStr}`;
          const encoder = new TextEncoder();
          const checkHashBuf = await crypto.subtle.digest("MD5", encoder.encode(checkSumPayload));
          const checkHex = Array.prototype.map.call(new Uint8Array(checkHashBuf), x => ('00' + x.toString(16)).slice(-2)).join('').slice(0, 4).toUpperCase();
          const licenseCode = `EQT-${tier}-${todayStr}-${randStr}-${checkHex}`;

          // Hash email for buyer_email_hash
          let emailHash = "";
          if (buyerEmail) {
            const emailHashBuf = await crypto.subtle.digest("SHA-256", encoder.encode(buyerEmail.trim().toLowerCase()));
            emailHash = Array.prototype.map.call(new Uint8Array(emailHashBuf), x => ('00' + x.toString(16)).slice(-2)).join('');
          }

          // Write to DB
          await env.DB.prepare(`
            INSERT INTO licenses (
              license_code, tier, status, max_devices, expires_at, duration_days,
              buyer_email_hash, paddle_transaction_id, paddle_subscription_id, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).bind(
            licenseCode,
            tier,
            "active",
            2,
            expiresAt,
            durationDays,
            emailHash || null,
            transactionId,
            subscriptionId,
            new Date().toISOString()
          ).run();

          return new Response(JSON.stringify({ message: "License generated and fulfilled", license_code: licenseCode }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        // Revoke license on refund
        if (eventType === "transaction.refunded") {
          const transactionId = data.id;
          await env.DB.prepare(
            "UPDATE licenses SET status = 'revoked' WHERE paddle_transaction_id = ?"
          ).bind(transactionId).run();

          return new Response(JSON.stringify({ message: "License revoked due to refund" }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        // Revoke license on subscription cancel / suspend
        if (eventType === "subscription.canceled" || eventType === "subscription.updated") {
          const subscriptionId = data.id;
          const status = data.status;

          // If subscription is canceled, or updated to unpaid states
          if (eventType === "subscription.canceled" || status === "canceled" || status === "past_due" || status === "paused") {
            await env.DB.prepare(
              "UPDATE licenses SET status = 'revoked' WHERE paddle_subscription_id = ?"
            ).bind(subscriptionId).run();

            return new Response(JSON.stringify({ message: "License revoked due to subscription cancellation or non-payment" }), {
              status: 200,
              headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
          }
        }

        return new Response(JSON.stringify({ message: `Webhook event '${eventType}' acknowledged` }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      // 3.5.2 Client License Query (polling to fetch license code instantly after web payment completion)
      if (url.pathname === "/api/v1/paddle/license-query" && request.method === "GET") {
        const transactionId = url.searchParams.get("transaction_id");
        if (!transactionId) {
          return new Response(JSON.stringify({ error: "Missing transaction_id" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        const license = await env.DB.prepare(
          "SELECT license_code, tier, expires_at, status FROM licenses WHERE paddle_transaction_id = ?"
        ).bind(transactionId).first<any>();

        if (!license) {
          return new Response(JSON.stringify({ error: "License not generated yet, pending payment confirmation" }), {
            status: 404,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        return new Response(JSON.stringify({
          status: license.status,
          license_code: license.license_code,
          tier: license.tier,
          expires_at: license.expires_at
        }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      // 4. Health check or basic index
      return new Response(JSON.stringify({ status: "EQT DRM Serverless API Running" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });

    } catch (e: any) {
      return new Response(JSON.stringify({ error: e.message || String(e) }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
  }
};
