import { Env } from '../types';

const auditLogTableEnsured = new WeakSet<object>();

// System error audit log helper (Stores full technical stacktrace into D1)
export async function ensureAuditLogTable(env: Env): Promise<void> {
  if (!env?.DB || auditLogTableEnsured.has(env.DB)) return;
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
    auditLogTableEnsured.add(env.DB);
  } catch (err: any) {
    const msg = String(err?.message || err);
    if (/already exists/i.test(msg)) {
      auditLogTableEnsured.add(env.DB);
    } else {
      console.error("Failed to ensure audit log table:", err);
    }
  }
}

// --- Alert rate limiting (in-isolate) ---
// Money Path / Critical: max 3 per 10 minutes
const ALERT_WINDOW_MONEY_PATH_MS = 10 * 60 * 1000;
const ALERT_MAX_MONEY_PATH = 3;

interface AlertBucket {
  count: number;
  windowStart: number;
}

const alertBuckets = new Map<string, AlertBucket>();

function isAlertRateLimited(key: string, maxCount: number, windowMs: number): boolean {
  const now = Date.now();
  const b = alertBuckets.get(key);
  if (!b || now - b.windowStart > windowMs) {
    alertBuckets.set(key, { count: 1, windowStart: now });
    return false;
  }
  if (b.count >= maxCount) return true;
  b.count += 1;
  return false;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Send Telegram alert for critical and money-path failures.
 * Protected by in-memory rate limiting, sanitization, and HTML escaping.
 */
export async function sendTelegramAlert(
  env: Env,
  category: string,
  level: string,
  errorMessage: string,
  context?: any,
  traceId?: string
): Promise<void> {
  const token = env.TELEGRAM_BOT_TOKEN;
  const chatId = env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;

  const rateLimitKey = `${level}:${category}`;
  if (isAlertRateLimited(rateLimitKey, ALERT_MAX_MONEY_PATH, ALERT_WINDOW_MONEY_PATH_MS)) {
    console.log(`Telegram alert rate-limited for ${rateLimitKey}`);
    return;
  }

  const envTag = env.ENVIRONMENT ? `[${env.ENVIRONMENT.toUpperCase()}] ` : '';
  const header = `🚨 <b>${envTag}[${escapeHtml(level)}] ${escapeHtml(category)}</b>`;
  const timeStr = new Date().toISOString();
  
  let body = `${header}\n\n<b>Error:</b>\n<pre>${escapeHtml(errorMessage.slice(0, 1500))}</pre>`;

  if (context && typeof context === 'object') {
    try {
      const sanitizedContext: Record<string, any> = {};
      for (const [k, v] of Object.entries(context)) {
        if (/secret|token|password|auth|key/i.test(k) && typeof v === 'string') {
          sanitizedContext[k] = v.length > 8 ? `${v.slice(0, 4)}...${v.slice(-4)}` : '***';
        } else {
          sanitizedContext[k] = v;
        }
      }
      const ctxStr = JSON.stringify(sanitizedContext, null, 2);
      if (ctxStr && ctxStr.length > 2) {
        body += `\n\n<b>Context:</b>\n<pre>${escapeHtml(ctxStr.slice(0, 1000))}</pre>`;
      }
    } catch {
      // ignore context stringify error
    }
  }

  if (traceId) {
    body += `\n<b>Trace ID:</b> <code>${escapeHtml(traceId)}</code>`;
  }
  body += `\n<b>Time:</b> <code>${timeStr}</code>`;

  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: body, parse_mode: 'HTML' }),
    });
  } catch (err) {
    console.error('Failed to send Telegram alert:', err);
  }
}

/**
 * Check if a category represents a critical money path operation
 */
export function isMoneyPathCategory(category: string): boolean {
  return (
    category.startsWith('PADDLE_') ||
    category === 'SMTP_EMAIL_FAIL' ||
    category === 'DRM_ACTIVATE_FAIL' ||
    category === 'REFUND_MISS_TARGET' ||
    category === 'LICENSE_MINT_FAIL'
  );
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

    // Alert notification for CRITICAL errors and Money Path failures (§7.3 告警升级机制)
    if (level === 'CRITICAL' || (level === 'ERROR' && isMoneyPathCategory(category))) {
      // Await to ensure delivery before ctx.waitUntil() releases the isolate
      await sendTelegramAlert(env, category, level, errorMsg, context, traceId);
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
