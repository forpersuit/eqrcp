/**
 * Single Source of Truth for frontend free tier quota & bandwidth defaults.
 * Keeps limits and speed caps aligned with backend bandwidth.Policy.
 */

export const DEFAULT_FREE_MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024;
export const DEFAULT_FREE_DEGRADED_BYTES_PER_SEC = 100 * 1024;

/** Formats byte size to human-readable MB string (e.g. 10MB). */
export function formatLimitMB(bytes: number = DEFAULT_FREE_MAX_ATTACHMENT_BYTES): string {
  const mb = Math.round(bytes / (1024 * 1024));
  return `${mb}MB`;
}

/** Formats transfer rate to human-readable KB/s string (e.g. 100KB/s). */
export function formatSpeedKB(bytesPerSec: number = DEFAULT_FREE_DEGRADED_BYTES_PER_SEC): string {
  const kb = Math.round(bytesPerSec / 1024);
  return `${kb}KB/s`;
}
