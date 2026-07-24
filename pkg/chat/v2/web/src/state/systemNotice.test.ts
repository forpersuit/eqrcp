/**
 * Contract tests for H1 system notice surfacing.
 * Run: node --experimental-strip-types src/state/systemNotice.test.ts
 */

import { shouldSurfaceSystemNotice } from './systemNotice.ts';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

assert(shouldSurfaceSystemNotice('WebSocket encountered an error.') === true, 'errors must surface');
assert(shouldSurfaceSystemNotice('Cannot send command. WebSocket is not open.') === true, 'send failures must surface');
assert(shouldSurfaceSystemNotice('Reached maximum reconnect attempts. Use Reconnect or refresh the page.') === true, 'exhausted reconnect must surface');
assert(shouldSurfaceSystemNotice('WebSocket connection established.') === false, 'routine connect ack must not spam stream');
assert(shouldSurfaceSystemNotice('WebSocket connection established. Peer: x') === false, 'connect variants stay quiet');
assert(shouldSurfaceSystemNotice('') === false, 'empty notice ignored');
assert(shouldSurfaceSystemNotice('   ') === false, 'whitespace notice ignored');

console.log('systemNotice.test.ts: all assertions passed');
