import { Env } from '../types';
import { addManualBlacklist } from './blacklist';
import { logSystemError } from './error-logger';

// ── Thresholds ──────────────────────────────────────────────

/** R1: Max activations per license as multiple of max_devices */
const LICENSE_ACTIVATION_MULTIPLIER = 3;
// Minimum floor: even a 1-device license needs at least this many activations to trigger.
// 6 means a default 2-device license triggers at 6 activations (3× normal capacity).
const LICENSE_ACTIVATION_MIN = 6;

/** R2: Max distinct licenses a single device fingerprint can appear on */
const MAX_LICENSES_PER_FINGERPRINT = 5;

/** R3: Max distinct licenses activated from same IP per hour */
const MAX_LICENSES_PER_IP_PER_HOUR = 3;
const IP_WINDOW_MS = 60 * 60 * 1000;

// ── Check Functions ─────────────────────────────────────────

interface AbuseCheckResult {
  triggered: boolean;
  reason: string;
  details: Record<string, unknown>;
  /** Whether to auto-blacklist the device fingerprint */
  autoBlacklist: boolean;
}

/**
 * R1: Check if a single license has been activated on too many devices.
 * Threshold: max_devices × 3 (minimum 6).
 *
 * Alert only — the license may be shared legitimately (e.g. org-wide).
 * Admin investigates and decides whether to revoke.
 *
 * @visibleForTesting — exported for unit tests; not part of public API.
 */
export async function checkLicenseActivationCount(
  env: Env,
  licenseCode: string,
  maxDevices: number
): Promise<AbuseCheckResult> {
  const threshold = Math.max(LICENSE_ACTIVATION_MIN, maxDevices * LICENSE_ACTIVATION_MULTIPLIER);

  const result = await env.DB.prepare(
    "SELECT COUNT(*) as count FROM activations WHERE license_code = ?"
  ).bind(licenseCode).first<{ count: number }>();

  const count = result?.count || 0;
  if (count >= threshold) {
    return {
      triggered: true,
      autoBlacklist: false,
      reason: `License ${licenseCode} activated on ${count} devices (threshold: ${threshold}, max_devices: ${maxDevices})`,
      details: { license_code: licenseCode, activation_count: count, threshold, max_devices: maxDevices }
    };
  }
  return { triggered: false, reason: '', details: {}, autoBlacklist: false };
}

/**
 * R2: Check if the same device fingerprint appears on too many different licenses.
 * Uses SQL OR on individual hashes — if any single hash appears across 5+ licenses,
 * it's strong evidence of device sharing or VM farming.
 *
 * Auto-blacklists the device to block further activations.
 *
 * @visibleForTesting — exported for unit tests; not part of public API.
 */
export async function checkDeviceFingerprintReuse(
  env: Env,
  uuidHash: string,
  cpuHash: string,
  diskHash: string
): Promise<AbuseCheckResult> {
  const clauses: string[] = [];
  const binds: string[] = [];

  if (uuidHash) { clauses.push("uuid_hash = ?"); binds.push(uuidHash); }
  if (cpuHash) { clauses.push("cpu_hash = ?"); binds.push(cpuHash); }
  if (diskHash) { clauses.push("disk_hash = ?"); binds.push(diskHash); }

  if (clauses.length === 0) {
    return { triggered: false, reason: '', details: {}, autoBlacklist: false };
  }

  const sql = `SELECT COUNT(DISTINCT license_code) as count FROM activations WHERE ${clauses.join(" OR ")}`;
  const result = await env.DB.prepare(sql).bind(...binds).first<{ count: number }>();
  const count = result?.count || 0;

  if (count >= MAX_LICENSES_PER_FINGERPRINT) {
    return {
      triggered: true,
      autoBlacklist: true,
      reason: `Device fingerprint activated on ${count} different licenses (threshold: ${MAX_LICENSES_PER_FINGERPRINT})`,
      details: {
        uuid_hash: uuidHash ? uuidHash.slice(0, 8) : null,
        cpu_hash: cpuHash ? cpuHash.slice(0, 8) : null,
        disk_hash: diskHash ? diskHash.slice(0, 8) : null,
        license_count: count,
        threshold: MAX_LICENSES_PER_FINGERPRINT
      }
    };
  }
  return { triggered: false, reason: '', details: {}, autoBlacklist: false };
}

