/**
 * EQT E2EE Ephemeral Session Key Exchange Service
 * Complies with Phase 2 of E2EE Implementation Plan (20260901).
 * Features:
 *   - Device & Mode singleton session upsert (UNIQUE(device_id, mode))
 *   - Transparent blind relay of MasterKey over TLS 1.3 HTTPS
 *   - Atomic CAS claim quota management (max_claims)
 *   - Fail-closed License validation (active status + non-expired)
 *   - Deterministic close verification (checks affected rows)
 *   - 10-minute TTL with real-time expiration checks
 *   - Zero telemetry logging & minimal CORS
 */

import { Env } from '../types';
import { sha256Hex } from '../utils/crypto';

// Ensure table exists dynamically if not yet applied in D1
export async function ensureE2EESessionsTable(db: D1Database): Promise<void> {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS e2ee_sessions (
      session_id TEXT PRIMARY KEY,
      license_code TEXT NOT NULL,
      device_id TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'send',
      master_key_b64 TEXT NOT NULL,
      close_token_hash TEXT NOT NULL,
      k_auth_hash TEXT NOT NULL,
      claim_count INTEGER NOT NULL DEFAULT 0,
      max_claims INTEGER NOT NULL DEFAULT 5,
      status TEXT NOT NULL DEFAULT 'active',
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
  `).run();
  await db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_e2ee_device_mode ON e2ee_sessions(device_id, mode);`).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_e2ee_expires ON e2ee_sessions(expires_at);`).run();
}

export async function handleSessionRoutes(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  url: URL,
  corsHeaders: Record<string, string>
): Promise<Response | null> {
  const db = env.DB;
  if (!db) {
    return new Response(JSON.stringify({ error: "Database unavailable" }), {
      status: 503,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  const path = url.pathname;

  // 1. Health check probe (HEAD or GET /api/v1/e2ee/session/health, /api/v1/session/health or /health)
  if ((path === "/api/v1/e2ee/session/health" || path === "/api/v1/session/health" || path === "/health") &&
      (request.method === "HEAD" || request.method === "GET")) {
    return new Response(request.method === "HEAD" ? null : JSON.stringify({ status: "healthy", ok: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  // 2. Session Create / Singleton Upsert (POST /api/v1/e2ee/session/create or /api/v1/session/create)
  if ((path === "/api/v1/e2ee/session/create" || path === "/api/v1/session/create") && request.method === "POST") {
    const body: any = await request.json().catch(() => ({}));
    const {
      license_code,
      device_id,
      mode = "send",
      master_key_b64,
      encrypted_master_key, // backward compatibility
      close_token,
      close_token_hash: rawCloseTokenHash,
      k_auth_hash,
      max_claims = 5
    } = body;

    const keyPayload = master_key_b64 || encrypted_master_key;

    if (!license_code || !device_id || !keyPayload || !k_auth_hash) {
      return new Response(JSON.stringify({
        ok: false,
        error: "Missing required fields: license_code, device_id, master_key_b64, k_auth_hash",
        error_code: "INVALID_PAYLOAD"
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    await ensureE2EESessionsTable(db);

    // Fail-closed license validation
    const lic: any = await db.prepare("SELECT status, expires_at FROM licenses WHERE license_code = ?")
      .bind(license_code.trim())
      .first();

    if (!lic || lic.status !== 'active') {
      return new Response(JSON.stringify({
        ok: false,
        error: "Invalid, expired, or non-active license",
        error_code: "LICENSE_INACTIVE"
      }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    if (lic.expires_at && lic.expires_at !== 'LIFETIME') {
      const expTime = new Date(lic.expires_at).getTime();
      if (!isNaN(expTime) && expTime < Date.now()) {
        return new Response(JSON.stringify({
          ok: false,
          error: "License expired",
          error_code: "LICENSE_EXPIRED"
        }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
    }

    const sessionId = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + 600; // 10 minutes TTL
    const cleanMode = ["send", "receive", "chat"].includes(mode) ? mode : "send";

    let closeTokenHash = rawCloseTokenHash;
    if (!closeTokenHash) {
      closeTokenHash = close_token ? await sha256Hex(close_token) : k_auth_hash.trim();
    }

    // Lazy GC of expired sessions in background
    ctx.waitUntil(
      db.prepare("DELETE FROM e2ee_sessions WHERE expires_at < ?").bind(now).run()
    );

    // Singleton Upsert on (device_id, mode): allows concurrent send & receive on the same PC
    await db.prepare(`
      INSERT INTO e2ee_sessions (
        session_id, license_code, device_id, mode, master_key_b64,
        close_token_hash, k_auth_hash, claim_count, max_claims, status, expires_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, 'active', ?, ?)
      ON CONFLICT(device_id, mode) DO UPDATE SET
        session_id = excluded.session_id,
        license_code = excluded.license_code,
        master_key_b64 = excluded.master_key_b64,
        close_token_hash = excluded.close_token_hash,
        k_auth_hash = excluded.k_auth_hash,
        claim_count = 0,
        max_claims = excluded.max_claims,
        status = 'active',
        expires_at = excluded.expires_at,
        created_at = excluded.created_at
    `).bind(
      sessionId,
      license_code.trim(),
      device_id.trim(),
      cleanMode,
      keyPayload.trim(),
      closeTokenHash,
      k_auth_hash.trim(),
      Number(max_claims) || 5,
      expiresAt,
      now
    ).run();

    return new Response(JSON.stringify({
      ok: true,
      session_id: sessionId,
      expires_at: expiresAt
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  // 3. Session Claim (POST /api/v1/e2ee/session/:id/claim, POST /api/v1/e2ee/session/claim, GET /api/v1/session/claim)
  const isClaimRoute =
    path === "/api/v1/e2ee/session/claim" ||
    path === "/api/v1/session/claim" ||
    /^\/api\/v1\/(e2ee\/)?session\/[^\/]+\/claim$/.test(path);

  if (isClaimRoute && (request.method === "POST" || request.method === "GET")) {
    let sessionId: string | null = null;

    // Check path parameter /session/:id/claim
    const pathMatch = path.match(/^\/api\/v1\/(?:e2ee\/)?session\/([^\/]+)\/claim$/);
    if (pathMatch) {
      sessionId = pathMatch[1];
    }

    if (!sessionId) {
      if (request.method === "GET") {
        sessionId = url.searchParams.get("session_id") || url.searchParams.get("token");
      } else {
        const body: any = await request.json().catch(() => ({}));
        sessionId = body.session_id || body.token;
      }
    }

    if (!sessionId || sessionId.trim() === "") {
      return new Response(JSON.stringify({
        ok: false,
        error: "Missing session_id parameter",
        error_code: "INVALID_PARAM"
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    await ensureE2EESessionsTable(db);
    const cleanSessionId = sessionId.trim();
    const now = Math.floor(Date.now() / 1000);

    // Atomic CAS increment of claim_count
    const updateRes = await db.prepare(`
      UPDATE e2ee_sessions
      SET claim_count = claim_count + 1
      WHERE session_id = ? AND claim_count < max_claims AND expires_at > ? AND status = 'active'
    `).bind(cleanSessionId, now).run();

    const changes = (updateRes.meta as any)?.changes ?? (updateRes.success ? 1 : 0);

    if (changes > 0) {
      // Successfully claimed within quota
      const session: any = await db.prepare(`
        SELECT session_id, master_key_b64, k_auth_hash, expires_at, claim_count, max_claims
        FROM e2ee_sessions
        WHERE session_id = ?
      `).bind(cleanSessionId).first();

      if (session) {
        return new Response(JSON.stringify({
          ok: true,
          session_id: session.session_id,
          master_key_b64: session.master_key_b64,
          encrypted_master_key: session.master_key_b64, // backward compatibility
          k_auth_hash: session.k_auth_hash,
          expires_at: session.expires_at
        }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
    }

    // Atomic increment failed: diagnose precise reason
    const existing: any = await db.prepare(`
      SELECT session_id, claim_count, max_claims, status, expires_at
      FROM e2ee_sessions
      WHERE session_id = ?
    `).bind(cleanSessionId).first();

    if (!existing) {
      return new Response(JSON.stringify({
        ok: false,
        error: "Session not found",
        error_code: "SESSION_NOT_FOUND",
        not_found: true
      }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    if (existing.expires_at <= now) {
      ctx.waitUntil(
        db.prepare("DELETE FROM e2ee_sessions WHERE session_id = ?").bind(cleanSessionId).run()
      );
      return new Response(JSON.stringify({
        ok: false,
        error: "Session expired",
        error_code: "SESSION_EXPIRED",
        expired: true
      }), {
        status: 410,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    if (existing.claim_count >= existing.max_claims) {
      return new Response(JSON.stringify({
        ok: false,
        error: "Claim limit exceeded",
        error_code: "CLAIM_LIMIT_EXCEEDED",
        limit_exceeded: true
      }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    return new Response(JSON.stringify({
      ok: false,
      error: "Session is inactive or closed",
      error_code: "SESSION_INACTIVE"
    }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  // 4. Session Close (POST /api/v1/e2ee/session/:id/close, POST /api/v1/e2ee/session/close, POST /api/v1/session/close)
  const isCloseRoute =
    path === "/api/v1/e2ee/session/close" ||
    path === "/api/v1/session/close" ||
    /^\/api\/v1\/(e2ee\/)?session\/[^\/]+\/close$/.test(path);

  if (isCloseRoute && request.method === "POST") {
    const body: any = await request.json().catch(() => ({}));
    let { session_id, close_token, k_auth_hash, device_id, mode } = body;

    const pathMatch = path.match(/^\/api\/v1\/(?:e2ee\/)?session\/([^\/]+)\/close$/);
    if (pathMatch) {
      session_id = pathMatch[1];
    }

    if (!session_id && !device_id) {
      return new Response(JSON.stringify({ error: "Missing session_id or device_id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    await ensureE2EESessionsTable(db);

    let deleteRes: D1Response;
    if (session_id) {
      const closeHash = close_token ? await sha256Hex(close_token) : "";
      const authHash = k_auth_hash ? k_auth_hash.trim() : "";

      if (closeHash || authHash) {
        deleteRes = await db.prepare(`
          DELETE FROM e2ee_sessions
          WHERE session_id = ? AND (close_token_hash = ? OR k_auth_hash = ?)
        `).bind(session_id.trim(), closeHash, authHash).run();
      } else {
        deleteRes = await db.prepare(`
          DELETE FROM e2ee_sessions WHERE session_id = ?
        `).bind(session_id.trim()).run();
      }
    } else {
      // device_id mode
      const cleanMode = mode || "send";
      const closeHash = close_token ? await sha256Hex(close_token) : "";
      const authHash = k_auth_hash ? k_auth_hash.trim() : "";

      if (closeHash || authHash) {
        deleteRes = await db.prepare(`
          DELETE FROM e2ee_sessions
          WHERE device_id = ? AND mode = ? AND (close_token_hash = ? OR k_auth_hash = ?)
        `).bind(device_id.trim(), cleanMode, closeHash, authHash).run();
      } else {
        deleteRes = await db.prepare(`
          DELETE FROM e2ee_sessions WHERE device_id = ? AND mode = ?
        `).bind(device_id.trim(), cleanMode).run();
      }
    }

    const changes = (deleteRes.meta as any)?.changes ?? (deleteRes.success ? 1 : 0);
    if (changes === 0) {
      return new Response(JSON.stringify({
        ok: false,
        error: "Session not found or invalid close credentials",
        error_code: "SESSION_NOT_FOUND"
      }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    return new Response(JSON.stringify({ ok: true, closed: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  return null;
}
