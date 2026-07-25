/**
 * Contract tests for H1 system notice surfacing + Dev Debug Mode filter.
 * Run: node --experimental-strip-types src/state/systemNotice.test.ts
 */

import { isDevDebugNotice, shouldSurfaceSystemNotice } from './systemNotice.ts';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

// --- baseline (dev off) ---
assert(shouldSurfaceSystemNotice('WebSocket encountered an error.') === true, 'errors must surface');
assert(shouldSurfaceSystemNotice('Cannot send command. WebSocket is not open.') === true, 'send failures must surface');
assert(shouldSurfaceSystemNotice('Reached maximum reconnect attempts. Use Reconnect or refresh the page.') === true, 'exhausted reconnect must surface');
assert(shouldSurfaceSystemNotice('WebSocket connection established.') === false, 'routine connect ack must not spam stream');
assert(shouldSurfaceSystemNotice('WebSocket connection established. Peer: x') === false, 'connect variants stay quiet');
assert(shouldSurfaceSystemNotice('') === false, 'empty notice ignored');
assert(shouldSurfaceSystemNotice('   ') === false, 'whitespace notice ignored');

// --- [App] process logs: hidden by default, shown in dev ---
assert(isDevDebugNotice('[App] 收到 selected-files 文件消息: ["a"]') === true, '[App] is debug notice');
assert(isDevDebugNotice('  [App] 开始注册附件: x') === true, 'trimmed [App] is debug notice');
assert(isDevDebugNotice('下载附件失败: x') === false, 'user errors are not debug notices');

assert(
  shouldSurfaceSystemNotice('[App] 收到 selected-files 文件消息: ["a"]', false) === false,
  '[App] hidden when dev off'
);
assert(
  shouldSurfaceSystemNotice('[App] 开始注册附件: /tmp/x', false) === false,
  'register start hidden when dev off'
);
assert(
  shouldSurfaceSystemNotice('[App] 注册成功: foo.bin', false) === false,
  'register success hidden when dev off'
);
assert(
  shouldSurfaceSystemNotice('[App] Received selected-files message: []', true) === true,
  '[App] shown when dev on'
);
assert(
  shouldSurfaceSystemNotice('您已被强制下线，无法继续加入本会话。', false) === true,
  'kick notice always surfaces'
);
assert(
  shouldSurfaceSystemNotice('file size exceeds 2MB free limit', false) === true,
  'quota errors always surface'
);

console.log('systemNotice.test.ts: all assertions passed');
