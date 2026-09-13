import { Env } from '../types';

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerRecord {
  name: string;
  state: CircuitState;
  failure_count: number;
  success_count: number;
  last_failure_time?: string | null;
  cooldown_until?: string | null;
  last_retry_after: number;
  updated_at: string;
}

export interface CircuitCheckResult {
  allowed: boolean;
  state: CircuitState;
  retryAfter: number; // In seconds
}

const _circuitBreakersTableEnsured = new WeakSet<object>();

/**
 * Ensures the circuit_breakers state table exists in D1.
 */
export async function ensureCircuitBreakersTable(env: Env): Promise<void> {
  if (!env?.DB || _circuitBreakersTableEnsured.has(env.DB)) return;
  try {
    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS circuit_breakers (
        name TEXT PRIMARY KEY,
        state TEXT NOT NULL DEFAULT 'CLOSED',
        failure_count INTEGER NOT NULL DEFAULT 0,
        success_count INTEGER NOT NULL DEFAULT 0,
        last_failure_time TEXT DEFAULT NULL,
        cooldown_until TEXT DEFAULT NULL,
        last_retry_after INTEGER DEFAULT 0,
        updated_at TEXT NOT NULL
      )
    `).run();
    _circuitBreakersTableEnsured.add(env.DB);
  } catch (err: any) {
    const msg = String(err?.message || err);
    if (/already exists/i.test(msg)) {
      _circuitBreakersTableEnsured.add(env.DB);
    } else {
      console.error('Failed to ensure circuit_breakers table:', err);
    }
  }
}

/**
 * Checks whether an outbound call to the protected resource is permitted.
 * - CLOSED: All requests allowed.
 * - OPEN: Requests rejected until cooldown_until has passed.
 * - HALF_OPEN: Cooldown expired, allows a single probe request to test upstream health.
 */
export async function canExecuteCircuit(
  env: Env,
  name: string
): Promise<CircuitCheckResult> {
  await ensureCircuitBreakersTable(env);
  const now = Date.now();
  const nowIso = new Date(now).toISOString();

  // 1. Atomic CAS transition: OPEN -> HALF_OPEN (Single Probe Gate, R39-5)
  // Only the single caller that transitions state from OPEN to HALF_OPEN gets the probe privilege
  const casRes = await env.DB.prepare(`
    UPDATE circuit_breakers
    SET state = 'HALF_OPEN', updated_at = ?
    WHERE name = ? AND state = 'OPEN' AND (cooldown_until IS NULL OR cooldown_until <= ?)
  `).bind(nowIso, name, nowIso).run();

  if (casRes.meta.changes === 1) {
    console.log(`[CIRCUIT-BREAKER] Circuit '${name}' cooldown elapsed. Single probe granted (transitioned to HALF_OPEN).`);
    return { allowed: true, state: 'HALF_OPEN', retryAfter: 0 };
  }

  // 2. Inspect current circuit state
  const row = await env.DB.prepare(
    'SELECT name, state, failure_count, success_count, cooldown_until, last_retry_after FROM circuit_breakers WHERE name = ?'
  ).bind(name).first<CircuitBreakerRecord>();

  if (!row || row.state === 'CLOSED') {
    return { allowed: true, state: 'CLOSED', retryAfter: 0 };
  }

  if (row.state === 'HALF_OPEN') {
    // Another probe request is already in-flight; block concurrent callers until probe finishes (R39-5)
    return { allowed: false, state: 'HALF_OPEN', retryAfter: 15 };
  }

  // Still in OPEN state and cooldown not expired
  const cooldownTime = row.cooldown_until ? new Date(row.cooldown_until).getTime() : 0;
  const remainingSec = Math.max(1, Math.ceil((cooldownTime - now) / 1000));
  return { allowed: false, state: 'OPEN', retryAfter: remainingSec };
}

/**
 * Records a successful call to the upstream service.
 * Resets circuit state to CLOSED, resets failure_count to 0, and increments success_count.
 */
export async function recordCircuitSuccess(env: Env, name: string): Promise<void> {
  await ensureCircuitBreakersTable(env);
  const nowIso = new Date().toISOString();
  const row = await env.DB.prepare(
    'SELECT state, success_count FROM circuit_breakers WHERE name = ?'
  ).bind(name).first<{ state: string; success_count: number }>();

  if (!row) {
    await env.DB.prepare(`
      INSERT OR REPLACE INTO circuit_breakers (name, state, failure_count, success_count, last_failure_time, cooldown_until, last_retry_after, updated_at)
      VALUES (?, ?, ?, ?, NULL, ?, ?, ?)
    `).bind(name, 'CLOSED', 0, 1, null, 0, nowIso).run();
    return;
  }

  if (row.state !== 'CLOSED') {
    console.log(`[CIRCUIT-BREAKER] Circuit '${name}' self-healed. Transitioning ${row.state} -> CLOSED.`);
  }

  await env.DB.prepare(`
    UPDATE circuit_breakers
    SET state = ?,
        failure_count = ?,
        success_count = success_count + 1,
        cooldown_until = NULL,
        last_retry_after = 0,
        updated_at = ?
    WHERE name = ?
  `).bind('CLOSED', 0, nowIso, name).run();
}

/**
 * Records a failure when calling the upstream service.
 * - If isRateLimit is true (HTTP 429), trips immediately to OPEN and enforces retryAfterSec.
 * - If state is HALF_OPEN, probe failed -> trips immediately to OPEN with exponential backoff.
 * - If failure_count >= 3 in CLOSED -> trips to OPEN.
 */
export async function recordCircuitFailure(
  env: Env,
  name: string,
  retryAfterSec?: number,
  isRateLimit?: boolean
): Promise<void> {
  await ensureCircuitBreakersTable(env);
  const now = Date.now();
  const nowIso = new Date(now).toISOString();

  const row = await env.DB.prepare(
    'SELECT state, failure_count, last_retry_after FROM circuit_breakers WHERE name = ?'
  ).bind(name).first<CircuitBreakerRecord>();

  const currentFails = (row?.failure_count || 0) + 1;
  const currentState = row?.state || 'CLOSED';

  // Determine cooldown duration
  let cooldownSec = 60; // default 1 min
  if (retryAfterSec && retryAfterSec > 0) {
    cooldownSec = retryAfterSec;
  } else if (row?.last_retry_after && row.last_retry_after > 0) {
    cooldownSec = Math.min(row.last_retry_after * 2, 3600); // Exponential backoff capped at 1h
  } else {
    cooldownSec = Math.min(30 * Math.pow(2, Math.min(currentFails - 1, 6)), 3600);
  }

  const cooldownUntilIso = new Date(now + cooldownSec * 1000).toISOString();

  let nextState: CircuitState = currentState;
  if (isRateLimit || currentState === 'HALF_OPEN' || currentFails >= 3) {
    nextState = 'OPEN';
    console.warn(`[CIRCUIT-BREAKER] Circuit '${name}' tripped to OPEN (failures=${currentFails}, cooldown=${cooldownSec}s until ${cooldownUntilIso})`);
  }

  await env.DB.prepare(`
    INSERT INTO circuit_breakers (name, state, failure_count, success_count, last_failure_time, cooldown_until, last_retry_after, updated_at)
    VALUES (?, ?, ?, 0, ?, ?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET
      state = excluded.state,
      failure_count = excluded.failure_count,
      last_failure_time = excluded.last_failure_time,
      cooldown_until = excluded.cooldown_until,
      last_retry_after = excluded.last_retry_after,
      updated_at = excluded.updated_at
  `).bind(
    name,
    nextState,
    currentFails,
    nowIso,
    cooldownUntilIso,
    cooldownSec,
    nowIso
  ).run();
}

/**
 * Resets the circuit breaker to CLOSED (for admin manual recovery).
 */
export async function resetCircuitBreaker(env: Env, name: string): Promise<void> {
  await ensureCircuitBreakersTable(env);
  const nowIso = new Date().toISOString();
  await env.DB.prepare(`
    INSERT INTO circuit_breakers (name, state, failure_count, success_count, last_failure_time, cooldown_until, last_retry_after, updated_at)
    VALUES (?, ?, ?, 0, NULL, NULL, 0, ?)
    ON CONFLICT(name) DO UPDATE SET
      state = excluded.state,
      failure_count = excluded.failure_count,
      cooldown_until = excluded.cooldown_until,
      last_retry_after = excluded.last_retry_after,
      updated_at = excluded.updated_at
  `).bind(name, 'CLOSED', 0, nowIso).run();
  console.log(`[CIRCUIT-BREAKER] Circuit '${name}' manually reset to CLOSED.`);
}


/**
 * Returns the current status of the circuit breaker for telemetry/admin dashboard.
 */
export async function getCircuitBreakerStatus(env: Env, name: string): Promise<CircuitBreakerRecord | null> {
  await ensureCircuitBreakersTable(env);
  return await env.DB.prepare(
    'SELECT * FROM circuit_breakers WHERE name = ?'
  ).bind(name).first<CircuitBreakerRecord>();
}
