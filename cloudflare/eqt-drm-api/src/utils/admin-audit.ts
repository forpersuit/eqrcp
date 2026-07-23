import { Env } from '../types';

export async function ensureAdminAuditLogTable(env: Env): Promise<void> {
  try {
    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS admin_audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        action TEXT NOT NULL,
        target_type TEXT,
        target_id TEXT,
        details_json TEXT,
        operator_ip TEXT,
        created_at TEXT NOT NULL
      )
    `).run();
  } catch (err) {
    console.error("Failed to ensure admin_audit_logs table:", err);
  }
}

export async function logAdminAudit(
  env: Env,
  action: string,
  targetType: string,
  targetId: string | null,
  details?: any,
  operatorIp?: string
): Promise<void> {
  try {
    await ensureAdminAuditLogTable(env);
    const detailsJson = details ? JSON.stringify(details) : null;
    await env.DB.prepare(
      "INSERT INTO admin_audit_logs (action, target_type, target_id, details_json, operator_ip, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).bind(
      action.toUpperCase(),
      targetType,
      targetId || null,
      detailsJson,
      operatorIp || null,
      new Date().toISOString()
    ).run();
  } catch (err) {
    console.error("Failed to log admin audit to D1:", err);
  }
}
