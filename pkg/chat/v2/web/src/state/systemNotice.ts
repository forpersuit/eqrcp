/**
 * Chat system notices — first principle:
 * What appears in the message stream must be meaningful to a normal user
 * (what happened + optional next step). Implementation jargon is debug-only.
 */

/** Explicit process / engineering logs (legacy [App] prefix or known technical shapes). */
export function isDevDebugNotice(msg: string): boolean {
  if (!msg) return false;
  const t = msg.trimStart();
  if (t.startsWith('[App]')) return true;
  // Protocol / transport engineering strings (never user vocabulary)
  if (t.startsWith('WebSocket ')) return true;
  if (t.startsWith('Heartbeat timeout')) return true;
  if (t.startsWith('Failed to parse server event')) return true;
  if (t.startsWith('Server Error:')) return true;
  if (t.startsWith('Connection setup failed')) return true;
  if (t.startsWith('Cannot send command')) return true;
  // Internal product terms that mean nothing to end users
  if (/附件注册|Attachment registration|register(ing|ed)? attachment|selected-files/i.test(t)) {
    return true;
  }
  return false;
}

/**
 * Whether a notice may appear as a chat bubble.
 * - User notices: always (non-empty).
 * - Debug notices: only when Dev Debug Mode is on.
 */
export function shouldSurfaceSystemNotice(msg: string, isDevDebug = false): boolean {
  if (!msg || !msg.trim()) return false;
  if (isDevDebugNotice(msg)) return isDevDebug;
  return true;
}

/** Basename for user-facing file copy (path or name). */
export function displayFileName(pathOrName: string): string {
  if (!pathOrName) return '';
  const s = pathOrName.replace(/\\/g, '/');
  const i = s.lastIndexOf('/');
  return i >= 0 ? s.slice(i + 1) : s;
}
