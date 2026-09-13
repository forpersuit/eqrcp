import { Env } from '../types';

const _tokenBucketsTableEnsured = new WeakSet<object>();

/**
 * Ensures the token_buckets table exists in D1.
 */
export async function ensureTokenBucketsTable(env: Env): Promise<void> {
  if (!env?.DB || _tokenBucketsTableEnsured.has(env.DB)) return;
  try {
    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS token_buckets (
        key TEXT PRIMARY KEY,
        tokens REAL NOT NULL,
        last_refill TEXT NOT NULL,
        capacity REAL NOT NULL,
        refill_rate REAL NOT NULL
      )
    `).run();
    _tokenBucketsTableEnsured.add(env.DB);
  } catch (err: any) {
    const msg = String(err?.message || err);
    if (/already exists/i.test(msg)) {
      _tokenBucketsTableEnsured.add(env.DB);
    } else {
      console.error('Failed to ensure token_buckets table:', err);
    }
  }
}

export interface TokenBucketResult {
  allowed: boolean;
  retryAfter: number; // in seconds
  currentTokens: number;
}

/**
 * D1-backed Token Bucket rate limiter for traffic smoothing and per-minute rate protection.
 * Smooths traffic peaks by ensuring requests consume tokens refillable over time.
 *
 * @param env Worker environment
 * @param key Bucket key identifier (e.g. 'cert_provision:acme_smoothing')
 * @param capacity Maximum token burst capacity (e.g. 5)
 * @param refillRatePerSec Tokens added per second (e.g. 10 / 60 = 0.1667)
 */
export async function consumeToken(
  env: Env,
  key: string,
  capacity: number,
  refillRatePerSec: number
): Promise<TokenBucketResult> {
  await ensureTokenBucketsTable(env);
  const now = Date.now();
  const nowIso = new Date(now).toISOString();

  // 1. Ensure bucket row exists (initial tokens = capacity)
  await env.DB.prepare(`
    INSERT OR IGNORE INTO token_buckets (key, tokens, last_refill, capacity, refill_rate)
    VALUES (?, ?, ?, ?, ?)
  `).bind(key, capacity, nowIso, capacity, refillRatePerSec).run();

  // 2. Atomically calculate refreshed tokens and decrement by 1.0 (R39-2)
  const updateRes = await env.DB.prepare(`
    UPDATE token_buckets
    SET
      tokens = MIN(capacity, tokens + MAX(0.0, (julianday(?) - julianday(last_refill)) * 86400.0) * refill_rate) - 1.0,
      last_refill = ?
    WHERE key = ?
      AND MIN(capacity, tokens + MAX(0.0, (julianday(?) - julianday(last_refill)) * 86400.0) * refill_rate) >= 1.0
    RETURNING tokens;
  `).bind(nowIso, nowIso, key, nowIso).first<{ tokens: number }>();

  if (updateRes) {
    return { allowed: true, retryAfter: 0, currentTokens: updateRes.tokens };
  }

  // 3. Bucket has less than 1.0 token -> compute dynamic retryAfter
  const cur = await env.DB.prepare(
    'SELECT tokens, last_refill, capacity, refill_rate FROM token_buckets WHERE key = ?'
  ).bind(key).first<{
    tokens: number;
    last_refill: string;
    capacity: number;
    refill_rate: number;
  }>();

  const curTokens = cur?.tokens ?? 0;
  const curRefillRate = cur?.refill_rate || refillRatePerSec || (10 / 60);
  const needed = Math.max(0, 1.0 - curTokens);
  const retryAfter = Math.max(1, Math.ceil(needed / curRefillRate));

  return { allowed: false, retryAfter, currentTokens: curTokens };
}

