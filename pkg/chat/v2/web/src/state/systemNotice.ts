/** Pure helpers: which addSystemMessage texts should appear as chat stream bubbles. */

/** Internal frontend process logs (drag/register pipeline). Always go to logToGui; UI only in dev debug. */
export function isDevDebugNotice(msg: string): boolean {
  if (!msg) return false;
  return msg.trimStart().startsWith('[App]');
}

/**
 * @param isDevDebug when true, surface [App] debug process lines in the chat stream.
 * Default false: hide [App] noise; still show user-facing errors/notices.
 * Routine connect acks never spam the stream (dev or not).
 */
export function shouldSurfaceSystemNotice(msg: string, isDevDebug = false): boolean {
  if (!msg || !msg.trim()) return false;
  // Routine connect acks — keep in TransferStatus store only, not the chat stream.
  if (msg === 'WebSocket connection established.') return false;
  if (msg.startsWith('WebSocket connection established')) return false;
  // Dev process logs: UI only when Dev Debug Mode is on (still always logged via logToGui / systemMessages store).
  if (isDevDebugNotice(msg) && !isDevDebug) return false;
  return true;
}
