import { Env } from '../types';
import {
  clearAdminAuthFailures,
  isAdminAuthRateLimited,
  recordAdminAuthFailure
} from './rate-limit';

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

/** Ensure verification_codes.created_at exists for 60s send-code rate limiting. */
export async function ensureVerificationCodesCreatedAt(env: Env): Promise<void> {
  try {
    await env.DB.prepare(
      "ALTER TABLE verification_codes ADD COLUMN created_at TEXT DEFAULT NULL"
    ).run();
  } catch (err) {
    // Column already exists or table does not exist yet; ignore safely
  }
}

/** Ensure activations network metadata columns for admin visibility / geo baselining. */
export async function ensureActivationNetworkColumns(env: Env): Promise<void> {
  const alters = [
    "ALTER TABLE activations ADD COLUMN client_ip TEXT DEFAULT NULL",
    "ALTER TABLE activations ADD COLUMN ip_country TEXT DEFAULT NULL",
    "ALTER TABLE activations ADD COLUMN user_agent TEXT DEFAULT NULL",
  ];
  for (const sql of alters) {
    try {
      await env.DB.prepare(sql).run();
    } catch (err) {
      // Column already exists; ignore
    }
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
            source TEXT DEFAULT NULL,
            revoked_at TEXT DEFAULT NULL,
            revoke_reason TEXT DEFAULT NULL,
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
  await ensureLicenseSourceColumns(env);
}

/** Idempotent ALTERs for license origin + abuse-window timestamps. */
export async function ensureLicenseSourceColumns(env: Env): Promise<void> {
  const alters = [
    "ALTER TABLE licenses ADD COLUMN source TEXT DEFAULT NULL",
    "ALTER TABLE licenses ADD COLUMN revoked_at TEXT DEFAULT NULL",
    "ALTER TABLE licenses ADD COLUMN revoke_reason TEXT DEFAULT NULL",
  ];
  for (const sql of alters) {
    try {
      await env.DB.prepare(sql).run();
    } catch {
      // Column already exists
    }
  }
}

function clientIpFromRequest(request: Request): string {
  // Prefer explicit X-Forwarded-For when present (tests / reverse proxies), else CF edge IP.
  const xff = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (xff) return xff;
  return (
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-real-ip") ||
    ""
  );
}

/**
 * Admin route guard (docs/admin/api-contract.md):
 * - ADMIN_SECRET unset → 503 fail-closed
 * - missing/wrong secret → 401 (strictly X-Admin-Secret header)
 * - repeated wrong secrets from same IP → 429 (in-isolate rate limit)
 * - correct secret always succeeds and clears the bucket (recovery path)
 */
export async function requireAdminAuth(
  request: Request,
  env: Env,
  corsHeaders: Record<string, string>
): Promise<Response | null> {
  const clientIp = clientIpFromRequest(request);

  if (!env.ADMIN_SECRET) {
    return new Response(
      JSON.stringify({ error: "Admin API not configured (ADMIN_SECRET missing)" }),
      { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const adminSecret = request.headers.get("X-Admin-Secret");
  // Missing header → 401 without counting (login probes / readiness).
  if (!adminSecret) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (adminSecret === env.ADMIN_SECRET) {
    clearAdminAuthFailures(clientIp);
    await ensureDrmTables(env);
    return null;
  }

  // Wrong secret: rate-limit then 401
  if (isAdminAuthRateLimited(clientIp)) {
    return new Response(
      JSON.stringify({
        error: "Too many failed admin auth attempts. Try again later.",
        code: "ADMIN_AUTH_RATE_LIMITED"
      }),
      {
        status: 429,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
          "Retry-After": "300"
        }
      }
    );
  }
  recordAdminAuthFailure(clientIp);
  // If this failure crossed the threshold, surface 429 immediately.
  if (isAdminAuthRateLimited(clientIp)) {
    return new Response(
      JSON.stringify({
        error: "Too many failed admin auth attempts. Try again later.",
        code: "ADMIN_AUTH_RATE_LIMITED"
      }),
      {
        status: 429,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
          "Retry-After": "300"
        }
      }
    );
  }
  return new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
