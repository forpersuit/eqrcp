/**
 * Contract tests for page-visibility, in-flight heartbeat, and superseded socket guard policies.
 * Run: node --experimental-strip-types src/services/visibilityPolicy.test.ts
 */

import {
  isDesktopPeer,
  shouldCloseSocketOnHidden,
  shouldReconnectOnVisible,
  shouldDiscardSupersededSocketEvent,
  evaluateHeartbeatTick
} from './visibilityPolicy.ts';

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
  shouldReconnectOnVisible({ isManualClosed: false, readyState: undefined }) === true,
  'visible + no socket reconnects'
);
assert(
  shouldReconnectOnVisible({ isManualClosed: false, readyState: 3 /* CLOSED */ }) === true,
  'visible + closed socket reconnects'
);
assert(
  shouldReconnectOnVisible({ isManualClosed: false, readyState: 2 /* CLOSING */ }) === true,
  'visible + closing socket reconnects'
);
assert(
  shouldReconnectOnVisible({ isManualClosed: false, readyState: 1 /* OPEN */ }) === false,
  'visible + live socket no-op'
);
assert(
  shouldReconnectOnVisible({ isManualClosed: false, readyState: 0 /* CONNECTING */ }) === false,
  'visible + connecting socket waits for handshake without interrupting'
);
assert(
  shouldReconnectOnVisible({ isManualClosed: true, readyState: 3 /* CLOSED */ }) === false,
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
