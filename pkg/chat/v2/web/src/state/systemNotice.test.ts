/**
 * First-principle test: explicit method dispatch (isDebug = true/false).
 * No brittle string blacklists or regex guessing.
 * Run: node --experimental-strip-types src/state/systemNotice.test.ts
 */

import { displayFileName, shouldSurfaceNotice } from './systemNotice';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

// --- user notices (isDebug = false) -> always surface regardless of dev mode ---
assert(shouldSurfaceNotice(false, false) === true, 'user notice surfaces when dev off');
assert(shouldSurfaceNotice(false, true) === true, 'user notice surfaces when dev on');

// --- debug notices (isDebug = true) -> surfaces only when dev mode is ON ---
assert(shouldSurfaceNotice(true, false) === false, 'debug notice hidden when dev off');
assert(shouldSurfaceNotice(true, true) === true, 'debug notice surfaces when dev on');

// --- displayFileName helper ---
assert(displayFileName('/home/u/foo/bar.pdf') === 'bar.pdf', 'basename unix');
assert(displayFileName('C:\\\\a\\\\b.txt') === 'b.txt' || displayFileName('C:\\a\\b.txt') === 'b.txt', 'basename win');
assert(displayFileName('plain.png') === 'plain.png', 'basename plain');

console.log('systemNotice.test.ts: all assertions passed');

