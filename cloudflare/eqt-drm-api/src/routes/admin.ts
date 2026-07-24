import { Env } from '../types';
import { requireAdminAuth } from '../utils/auth';
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
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10) || 50, 200);
    const offset = Math.max(parseInt(url.searchParams.get("offset") || "0", 10) || 0, 0);

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
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10) || 50, 200);
    const offset = Math.max(parseInt(url.searchParams.get("offset") || "0", 10) || 0, 0);

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

    const body: any = await request.json();
    const { tier, max_devices, expires_in_days, duration_days, buyer_email, send_email, source: rawSource } = body;

    if (tier !== "PLUS" && tier !== "PRO") {
      return new Response(JSON.stringify({ error: "Invalid tier. Must be 'PLUS' or 'PRO'" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Admin may mint promo (campaign) or admin (support/internal). Never purchase/test here.
    const sourceRaw = String(rawSource || "admin").trim().toLowerCase();
    const source = sourceRaw === "promo" ? "promo" : "admin";

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
    const durDays = duration_days !== undefined && duration_days !== null && duration_days !== ""
      ? Number(duration_days)
      : null;
    const cleanEmail = (buyer_email || "").trim();

    // Promo codes should have a redeem-by window; duration_days = post-activate entitlement.
    if (source === "promo" && (!expires_in_days || Number(expires_in_days) <= 0)) {
      return new Response(JSON.stringify({
        error: "Promo licenses require expires_in_days (redeem-by window)"
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
      "INSERT INTO licenses (license_code, tier, status, max_devices, expires_at, duration_days, buyer_email_hash, buyer_email, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
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
      new Date().toISOString()
    ).run();

    let emailSent = false;
    if (send_email && cleanEmail) {
      const planName = tier === "PLUS" ? "EQT Plus" : (tier === "PRO" ? "EQT Pro" : tier);
      const expiresStr = expiresAt === "LIFETIME" ? "Lifetime (永久生效)" : new Date(expiresAt).toLocaleDateString();
      const emailHtml = `
        <div style="font-family: sans-serif; padding: 20px; line-height: 1.6; color: #333;">
          <h2 style="color: #10b981;">您的 EQT 专享授权激活码已发放！</h2>
          <p>管理员已成功为您创建 EQT 许可授权。以下是您的授权明细：</p>
          <table style="border-collapse: collapse; margin: 20px 0; width: 100%; max-width: 600px;">
            <tr>
              <td style="padding: 10px; border: 1px solid #ddd; font-weight: bold; background: #f9f9f9; width: 180px;">授权级别 (Tier)</td>
              <td style="padding: 10px; border: 1px solid #ddd;">${planName}</td>
            </tr>
            <tr>
              <td style="padding: 10px; border: 1px solid #ddd; font-weight: bold; background: #f9f9f9;">激活码 (License Code)</td>
              <td style="padding: 10px; border: 1px solid #ddd; font-family: monospace; font-size: 16px; font-weight: bold; color: #10b981;">${licenseCode}</td>
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

  // 4. Admin Endpoint: Search all licenses (sort by created_at; real activations columns)
  if (url.pathname === "/api/v1/admin/licenses" && request.method === "GET") {
    const denied = await requireAdminAuth(request, env, corsHeaders);
    if (denied) return denied;

    const queryStr = (url.searchParams.get("q") || url.searchParams.get("query") || "").trim();
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10) || 50, 200);
    const offset = Math.max(parseInt(url.searchParams.get("offset") || "0", 10) || 0, 0);

    let sql = "SELECT * FROM licenses";
    let params: any[] = [];

    if (queryStr) {
      let emailHash = "";
      if (queryStr.includes("@")) {
        const encoder = new TextEncoder();
        const emailHashBuf = await crypto.subtle.digest("SHA-256", encoder.encode(queryStr.toLowerCase()));
        emailHash = Array.from(new Uint8Array(emailHashBuf), x => ('00' + x.toString(16)).slice(-2)).join('');
      }
      const likeQuery = `%${queryStr}%`;
      sql += " WHERE license_code LIKE ? OR buyer_email LIKE ? OR paddle_transaction_id LIKE ? OR buyer_email_hash = ?";
      params = [likeQuery, likeQuery, likeQuery, emailHash || queryStr];
    }

    sql += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
    params.push(limit, offset);

    const res = await env.DB.prepare(sql).bind(...params).all();
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
        return {
          ...lic,
          active_devices_count: acts.length,
          activations: acts
        };
      });
    }

    return new Response(JSON.stringify({ success: true, licenses: licensesWithDevices }), {
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
      await env.DB.prepare(
        "DELETE FROM activations WHERE id = ? AND license_code = ?"
      ).bind(actId, license_code).run();
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
      await env.DB.prepare("DELETE FROM activations WHERE license_code = ?").bind(license_code).run();
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
    const probes = await runHealthProbes(env);

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

  // 8. Manual blacklist management (email / device)
  if (url.pathname === "/api/v1/admin/blacklist" && request.method === "GET") {
    const denied = await requireAdminAuth(request, env, corsHeaders);
    if (denied) return denied;

    const kind = (url.searchParams.get("kind") || "").trim();
    const q = (url.searchParams.get("q") || "").trim();
    const includeInactive = url.searchParams.get("include_inactive") === "1";
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "100", 10) || 100, 200);
    const offset = Math.max(parseInt(url.searchParams.get("offset") || "0", 10) || 0, 0);

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

  return null;
}

