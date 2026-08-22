import { Env } from '../types';
import { ensureManualBlacklistTable } from './blacklist';
import { verifyCloudflareAccessJwt } from './cf-access-jwt';
import { logSystemError } from './error-logger';
import { isTestEnvironment } from './env-guard';

export function getCorsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("Origin") || "";
  let allowOrigin = "*";
  if (origin && (
    origin.includes("eqt.net.im") ||
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

// In-memory caching guards keyed by D1 binding instance (WeakSet) to ensure idempotent schema setup
// per database instance without leaking memory or cross-environment isolation assumptions.
const deviceIdColumnEnsured = new WeakSet<object>();
const autoRenewColumnEnsured = new WeakSet<object>();
const activationNetworkColumnsEnsured = new WeakSet<object>();
const verificationCodesCreatedAtEnsured = new WeakSet<object>();
const deviceRegistryTableEnsured = new WeakSet<object>();
const licenseUpgradesTableEnsured = new WeakSet<object>();
const licensePaddleTxnIndexEnsured = new WeakSet<object>();
const drmTablesEnsured = new WeakSet<object>();
const licenseSourceColumnsEnsured = new WeakSet<object>();

/**
 * Ensure the activations table has the device_id column.
 * Safe to call repeatedly (ignores "duplicate column" errors).
 */
export async function ensureDeviceIdColumn(env: Env): Promise<void> {
  if (!env?.DB || deviceIdColumnEnsured.has(env.DB)) return;
  try {
    await env.DB.prepare(
      "ALTER TABLE activations ADD COLUMN device_id TEXT DEFAULT NULL"
    ).run();
    deviceIdColumnEnsured.add(env.DB);
  } catch (err: any) {
    const msg = String(err?.message || err);
    if (/duplicate column|already exists/i.test(msg)) {
      deviceIdColumnEnsured.add(env.DB);
    } else {
      console.error("Failed to ensure device_id column:", err);
    }
  }
}

/** Ensure licenses table has auto_renew column. Safe to call repeatedly. */
export async function ensureAutoRenewColumn(env: Env): Promise<void> {
  if (!env?.DB || autoRenewColumnEnsured.has(env.DB)) return;
  try {
    await env.DB.prepare(
      "ALTER TABLE licenses ADD COLUMN auto_renew INTEGER DEFAULT 1"
    ).run();
    autoRenewColumnEnsured.add(env.DB);
  } catch (err: any) {
    const msg = String(err?.message || err);
    if (/duplicate column|already exists/i.test(msg)) {
      autoRenewColumnEnsured.add(env.DB);
    } else {
      console.error("Failed to ensure auto_renew column:", err);
    }
  }
}

/** Ensure activations has network meta columns (ip / country / ua / trace_id). Idempotent. */
export async function ensureActivationNetworkColumns(env: Env): Promise<void> {
  if (!env?.DB || activationNetworkColumnsEnsured.has(env.DB)) return;
  const alters = [
    "ALTER TABLE activations ADD COLUMN client_ip TEXT DEFAULT NULL",
    "ALTER TABLE activations ADD COLUMN ip_country TEXT DEFAULT NULL",
    "ALTER TABLE activations ADD COLUMN user_agent TEXT DEFAULT NULL",
    "ALTER TABLE activations ADD COLUMN city TEXT DEFAULT NULL",
    "ALTER TABLE activations ADD COLUMN region TEXT DEFAULT NULL",
    "ALTER TABLE activations ADD COLUMN latitude REAL DEFAULT NULL",
    "ALTER TABLE activations ADD COLUMN longitude REAL DEFAULT NULL",
    "ALTER TABLE activations ADD COLUMN trace_id TEXT DEFAULT NULL",
  ];
  let allOk = true;
  for (const sql of alters) {
    try {
      await env.DB.prepare(sql).run();
    } catch (err: any) {
      const msg = String(err?.message || err);
      if (!/duplicate column|already exists/i.test(msg)) {
        console.error("Failed to add activation network column:", err);
        allOk = false;
      }
    }
  }
  if (allOk) {
    activationNetworkColumnsEnsured.add(env.DB);
  }
}

/** Ensure verification_codes.created_at exists for 60s send-code rate limiting. */
export async function ensureVerificationCodesCreatedAt(env: Env): Promise<void> {
  if (!env?.DB || verificationCodesCreatedAtEnsured.has(env.DB)) return;
  try {
    await env.DB.prepare(
      "ALTER TABLE verification_codes ADD COLUMN created_at TEXT"
    ).run();
    verificationCodesCreatedAtEnsured.add(env.DB);
  } catch (err: any) {
    const msg = String(err?.message || err);
    if (/duplicate column|already exists/i.test(msg)) {
      verificationCodesCreatedAtEnsured.add(env.DB);
    } else {
      console.error("Failed to ensure verification_codes.created_at:", err);
    }
  }
}

export async function ensureDeviceRegistryTable(env: Env): Promise<void> {
  if (!env?.DB || deviceRegistryTableEnsured.has(env.DB)) return;
  try {
    await env.DB.batch([
      env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS device_registry (
            device_id     TEXT PRIMARY KEY,
            uuid_hash     TEXT,
            cpu_hash      TEXT,
            disk_hash     TEXT,
            tier_label    TEXT NOT NULL DEFAULT 'free',
            license_code  TEXT DEFAULT NULL,
            email         TEXT DEFAULT NULL,
            registered_at TEXT NOT NULL,
            last_seen_at  TEXT,
            last_ip       TEXT DEFAULT NULL,
            ip_country    TEXT DEFAULT NULL,
            city          TEXT DEFAULT NULL,
            region        TEXT DEFAULT NULL,
            latitude      REAL DEFAULT NULL,
            longitude     REAL DEFAULT NULL,
            app_version   TEXT DEFAULT NULL
        )
      `),
      env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_registry_live ON device_registry(tier_label, last_seen_at)`),
      env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_registry_last_seen ON device_registry(last_seen_at)`),
      env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_registry_uuid ON device_registry(uuid_hash)`),
      env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_registry_cpu ON device_registry(cpu_hash)`),
      env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_registry_disk ON device_registry(disk_hash)`)
    ]);
    deviceRegistryTableEnsured.add(env.DB);
  } catch (err: any) {
    const msg = String(err?.message || err);
    if (/already exists/i.test(msg)) {
      deviceRegistryTableEnsured.add(env.DB);
    } else {
      console.error("Failed to ensure device_registry table:", err);
    }
  }
}

