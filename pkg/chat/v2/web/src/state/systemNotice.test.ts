/**
 * User-meaning first: chat bubbles must be plain language; engineering terms are debug-only.
 * Run: node --experimental-strip-types src/state/systemNotice.test.ts
 */

import { displayFileName, isDevDebugNotice, shouldSurfaceSystemNotice } from './systemNotice.ts';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

// --- user-facing: always surface when dev off ---
assert(shouldSurfaceSystemNotice('无法分享「a.txt」，请重试。', false) === true, 'share fail user copy surfaces');
assert(shouldSurfaceSystemNotice('Could not send "a.txt". Please try again.', false) === true, 'send fail EN surfaces');
assert(shouldSurfaceSystemNotice('连接已断开，正在重新连接…', false) === true, 'reconnect user copy surfaces');
assert(shouldSurfaceSystemNotice('您已被强制下线，无法继续加入本会话。', false) === true, 'kick surfaces');
assert(shouldSurfaceSystemNotice('文件下载失败，请重试。', false) === true, 'download fail surfaces');

// --- engineering: hidden unless dev ---
assert(isDevDebugNotice('[App] 开始注册附件: /x') === true, '[App] is debug');
assert(isDevDebugNotice('[Debug] IPC msg') === true, '[Debug] is debug');
assert(isDevDebugNotice('[IO] Disk read') === true, '[IO] is debug');
assert(isDevDebugNotice('registerLocalAttachment failed') === true, 'registerLocalAttachment is debug');
assert(isDevDebugNotice('postMessage iframe-log') === true, 'postMessage is debug');
assert(isDevDebugNotice('Attachment registration failed: boom') === true, 'registration jargon is debug');
assert(isDevDebugNotice('附件注册失败: boom') === true, '注册 jargon is debug');
assert(isDevDebugNotice('WebSocket encountered an error.') === true, 'WebSocket jargon is debug');
assert(isDevDebugNotice('Server Error: [x] y') === true, 'Server Error is debug');
assert(isDevDebugNotice('Heartbeat timeout (30s). Re-establishing connection.') === true, 'heartbeat is debug');
assert(isDevDebugNotice('Cannot send command. WebSocket is not open.') === true, 'cannot send command is debug');

assert(shouldSurfaceSystemNotice('[App] 注册成功: a', false) === false, '[App] hidden when dev off');
assert(shouldSurfaceSystemNotice('[Debug] Socket payload', false) === false, '[Debug] hidden when dev off');
assert(shouldSurfaceSystemNotice('WebSocket connection established.', false) === false, 'ws established hidden');
assert(shouldSurfaceSystemNotice('Attachment registration failed: x', false) === false, 'registration fail hidden when not user copy');
assert(shouldSurfaceSystemNotice('[App] 注册成功: a', true) === true, '[App] shown in dev');

assert(displayFileName('/home/u/foo/bar.pdf') === 'bar.pdf', 'basename unix');
assert(displayFileName('C:\\\\a\\\\b.txt') === 'b.txt' || displayFileName('C:\\a\\b.txt') === 'b.txt', 'basename win');
assert(displayFileName('plain.png') === 'plain.png', 'basename plain');

assert(shouldSurfaceSystemNotice('') === false, 'empty ignored');

console.log('systemNotice.test.ts: all assertions passed');
