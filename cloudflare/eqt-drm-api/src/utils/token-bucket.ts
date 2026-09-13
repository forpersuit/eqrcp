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

  const row = await env.DB.prepare(
    'SELECT tokens, last_refill, capacity, refill_rate FROM token_buckets WHERE key = ?'
  ).bind(key).first<{
    tokens: number;
    last_refill: string;
    capacity: number;
    refill_rate: number;
  }>();

  if (!row) {
    // Initial bucket creation: start with capacity - 1 (1 token consumed)
    const initialTokens = Math.max(0, capacity - 1);
    await env.DB.prepare(`
      INSERT OR REPLACE INTO token_buckets (key, tokens, last_refill, capacity, refill_rate)
      VALUES (?, ?, ?, ?, ?)
    `).bind(key, initialTokens, nowIso, capacity, refillRatePerSec).run();
    return { allowed: true, retryAfter: 0, currentTokens: initialTokens };
  }

  const elapsedSec = Math.max(0, (now - new Date(row.last_refill).getTime()) / 1000);
  const currentCapacity = capacity || row.capacity;
  const currentRefillRate = refillRatePerSec || row.refill_rate;

  const refreshedTokens = Math.min(currentCapacity, row.tokens + elapsedSec * currentRefillRate);

  if (refreshedTokens >= 1.0) {
    const remainingTokens = refreshedTokens - 1.0;
    await env.DB.prepare(`
      UPDATE token_buckets
      SET tokens = ?, last_refill = ?, capacity = ?, refill_rate = ?
      WHERE key = ?
    `).bind(remainingTokens, nowIso, currentCapacity, currentRefillRate, key).run();
    return { allowed: true, retryAfter: 0, currentTokens: remainingTokens };
  } else {
    const needed = 1.0 - refreshedTokens;
    const retryAfter = Math.max(1, Math.ceil(needed / currentRefillRate));
    // Save updated refreshedTokens without consuming
    await env.DB.prepare(`
      UPDATE token_buckets
      SET tokens = ?, last_refill = ?, capacity = ?, refill_rate = ?
      WHERE key = ?
    `).bind(refreshedTokens, nowIso, currentCapacity, currentRefillRate, key).run();
    return { allowed: false, retryAfter, currentTokens: refreshedTokens };
  }
}
