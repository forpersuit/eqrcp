import { Env } from '../types';

export function getCorsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("Origin") || "";
  let allowOrigin = "*";
  if (origin && (
    origin.includes("eqt.net.im") ||
    origin.includes("pages.dev") ||
    origin.includes("localhost") ||
    origin.includes("127.0.0.1")
  )) {
    allowOrigin = origin;
  }

  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Admin-Secret",
  };
}

export async function ensureDeviceIdColumn(env: Env): Promise<void> {
  try {
    await env.DB.prepare("ALTER TABLE activations ADD COLUMN device_id TEXT DEFAULT NULL").run();
  } catch (err) {
    // Column already exists or table does not exist yet; ignore safely
  }
}

export async function ensureDrmTables(env: Env): Promise<void> {
  try {
    await env.DB.batch([
      env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS licenses (
            license_code TEXT PRIMARY KEY,
            tier TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'active',
            max_devices INTEGER DEFAULT 2,
            expires_at TEXT,
            duration_days INTEGER DEFAULT NULL,
            buyer_email_hash TEXT DEFAULT NULL,
            buyer_email TEXT DEFAULT NULL,
            paddle_transaction_id TEXT DEFAULT NULL,
            paddle_subscription_id TEXT DEFAULT NULL,
            created_at TEXT NOT NULL
        )
      `),
      env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS activations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            license_code TEXT NOT NULL,
            uuid_hash TEXT,
            cpu_hash TEXT,
            disk_hash TEXT,
            device_id TEXT DEFAULT NULL,
            activated_at TEXT NOT NULL
        )
      `),
      env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS system_error_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            level TEXT NOT NULL DEFAULT 'ERROR',
            category TEXT NOT NULL,
            error_message TEXT NOT NULL,
            context_json TEXT,
            created_at TEXT NOT NULL
        )
      `)
    ]);
  } catch (err) {
    console.error("Failed to ensure DRM D1 tables:", err);
  }
}

/**
 * Admin route guard (docs/admin/api-contract.md):
 * - ADMIN_SECRET unset → 503 fail-closed
 * - missing/wrong secret → 401 (strictly X-Admin-Secret header)
 */
export async function requireAdminAuth(
  request: Request,
  env: Env,
  corsHeaders: Record<string, string>
): Promise<Response | null> {
  if (!env.ADMIN_SECRET) {
    return new Response(
      JSON.stringify({ error: "Admin API not configured (ADMIN_SECRET missing)" }),
      { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
  const adminSecret = request.headers.get("X-Admin-Secret");
  if (!adminSecret || adminSecret !== env.ADMIN_SECRET) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  await ensureDrmTables(env);
  return null;
}
