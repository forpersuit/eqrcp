/**
 * Chat system notices — first principle:
 * Explicit method dispatch defines notice category (isDebug = true/false).
 * No brittle string blacklists or regex guessing.
 */

/**
 * Whether a notice should surface in the chat message stream.
 * - Regular user notice (isDebug = false): always surfaces.
 * - Debug notice (isDebug = true): surfaces only when devDebugMode is ON.
 */
export function shouldSurfaceNotice(isDebug: boolean, isDevDebug: boolean): boolean {
  return !isDebug || isDevDebug;
}

/** Basename for user-facing file copy (path or name). */
export function displayFileName(pathOrName: string): string {
  if (!pathOrName) return '';
  const s = pathOrName.replace(/\\/g, '/');
  const i = s.lastIndexOf('/');
  return i >= 0 ? s.slice(i + 1) : s;
}

