import { Env } from '../types';
import { requireAdminAuth, ensureBetaTestersTable, ensureLicenseSourceColumns } from '../utils/auth';
import { ensureAuditLogTable } from '../utils/error-logger';
import { activationAuditSnapshot, ensureAdminAuditLogTable, logAdminAudit } from '../utils/admin-audit';
import { sendDRMEmail } from '../services/smtp';
import { runHealthProbes } from '../utils/probes';
import {
  addManualBlacklist,
  deactivateManualBlacklist,
  listManualBlacklist,
  type ManualBlacklistKind
} from '../utils/blacklist';
import { rateLimitStatus } from '../utils/rate-limit';
import { normalizeLicenseSource } from '../utils/license-source';
import { isTestEnvironment } from '../utils/env-guard';

function parseBoundedInt(val: string | null | undefined, defaultVal: number, min: number, max: number): number {
  if (val === null || val === undefined || val === '') return defaultVal;
  const n = parseInt(val, 10);
  if (!Number.isFinite(n) || isNaN(n)) return defaultVal;
  return Math.max(min, Math.min(n, max));
}

export async function handleAdminRoutes(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  url: URL,
  corsHeaders: Record<string, string>
): Promise<Response | null> {
  const clientIp = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "";

  // 1. Admin Error Logs Query Endpoint (Server-Side Filtering & Pagination)
  if (url.pathname === "/api/v1/admin/error-logs" && request.method === "GET") {
    const denied = await requireAdminAuth(request, env, corsHeaders);
    if (denied) return denied;
    await ensureAuditLogTable(env);

    const level = (url.searchParams.get("level") || "").trim();
    const category = (url.searchParams.get("category") || "").trim();
    const queryStr = (url.searchParams.get("q") || url.searchParams.get("query") || "").trim();
    const limit = parseBoundedInt(url.searchParams.get("limit"), 50, 1, 200);
    const offset = parseBoundedInt(url.searchParams.get("offset"), 0, 0, 1_000_000);

    const conditions: string[] = [];
    const params: any[] = [];

    if (level && level.toUpperCase() !== "ALL") {
      conditions.push("level = ?");
      params.push(level.toUpperCase());
    }
    if (category && category.toUpperCase() !== "ALL") {
      conditions.push("category = ?");
      params.push(category);
    }
    if (queryStr) {
      conditions.push("(error_message LIKE ? OR context_json LIKE ?)");
      params.push(`%${queryStr}%`, `%${queryStr}%`);
    }

    const whereClause = conditions.length > 0 ? " WHERE " + conditions.join(" AND ") : "";

    const countSql = "SELECT COUNT(*) as total FROM system_error_logs" + whereClause;
    const countRes = await env.DB.prepare(countSql).bind(...params).first<{ total: number }>();
    const total = countRes?.total || 0;

    const logsSql = "SELECT * FROM system_error_logs" + whereClause + " ORDER BY id DESC LIMIT ? OFFSET ?";
    const logsRes = await env.DB.prepare(logsSql).bind(...params, limit, offset).all();

    return new Response(JSON.stringify({
      success: true,
      logs: logsRes.results || [],
      total,
      limit,
      offset
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  // 2. Admin Error Logs Clear Endpoint
  if (
    (url.pathname === "/api/v1/admin/error-logs" && request.method === "DELETE") ||
    (url.pathname === "/api/v1/admin/error-logs/clear" && request.method === "POST")
  ) {
    const denied = await requireAdminAuth(request, env, corsHeaders);
    if (denied) return denied;
    await ensureAuditLogTable(env);
    const errCountRes = await env.DB.prepare("SELECT COUNT(*) as count FROM system_error_logs").first<{ count: number }>();
    const clearedCount = Number(errCountRes?.count || 0);
    await env.DB.prepare("DELETE FROM system_error_logs").run();
    ctx.waitUntil(logAdminAudit(env, 'CLEAR_LOGS', 'SYSTEM', null, {
      cleared_error_log_count: clearedCount,
      note: 'Cleared system_error_logs only; admin_audit_logs retained'
    }, clientIp));
    return new Response(JSON.stringify({ success: true, message: "System error logs cleared successfully" }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  // 2.5 Admin Audit Logs Query Endpoint
  if (url.pathname === "/api/v1/admin/audit-logs" && request.method === "GET") {
    const denied = await requireAdminAuth(request, env, corsHeaders);
    if (denied) return denied;
    await ensureAdminAuditLogTable(env);

    const action = (url.searchParams.get("action") || "").trim();
    const queryStr = (url.searchParams.get("q") || url.searchParams.get("query") || "").trim();
    const limit = parseBoundedInt(url.searchParams.get("limit"), 50, 1, 200);
    const offset = parseBoundedInt(url.searchParams.get("offset"), 0, 0, 1_000_000);

    const conditions: string[] = [];
    const params: any[] = [];

    if (action && action.toUpperCase() !== "ALL") {
      conditions.push("action = ?");
      params.push(action.toUpperCase());
    }
    if (queryStr) {
      conditions.push("(target_id LIKE ? OR details_json LIKE ? OR operator_ip LIKE ?)");
      params.push(`%${queryStr}%`, `%${queryStr}%`, `%${queryStr}%`);
    }

    const whereClause = conditions.length > 0 ? " WHERE " + conditions.join(" AND ") : "";

    const countSql = "SELECT COUNT(*) as total FROM admin_audit_logs" + whereClause;
    const countRes = await env.DB.prepare(countSql).bind(...params).first<{ total: number }>();
    const total = countRes?.total || 0;

    const logsSql = "SELECT * FROM admin_audit_logs" + whereClause + " ORDER BY id DESC LIMIT ? OFFSET ?";
    const logsRes = await env.DB.prepare(logsSql).bind(...params, limit, offset).all();

    return new Response(JSON.stringify({
      success: true,
      logs: logsRes.results || [],
      total,
      limit,
      offset
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  // 3. Admin Endpoint: Manual license generation (supports /generate and /generate-license)
  if ((url.pathname === "/api/v1/admin/generate" || url.pathname === "/api/v1/admin/generate-license") && request.method === "POST") {
    const denied = await requireAdminAuth(request, env, corsHeaders);
    if (denied) return denied;
    await ensureLicenseSourceColumns(env);

    const body: any = await request.json();
    const { tier, max_devices, expires_in_days, duration_days, buyer_email, send_email, source: rawSource, bound_device_id } = body;

    if (tier !== "PLUS" && tier !== "PRO") {
      return new Response(JSON.stringify({ error: "Invalid tier. Must be 'PLUS' or 'PRO'" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Admin may mint promo (campaign), test (sandbox beta tester), or admin (support/internal).
    const sourceRaw = String(rawSource || "admin").trim().toLowerCase();
    const source = sourceRaw === "promo" ? "promo" : (sourceRaw === "test" || sourceRaw === "beta" ? "test" : "admin");
    if (source === "test" && !isTestEnvironment(env, url)) {
      return new Response(JSON.stringify({
        error: "Test licenses with source='test' can only be generated in test/sandbox environment",
        code: "SANDBOX_ONLY"
      }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
    const boundDevice = (bound_device_id || "").trim() || null;

    const todayStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const randBytes = new Uint8Array(6);
    crypto.getRandomValues(randBytes);
    const randStr = Array.from(randBytes, b => ('00' + b.toString(16)).slice(-2)).join('').toUpperCase();
    const prefix = source === "test" ? `EQT-TEST-${tier}` : `EQT-${tier}`;
    const licenseCode = `${prefix}-${todayStr}-${randStr}`;

    let expiresAt = "LIFETIME";
    if (expires_in_days) {
      const expDate = new Date();
      expDate.setDate(expDate.getDate() + Number(expires_in_days));
      expiresAt = expDate.toISOString();
    }

    let maxDev = source === "test" ? 1 : 2;
    if (max_devices !== undefined && max_devices !== null && max_devices !== "") {
      const parsedMax = Number(max_devices);
      if (!Number.isFinite(parsedMax) || isNaN(parsedMax) || parsedMax < 1 || parsedMax > 100) {
        return new Response(JSON.stringify({ error: "max_devices must be an integer between 1 and 100" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
      maxDev = Math.floor(parsedMax);
    }
    const durDays = duration_days !== undefined && duration_days !== null && duration_days !== ""
      ? Number(duration_days)
      : null;
    const cleanEmail = (buyer_email || "").trim();

    // Promo and test codes should have a redeem-by window; duration_days = post-activate entitlement.
    if ((source === "promo" || source === "test") && (!expires_in_days || Number(expires_in_days) <= 0)) {
      return new Response(JSON.stringify({
        error: "Promo and test licenses require expires_in_days (redeem-by window)"
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    let emailHash: string | null = null;
    if (cleanEmail) {
      const encoder = new TextEncoder();
      const emailHashBuf = await crypto.subtle.digest("SHA-256", encoder.encode(cleanEmail.toLowerCase()));
      emailHash = Array.from(new Uint8Array(emailHashBuf), x => ('00' + x.toString(16)).slice(-2)).join('');
    }

    await env.DB.prepare(
      "INSERT INTO licenses (license_code, tier, status, max_devices, expires_at, duration_days, buyer_email_hash, buyer_email, source, bound_device_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(
      licenseCode,
      tier,
      "active",
      maxDev,
      expiresAt,
      durDays,
      emailHash,
      cleanEmail || null,
      source,
      boundDevice,
      new Date().toISOString()
    ).run();

    let emailSent = false;
    if (send_email && cleanEmail) {
      const planName = tier === "PLUS" ? "EQT Plus" : (tier === "PRO" ? "EQT Pro" : tier);
      const expiresStr = expiresAt === "LIFETIME" ? "Lifetime (永久生效)" : new Date(expiresAt).toLocaleDateString();
      const emailHtml = `
        <div style="font-family: sans-serif; padding: 20px; line-height: 1.6; color: #333;">
          <h2 style="color: #156f5a;">您的 EQT 专享授权激活码已发放！</h2>
          <p>管理员已成功为您创建 EQT 许可授权。以下是您的授权明细：</p>
          <table style="border-collapse: collapse; margin: 20px 0; width: 100%; max-width: 600px;">
            <tr>
              <td style="padding: 10px; border: 1px solid #ddd; font-weight: bold; background: #f9f9f9; width: 180px;">授权级别 (Tier)</td>
              <td style="padding: 10px; border: 1px solid #ddd;">${planName}</td>
            </tr>
            <tr>
              <td style="padding: 10px; border: 1px solid #ddd; font-weight: bold; background: #f9f9f9;">激活码 (License Code)</td>
              <td style="padding: 10px; border: 1px solid #ddd; font-family: monospace; font-size: 16px; font-weight: bold; color: #156f5a;">${licenseCode}</td>
            </tr>
            <tr>
              <td style="padding: 10px; border: 1px solid #ddd; font-weight: bold; background: #f9f9f9;">有效期限 (Expires)</td>
              <td style="padding: 10px; border: 1px solid #ddd;">${expiresStr}</td>
            </tr>
            <tr>
              <td style="padding: 10px; border: 1px solid #ddd; font-weight: bold; background: #f9f9f9;">最大激活设备数</td>
              <td style="padding: 10px; border: 1px solid #ddd;">${maxDev} 台设备</td>
            </tr>
          </table>
          <p><strong>如何激活：</strong></p>
          <ol>
            <li>打开 EQT 客户端，前往设置或关于面板。</li>
            <li>点击“输入激活码”并输入上述激活码，确认即可享受高级传输体验！</li>
          </ol>
        </div>
      `;
      ctx.waitUntil(sendDRMEmail(env, cleanEmail, "【EQT】您的专属授权激活码", emailHtml));
      emailSent = true;
    }

    ctx.waitUntil(logAdminAudit(env, 'GENERATE', 'LICENSE', licenseCode, {
      license_code: licenseCode,
      tier,
      max_devices: maxDev,
      expires_at: expiresAt,
      duration_days: durDays,
      expires_in_days: expires_in_days != null && expires_in_days !== '' ? Number(expires_in_days) : null,
      buyer_email: cleanEmail || null,
      send_email_requested: Boolean(send_email),
      email_sent: emailSent,
      status: 'active',
      source
    }, clientIp));

    return new Response(JSON.stringify({
      success: true,
      license_code: licenseCode,
      tier: tier,
      max_devices: maxDev,
      source,
      expires_at: expiresAt,
      duration_days: durDays,
      buyer_email: cleanEmail || null,
      email_sent: emailSent,
      status: "active"
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  // 3.8 Admin Endpoint (legacy): Active License Locations Aggregation — authorization-distribution
  // view over activations. KEPT per design doc §4.4 ("授权分布口径"). Active-device view
  // (paid/free, time window) lives at §3.9 /api/v1/admin/devices/live.
  if (url.pathname === "/api/v1/admin/activation-locations" && request.method === "GET") {
    const denied = await requireAdminAuth(request, env, corsHeaders);
    if (denied) return denied;

    const locationsSql = `
      SELECT 
        a.ip_country as country, 
        a.region as region,
        a.city as city,
        a.latitude as latitude,
        a.longitude as longitude,
        COUNT(a.id) as active_count,
        MAX(a.activated_at) as latest_activated_at
      FROM activations a
      JOIN licenses l ON a.license_code = l.license_code
      WHERE l.status = 'active' AND a.ip_country IS NOT NULL AND a.ip_country != ''
      GROUP BY a.ip_country, a.region, a.city, a.latitude, a.longitude
    `;
    const locRes = await env.DB.prepare(locationsSql).all<{
      country: string;
      region?: string | null;
      city?: string | null;
      latitude?: number | null;
      longitude?: number | null;
      active_count: number;
      latest_activated_at: string;
    }>();

    // Build city-level cross-location arcs for SAME license key
    const rawActivationsSql = `
      SELECT 
        a.license_code,
        a.ip_country as country,
        a.region as region,
        a.city as city,
        a.latitude as latitude,
        a.longitude as longitude
      FROM activations a
      JOIN licenses l ON a.license_code = l.license_code
      WHERE l.status = 'active' AND a.ip_country IS NOT NULL AND a.ip_country != ''
    `;
    const rawRes = await env.DB.prepare(rawActivationsSql).all<{
      license_code: string;
      country: string;
      region?: string | null;
      city?: string | null;
      latitude?: number | null;
      longitude?: number | null;
    }>();
    const rawList = rawRes.results || [];

    const keyNodesMap = new Map<string, Array<{ country: string; region?: string; city?: string; latitude?: number; longitude?: number }>>();
    for (const item of rawList) {
      const code = item.license_code;
      if (!keyNodesMap.has(code)) {
        keyNodesMap.set(code, []);
      }
      keyNodesMap.get(code)!.push({
        country: item.country.toUpperCase(),
        region: item.region || undefined,
        city: item.city || undefined,
        latitude: item.latitude || undefined,
        longitude: item.longitude || undefined
      });
    }

    const crossRegionArcs: {
      license_code: string;
      from_country: string;
      from_city?: string;
      from_lat?: number;
      from_lng?: number;
      to_country: string;
      to_city?: string;
      to_lat?: number;
      to_lng?: number;
    }[] = [];
    const seenPairs = new Set<string>();

    for (const [code, nodes] of keyNodesMap.entries()) {
      if (nodes.length > 1) {
        for (let i = 0; i < nodes.length; i++) {
          for (let j = i + 1; j < nodes.length; j++) {
            const n1 = nodes[i];
            const n2 = nodes[j];
            const locKey1 = `${n1.country}:${n1.region || ''}:${n1.city || ''}`;
            const locKey2 = `${n2.country}:${n2.region || ''}:${n2.city || ''}`;

            if (locKey1 !== locKey2) {
              const pairKey = `${code}:${locKey1}->${locKey2}`;
              if (!seenPairs.has(pairKey)) {
                seenPairs.add(pairKey);
                crossRegionArcs.push({
                  license_code: code,
                  from_country: n1.country,
                  from_city: n1.city,
                  from_lat: n1.latitude,
                  from_lng: n1.longitude,
                  to_country: n2.country,
                  to_city: n2.city,
                  to_lat: n2.latitude,
                  to_lng: n2.longitude
                });
              }
            }
          }
        }
      }
    }

    const totalActiveDevicesSql = `
      SELECT COUNT(a.id) as total
      FROM activations a
      JOIN licenses l ON a.license_code = l.license_code
      WHERE l.status = 'active'
    `;
    const totalRes = await env.DB.prepare(totalActiveDevicesSql).first<{ total: number }>();

    ctx.waitUntil(logAdminAudit(env, 'QUERY_ACTIVATION_LOCATIONS', 'LICENSE', null, {
      total_active_devices: totalRes?.total || 0,
      active_country_count: (locRes.results || []).length,
      cross_region_arcs_count: crossRegionArcs.length
    }, clientIp));

    return new Response(JSON.stringify({
      success: true,
      locations: locRes.results || [],
      total_active_devices: totalRes?.total || 0,
      cross_region_arcs: crossRegionArcs
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  // 3.9 Admin Endpoint: Live devices from device_registry (paid/free, time window, optional arcs)
  if (url.pathname === "/api/v1/admin/devices/live" && request.method === "GET") {
    const denied = await requireAdminAuth(request, env, corsHeaders);
    if (denied) return denied;

    const windowParam = (url.searchParams.get("window") || "1h").trim();
    const arcsParam = url.searchParams.get("arcs") === "1";

    const WINDOW_MS: Record<string, number> = {
      "1h": 60 * 60 * 1000,
      "12h": 12 * 60 * 60 * 1000,
      "24h": 24 * 60 * 60 * 1000,
      "7d": 7 * 24 * 60 * 60 * 1000
    };
    // Invalid window values silently fall back to 1h (reviewer P3); echo the EFFECTIVE
    // window so the response never claims a window that wasn't applied.
    const effectiveWindow = WINDOW_MS[windowParam] ? windowParam : "1h";
    const windowMs = WINDOW_MS[effectiveWindow];
    const cutoff = new Date(Date.now() - windowMs).toISOString();

    const locationsSql = `
      SELECT
        ip_country AS country,
        region,
        city,
        latitude,
        longitude,
        SUM(CASE WHEN tier_label = 'paid' THEN 1 ELSE 0 END) AS paid_count,
        SUM(CASE WHEN tier_label = 'free' THEN 1 ELSE 0 END) AS free_count,
        COUNT(*) AS total_count,
        MAX(last_seen_at) AS latest_seen_at
      FROM device_registry
      WHERE last_seen_at >= ?
        AND ip_country IS NOT NULL AND ip_country != ''
        AND latitude IS NOT NULL AND longitude IS NOT NULL
      GROUP BY ip_country, region, city, latitude, longitude
      ORDER BY total_count DESC
    `;
    const locRes = await env.DB.prepare(locationsSql).bind(cutoff).all<{
      country: string;
      region?: string | null;
      city?: string | null;
      latitude: number;
      longitude: number;
      paid_count: number;
      free_count: number;
      total_count: number;
      latest_seen_at: string;
    }>();

    const locations = locRes.results || [];
    let totalActiveDevices = 0;
    let totalPaidDevices = 0;
    let totalFreeDevices = 0;
    for (const loc of locations) {
      totalActiveDevices += loc.total_count;
      totalPaidDevices += loc.paid_count;
      totalFreeDevices += loc.free_count;
    }

    let crossRegionArcs: {
      license_code: string;
      email?: string;
      from_country: string;
      from_city?: string;
      from_lat: number;
      from_lng: number;
      to_country: string;
      to_city?: string;
      to_lat: number;
      to_lng: number;
    }[] = [];

    if (arcsParam) {
      // Arc semantics (§4.4): group by license_code — one license redeemed on multiple
      // devices (each its own device_registry row) that appear in different cities/
      // countries. device_registry is one row per device (device_id PK), so grouping by
      // device_id would always yield a single node (dead code). Free devices have
      // license_code = NULL and are excluded by the filter below.
      const rawSql = `
        SELECT license_code, email, ip_country AS country, city, latitude, longitude
        FROM device_registry
        WHERE last_seen_at >= ?
          AND license_code IS NOT NULL AND license_code != ''
          AND ip_country IS NOT NULL AND ip_country != ''
          AND latitude IS NOT NULL AND longitude IS NOT NULL
        ORDER BY license_code
      `;
      const rawRes = await env.DB.prepare(rawSql).bind(cutoff).all<{
        license_code: string;
        email?: string | null;
        country: string;
        city?: string | null;
        latitude: number;
        longitude: number;
      }>();
      const rawList = rawRes.results || [];

      const codeNodesMap = new Map<string, Array<{ country: string; city?: string; latitude: number; longitude: number; email?: string }>>();
      for (const item of rawList) {
        const code = item.license_code;
        if (!codeNodesMap.has(code)) {
          codeNodesMap.set(code, []);
        }
        codeNodesMap.get(code)!.push({
          country: item.country.toUpperCase(),
          city: item.city || undefined,
          latitude: item.latitude,
          longitude: item.longitude,
          email: item.email || undefined
        });
      }

      const seenPairs = new Set<string>();
      for (const [code, nodes] of codeNodesMap.entries()) {
        if (nodes.length > 1) {
          for (let i = 0; i < nodes.length; i++) {
            for (let j = i + 1; j < nodes.length; j++) {
              const n1 = nodes[i];
              const n2 = nodes[j];
              const locKey1 = `${n1.country}:${n1.city || ''}`;
              const locKey2 = `${n2.country}:${n2.city || ''}`;
              if (locKey1 === locKey2) continue;
              // Normalize the unordered city pair (min->max lexicographic) so a given
              // pair ALWAYS produces the same directional arc. Node order within a code
              // is rowid order (not semantic), so without normalization the same visual
              // pair could flip A->B / B->A across reloads — and never emit both at once.
              const [fromKey, toKey] = [locKey1, locKey2].sort();
              const pairKey = `${code}:${fromKey}->${toKey}`;
              if (seenPairs.has(pairKey)) continue;
              seenPairs.add(pairKey);
              // fromNode is whichever raw node matches the normalized "from" key.
              const [fromNode, toNode] = locKey1 === fromKey ? [n1, n2] : [n2, n1];
              const arcEmail = n1.email || n2.email || undefined;
              crossRegionArcs.push({
                license_code: code,
                email: arcEmail,
                from_country: fromNode.country,
                from_city: fromNode.city,
                from_lat: fromNode.latitude,
                from_lng: fromNode.longitude,
                to_country: toNode.country,
                to_city: toNode.city,
                to_lat: toNode.latitude,
                to_lng: toNode.longitude
              });
            }
          }
        }
      }
    }

    ctx.waitUntil(logAdminAudit(env, 'QUERY_LIVE_DEVICES', 'SYSTEM', null, {
      window: effectiveWindow,
      total_active_devices: totalActiveDevices,
      total_paid_devices: totalPaidDevices,
      total_free_devices: totalFreeDevices,
      location_count: locations.length,
      cross_region_arcs_count: crossRegionArcs.length
    }, clientIp));

    return new Response(JSON.stringify({
      success: true,
      window: effectiveWindow,
      locations,
      total_active_devices: totalActiveDevices,
      total_paid_devices: totalPaidDevices,
      total_free_devices: totalFreeDevices,
      cross_region_arcs: crossRegionArcs
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  // 4. Admin Endpoint: Search all licenses (sort by created_at; real activations columns)
  if (url.pathname === "/api/v1/admin/licenses" && request.method === "GET") {
    const denied = await requireAdminAuth(request, env, corsHeaders);
    if (denied) return denied;

    const queryStr = (url.searchParams.get("q") || url.searchParams.get("query") || "").trim();
    const limit = parseBoundedInt(url.searchParams.get("limit"), 50, 1, 200);
    const offset = parseBoundedInt(url.searchParams.get("offset"), 0, 0, 1_000_000);

    let whereClause = "";
    let params: any[] = [];

    if (queryStr) {
      let emailHash = "";
      if (queryStr.includes("@")) {
        const encoder = new TextEncoder();
        const emailHashBuf = await crypto.subtle.digest("SHA-256", encoder.encode(queryStr.toLowerCase()));
        emailHash = Array.from(new Uint8Array(emailHashBuf), x => ('00' + x.toString(16)).slice(-2)).join('');
      }
      const likeQuery = `%${queryStr}%`;
      whereClause = " WHERE license_code LIKE ? OR buyer_email LIKE ? OR paddle_transaction_id LIKE ? OR buyer_email_hash = ?";
      params = [likeQuery, likeQuery, likeQuery, emailHash || queryStr];
    }

    const countSql = "SELECT COUNT(*) as total FROM licenses" + whereClause;
    const countRes = await env.DB.prepare(countSql).bind(...params).first<{ total: number }>();
    const total = countRes?.total || 0;

    const sql = "SELECT * FROM licenses" + whereClause + " ORDER BY created_at DESC LIMIT ? OFFSET ?";
    const res = await env.DB.prepare(sql).bind(...params, limit, offset).all();
    const rawLicenses: any[] = res.results || [];
    let licensesWithDevices: any[] = [];

    if (rawLicenses.length > 0) {
      const licenseCodes = rawLicenses.map(lic => lic.license_code);
      const placeholders = licenseCodes.map(() => '?').join(',');
      const actSql = `SELECT id, license_code, uuid_hash, cpu_hash, disk_hash, device_id, activated_at, client_ip, ip_country, user_agent FROM activations WHERE license_code IN (${placeholders}) ORDER BY id ASC`;
      const actRes = await env.DB.prepare(actSql).bind(...licenseCodes).all();
      const rawActivations: any[] = actRes.results || [];

      const activationsMap = new Map<string, any[]>();
      for (const act of rawActivations) {
        const list = activationsMap.get(act.license_code) || [];
        list.push(act);
        activationsMap.set(act.license_code, list);
      }

      licensesWithDevices = rawLicenses.map((lic) => {
        const acts = activationsMap.get(lic.license_code) || [];
        const source = normalizeLicenseSource(lic.source, lic.paddle_transaction_id);
        return {
          ...lic,
          source,
          active_devices_count: acts.length,
          activations: acts
        };
      });
    }

    return new Response(JSON.stringify({
      success: true,
      licenses: licensesWithDevices,
      total,
      limit,
      offset
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  // 5. Admin Endpoint: Revoke license (supports /revoke and /revoke-license)
  if ((url.pathname === "/api/v1/admin/revoke" || url.pathname === "/api/v1/admin/revoke-license") && request.method === "POST") {
    const denied = await requireAdminAuth(request, env, corsHeaders);
    if (denied) return denied;

    const body: any = await request.json();
    const { license_code } = body;
    if (!license_code) {
      return new Response(JSON.stringify({ error: "license_code is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const existing = await env.DB.prepare(
      "SELECT * FROM licenses WHERE license_code = ?"
    ).bind(license_code).first<any>();

    if (!existing) {
      return new Response(JSON.stringify({ error: "License not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const actRes = await env.DB.prepare(
      "SELECT id, license_code, uuid_hash, cpu_hash, disk_hash, device_id, activated_at, client_ip, ip_country, user_agent FROM activations WHERE license_code = ? ORDER BY id ASC"
    ).bind(license_code).all();
    const activationsAtRevoke = (actRes.results || []).map(activationAuditSnapshot);

    await env.DB.prepare(
      `UPDATE licenses
       SET status = 'revoked',
           revoked_at = COALESCE(revoked_at, ?),
           revoke_reason = COALESCE(revoke_reason, 'admin')
       WHERE license_code = ?`
    ).bind(new Date().toISOString(), license_code).run();
    // B5: Downgrade device_registry to 'free' on admin revoke
    await env.DB.prepare(
      "UPDATE device_registry SET tier_label = 'free', license_code = NULL, email = NULL WHERE license_code = ?"
    ).bind(license_code).run();
    ctx.waitUntil(logAdminAudit(env, 'REVOKE', 'LICENSE', license_code, {
      revoke_reason: 'admin',
      license_code,
      previous_status: existing.status,
      new_status: 'revoked',
      tier: existing.tier,
      max_devices: existing.max_devices,
      expires_at: existing.expires_at,
      duration_days: existing.duration_days ?? null,
      buyer_email: existing.buyer_email ?? null,
      paddle_transaction_id: existing.paddle_transaction_id ?? null,
      paddle_subscription_id: existing.paddle_subscription_id ?? null,
      active_devices_count: activationsAtRevoke.length,
      activations_snapshot: activationsAtRevoke,
      activations_deleted: false,
      note: 'Status set to revoked only; activation rows kept until unbind/expiry sync'
    }, clientIp));

    return new Response(JSON.stringify({
      success: true,
      message: `License ${license_code} revoked successfully`,
      license_code,
      status: "revoked"
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  // 6. Admin Endpoint: Unbind devices by activation_id (or clear all for license)
  if (url.pathname === "/api/v1/admin/unbind" && request.method === "POST") {
    const denied = await requireAdminAuth(request, env, corsHeaders);
    if (denied) return denied;

    const body: any = await request.json();
    const { license_code, activation_id } = body;
    if (!license_code) {
      return new Response(JSON.stringify({ error: "license_code is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const lic = await env.DB.prepare(
      "SELECT license_code FROM licenses WHERE license_code = ?"
    ).bind(license_code).first<any>();
    if (!lic) {
      return new Response(JSON.stringify({ error: "License not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    let unboundActivationId: number | null = null;
    let auditDetails: Record<string, unknown>;

    if (activation_id !== undefined && activation_id !== null && activation_id !== "") {
      const actId = Number(activation_id);
      if (!Number.isFinite(actId)) {
        return new Response(JSON.stringify({ error: "activation_id must be a number" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
      const act = await env.DB.prepare(
        "SELECT id, license_code, uuid_hash, cpu_hash, disk_hash, device_id, activated_at, client_ip, ip_country, user_agent FROM activations WHERE id = ? AND license_code = ?"
      ).bind(actId, license_code).first<any>();
      if (!act) {
        return new Response(JSON.stringify({ error: "Activation not found for this license" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
      const cleanupBatch = [
        env.DB.prepare("DELETE FROM activations WHERE id = ? AND license_code = ?").bind(actId, license_code)
      ];
      if (act.device_id) {
        cleanupBatch.push(
          env.DB.prepare("UPDATE device_registry SET tier_label = 'free', license_code = NULL, email = NULL WHERE device_id = ?").bind(act.device_id)
        );
      }
      await env.DB.batch(cleanupBatch);
      unboundActivationId = actId;
      auditDetails = {
        mode: 'single',
        license_code,
        activation_id: actId,
        unbound_count: 1,
        activation_ids: [actId],
        device_snapshot: activationAuditSnapshot(act),
        devices_snapshot: [activationAuditSnapshot(act)],
        counts_toward_user_quota: false,
        note: 'Admin unbind does not insert unbind_records (user 4/year quota unchanged)'
      };
    } else {
      const actRes = await env.DB.prepare(
        "SELECT id, license_code, uuid_hash, cpu_hash, disk_hash, device_id, activated_at, client_ip, ip_country, user_agent FROM activations WHERE license_code = ? ORDER BY id ASC"
      ).bind(license_code).all();
      const acts = actRes.results || [];
      const snaps = acts.map(activationAuditSnapshot);
      const ids = acts.map((a: any) => a.id);
      const deviceIds = acts.map((a: any) => a.device_id).filter(Boolean);
      const batchStmts = [
        env.DB.prepare("DELETE FROM activations WHERE license_code = ?").bind(license_code)
      ];
      for (const dId of deviceIds) {
        batchStmts.push(
          env.DB.prepare("UPDATE device_registry SET tier_label = 'free', license_code = NULL, email = NULL WHERE device_id = ?").bind(dId)
        );
      }
      await env.DB.batch(batchStmts);
      auditDetails = {
        mode: 'clear_all',
        license_code,
        activation_id: null,
        unbound_count: snaps.length,
        activation_ids: ids,
        devices_snapshot: snaps,
        counts_toward_user_quota: false,
        note: 'Admin clear-all unbind; does not insert unbind_records (user 4/year quota unchanged)'
      };
    }

    ctx.waitUntil(logAdminAudit(
      env,
      'UNBIND',
      unboundActivationId ? 'ACTIVATION' : 'LICENSE',
      unboundActivationId ? String(unboundActivationId) : license_code,
      auditDetails,
      clientIp
    ));

    return new Response(JSON.stringify({
      success: true,
      message: `Devices for license ${license_code} unbound successfully`,
      license_code,
      unbound_activation_id: unboundActivationId,
      unbound_count: auditDetails.unbound_count,
      counts_toward_user_quota: false
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  // 7. Admin Endpoint: System Health Probe & Enriched KPI Metrics
  if (url.pathname === "/api/v1/admin/health" && request.method === "GET") {
    const denied = await requireAdminAuth(request, env, corsHeaders);
    if (denied) return denied;

    let dbStatus = "ok";
    let errorCount = 0;
    let licenseCount = 0;
    let activeLicenseCount = 0;
    let todayActivationCount = 0;
    let errors24hCount = 0;

    try {
      const licCountRes = await env.DB.prepare("SELECT count(*) as count FROM licenses").first<{ count: number }>();
      licenseCount = licCountRes?.count || 0;

      const activeLicRes = await env.DB.prepare("SELECT count(*) as count FROM licenses WHERE status = 'active'").first<{ count: number }>();
      activeLicenseCount = activeLicRes?.count || 0;

      const todayStart = new Date().toISOString().slice(0, 10);
      const todayActRes = await env.DB.prepare("SELECT count(*) as count FROM activations WHERE activated_at >= ?").bind(todayStart).first<{ count: number }>();
      todayActivationCount = todayActRes?.count || 0;

      await ensureAuditLogTable(env);
      const errCountRes = await env.DB.prepare("SELECT count(*) as count FROM system_error_logs").first<{ count: number }>();
      errorCount = errCountRes?.count || 0;

      const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const err24hRes = await env.DB.prepare("SELECT count(*) as count FROM system_error_logs WHERE created_at >= ?").bind(dayAgo).first<{ count: number }>();
      errors24hCount = err24hRes?.count || 0;
    } catch (err) {
      dbStatus = "error";
    }

    const smtpConfigured = Boolean(env.MAIL_SENDER && env.MAIL_SENDER_PASSWORD && env.MAIL_SEND_SERVER);
    const paddleConfigured = Boolean(env.PADDLE_WEBHOOK_SECRET);
    const r2Configured = Boolean(env.R2_PUBLIC_URL);

    // Live probes (bounded timeouts) + recent Paddle/SMTP related error rows as webhook timeline proxy
    const probeQuery = url.searchParams.get("probe");
    const skipProbes = probeQuery === "0" || probeQuery === "false" || url.searchParams.get("quick") === "1";
    const forceFresh = url.searchParams.get("fresh") === "1" || url.searchParams.get("fresh") === "true";

    let probes;
    if (skipProbes) {
      probes = {
        db: { ok: dbStatus === "ok", latency_ms: 0, error: dbStatus === "ok" ? null : "D1 query error", mode: "quick" },
        smtp: { ok: smtpConfigured, latency_ms: 0, error: null, skipped: true },
        paddle: { ok: paddleConfigured, latency_ms: 0, error: null, skipped: true }
      };
    } else {
      probes = await runHealthProbes(env, forceFresh);
    }

    let recentEvents: any[] = [];
    try {
      await ensureAuditLogTable(env);
      const evRes = await env.DB.prepare(
        `SELECT id, level, category, error_message, created_at FROM system_error_logs
         WHERE category IN ('PADDLE_WEBHOOK', 'PADDLE_API_ERROR', 'SMTP_ERROR', 'SMTP_EMAIL_FAIL')
         ORDER BY id DESC LIMIT 15`
      ).all();
      recentEvents = evRes.results || [];
    } catch {
      recentEvents = [];
    }

    // config keys are contract SSOT (docs/admin/api-contract.md). Keep both
    // canonical short names and explicit *_webhook / detail flags for UI badges.
    return new Response(JSON.stringify({
      success: true,
      status: probes.db.ok ? "healthy" : "degraded",
      timestamp: new Date().toISOString(),
      metrics: {
        total_licenses: licenseCount,
        active_licenses: activeLicenseCount,
        today_activations: todayActivationCount,
        total_error_logs: errorCount,
        errors_24h: errors24hCount
      },
      config: {
        db_status: dbStatus,
        db_connected: dbStatus === "ok",
        smtp_configured: smtpConfigured,
        paddle_configured: paddleConfigured,
        paddle_webhook_configured: paddleConfigured,
        r2_configured: r2Configured,
        ed25519_key_configured: Boolean(env.ED25519_PRIVATE_KEY),
        access_configured: Boolean(env.CF_ACCESS_TEAM_DOMAIN && env.CF_ACCESS_AUD)
      },
      probes: {
        smtp: probes.smtp,
        paddle: probes.paddle,
        db: probes.db
      },
      recent_events: recentEvents
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  // 7.5 Admin Endpoint: Business Metrics Dashboard (§7.2 P1 业务指标仪表盘)
  if (url.pathname === "/api/v1/admin/metrics" && request.method === "GET") {
    const denied = await requireAdminAuth(request, env, corsHeaders);
    if (denied) return denied;

    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    let dailyActiveDevices = 0;
    let activationSuccessRate: number | null = null;
    let tierDistribution: { tier: string; count: number }[] = [];
    let crashTrend: { date: string; count: number }[] = [];
    let rateLimitHits24h = 0;

    try {
      // 1. Daily active devices (last 24h)
      const daRes = await env.DB.prepare(
        "SELECT COUNT(*) as count FROM device_registry WHERE last_seen_at >= ?"
      ).bind(dayAgo).first<{ count: number }>();
      dailyActiveDevices = daRes?.count || 0;

      // 2. Activation success rate (last 7 days)
      const totalActRes = await env.DB.prepare(
        "SELECT COUNT(*) as count FROM activations WHERE activated_at >= ?"
      ).bind(weekAgo).first<{ count: number }>();
      const totalActivations = totalActRes?.count || 0;
      // Count successful activations (activations that led to a device_registry entry with paid tier)
      const successActRes = await env.DB.prepare(
        `SELECT COUNT(DISTINCT a.id) as count
         FROM activations a
         JOIN device_registry d ON a.device_id = d.device_id
         WHERE a.activated_at >= ? AND d.tier_label = 'paid'`
      ).bind(weekAgo).first<{ count: number }>();
      const successActivations = successActRes?.count || 0;
      activationSuccessRate = totalActivations > 0 ? Math.round((successActivations / totalActivations) * 10000) / 100 : null;

      // 3. License tier distribution
      const tierRes = await env.DB.prepare(
        "SELECT tier, COUNT(*) as count FROM licenses GROUP BY tier ORDER BY count DESC"
      ).all<{ tier: string; count: number }>();
      tierDistribution = (tierRes.results || []).map(r => ({ tier: r.tier, count: r.count }));

      // 4. Crash trend (daily count, last 30 days)
      const crashRes = await env.DB.prepare(
        `SELECT date(created_at) as date, COUNT(*) as count
         FROM system_error_logs
         WHERE category = 'DESKTOP_CRASH' AND created_at >= ?
         GROUP BY date(created_at)
         ORDER BY date ASC`
      ).bind(monthAgo).all<{ date: string; count: number }>();
      crashTrend = (crashRes.results || []).map(r => ({ date: r.date, count: r.count }));

      // 5. Rate limit hit count (last 24h)
      const rlRes = await env.DB.prepare(
        "SELECT COUNT(*) as count FROM system_error_logs WHERE category LIKE 'RATE_LIMIT_%' AND created_at >= ?"
      ).bind(dayAgo).first<{ count: number }>();
      rateLimitHits24h = rlRes?.count || 0;
    } catch (err) {
      // Non-critical: return partial data on query failure
      console.error("Metrics query error:", err);
    }

    return new Response(JSON.stringify({
      success: true,
      timestamp: new Date().toISOString(),
      metrics: {
        daily_active_devices: dailyActiveDevices,
        activation_success_rate: activationSuccessRate,
        tier_distribution: tierDistribution,
        crash_trend: crashTrend,
        rate_limit_hits_24h: rateLimitHits24h
      }
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  // 8. Admin Endpoint: System Prune — delete old logs (§3 P1 数据清理管理端点)
  if (url.pathname === "/api/v1/admin/system/prune" && request.method === "POST") {
    const denied = await requireAdminAuth(request, env, corsHeaders);
    if (denied) return denied;
    await ensureAuditLogTable(env);
    await ensureAdminAuditLogTable(env);

    const now = new Date().toISOString();
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

    // Delete system_error_logs older than 30 days
    const errDelRes = await env.DB.prepare(
      "DELETE FROM system_error_logs WHERE created_at < ?"
    ).bind(thirtyDaysAgo).run();
    const deletedErrorLogs = errDelRes.meta.changes || 0;

    // Delete admin_audit_logs older than 90 days
    const auditDelRes = await env.DB.prepare(
      "DELETE FROM admin_audit_logs WHERE created_at < ?"
    ).bind(ninetyDaysAgo).run();
    const deletedAuditLogs = auditDelRes.meta.changes || 0;

    ctx.waitUntil(logAdminAudit(env, 'PRUNE', 'SYSTEM', null, {
      deleted_error_logs: deletedErrorLogs,
      deleted_audit_logs: deletedAuditLogs,
      error_logs_older_than_days: 30,
      audit_logs_older_than_days: 90
    }, clientIp));

    return new Response(JSON.stringify({
      success: true,
      message: "System logs pruned successfully",
      deleted_error_logs: deletedErrorLogs,
      deleted_audit_logs: deletedAuditLogs
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  // 8.5 Admin Endpoint: Rate Limit Status — read-only view of current isolate buckets (§3 P1 限流可见性)
  if (url.pathname === "/api/v1/admin/rate-limit-status" && request.method === "GET") {
    const denied = await requireAdminAuth(request, env, corsHeaders);
    if (denied) return denied;

    const status = rateLimitStatus();

    return new Response(JSON.stringify({
      success: true,
      status,
      note: "In-isolate only — multi-region deployments have independent counts"
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  // 9. Manual blacklist management (email / device)
  if (url.pathname === "/api/v1/admin/blacklist" && request.method === "GET") {
    const denied = await requireAdminAuth(request, env, corsHeaders);
    if (denied) return denied;

    const kind = (url.searchParams.get("kind") || "").trim();
    const q = (url.searchParams.get("q") || "").trim();
    const includeInactive = url.searchParams.get("include_inactive") === "1";
    const limit = parseBoundedInt(url.searchParams.get("limit"), 100, 1, 200);
    const offset = parseBoundedInt(url.searchParams.get("offset"), 0, 0, 1_000_000);

    const { rows, total } = await listManualBlacklist(env, {
      kind: kind || undefined,
      q: q || undefined,
      activeOnly: !includeInactive,
      limit,
      offset
    });

    return new Response(JSON.stringify({
      success: true,
      entries: rows,
      total,
      limit,
      offset
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  if (url.pathname === "/api/v1/admin/blacklist" && request.method === "POST") {
    const denied = await requireAdminAuth(request, env, corsHeaders);
    if (denied) return denied;

    let body: any = {};
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const kind = String(body.kind || "").toLowerCase() as ManualBlacklistKind;
    const operator = String((request as any).__adminEmail || "");
    const result = await addManualBlacklist(env, {
      kind,
      email: body.email,
      device_id: body.device_id,
      uuid_hash: body.uuid_hash,
      cpu_hash: body.cpu_hash,
      disk_hash: body.disk_hash,
      reason: body.reason,
      created_by: operator
    });

    if (!result.ok) {
      return new Response(JSON.stringify({ error: result.error }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    await logAdminAudit(
      env,
      "BLACKLIST_ADD",
      "BLACKLIST",
      String(result.row.id),
      { kind: result.row.kind, email: result.row.email, device_id: result.row.device_id, reason: result.row.reason },
      clientIp
    );

    return new Response(JSON.stringify({ success: true, entry: result.row }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  // DELETE /api/v1/admin/blacklist/:id  (soft unban)
  const blDeleteMatch = url.pathname.match(/^\/api\/v1\/admin\/blacklist\/(\d+)$/);
  if (blDeleteMatch && request.method === "DELETE") {
    const denied = await requireAdminAuth(request, env, corsHeaders);
    if (denied) return denied;

    const id = parseInt(blDeleteMatch[1], 10);
    const row = await deactivateManualBlacklist(env, id);
    if (!row) {
      return new Response(JSON.stringify({ error: "Blacklist entry not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    await logAdminAudit(
      env,
      "BLACKLIST_REMOVE",
      "BLACKLIST",
      String(id),
      { kind: row.kind, email: row.email, device_id: row.device_id },
      clientIp
    );

    return new Response(JSON.stringify({ success: true, entry: row }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  // GET /api/v1/admin/sandbox/testers
  if (url.pathname === "/api/v1/admin/sandbox/testers" && request.method === "GET") {
    const denied = await requireAdminAuth(request, env, corsHeaders);
    if (denied) return denied;
    if (!isTestEnvironment(env, url)) {
      return new Response(JSON.stringify({
        error: "Sandbox endpoints are strictly disabled in production environment",
        code: "SANDBOX_ONLY"
      }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
    await ensureBetaTestersTable(env);

    const rows = await env.DB.prepare(
      "SELECT * FROM sandbox_beta_testers ORDER BY id ASC"
    ).all<any>();

    return new Response(JSON.stringify({
      success: true,
      testers: rows.results || []
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  // POST /api/v1/admin/sandbox/testers
  if (url.pathname === "/api/v1/admin/sandbox/testers" && request.method === "POST") {
    const denied = await requireAdminAuth(request, env, corsHeaders);
    if (denied) return denied;
    if (!isTestEnvironment(env, url)) {
      return new Response(JSON.stringify({
        error: "Sandbox endpoints are strictly disabled in production environment",
        code: "SANDBOX_ONLY"
      }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
    await ensureBetaTestersTable(env);

    const body: any = await request.json().catch(() => ({}));
    const deviceId = (body.device_id || "").trim() || null;
    const email = (body.email || "").trim() || null;
    const notes = (body.notes || "").trim() || null;

    if (!deviceId && !email) {
      return new Response(JSON.stringify({ error: "Must specify at least device_id or email" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const now = new Date().toISOString();
    const res = await env.DB.prepare(
      "INSERT INTO sandbox_beta_testers (device_id, email, notes, status, created_at) VALUES (?, ?, ?, 'active', ?)"
    ).bind(deviceId, email, notes, now).run();

    return new Response(JSON.stringify({
      success: true,
      id: res.meta?.last_row_id || 0
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  // DELETE /api/v1/admin/sandbox/testers
  if ((url.pathname === "/api/v1/admin/sandbox/testers" && request.method === "DELETE") || url.pathname.startsWith("/api/v1/admin/sandbox/testers/")) {
    const denied = await requireAdminAuth(request, env, corsHeaders);
    if (denied) return denied;
    if (!isTestEnvironment(env, url)) {
      return new Response(JSON.stringify({
        error: "Sandbox endpoints are strictly disabled in production environment",
        code: "SANDBOX_ONLY"
      }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
    await ensureBetaTestersTable(env);

    let targetId: number | null = null;
    const match = url.pathname.match(/^\/api\/v1\/admin\/sandbox\/testers\/(\d+)$/);
    if (match) {
      targetId = parseInt(match[1], 10);
    } else {
      const body: any = await request.json().catch(() => ({}));
      if (body.id) targetId = Number(body.id);
    }

    if (!targetId) {
      return new Response(JSON.stringify({ error: "Missing tester id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    await env.DB.prepare("DELETE FROM sandbox_beta_testers WHERE id = ?").bind(targetId).run();

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  // POST /api/v1/admin/sandbox/mint-test-license
  if (url.pathname === "/api/v1/admin/sandbox/mint-test-license" && request.method === "POST") {
    const denied = await requireAdminAuth(request, env, corsHeaders);
    if (denied) return denied;
    if (!isTestEnvironment(env, url)) {
      return new Response(JSON.stringify({
        error: "Sandbox endpoints are strictly disabled in production environment",
        code: "SANDBOX_ONLY"
      }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
    await ensureLicenseSourceColumns(env);
    await ensureBetaTestersTable(env);

    const body: any = await request.json().catch(() => ({}));
    const tier = (body.tier === "PRO" ? "PRO" : "PLUS");
    const deviceId = (body.device_id || "").trim();
    const email = (body.email || "").trim();
    if (!deviceId || !email) {
      return new Response(JSON.stringify({
        error: "Missing required parameters: device_id and email are required for test license minting"
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
    // Enforce "register first, then mint": the device+email pair must already exist in the whitelist.
    const existingTester = await env.DB.prepare(
      "SELECT * FROM sandbox_beta_testers WHERE device_id = ? AND LOWER(email) = ? AND status = 'active'"
    ).bind(deviceId, email.toLowerCase()).first<any>();
    if (!existingTester) {
      return new Response(JSON.stringify({
        error: "device_id and email must be registered in the sandbox tester whitelist before minting"
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
    const expDays = Math.min(Number(body.expires_in_days || 8), 8);
    const durDays = Number(body.duration_days || 30);

    const todayStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const randBytes = new Uint8Array(6);
    crypto.getRandomValues(randBytes);
    const randStr = Array.from(randBytes, b => ('00' + b.toString(16)).slice(-2)).join('').toUpperCase();
    const licenseCode = `EQT-TEST-${tier}-${todayStr}-${randStr}`;

    const expDate = new Date();
    expDate.setDate(expDate.getDate() + expDays);
    const expiresAt = expDate.toISOString();

    const encoder = new TextEncoder();
    const emailHashBuf = await crypto.subtle.digest("SHA-256", encoder.encode(email.toLowerCase()));
    const emailHash = Array.from(new Uint8Array(emailHashBuf), x => ('00' + x.toString(16)).slice(-2)).join('');

    await env.DB.prepare(`
      INSERT INTO licenses (
        license_code, tier, status, max_devices, expires_at, duration_days,
        buyer_email_hash, buyer_email, source, bound_device_id, created_at
      ) VALUES (?, ?, 'active', 1, ?, ?, ?, ?, 'test', ?, ?)
    `).bind(
      licenseCode,
      tier,
      expiresAt,
      durDays,
      emailHash,
      email,
      deviceId,
      new Date().toISOString()
    ).run();

    return new Response(JSON.stringify({
      success: true,
      license_code: licenseCode,
      tier,
      bound_device_id: deviceId,
      buyer_email: email,
      expires_at: expiresAt,
      duration_days: durDays
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  return null;
}