/**
 * R3: Check if the same IP has activated too many different licenses in the last hour.
 * Alert only — NAT/CGNAT can cause false positives.
 *
 * @visibleForTesting — exported for unit tests; not part of public API.
 */
export async function checkIpActivationRate(
  env: Env,
  clientIp: string | null
): Promise<AbuseCheckResult> {
  if (!clientIp || clientIp === 'unknown' || clientIp === '127.0.0.1') {
    return { triggered: false, reason: '', details: {}, autoBlacklist: false };
  }

  const cutoff = new Date(Date.now() - IP_WINDOW_MS).toISOString();
  const result = await env.DB.prepare(
    "SELECT COUNT(DISTINCT license_code) as count FROM activations WHERE client_ip = ? AND activated_at >= ?"
  ).bind(clientIp, cutoff).first<{ count: number }>();

  const count = result?.count || 0;
  if (count >= MAX_LICENSES_PER_IP_PER_HOUR) {
    return {
      triggered: true,
      autoBlacklist: false,
      reason: `IP ${clientIp} activated ${count} different licenses in the last hour (threshold: ${MAX_LICENSES_PER_IP_PER_HOUR})`,
      details: { client_ip: clientIp, license_count: count, threshold: MAX_LICENSES_PER_IP_PER_HOUR, window_ms: IP_WINDOW_MS }
    };
  }
  return { triggered: false, reason: '', details: {}, autoBlacklist: false };
}

// ── Main Entry Point ───────────────────────────────────────

/**
 * Run abuse detection checks after a successful activation.
 * Designed to be called via ctx.waitUntil() — runs asynchronously after the response.
 *
 * Detection rules:
 *   R1 — License activated on too many devices (alert only)
 *   R2 — Same device fingerprint on too many different licenses (auto-blacklist + alert)
 *   R3 — Same IP activating too many different licenses (alert only)
 *
 * @param env        - Worker environment bindings
 * @param licenseCode - The license code that was just activated
 * @param maxDevices  - The license's max_devices setting
 * @param uuidHash    - Device UUID hash from the activation
 * @param cpuHash     - Device CPU hash from the activation
 * @param diskHash    - Device disk hash from the activation
 * @param clientIp    - Client IP from the activation request
 */
export async function checkAbuseAfterActivation(
  env: Env,
  licenseCode: string,
  maxDevices: number,
  uuidHash: string,
  cpuHash: string,
  diskHash: string,
  clientIp: string | null
): Promise<void> {
  try {
    const results = await Promise.all([
      checkLicenseActivationCount(env, licenseCode, maxDevices),
      checkDeviceFingerprintReuse(env, uuidHash, cpuHash, diskHash),
      checkIpActivationRate(env, clientIp),
    ]);

    for (const check of results) {
      if (!check.triggered) continue;

      // Auto-blacklist device for R2 (fingerprint reuse across licenses)
      //
      // NOTE: This runs via ctx.waitUntil() — the current activation has already
      // returned 200 to the client. The blacklist takes effect on the NEXT
      // request from this device (activate/verify/register). There is a brief
      // window between response and blacklist persistence where the device could
      // make another request. This is acceptable: the window is sub-second, and
      // the D1-persistent rate limiter (3/min per license) bounds burst volume.
      if (check.autoBlacklist) {
        const blacklistResult = await addManualBlacklist(env, {
          kind: 'device',
          uuid_hash: uuidHash || undefined,
          cpu_hash: cpuHash || undefined,
          disk_hash: diskHash || undefined,
          reason: check.reason,
          created_by: 'auto-abuse-detection'
        });

        if (!blacklistResult.ok) {
          console.warn(`Abuse detection: auto-blacklist skipped (${blacklistResult.error})`);
        }
      }

      // Log CRITICAL — triggers Telegram alert via logSystemError
      await logSystemError(env, 'ABUSE_DETECTION', 'CRITICAL', check.reason, check.details);
    }
  } catch (err) {
    // Never let abuse detection crash the activation flow
    console.error('Abuse detection error:', err);
  }
}
