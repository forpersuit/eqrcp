import { Env } from '../types';
import { ensureManualBlacklistTable } from './blacklist';
import { verifyCloudflareAccessJwt } from './cf-access-jwt';

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
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, Cf-Access-Jwt-Assertion",
  };
}

/**
 * Ensure the activations table has the device_id column.
 * Safe to call repeatedly (ignores "duplicate column" errors).
 */
export async function ensureDeviceIdColumn(env: Env): Promise<void> {
  try {
    await env.DB.prepare(
      "ALTER TABLE activations ADD COLUMN device_id TEXT DEFAULT NULL"
    ).run();
  } catch (err) {
    // Column already exists — ignore
  }
}

/** Ensure activations has network meta columns (ip / country / ua). Idempotent. */
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

/** Ensure verification_codes.created_at exists for 60s send-code rate limiting. */
export async function ensureVerificationCodesCreatedAt(env: Env): Promise<void> {
  try {
    await env.DB.prepare(
      "ALTER TABLE verification_codes ADD COLUMN created_at TEXT"
    ).run();
  } catch {
    // column already exists
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
  await ensureDeviceIdColumn(env);
  await ensureActivationNetworkColumns(env);
  await ensureManualBlacklistTable(env);
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

function accessConfigured(env: Env): boolean {
  return !!(env.CF_ACCESS_TEAM_DOMAIN && env.CF_ACCESS_AUD);
}

function parseAllowedEmails(env: Env): string[] {
  const raw = (env.CF_ACCESS_ALLOWED_EMAILS || "admin@eqt.net.im").trim();
  if (!raw) return [];
  return raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}

/**
 * Local wrangler / e2e only: TEAM_DOMAIN=local.dev + AUD=local-dev
 * accepts header Cf-Access-Jwt-Assertion: local.<email>
 */
function tryLocalDevJwt(
  jwt: string,
  env: Env
): { ok: true; email: string } | { ok: false } {
  const team = (env.CF_ACCESS_TEAM_DOMAIN || "").toLowerCase();
  const aud = env.CF_ACCESS_AUD || "";
  if (team !== "local.dev" || aud !== "local-dev") return { ok: false };
  if (!jwt.startsWith("local.")) return { ok: false };
  const email = jwt.slice("local.".length).trim().toLowerCase();
  if (!email.includes("@")) return { ok: false };
  const allowed = parseAllowedEmails(env);
  if (allowed.length && !allowed.includes(email)) return { ok: false };
  return { ok: true, email };
}

/**
 * Admin route guard — Cloudflare Access JWT only (no ADMIN_SECRET).
 * Header: Cf-Access-Jwt-Assertion
 */
export async function requireAdminAuth(
  request: Request,
  env: Env,
  corsHeaders: Record<string, string>
): Promise<Response | null> {
  if (!accessConfigured(env)) {
    return new Response(
      JSON.stringify({
        error: "Admin API not configured (CF_ACCESS_TEAM_DOMAIN / CF_ACCESS_AUD missing)",
        code: "ACCESS_NOT_CONFIGURED"
      }),
      { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const jwt =
    request.headers.get("Cf-Access-Jwt-Assertion") ||
    request.headers.get("cf-access-jwt-assertion");

  if (!jwt) {
    return new Response(
      JSON.stringify({
        error: "Cloudflare Access JWT required",
        code: "ACCESS_JWT_REQUIRED"
      }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const local = tryLocalDevJwt(jwt, env);
  if (local.ok) {
    await ensureDrmTables(env);
    (request as any).__adminEmail = local.email;
    return null;
  }

  const result = await verifyCloudflareAccessJwt(
    jwt,
    env.CF_ACCESS_TEAM_DOMAIN!,
    env.CF_ACCESS_AUD!,
    parseAllowedEmails(env)
  );
  if (result.ok) {
    await ensureDrmTables(env);
    (request as any).__adminEmail = result.email;
    return null;
  }

  return new Response(
    JSON.stringify({
      error: result.error || "Invalid Cloudflare Access JWT",
      code: "ACCESS_JWT_INVALID"
    }),
    { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}
