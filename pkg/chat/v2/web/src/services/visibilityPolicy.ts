/**
 * Pure policy helpers for WebSocket page-visibility, in-flight heartbeat, and superseded socket guards.
 */

/** Check if client peer identifier matches desktop host (case-insensitive & trimmed, consistent with server). */
export function isDesktopPeer(peer?: string | null): boolean {
  return (peer || '').trim().toLowerCase() === 'desktop';
}

/** When page becomes hidden: Desktop GUI stays connected continuously; Mobile/web actively suspends socket. */
export function shouldCloseSocketOnHidden(peer?: string | null): boolean {
  return !isDesktopPeer(peer);
}

/** When page becomes visible again, determine whether to trigger automatic reconnect. */
export function shouldReconnectOnVisible(opts: {
  isManualClosed: boolean;
  isSocketOpen: boolean;
}): boolean {
  if (opts.isManualClosed) return false;
  if (opts.isSocketOpen) return false;
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
