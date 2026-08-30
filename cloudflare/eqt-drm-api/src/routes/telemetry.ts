import { Env } from '../types';
import { clientIpFromRequest, isD1RateLimited } from '../utils/rate-limit';

/**
 * Hash client IP with a secret salt using SHA-256 for privacy compliance.
 */
async function hashClientIp(ip: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(`${ip}:${salt}`);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Double-channel extraction: HTTP headers OR request.cf object
 */
function extractGeoMetadata(request: Request): {
  ip_country: string | null;
  colo: string | null;
  city: string | null;
  region: string | null;
  latitude: number | null;
  longitude: number | null;
} {
  const cf = (request as any).cf;

  const countryRaw = (request.headers.get("cf-ipcountry") || cf?.country || "").trim().toUpperCase();
  const ip_country = countryRaw && countryRaw !== "XX" && countryRaw !== "T1"
    ? countryRaw.slice(0, 8)
    : (countryRaw || null);

  const coloRaw = (cf?.colo || "").trim().toUpperCase();
  const colo = coloRaw ? coloRaw.slice(0, 8) : null;

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

  return { ip_country, colo, city, region, latitude, longitude };
}

export async function handleTelemetryRoutes(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  url: URL,
  corsHeaders: Record<string, string>
): Promise<Response | null> {
  if (url.pathname === "/api/v1/telemetry/download" && request.method === "POST") {
    const clientIp = clientIpFromRequest(request);

    // G1: Rate limiting (60 requests per minute per IP)
    const isRateLimited = await isD1RateLimited(
      env,
      `telemetry:download:${clientIp}`,
      60,
      60 * 1000
    );
    if (isRateLimited) {
      return new Response(JSON.stringify({ error: "Too Many Requests" }), {
        status: 429,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Parse payload with text/plain tolerance (§7.4)
    let body: any = {};
    try {
      const rawText = await request.text();
      if (rawText) {
        body = JSON.parse(rawText);
      }
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // G2: Strict field validation
    const version = String(body.version || "").trim();
    if (!version || version.length > 32 || !/^v?\d+\.\d+\.\d+$/.test(version)) {
      return new Response(JSON.stringify({ error: "Invalid version format" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const filename = String(body.filename || "").trim();
    if (!filename || filename.length > 128 || !/^[a-zA-Z0-9._-]+$/.test(filename)) {
      return new Response(JSON.stringify({ error: "Invalid filename format" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const allowedSources = ['website', 'desktop_update', 'direct'];
    let source = String(body.source || 'website').trim().toLowerCase();
    if (!allowedSources.includes(source)) {
      source = 'website';
    }

    const uaHeader = request.headers.get("user-agent") || "";
    const userAgent = String(body.user_agent || uaHeader).trim().slice(0, 512) || null;

    const refererHeader = request.headers.get("referer") || "";
    const referer = String(body.referer || refererHeader).trim().slice(0, 512) || null;

    const salt = (env.TELEMETRY_SALT || "").trim();
    if (!salt) {
      console.error("CRITICAL SECURITY CONFIG MISMATCH: TELEMETRY_SALT is not configured. Refusing to hash client IP with empty/fallback salt.");
      return new Response(JSON.stringify({ error: "Telemetry service misconfigured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
    const clientIpHash = await hashClientIp(clientIp, salt);
    const { ip_country, colo, city, region, latitude, longitude } = extractGeoMetadata(request);

    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    const fiveSecAgoIso = new Date(now - 5000).toISOString();

    // Asynchronous Atomic INSERT WHERE NOT EXISTS (§5.2 / §7.2 / 108dca6)
    ctx.waitUntil((async () => {
      try {
        await env.DB.prepare(`
          INSERT INTO download_records (
            version, filename, client_ip_hash, ip_country, colo, city, region, latitude, longitude, user_agent, referer, source, created_at
          ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
          WHERE NOT EXISTS (
            SELECT 1 FROM download_records
            WHERE client_ip_hash = ? AND filename = ? AND created_at > ?
          )
        `).bind(
          version,         // 1
          filename,        // 2
          clientIpHash,    // 3
          ip_country,      // 4
          colo,            // 5
          city,            // 6
          region,          // 7
          latitude,        // 8
          longitude,       // 9
          userAgent,       // 10
          referer,         // 11
          source,          // 12
          nowIso,          // 13
          clientIpHash,    // 14
          filename,        // 15
          fiveSecAgoIso    // 16
        ).run();
      } catch (err) {
        console.error("Failed to asynchronously write download telemetry record:", err);
      }
    })());

    return new Response(null, {
      status: 204,
      headers: corsHeaders
    });
  }

  return null;
}
