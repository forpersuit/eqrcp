import { Env } from '../types';

const adminAuditLogTableEnsured = new WeakSet<object>();

export async function ensureAdminAuditLogTable(env: Env): Promise<void> {
  if (!env?.DB || adminAuditLogTableEnsured.has(env.DB)) return;
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
    adminAuditLogTableEnsured.add(env.DB);
  } catch (err: any) {
    const msg = String(err?.message || err);
    if (/already exists/i.test(msg)) {
      adminAuditLogTableEnsured.add(env.DB);
    } else {
      console.error("Failed to ensure admin_audit_logs table:", err);
    }
  }
}

/** Compact activation row for admin audit forensics (survives DELETE activations). */
export function activationAuditSnapshot(act: any): Record<string, unknown> {
  return {
    id: act?.id ?? null,
    device_id: act?.device_id ?? null,
    uuid_hash: act?.uuid_hash ?? null,
    cpu_hash: act?.cpu_hash ?? null,
    disk_hash: act?.disk_hash ?? null,
    activated_at: act?.activated_at ?? null,
    client_ip: act?.client_ip ?? null,
    ip_country: act?.ip_country ?? null,
    user_agent: act?.user_agent ?? null
  };
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
