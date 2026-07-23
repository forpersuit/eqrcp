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
