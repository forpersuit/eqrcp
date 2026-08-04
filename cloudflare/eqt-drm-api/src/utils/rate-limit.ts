import { Env } from '../types';

/**
 * In-isolate admin auth rate limiter (failed secret attempts).
 * Not a global Cloudflare edge limit — still blocks brute-force within an isolate.
 */

interface FailBucket {
  fails: number;
  windowStart: number;
}

const WINDOW_MS = 5 * 60 * 1000;
const MAX_FAILS = 10;

const buckets = new Map<string, FailBucket>();

function clientKey(ip: string): string {
  return (ip || "unknown").trim() || "unknown";
}

function prune(now: number): void {
  if (buckets.size < 500) return;
  for (const [k, b] of buckets) {
    if (now - b.windowStart > WINDOW_MS) buckets.delete(k);
  }
}

/** Returns true if this IP is currently blocked for more failed auth. */
export function isAdminAuthRateLimited(ip: string): boolean {
  const now = Date.now();
  const key = clientKey(ip);
  const b = buckets.get(key);
  if (!b) return false;
  if (now - b.windowStart > WINDOW_MS) {
    buckets.delete(key);
    return false;
  }
  return b.fails >= MAX_FAILS;
}

export function recordAdminAuthFailure(ip: string): void {
  const now = Date.now();
  prune(now);
  const key = clientKey(ip);
  const b = buckets.get(key);
  if (!b || now - b.windowStart > WINDOW_MS) {
    buckets.set(key, { fails: 1, windowStart: now });
    return;
  }
  b.fails += 1;
}

export function clearAdminAuthFailures(ip: string): void {
  buckets.delete(clientKey(ip));
}

export function adminAuthRateLimitMeta(): { window_ms: number; max_fails: number } {
  return { window_ms: WINDOW_MS, max_fails: MAX_FAILS };
}

// --- OTP verify-code failure limiter (portal + checkout) ---
// In-isolate only; blocks rapid 6-digit brute force within a Worker instance.

const OTP_VERIFY_WINDOW_MS = 15 * 60 * 1000;
const OTP_VERIFY_MAX_FAILS = 8;

const otpVerifyBuckets = new Map<string, FailBucket>();

function pruneOtp(now: number): void {
  if (otpVerifyBuckets.size < 1000) return;
  for (const [k, b] of otpVerifyBuckets) {
    if (now - b.windowStart > OTP_VERIFY_WINDOW_MS) otpVerifyBuckets.delete(k);
  }
}

/** bucketKey e.g. `ip|purpose|email` */
export function isOtpVerifyRateLimited(bucketKey: string): boolean {
  const now = Date.now();
  const b = otpVerifyBuckets.get(bucketKey);
  if (!b) return false;
  if (now - b.windowStart > OTP_VERIFY_WINDOW_MS) {
    otpVerifyBuckets.delete(bucketKey);
    return false;
  }
  return b.fails >= OTP_VERIFY_MAX_FAILS;
}

export function recordOtpVerifyFailure(bucketKey: string): void {
  const now = Date.now();
  pruneOtp(now);
  const b = otpVerifyBuckets.get(bucketKey);
  if (!b || now - b.windowStart > OTP_VERIFY_WINDOW_MS) {
    otpVerifyBuckets.set(bucketKey, { fails: 1, windowStart: now });
    return;
  }
  b.fails += 1;
}

export function clearOtpVerifyFailures(bucketKey: string): void {
  otpVerifyBuckets.delete(bucketKey);
}

export function otpVerifyRateLimitMeta(): { window_ms: number; max_fails: number } {
  return { window_ms: OTP_VERIFY_WINDOW_MS, max_fails: OTP_VERIFY_MAX_FAILS };
}

