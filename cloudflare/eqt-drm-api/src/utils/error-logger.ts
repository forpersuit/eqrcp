import { Env } from '../types';

let auditLogTableEnsured = false;

// System error audit log helper (Stores full technical stacktrace into D1)
export async function ensureAuditLogTable(env: Env): Promise<void> {
  if (auditLogTableEnsured) return;
  try {
    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS system_error_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        level TEXT NOT NULL DEFAULT 'ERROR',
        category TEXT NOT NULL,
        error_message TEXT NOT NULL,
        context_json TEXT,
        created_at TEXT NOT NULL,
        trace_id TEXT
      )
    `).run();
    auditLogTableEnsured = true;
  } catch (err) {
    console.error("Failed to ensure audit log table:", err);
  }
}

// --- Alert rate limiting (in-isolate) ---
// CRITICAL: max 1 per hour, ERROR: max 3 per hour
const ALERT_WINDOW_CRITICAL_MS = 60 * 60 * 1000;
const ALERT_WINDOW_ERROR_MS = 60 * 60 * 1000;
const ALERT_MAX_CRITICAL = 1;
const ALERT_MAX_ERROR = 3;

interface AlertBucket {
  count: number;
  windowStart: number;
}

const criticalAlertBuckets = new Map<string, AlertBucket>();
const errorAlertBuckets = new Map<string, AlertBucket>();

function isAlertRateLimited(buckets: Map<string, AlertBucket>, key: string, maxCount: number, windowMs: number): boolean {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || now - b.windowStart > windowMs) {
    buckets.set(key, { count: 1, windowStart: now });
    return false;
  }
  if (b.count >= maxCount) return true;
  b.count += 1;
  return false;
}

/**
 * Send Telegram alert for CRITICAL errors.
 * Rate-limited to 1 per hour per category.
 */
async function sendTelegramAlert(env: Env, category: string, errorMessage: string): Promise<void> {
  const token = env.TELEGRAM_BOT_TOKEN;
  const chatId = env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;

  const rateLimitKey = `critical:${category}`;
  if (isAlertRateLimited(criticalAlertBuckets, rateLimitKey, ALERT_MAX_CRITICAL, ALERT_WINDOW_CRITICAL_MS)) {
    console.log(`Telegram alert rate-limited for ${rateLimitKey}`);
    return;
  }

  const text = `🚨 [CRITICAL] ${category}\n\n${errorMessage.slice(0, 2000)}`;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
    });
  } catch (err) {
    console.error('Failed to send Telegram alert:', err);
  }
}

export async function logSystemError(
  env: Env,
  category: string,
  level: 'INFO' | 'ERROR' | 'WARN' | 'CRITICAL',
  error: any,
  context?: any,
  traceId?: string
): Promise<void> {
  try {
    await ensureAuditLogTable(env);
    // Ensure trace_id column exists (idempotent)
    try {
      await env.DB.prepare("ALTER TABLE system_error_logs ADD COLUMN trace_id TEXT").run();
    } catch { /* column already exists */ }
    const errorMsg = error instanceof Error ? `${error.message}\n${error.stack || ''}` : String(error);
    const contextJson = context ? JSON.stringify(context) : null;
    await env.DB.prepare(
      "INSERT INTO system_error_logs (level, category, error_message, context_json, created_at, trace_id) VALUES (?, ?, ?, ?, ?, ?)"
    ).bind(level, category, errorMsg, contextJson, new Date().toISOString(), traceId || null).run();

    // Alert notification for CRITICAL errors (§7.3 告警升级机制)
    if (level === 'CRITICAL') {
      // Await to ensure delivery before ctx.waitUntil() releases the isolate
      await sendTelegramAlert(env, category, errorMsg);
    }
  } catch (err) {
    console.error("Failed to log system error to D1:", err);
  }
}

// Map internal DB/code errors to safe user-friendly messages for general public
export function getSafeUserErrorMessage(rawMessage: string, defaultFriendlyMsg: string = "Service temporarily unavailable. Please try again later."): string {
  if (!rawMessage) return defaultFriendlyMsg;
  // If rawMessage contains internal DB/code exception details, swallow them completely!
  if (/D1_ERROR|SQLITE|UNIQUE constraint|FOREIGN KEY|syntax error|PRIMARYKEY|fatal|exception|stack|trace|TypeError|ReferenceError/i.test(rawMessage)) {
    return defaultFriendlyMsg;
  }
  return rawMessage;
}
