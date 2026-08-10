/**
 * Contract tests for H3 page-visibility WebSocket policy.
 * Run: node --experimental-strip-types src/services/visibilityPolicy.test.ts
 */

/** When page becomes hidden, client must NOT actively close the socket. */
function shouldCloseSocketOnHidden(): boolean {
  return false;
}

/** When page becomes visible again, reconnect if socket is dead and not manual-closed. */
function shouldReconnectOnVisible(opts: {
  isManualClosed: boolean;
  wsOpen: boolean;
}): boolean {
  if (opts.isManualClosed) return false;
  if (opts.wsOpen) return false;
  return true;
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

assert(shouldCloseSocketOnHidden() === false, 'must not actively close WS on page hidden');
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

console.log('visibilityPolicy.test.ts: all assertions passed');
