import { Env } from '../types';
import { ensureAuditLogTable } from '../utils/error-logger';

/**
 * POST /api/v1/crash-report
 *
 * Accepts desktop crash reports from eqt-desktop clients.
 * - Stores structured metadata in D1 `system_error_logs`
 * - Stores full stack_trace + log_tail in R2 `crash-reports/{date}/{uuid}.txt`
 * - No auth required (crash data is not sensitive; rate-limited per IP)
 *
 * Request body (JSON):
 *   app_version  (string, required)  — desktop app version
 *   os_version   (string, required)  — OS version string
 *   stack_trace  (string, required)  — crash stack trace
 *   log_tail     (string, optional)  — last N lines of desktop log
 *   device_id    (string, optional)  — DRM device ID
 *   license_code (string, optional)  — current license code
 *
 * Response:
 *   { "status": "received", "report_id": "<uuid>" }
 */
export async function handleCrashReport(
  request: Request,
  env: Env,
  corsHeaders: Record<string, string>
): Promise<Response | null> {
  if (request.method !== "POST") {
    return null;
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  // Validate required fields
  const appVersion = String(body.app_version || "").trim();
  const osVersion = String(body.os_version || "").trim();
  const stackTrace = String(body.stack_trace || "").trim();

  if (!appVersion || !osVersion || !stackTrace) {
    return new Response(JSON.stringify({
      error: "Missing required fields: app_version, os_version, stack_trace"
    }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  // Optional fields
  const logTail = String(body.log_tail || "").trim() || null;
  const deviceId = String(body.device_id || "").trim() || null;
  const licenseCode = String(body.license_code || "").trim() || null;

  // Generate report ID (UUID v4)
  const reportId = crypto.randomUUID();

  // Build R2 key: crash-reports/YYYY-MM-DD/<uuid>.txt
  const today = new Date().toISOString().slice(0, 10);
  const r2Key = `crash-reports/${today}/${reportId}.txt`;

  // Build full report content for R2
  const reportLines: string[] = [
    `=== EQT Crash Report ===`,
    `Report ID: ${reportId}`,
    `Timestamp: ${new Date().toISOString()}`,
    `App Version: ${appVersion}`,
    `OS Version: ${osVersion}`,
    `Device ID: ${deviceId || '(not provided)'}`,
    `License Code: ${licenseCode || '(not provided)'}`,
    ``,
    `=== Stack Trace ===`,
    stackTrace,
  ];
  if (logTail) {
    reportLines.push(``, `=== Log Tail ===`, logTail);
  }
  const reportContent = reportLines.join('\n');

  // 1. Store full report in R2
  try {
    await env.CRASH_BUCKET.put(r2Key, reportContent, {
      httpMetadata: { contentType: "text/plain; charset=utf-8" }
    });
  } catch (err: any) {
    console.error(`Failed to store crash report in R2: ${err.message}`);
    // Continue — D1 metadata is more important than R2 blob
  }

  // Extract trace_id from request headers if present (§7.1)
  const traceId = request.headers.get('X-Trace-Id') || undefined;

  // 2. Store structured metadata in D1 system_error_logs
  const errorMessage = `app_version=${appVersion} os=${osVersion} device_id=${deviceId || 'unknown'} stack=${stackTrace.slice(0, 200)}`;
  const contextJson = JSON.stringify({
    report_id: reportId,
    r2_key: r2Key,
    app_version: appVersion,
    os_version: osVersion,
    device_id: deviceId,
    license_code: licenseCode,
    has_log_tail: logTail !== null
  });

  try {
    await ensureAuditLogTable(env);
    // Ensure trace_id column exists (idempotent)
    try {
      await env.DB.prepare("ALTER TABLE system_error_logs ADD COLUMN trace_id TEXT").run();
    } catch { /* column already exists */ }
    await env.DB.prepare(
      "INSERT INTO system_error_logs (level, category, error_message, context_json, created_at, trace_id) VALUES (?, ?, ?, ?, ?, ?)"
    ).bind(
      'CRITICAL',
      'DESKTOP_CRASH',
      errorMessage,
      contextJson,
      new Date().toISOString(),
      traceId || null
    ).run();
  } catch (err: any) {
    console.error(`Failed to log crash report to D1: ${err.message}`);
  }

  return new Response(JSON.stringify({
    status: "received",
    report_id: reportId
  }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}
