import { Env } from '../types';

// System error audit log helper (Stores full technical stacktrace into D1)
export async function ensureAuditLogTable(env: Env): Promise<void> {
  try {
    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS system_error_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        level TEXT NOT NULL DEFAULT 'ERROR',
        category TEXT NOT NULL,
        error_message TEXT NOT NULL,
        context_json TEXT,
        created_at TEXT NOT NULL
      )
    `).run();
  } catch (err) {
    console.error("Failed to ensure audit log table:", err);
  }
}

export async function logSystemError(
  env: Env,
  category: string,
  level: 'ERROR' | 'WARN' | 'CRITICAL',
  error: any,
  context?: any
): Promise<void> {
  try {
    await ensureAuditLogTable(env);
    const errorMsg = error instanceof Error ? `${error.message}\n${error.stack || ''}` : String(error);
    const contextJson = context ? JSON.stringify(context) : null;
    await env.DB.prepare(
      "INSERT INTO system_error_logs (level, category, error_message, context_json, created_at) VALUES (?, ?, ?, ?, ?)"
    ).bind(level, category, errorMsg, contextJson, new Date().toISOString()).run();
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
