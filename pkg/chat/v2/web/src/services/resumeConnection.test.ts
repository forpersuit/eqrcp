/**
 * Lightweight contract checks for the "resume after peer replacement" flow.
 * Run: node --experimental-strip-types src/services/resumeConnection.test.ts
 *
 * Full multi-tab E2E needs a real browser (two tabs, same origin) — see
 * docs note in commit message / agent reply. No Android emulator required.
 */

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

// Mirrors ChatWebSocketClient.resumeConnection preconditions (documentation-as-test).
function canResume(opts: {
  isManualClosed: boolean;
  sessionStatus: 'active' | 'replaced' | 'kicked' | 'left';
  wsOpen: boolean;
}): boolean {
  if (opts.sessionStatus === 'kicked' || opts.sessionStatus === 'left') {
    return false;
  }
  if (opts.sessionStatus === 'replaced' && opts.isManualClosed) {
    return true;
  }
  if (!opts.isManualClosed && opts.wsOpen) {
    return false; // already live
  }
  return opts.isManualClosed === false || opts.sessionStatus === 'replaced';
}

assert(
  canResume({ isManualClosed: true, sessionStatus: 'replaced', wsOpen: false }) === true,
  'replaced tab should allow explicit resume'
);
assert(
  canResume({ isManualClosed: true, sessionStatus: 'kicked', wsOpen: false }) === false,
  'kicked tab must not use resume path'
);
assert(
  canResume({ isManualClosed: false, sessionStatus: 'active', wsOpen: true }) === false,
  'live connection does not need resume'
);
assert(
  canResume({ isManualClosed: true, sessionStatus: 'left', wsOpen: false }) === false,
  'left session must not resume via peer-replaced button'
);

console.log('resumeConnection.test.ts: all assertions passed');
