/**
 * EQT E2EE Ephemeral Session Key Exchange Service
 * Complies with Phase 2 of E2EE Implementation Plan (20260901).
 * Features:
 *   - Device-level singleton session upsert (1 PC = 1 active session)
 *   - 10-minute TTL with real-time expiration checks
 *   - Zero telemetry logging & minimal CORS
 *   - Immediate atomic session closure
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
      claim_token_hash TEXT NOT NULL,
      encrypted_master_key TEXT NOT NULL,
      k_auth_hash TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
  `).run();
  await db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_e2ee_device ON e2ee_sessions(device_id);`).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_e2ee_claim_token ON e2ee_sessions(claim_token_hash);`).run();
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

  // 1. Health check probe (HEAD or GET /api/v1/session/health or /health)
  if ((url.pathname === "/api/v1/session/health" || url.pathname === "/health") &&
      (request.method === "HEAD" || request.method === "GET")) {
    return new Response(request.method === "HEAD" ? null : JSON.stringify({ status: "healthy", ok: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  // 2. Session Create / Singleton Upsert (POST /api/v1/session/create)
  if (url.pathname === "/api/v1/session/create" && request.method === "POST") {
    const body: any = await request.json().catch(() => ({}));
    const { license_code, device_id, claim_token_hash, encrypted_master_key, k_auth_hash } = body;

    if (!license_code || !device_id || !claim_token_hash || !encrypted_master_key || !k_auth_hash) {
      return new Response(JSON.stringify({
        error: "Missing required fields: license_code, device_id, claim_token_hash, encrypted_master_key, k_auth_hash"
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    await ensureE2EESessionsTable(db);

    // Optional license validation if present
    const lic: any = await db.prepare("SELECT status FROM licenses WHERE license_code = ?")
      .bind(license_code.trim())
      .first();

    if (lic && lic.status === 'revoked') {
      return new Response(JSON.stringify({ error: "License revoked" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const sessionId = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + 600; // 10 minutes TTL

    // Lazy GC of expired sessions in background
    ctx.waitUntil(
      db.prepare("DELETE FROM e2ee_sessions WHERE expires_at < ?").bind(now).run()
    );

    // Singleton Upsert on device_id: replaces any previous session for this PC
    await db.prepare(`
      INSERT INTO e2ee_sessions (
        session_id, license_code, device_id, claim_token_hash,
        encrypted_master_key, k_auth_hash, expires_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(device_id) DO UPDATE SET
        session_id = excluded.session_id,
        license_code = excluded.license_code,
        claim_token_hash = excluded.claim_token_hash,
        encrypted_master_key = excluded.encrypted_master_key,
        k_auth_hash = excluded.k_auth_hash,
        expires_at = excluded.expires_at,
        created_at = excluded.created_at
    `).bind(
      sessionId,
      license_code.trim(),
      device_id.trim(),
      claim_token_hash.trim(),
      encrypted_master_key.trim(),
      k_auth_hash.trim(),
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

  // 3. Session Claim (GET /api/v1/session/claim?token=...)
  if (url.pathname === "/api/v1/session/claim" && request.method === "GET") {
    const token = url.searchParams.get("token");
    if (!token || token.trim() === "") {
      return new Response(JSON.stringify({ error: "Missing token parameter" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    await ensureE2EESessionsTable(db);

    const tokenHash = await sha256Hex(token.trim());
    const now = Math.floor(Date.now() / 1000);

    const session: any = await db.prepare(`
      SELECT session_id, encrypted_master_key, k_auth_hash, expires_at
      FROM e2ee_sessions
      WHERE claim_token_hash = ?
    `).bind(tokenHash).first();

    if (!session) {
      return new Response(JSON.stringify({ error: "Session not found", not_found: true }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Real-time expiration check
    if (session.expires_at < now) {
      // Lazy cleanup
      ctx.waitUntil(
        db.prepare("DELETE FROM e2ee_sessions WHERE session_id = ?").bind(session.session_id).run()
      );
      return new Response(JSON.stringify({ error: "Session expired", expired: true }), {
        status: 410,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    return new Response(JSON.stringify({
      ok: true,
      session_id: session.session_id,
      encrypted_master_key: session.encrypted_master_key,
      k_auth_hash: session.k_auth_hash,
      expires_at: session.expires_at
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  // 4. Session Close (POST /api/v1/session/close)
  if (url.pathname === "/api/v1/session/close" && request.method === "POST") {
    const body: any = await request.json().catch(() => ({}));
    const { session_id, k_auth_hash, device_id } = body;

    if (!session_id && !device_id) {
      return new Response(JSON.stringify({ error: "Missing session_id or device_id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    await ensureE2EESessionsTable(db);

    if (session_id && k_auth_hash) {
      await db.prepare(`
        DELETE FROM e2ee_sessions WHERE session_id = ? AND k_auth_hash = ?
      `).bind(session_id.trim(), k_auth_hash.trim()).run();
    } else if (device_id) {
      await db.prepare(`
        DELETE FROM e2ee_sessions WHERE device_id = ?
      `).bind(device_id.trim()).run();
    }

    return new Response(JSON.stringify({ ok: true, closed: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  return null;
}