/** Prefer CF / proxy IP headers for rate-limit keys. */
export function clientIpFromRequest(request: Request): string {
  const xff = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (xff) return xff;
  return (
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

// --- Device Registration Rate Limiter (§5.4 IP + Fingerprint Key) ---
// Design Note: In-isolate Map provides cost-raising protection per Worker instance (resets on isolate recycle).
// Multi-region instances multiply rate window slightly, which is acceptable for M1 C-1 sampling.
const DEV_REG_WINDOW_MS = 60 * 1000; // 1 minute window
const DEV_REG_MAX_REQUESTS = 10;     // max 10 requests per minute

interface DevRegBucket {
  count: number;
  windowStart: number;
}

const devRegBuckets = new Map<string, DevRegBucket>();

function pruneDevReg(now: number): void {
  if (devRegBuckets.size < 2000) return;
  for (const [k, b] of devRegBuckets) {
    if (now - b.windowStart > DEV_REG_WINDOW_MS) devRegBuckets.delete(k);
  }
}

function buildDevRegKey(ip: string, uuidHash: string, cpuHash: string, diskHash: string): string {
  const cleanIp = (ip || "unknown").trim();
  const fp = [uuidHash.trim(), cpuHash.trim(), diskHash.trim()].filter(Boolean).join("|") || "anon";
  return `reg:${cleanIp}:${fp}`;
}

export function isDeviceRegisterRateLimited(ip: string, uuidHash: string, cpuHash: string, diskHash: string): boolean {
  const now = Date.now();
  const key = buildDevRegKey(ip, uuidHash, cpuHash, diskHash);
  const b = devRegBuckets.get(key);
  if (!b) return false;
  if (now - b.windowStart > DEV_REG_WINDOW_MS) {
    devRegBuckets.delete(key);
    return false;
  }
  return b.count >= DEV_REG_MAX_REQUESTS;
}

export function recordDeviceRegisterRequest(ip: string, uuidHash: string, cpuHash: string, diskHash: string): void {
  const now = Date.now();
  pruneDevReg(now);
  const key = buildDevRegKey(ip, uuidHash, cpuHash, diskHash);
  const b = devRegBuckets.get(key);
  if (!b || now - b.windowStart > DEV_REG_WINDOW_MS) {
    devRegBuckets.set(key, { count: 1, windowStart: now });
    return;
  }
  b.count += 1;
}

// --- A3: D1-persistent rate limiter for activate/verify (audit licensing-flow-audit.md) ---
// D1 persistence avoids in-isolate Map dilution across multi-region Worker instances.
// Uses read-then-write (race acceptable for soft rate limiting — worst case a few extra
// requests slip through before the count catches up).

export async function ensureRateLimitsTable(env: Env): Promise<void> {
  try {
    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS rate_limits (
        key TEXT PRIMARY KEY,
        count INTEGER NOT NULL DEFAULT 1,
        window_start TEXT NOT NULL
      )
    `).run();
  } catch (err) {
    console.error("Failed to ensure rate_limits table:", err);
  }
}

/**
 * D1-persistent rate limiter. Returns true if the key has exceeded maxAttempts within windowMs.
 * On first call in a window, resets count=1. On subsequent calls, increments count.
 * Old windows are naturally overwritten (no accumulation), so no explicit pruning is needed.
 */
export async function isD1RateLimited(
  env: Env,
  key: string,
  maxAttempts: number,
  windowMs: number
): Promise<boolean> {
  await ensureRateLimitsTable(env);
  const now = Date.now();
  const nowIso = new Date(now).toISOString();

  const row = await env.DB.prepare(
    "SELECT count, window_start FROM rate_limits WHERE key = ?"
  ).bind(key).first<{ count: number; window_start: string }>();

  if (!row || (now - new Date(row.window_start).getTime()) > windowMs) {
    // New window: reset
    await env.DB.prepare(
      "INSERT OR REPLACE INTO rate_limits (key, count, window_start) VALUES (?, 1, ?)"
    ).bind(key, nowIso).run();
    return false;
  }

  if (row.count >= maxAttempts) return true;

  await env.DB.prepare(
    "UPDATE rate_limits SET count = count + 1 WHERE key = ?"
  ).bind(key).run();
  return false;
}

