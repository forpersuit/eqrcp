/**
 * Contract tests for page-visibility, in-flight heartbeat, and superseded socket guard policies.
 * Run: node --experimental-strip-types src/services/visibilityPolicy.test.ts
 */

/** When page becomes hidden: Desktop GUI stays connected; Mobile/web actively suspends socket. */
function shouldCloseSocketOnHidden(peer: string): boolean {
  if (peer.trim().toLowerCase() === 'desktop') {
    return false;
  }
  return true;
}

/** When page becomes visible again, reconnect if socket is dead/closing and not manual-closed. */
function shouldReconnectOnVisible(opts: {
  isManualClosed: boolean;
  wsOpen: boolean;
}): boolean {
  if (opts.isManualClosed) return false;
  if (opts.wsOpen) return false;
  return true;
}

/** Guard against events from superseded/discarded WebSocket instances. */
function shouldDiscardSupersededSocketEvent(currentWs: any, eventWs: any): boolean {
  return currentWs !== eventWs;
}

/** In-flight heartbeat state machine decision. */
function evaluateHeartbeatTick(now: number, pendingHeartbeatSince: number, timeoutMs = 15000): {
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

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

// 1. Peer-specific visibility hidden tests
assert(shouldCloseSocketOnHidden('desktop') === false, 'desktop host must NOT actively close WS on hidden');
assert(shouldCloseSocketOnHidden('Desktop') === false, 'desktop host case-insensitive check');
assert(shouldCloseSocketOnHidden('mobile') === true, 'mobile client must actively suspend WS on hidden');
assert(shouldCloseSocketOnHidden('web') === true, 'web browser client must actively suspend WS on hidden');

// 2. Visible foreground reconnect tests
assert(
  shouldReconnectOnVisible({ isManualClosed: false, wsOpen: false }) === true,
  'visible + dead socket reconnects'
);
assert(
  shouldReconnectOnVisible({ isManualClosed: false, wsOpen: true }) === false,
  'visible + live socket no-op'
);
assert(
  shouldReconnectOnVisible({ isManualClosed: true, wsOpen: false }) === false,
  'manual leave/kick must not auto-reconnect on visible'
);

// 3. Superseded socket instance guard tests
const socketA = { id: 'sock-A' };
const socketB = { id: 'sock-B' };
assert(
  shouldDiscardSupersededSocketEvent(socketB, socketA) === true,
  'delayed event from old socket A must be discarded when current is socket B'
);
assert(
  shouldDiscardSupersededSocketEvent(socketB, socketB) === false,
  'event from active socket B must be processed'
);

// 4. In-flight heartbeat policy tests
assert(
  evaluateHeartbeatTick(1000, 0).action === 'send_heartbeat',
  'no in-flight heartbeat -> send new heartbeat'
);
assert(
  evaluateHeartbeatTick(10000, 1000).action === 'wait_in_flight',
  'in-flight heartbeat within 15s -> wait without resending'
);
assert(
  evaluateHeartbeatTick(16000, 1000).action === 'trigger_timeout_reconnect',
  'in-flight heartbeat after 15s -> trigger timeout reconnect'
);

console.log('visibilityPolicy.test.ts: all assertions passed');
