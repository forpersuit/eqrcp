/**
 * Contract tests for page-visibility, in-flight heartbeat, and superseded socket guard policies.
 * Run: node --experimental-strip-types src/services/visibilityPolicy.test.ts
 */

import {
  isDesktopPeer,
  shouldCloseSocketOnHidden,
  shouldSuspendOnHiddenTimeout,
  shouldReconnectOnVisible,
  shouldDiscardSupersededSocketEvent,
  evaluateHeartbeatTick
} from './visibilityPolicy.ts';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

// 1. Peer-specific visibility hidden tests
assert(isDesktopPeer('desktop') === true, 'desktop peer matches');
assert(isDesktopPeer(' Desktop ') === true, 'desktop peer case-insensitive and trimmed');
assert(isDesktopPeer('mobile') === false, 'mobile peer is not desktop');

// Desktop host never suspends on hidden
assert(shouldCloseSocketOnHidden('desktop', false) === false, 'desktop host must NOT close WS on hidden');
assert(shouldCloseSocketOnHidden('Desktop', false) === false, 'desktop host case-insensitive check');
assert(shouldCloseSocketOnHidden('desktop', true) === false, 'desktop host with file picking keeps open');

// Mobile and web clients: keep open during file picking, suspend on true background
assert(shouldCloseSocketOnHidden('mobile', true) === false, 'mobile client keeps WS connected while picking files');
assert(shouldCloseSocketOnHidden('mobile', false) === true, 'mobile client suspends WS on true background/sleep');
assert(shouldCloseSocketOnHidden('web', true) === false, 'web browser client keeps WS connected while picking files');
assert(shouldCloseSocketOnHidden('web', false) === true, 'web browser client suspends WS on true background');
assert(shouldCloseSocketOnHidden(null, true) === false, 'null peer keeps connected while picking files');
assert(shouldCloseSocketOnHidden(null, false) === true, 'null peer suspends WS on true background');

// Hidden timeout evaluation helper tests
assert(
  shouldSuspendOnHiddenTimeout({ peer: 'mobile', isFilePicking: false, visibilityState: 'hidden' }) === true,
  'mobile timeout while hidden suspends socket'
);
assert(
  shouldSuspendOnHiddenTimeout({ peer: 'mobile', isFilePicking: true, visibilityState: 'hidden' }) === false,
  'mobile timeout while file picking does NOT suspend socket'
);
assert(
  shouldSuspendOnHiddenTimeout({ peer: 'mobile', isFilePicking: false, visibilityState: 'visible' }) === false,
  'mobile timeout when visible does NOT suspend socket'
);
assert(
  shouldSuspendOnHiddenTimeout({ peer: 'desktop', isFilePicking: false, visibilityState: 'hidden' }) === false,
  'desktop timeout never suspends socket'
);

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
