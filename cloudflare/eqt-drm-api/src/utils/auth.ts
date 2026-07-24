import { Env } from '../types';
import {
  clearAdminAuthFailures,
  isAdminAuthRateLimited,
  recordAdminAuthFailure
} from './rate-limit';
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
      "Content-Type, Authorization, X-Admin-Secret, Cf-Access-Jwt-Assertion",
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
  const xff = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (xff) return xff;
  return (
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-real-ip") ||
    ""
  );
}

function timingSafeEqualStr(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) {
    const ca = i < a.length ? a.charCodeAt(i) : 0;
    const cb = i < b.length ? b.charCodeAt(i) : 0;
    diff |= ca ^ cb;
  }
  return diff === 0;
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
 * Admin route guard:
 * 1) Cloudflare Access JWT (Cf-Access-Jwt-Assertion) when CF_ACCESS_* configured
 * 2) X-Admin-Secret fallback when allowed (local dev / break-glass)
 *
 * - Neither Access nor ADMIN_SECRET usable → 503
 * - CF_ACCESS_REQUIRE_JWT=true → secret path disabled
 * - Wrong secret → 401 + in-isolate rate limit
 */
export async function requireAdminAuth(
  request: Request,
  env: Env,
  corsHeaders: Record<string, string>
): Promise<Response | null> {
  const clientIp = clientIpFromRequest(request);
  const accessOn = accessConfigured(env);
  const requireJwt = String(env.CF_ACCESS_REQUIRE_JWT || "").toLowerCase() === "true";
  const allowSecret =
    !requireJwt &&
    !!env.ADMIN_SECRET &&
    (String(env.CF_ACCESS_ALLOW_SECRET || "true").toLowerCase() !== "false" || !accessOn);

  // --- Path 1: Cloudflare Access JWT ---
  if (accessOn) {
    const jwt =
      request.headers.get("Cf-Access-Jwt-Assertion") ||
      request.headers.get("cf-access-jwt-assertion");
    if (jwt) {
      const result = await verifyCloudflareAccessJwt(
        jwt,
        env.CF_ACCESS_TEAM_DOMAIN!,
        env.CF_ACCESS_AUD!,
        parseAllowedEmails(env)
      );
      if (result.ok) {
        clearAdminAuthFailures(clientIp);
        await ensureDrmTables(env);
        // Stash verified identity for handlers (optional header for audit)
        (request as any).__adminEmail = result.email;
        return null;
      }
      // Invalid JWT: do not fall through silently if requireJwt
      if (requireJwt) {
        return new Response(
          JSON.stringify({
            error: result.error || "Invalid Cloudflare Access JWT",
            code: "ACCESS_JWT_INVALID"
          }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      // else try secret fallback below
    } else if (requireJwt) {
      return new Response(
        JSON.stringify({
          error: "Cloudflare Access JWT required",
          code: "ACCESS_JWT_REQUIRED"
        }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  }

  // --- Path 2: shared ADMIN_SECRET (dev / transition / break-glass) ---
  if (!allowSecret) {
    if (!accessOn && !env.ADMIN_SECRET) {
      return new Response(
        JSON.stringify({ error: "Admin API not configured (ADMIN_SECRET / CF Access missing)" }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    return new Response(
      JSON.stringify({
        error: "Unauthorized (Access JWT required; secret login disabled)",
        code: "ACCESS_JWT_REQUIRED"
      }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  if (!env.ADMIN_SECRET) {
    return new Response(
      JSON.stringify({ error: "Admin API not configured (ADMIN_SECRET missing)" }),
      { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const adminSecret = request.headers.get("X-Admin-Secret");
  if (!adminSecret) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (timingSafeEqualStr(adminSecret, env.ADMIN_SECRET)) {
    clearAdminAuthFailures(clientIp);
    await ensureDrmTables(env);
    (request as any).__adminEmail = "secret-operator";
    return null;
  }

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
