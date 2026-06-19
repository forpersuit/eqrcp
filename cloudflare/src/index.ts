export interface Env {
  DB: D1Database;
  ED25519_PRIVATE_KEY: string; // 64-char hex string (32 bytes raw private key)
  ADMIN_SECRET?: string;       // Secret header to allow manually generating licenses
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

        // Generate license signature
        // Formulate the raw payload: license_code|tier|uuid_hash|cpu_hash|disk_hash|expires_at
        const payloadStr = `${license_code}|${license.tier}|${uuid_hash || ""}|${cpu_hash || ""}|${disk_hash || ""}|${license.expires_at || "LIFETIME"}`;
        const encoder = new TextEncoder();
        const payloadData = encoder.encode(payloadStr);

        // Import the private key (Ed25519)
        const privateKeyHex = env.ED25519_PRIVATE_KEY;
        if (!privateKeyHex) {
          throw new Error("ED25519_PRIVATE_KEY is not configured in Workers Environment Variables");
        }
        const privateKeyBytes = hexToUint8Array(privateKeyHex);
        
        const key = await crypto.subtle.importKey(
          "raw",
          privateKeyBytes,
          { name: "Ed25519" },
          true,
          ["sign"]
        );

        // Sign the payload
        const signatureBuf = await crypto.subtle.sign("Ed25519", key, payloadData);
        const signatureHex = bufToHex(signatureBuf);

        // Return signed license
        return new Response(JSON.stringify({
          license_code: license_code,
          tier: license.tier,
          uuid_hash: uuid_hash || "",
          cpu_hash: cpu_hash || "",
          disk_hash: disk_hash || "",
          expires_at: license.expires_at || "LIFETIME",
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

      // 3. Health check or basic index
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
