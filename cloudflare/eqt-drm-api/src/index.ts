import { Env } from './types';
import { getCorsHeaders } from './utils/auth';
import { logSystemError, getSafeUserErrorMessage } from './utils/error-logger';
import { logStructuredRequest } from './utils/structured-logger';
import { handleDownloadDomain } from './services/github';
import { handleAdminRoutes } from './routes/admin';
import { handleAuthRoutes } from './routes/auth';
import { handlePortalRoutes } from './routes/portal';
import { handlePaddleRoutes } from './routes/paddle';
import { handleDrmRoutes } from './routes/drm';
import { handleSessionRoutes } from './routes/session';
import { handleCrashReport } from './routes/crash-report';
import { handleTelemetryRoutes } from './routes/telemetry';
import { assertEnvironmentAlignment } from './utils/env-guard';
import { wrapD1WithRetry } from './utils/d1-retry';
import { probeSmtp } from './services/smtp';

export type { Env };

// Worker start time for uptime reporting
const WORKER_START_MS = Date.now();

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const startMs = Date.now();
    const url = new URL(request.url);

    // Transparently equip D1 with lightweight exponential backoff retry for transient storage timeouts
    if (env?.DB) {
      env = { ...env, DB: wrapD1WithRetry(env.DB) };
    }

    // Generate trace_id (UUID v4) for request-level tracing (§7.1)
    const traceId = crypto.randomUUID();
    const newHeaders = new Headers(request.headers);
    newHeaders.set('X-Trace-Id', traceId);
    request = new Request(request, { headers: newHeaders });

    // Dynamic CORS Headers with Origin domain matching
    const corsHeaders = getCorsHeaders(request);

    if (request.method === "OPTIONS") {
      const resp = new Response(null, { headers: corsHeaders });
      ctx.waitUntil(logStructuredRequest(request, resp, startMs));
      return attachTraceId(resp, traceId);
    }

    try {
      // Fail-Fast: bidirectional guard between environment and Paddle secrets/prices
      assertEnvironmentAlignment(env, url);

      let response: Response | null = null;

      // 0. Public health check (no auth required — for UptimeRobot external monitoring)
      if (url.pathname === "/api/v1/health" && request.method === "GET") {
        response = await handlePublicHealth(env, corsHeaders);
      }

      // 1. Route to Download Domain handler if matching download host / paths
      if (!response &&
        (url.hostname === "download.eqt.net.im" ||
         url.hostname === "localhost" ||
         url.hostname === "127.0.0.1" ||
         url.pathname === "/update-metadata.json" ||
         url.pathname.startsWith("/downloads/")) &&
        !url.pathname.startsWith("/api/v1/")
      ) {
        response = await handleDownloadDomain(request, env, ctx, corsHeaders);
      }

      // 2. Route to Admin endpoints (/api/v1/admin/*)
      if (!response && url.pathname.startsWith("/api/v1/admin/")) {
        response = await handleAdminRoutes(request, env, ctx, url, corsHeaders);
      }

      // 3. Route to Auth & Checkout endpoints (/api/v1/auth/*, /api/v1/checkout/*)
      if (!response && (url.pathname.startsWith("/api/v1/auth/") || url.pathname.startsWith("/api/v1/checkout/"))) {
        response = await handleAuthRoutes(request, env, ctx, url, corsHeaders);
      }

      // 4. Route to User Portal endpoints (/api/v1/user/*)
      if (!response && url.pathname.startsWith("/api/v1/user/")) {
        response = await handlePortalRoutes(request, env, ctx, url, corsHeaders);
      }

      // 5. Route to Paddle Webhook & License Query endpoints (/api/v1/paddle/*)
      if (!response && url.pathname.startsWith("/api/v1/paddle/")) {
        response = await handlePaddleRoutes(request, env, ctx, url, corsHeaders);
      }

      // 5.5 Route to Crash Report endpoint (no auth required — rate-limited per IP)
      if (!response && url.pathname === "/api/v1/crash-report") {
        response = await handleCrashReport(request, env, corsHeaders);
      }

      // 5.6 Route to Telemetry endpoints (/api/v1/telemetry/*, no auth required — rate-limited per IP)
      if (!response && url.pathname.startsWith("/api/v1/telemetry/")) {
        response = await handleTelemetryRoutes(request, env, ctx, url, corsHeaders);
      }

      // 5.7 Route to E2EE Session endpoints (/api/v1/session/*)
      if (!response && (url.pathname.startsWith("/api/v1/session/") || url.pathname === "/health")) {
        response = await handleSessionRoutes(request, env, ctx, url, corsHeaders);
      }

      // 6. Route to Client DRM endpoints (/api/v1/activate, /api/v1/verify, /api/v1/update/check)
      if (!response) {
        response = await handleDrmRoutes(request, env, ctx, url, corsHeaders);
      }

      // 7. Health check or basic index fallback
      if (!response) {
        response = new Response(JSON.stringify({ status: "EQT DRM Serverless API Running" }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      ctx.waitUntil(logStructuredRequest(request, response, startMs));
      // Attach trace_id to response header (§7.1)
      response = attachTraceId(response, traceId);
      return response;

    } catch (e: any) {
      ctx.waitUntil(logSystemError(env, 'SERVER_EXCEPTION', 'CRITICAL', e, { url: request.url, method: request.method }, traceId));
      const safeMsg = getSafeUserErrorMessage(e.message || String(e), "An unexpected server error occurred. Please try again later.");
      const errorResp = new Response(JSON.stringify({ error: safeMsg }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
      ctx.waitUntil(logStructuredRequest(request, errorResp, startMs));
      return attachTraceId(errorResp, traceId);
    }
  },

  /**
   * Cloudflare Scheduled Cron Handler (Daily SMTP health probe at 03:05 UTC).
   * Verifies live TLS handshake, EHLO greeting, and AUTH LOGIN availability.
   * Emits a WARN alert to Telegram if the probe fails or SMTP certificate is invalid.
   */
  async scheduled(event: { cron: string; type?: string; scheduledTime?: number }, env: Env, ctx: ExecutionContext): Promise<void> {
    // 1. SMTP health probe
    try {
      const probe = await probeSmtp(env, 5000);
      if (!probe.ok && !probe.skipped) {
        await logSystemError(
          env,
          'SMTP_PROBE_FAIL',
          'WARN',
          new Error(probe.error || 'SMTP scheduled health probe failed'),
          { latency_ms: probe.latency_ms, cron: event?.cron }
        );
      }
    } catch (err: any) {
      await logSystemError(
        env,
        'SMTP_PROBE_FAIL',
        'WARN',
        err,
        { cron: event?.cron }
      );
    }

    // 2. Daily 90-day download telemetry retention & aggregation (§7.6 / Phase 4)
    try {
      const retentionDays = 90;
      const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
      const nowIso = new Date().toISOString();

      // Aggregate and Upsert into daily_download_stats, then delete archived records in an atomic transaction (§7.6 / Phase 4)
      await env.DB.batch([
        env.DB.prepare(`
          INSERT INTO daily_download_stats (stat_date, version, ip_country, source, download_cnt, created_at)
          SELECT
            substr(created_at, 1, 10) AS stat_date,
            version,
            COALESCE(ip_country, 'XX') AS ip_country,
            source,
            COUNT(*) AS download_cnt,
            ? AS created_at
          FROM download_records
          WHERE created_at < ?
          GROUP BY stat_date, version, ip_country, source
          ON CONFLICT(stat_date, version, ip_country, source)
          DO UPDATE SET
            download_cnt = download_cnt + excluded.download_cnt,
            created_at = excluded.created_at
        `).bind(nowIso, cutoffDate),
        env.DB.prepare(`
          DELETE FROM download_records WHERE created_at < ?
        `).bind(cutoffDate)
      ]);
    } catch (archiveErr: any) {
      console.error("Failed to archive 90-day download records:", archiveErr);
    }
  }
};

/**
 * Attach X-Trace-Id header to a Response object.
 * Creates a new Response with the added header since Response.headers is immutable after construction.
 */
export function attachTraceId(response: Response, traceId: string): Response {
  const newHeaders = new Headers(response.headers);
  newHeaders.set('X-Trace-Id', traceId);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders
  });
}

/**
 * Public health check endpoint — no auth required.
 * Returns D1/R2 connectivity, latency, version, and uptime.
 * Used by UptimeRobot for external monitoring (§6.3).
 */
async function handlePublicHealth(env: Env, corsHeaders: Record<string, string>): Promise<Response> {
  const dbStart = Date.now();
  let dbConnected = false;
  let dbLatencyMs = 0;
  let lastError: string | null = null;

  try {
    await env.DB.prepare("SELECT 1 as ok").first();
    dbLatencyMs = Date.now() - dbStart;
    dbConnected = true;
  } catch (err: any) {
    dbLatencyMs = Date.now() - dbStart;
    dbConnected = false;
    lastError = err?.message || String(err);
  }

  // Check for recent CRITICAL errors (last 24 hours)
  try {
    const dayAgo = new Date(Date.now() - 24 * 3600_000).toISOString();
    const errRes = await env.DB.prepare(
      "SELECT created_at FROM system_error_logs WHERE level = 'CRITICAL' AND created_at >= ? ORDER BY id DESC LIMIT 1"
    ).bind(dayAgo).first<{ created_at: string }>();
    if (errRes) {
      lastError = `CRITICAL error at ${errRes.created_at}`;
    }
  } catch {
    // Non-critical: probe failure shouldn't break health check
  }

  // Real R2 connectivity probe via public URL HEAD request
  let r2Connected = false;
  let r2LatencyMs = 0;
  if (env.R2_PUBLIC_URL) {
    const r2Start = Date.now();
    try {
      const r2Res = await fetch(env.R2_PUBLIC_URL, { method: 'HEAD' });
      r2Connected = r2Res.ok || r2Res.status === 403; // 403 = bucket exists but access denied (expected for private buckets)
      r2LatencyMs = Date.now() - r2Start;
    } catch {
      r2LatencyMs = Date.now() - r2Start;
      r2Connected = false;
    }
  }

  const status = dbConnected ? "healthy" : "degraded";

  return new Response(JSON.stringify({
    status,
    d1: { connected: dbConnected, queryLatencyMs: dbLatencyMs },
    r2: { connected: r2Connected, queryLatencyMs: r2LatencyMs },
    uptime: Math.floor((Date.now() - WORKER_START_MS) / 1000),
    version: "1.5.0",
    lastError,
    timestamp: new Date().toISOString()
  }), {
    status: dbConnected ? 200 : 503,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}