export async function ensureLicenseUpgradesTable(env: Env): Promise<void> {
  if (!env?.DB || licenseUpgradesTableEnsured.has(env.DB)) return;
  try {
    await env.DB.batch([
      env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS license_upgrades (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_email TEXT NOT NULL,
            target_license_code TEXT NOT NULL,
            lifetime_txn_id TEXT NOT NULL,
            purchased_at TEXT NOT NULL,
            effective_at TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            created_at TEXT NOT NULL
        )
      `),
      // Partial unique index: at most one pending upgrade per license (must match schema.sql — same name + definition)
      env.DB.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_upgrades_target ON license_upgrades(target_license_code) WHERE status = 'pending'`),
      env.DB.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_upgrades_lifetime_txn ON license_upgrades(lifetime_txn_id)`)
    ]);
    licenseUpgradesTableEnsured.add(env.DB);
  } catch (err: any) {
    const msg = String(err?.message || err);
    if (/already exists/i.test(msg)) {
      licenseUpgradesTableEnsured.add(env.DB);
    } else {
      console.error("Failed to ensure license_upgrades table:", err);
    }
  }
}

/**
 * A2 (audit licensing-flow-audit.md): UNIQUE index on licenses.paddle_transaction_id makes the
 * SELECT→INSERT mint path atomic. SQLite unique indexes allow multiple NULLs, so non-purchase rows
 * (paddle_transaction_id NULL) are unaffected. CREATE UNIQUE INDEX FAILS if duplicates exist, so this
 * pre-checks duplicates first (like the idx_upgrades_* procedure); if any are found it skips + audits a
 * WARN so the gap stays visible until duplicates are cleaned manually.
 */
export async function ensureLicensePaddleTxnIndex(env: Env): Promise<void> {
  if (!env?.DB || licensePaddleTxnIndexEnsured.has(env.DB)) return;
  try {
    const dup = await env.DB.prepare(
      "SELECT paddle_transaction_id FROM licenses WHERE paddle_transaction_id IS NOT NULL GROUP BY paddle_transaction_id HAVING COUNT(*) > 1 LIMIT 1"
    ).first<{ paddle_transaction_id: string }>();
    if (dup) {
      await logSystemError(env, 'PADDLE_TXN_UNIQUE_INDEX', 'WARN',
        new Error(`Cannot create unique index idx_licenses_paddle_txn: duplicate paddle_transaction_id "${dup.paddle_transaction_id}" exists. Clean duplicates first.`),
        { duplicate_txn_id: dup.paddle_transaction_id });
      return;
    }
    await env.DB.prepare(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_licenses_paddle_txn ON licenses(paddle_transaction_id)"
    ).run();
    licensePaddleTxnIndexEnsured.add(env.DB);
  } catch (err: any) {
    const msg = String(err?.message || err);
    if (/already exists/i.test(msg)) {
      licensePaddleTxnIndexEnsured.add(env.DB);
    } else {
      console.error("Failed to ensure paddle_transaction_id unique index:", err);
    }
  }
}

export async function ensureDrmTables(env: Env): Promise<void> {
  if (!env?.DB || drmTablesEnsured.has(env.DB)) return;
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
            auto_renew INTEGER DEFAULT 1,
            revoked_at TEXT DEFAULT NULL,
            revoke_reason TEXT DEFAULT NULL,
            last_purchased_at TEXT DEFAULT NULL,
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
            activated_at TEXT NOT NULL,
            client_ip TEXT DEFAULT NULL,
            ip_country TEXT DEFAULT NULL,
            user_agent TEXT DEFAULT NULL,
            city TEXT DEFAULT NULL,
            region TEXT DEFAULT NULL,
            latitude REAL DEFAULT NULL,
            longitude REAL DEFAULT NULL,
            trace_id TEXT DEFAULT NULL
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
    drmTablesEnsured.add(env.DB);
  } catch (err: any) {
    const msg = String(err?.message || err);
    if (/already exists/i.test(msg)) {
      drmTablesEnsured.add(env.DB);
    } else {
      console.error("Failed to ensure DRM D1 tables:", err);
    }
  }
  await ensureLicenseSourceColumns(env);
  await ensureDeviceIdColumn(env);
  await ensureActivationNetworkColumns(env);
  await ensureManualBlacklistTable(env);
  await ensureDeviceRegistryTable(env);
  await ensureLicenseUpgradesTable(env);
  await ensureLicensePaddleTxnIndex(env);
  await ensurePaddleProcessedTxnTable(env);
  await ensureActivationDeviceIndex(env);
}

export async function ensurePaddleProcessedTxnTable(env: Env): Promise<void> {
  if (!env?.DB) return;
  try {
    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS paddle_processed_transactions (
          transaction_id TEXT PRIMARY KEY,
          license_code TEXT NOT NULL,
          action TEXT NOT NULL,
          created_at TEXT NOT NULL
      )
    `).run();
  } catch (err: any) {
    const msg = String(err?.message || err);
    if (!/already exists/i.test(msg)) {
      console.error("Failed to ensure paddle_processed_transactions table:", err);
    }
  }
}

