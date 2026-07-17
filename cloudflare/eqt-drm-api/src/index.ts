export interface Env {
  DB: D1Database;
  ED25519_PRIVATE_KEY: string; // 64-char hex string (32 bytes raw private key)
  ADMIN_SECRET?: string;       // Secret header to allow manually generating licenses
  GITHUB_TOKEN?: string;       // Optional token to prevent GitHub Rate Limit
  GITHUB_REPO?: string;        // Optional repository path, default 'forpersuit/eqrcp'
  R2_PUBLIC_URL?: string;      // Optional public CDN url for R2 assets download redirection
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
  if (pathname === "/update-metadata.json" && request.method === "GET") {
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
  if (downloadMatch && request.method === "GET") {
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

  return new Response(JSON.stringify({ error: "Not Found" }), {
    status: 404,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
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
      // Route request to download handler if host is download.eqt.net.im
      if (url.hostname === "download.eqt.net.im") {
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

        if (license.expires_at && license.expires_at !== "LIFETIME") {
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

        let finalExpiresAt = license.expires_at || "LIFETIME";
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
        const { tier, max_devices, expires_in_days } = body;

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

        await env.DB.prepare(
          "INSERT INTO licenses (license_code, tier, status, max_devices, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)"
        ).bind(
          licenseCode,
          tier,
          "active",
          maxDev,
          expiresAt,
          new Date().toISOString()
        ).run();

        return new Response(JSON.stringify({
          license_code: licenseCode,
          tier: tier,
          max_devices: maxDev,
          expires_at: expiresAt,
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
