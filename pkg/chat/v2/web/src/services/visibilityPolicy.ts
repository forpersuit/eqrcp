/**
 * Pure policy helpers for WebSocket page-visibility, in-flight heartbeat, and superseded socket guards.
 */

/** Check if client peer identifier matches desktop host (case-insensitive & trimmed, consistent with server). */
export function isDesktopPeer(peer?: string | null): boolean {
  return (peer || '').trim().toLowerCase() === 'desktop';
}

/** When page becomes hidden: all clients (desktop, mobile, web) remain connected without actively closing WebSocket,
 * preventing accidental disconnects during file selection, photo album pickers, notification shade pull-downs, or brief app switching.
 */
export function shouldCloseSocketOnHidden(_peer?: string | null): boolean {
  return false;
}

/** When page becomes visible again, determine whether to trigger automatic reconnect.
 * Reconnects if socket is missing/undefined, CLOSING (2), or CLOSED (3).
 * Waits without interruption if socket is CONNECTING (0) or OPEN (1).
 */
export function shouldReconnectOnVisible(opts: {
  isManualClosed: boolean;
  readyState?: number;
}): boolean {
  if (opts.isManualClosed) return false;
  // 0: CONNECTING, 1: OPEN
  if (opts.readyState === 0 || opts.readyState === 1) {
    return false;
  }
  // undefined (no socket), 2 (CLOSING), 3 (CLOSED)
  return true;
}

/** Guard against events arriving from superseded/discarded WebSocket instances. */
export function shouldDiscardSupersededSocketEvent(currentWs: any, eventWs: any): boolean {
  return currentWs !== eventWs;
}

/** In-flight heartbeat state machine decision. */
export function evaluateHeartbeatTick(
  now: number,
  pendingHeartbeatSince: number,
  timeoutMs = 15000
): {
  action: 'send_heartbeat' | 'wait_in_flight' | 'trigger_timeout_reconnect';
} {
  if (pendingHeartbeatSince > 0) {
    if (now - pendingHeartbeatSince >= timeoutMs) {
      return { action: 'trigger_timeout_reconnect' };
    }
    return { action: 'wait_in_flight' };
  }
  return { action: 'send_heartbeat' };
}