export async function ensureActivationDeviceIndex(env: Env): Promise<void> {
  if (!env?.DB) return;
  try {
    const dup = await env.DB.prepare(
      `SELECT license_code, device_id, COUNT(*) as cnt
       FROM activations
       WHERE device_id IS NOT NULL AND device_id != ''
       GROUP BY license_code, device_id
       HAVING cnt > 1
       LIMIT 1`
    ).first<{ license_code: string; device_id: string; cnt: number }>();

    if (dup) {
      await logSystemError(env, 'ACTIVATION_DEVICE_UNIQUE_INDEX', 'WARN',
        new Error(`Cannot create unique index idx_activations_license_device: duplicate (license_code="${dup.license_code}", device_id="${dup.device_id}") found (${dup.cnt} rows). Clean duplicates first.`),
        { duplicate_license: dup.license_code, duplicate_device: dup.device_id, count: dup.cnt });
      return;
    }

    await env.DB.prepare(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_activations_license_device
      ON activations(license_code, device_id)
      WHERE device_id IS NOT NULL AND device_id != ''
    `).run();
  } catch (err: any) {
    const msg = String(err?.message || err);
    if (!/already exists/i.test(msg)) {
      console.error("Failed to ensure idx_activations_license_device index:", err);
    }
  }
}

/** Idempotent ALTERs for license origin + abuse-window timestamps + bound device. */
export async function ensureLicenseSourceColumns(env: Env): Promise<void> {
  if (!env?.DB || licenseSourceColumnsEnsured.has(env.DB)) return;
  const alters = [
    "ALTER TABLE licenses ADD COLUMN source TEXT DEFAULT NULL",
    "ALTER TABLE licenses ADD COLUMN bound_device_id TEXT DEFAULT NULL",
    "ALTER TABLE licenses ADD COLUMN revoked_at TEXT DEFAULT NULL",
    "ALTER TABLE licenses ADD COLUMN revoke_reason TEXT DEFAULT NULL",
    "ALTER TABLE licenses ADD COLUMN last_purchased_at TEXT DEFAULT NULL",
  ];
  let allOk = true;
  for (const sql of alters) {
    try {
      await env.DB.prepare(sql).run();
    } catch (err: any) {
      const msg = String(err?.message || err);
      if (!/duplicate column|already exists/i.test(msg)) {
        console.error("Failed to add license source column:", err);
        allOk = false;
      }
    }
  }
  if (allOk) {
    licenseSourceColumnsEnsured.add(env.DB);
  }
}

const betaTestersTableEnsured = new WeakSet<object>();

export async function ensureBetaTestersTable(env: Env): Promise<void> {
  if (!env?.DB || betaTestersTableEnsured.has(env.DB)) return;
  try {
    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS sandbox_beta_testers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        device_id TEXT DEFAULT NULL,
        email TEXT DEFAULT NULL,
        notes TEXT DEFAULT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL
      )
    `).run();
    try {
      // Migration: old unique device index prohibited one-device-many-emails. Drop before recreating non-unique.
      await env.DB.prepare(`DROP INDEX IF EXISTS idx_beta_device`).run();
    } catch (_) {}
    try {
      await env.DB.prepare(`
        CREATE INDEX IF NOT EXISTS idx_beta_device ON sandbox_beta_testers(device_id) WHERE device_id IS NOT NULL AND device_id != ''
      `).run();
    } catch (_) {}
    try {
      await env.DB.prepare(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_beta_email ON sandbox_beta_testers(email) WHERE email IS NOT NULL AND email != ''
      `).run();
    } catch (_) {}

    // Seeding safety: ONLY seed default test data in test/sandbox environments!
    if (isTestEnvironment(env)) {
      const countRow = await env.DB.prepare("SELECT COUNT(*) as count FROM sandbox_beta_testers").first<{ count: number }>();
      if (!countRow || countRow.count === 0) {
        const now = new Date().toISOString();
        await env.DB.batch([
          env.DB.prepare("INSERT OR IGNORE INTO sandbox_beta_testers (device_id, email, notes, status, created_at) VALUES (?, ?, ?, 'active', ?)").bind('b0036718cb9a469999d2910cdf418b1f', 'tmp@301098.xyz', 'Default Sandbox Beta Device', now),
          env.DB.prepare("INSERT OR IGNORE INTO sandbox_beta_testers (device_id, email, notes, status, created_at) VALUES (?, ?, ?, 'active', ?)").bind('b0036718cb9a469999d2910cdf418b1f', 'anon@301098.xyz', 'Default Sandbox Beta Device (alt email)', now),
          env.DB.prepare("INSERT OR IGNORE INTO sandbox_beta_testers (device_id, email, notes, status, created_at) VALUES (?, ?, ?, 'active', ?)").bind('sandbox_seed_device_placeholder', 'seed@301098.xyz', 'Default Sandbox Seed Pair', now),
        ]);
      }
    }

    betaTestersTableEnsured.add(env.DB);
  } catch (err: any) {
    const msg = String(err?.message || err);
    if (/already exists/i.test(msg)) {
      betaTestersTableEnsured.add(env.DB);
    } else {
      console.error("Failed to ensure sandbox_beta_testers table:", err);
    }
  }
}

function accessConfigured(env: Env): boolean {
  return !!(env.CF_ACCESS_TEAM_DOMAIN && env.CF_ACCESS_AUD);
}

function parseAllowedEmails(env: Env): string[] {
  const raw = (env.CF_ACCESS_ALLOWED_EMAILS || "").trim();
  if (!raw || raw === "*") return [];
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

  let jwt =
    request.headers.get("Cf-Access-Jwt-Assertion") ||
    request.headers.get("cf-access-jwt-assertion");

  if (!jwt) {
    const authHeader = request.headers.get("Authorization") || request.headers.get("authorization");
    if (authHeader && authHeader.toLowerCase().startsWith("bearer ")) {
      jwt = authHeader.slice(7).trim();
    }
  }

  if (!jwt) {
    const cookieHeader = request.headers.get("cookie") || request.headers.get("Cookie");
    if (cookieHeader) {
      const match = cookieHeader.match(/CF_Authorization=([^;]+)/);
      if (match) {
        jwt = match[1].trim();
      }
    }
  }

  if (!jwt) {
    return new Response(
      JSON.stringify({
        error: "Cloudflare Access JWT required",
        code: "ACCESS_JWT_REQUIRED",
        error_code: "ACCESS_JWT_REQUIRED"
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
      code: "ACCESS_JWT_INVALID",
      error_code: "ACCESS_JWT_INVALID"
    }),
    { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}
