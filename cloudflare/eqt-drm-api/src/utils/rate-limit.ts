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
