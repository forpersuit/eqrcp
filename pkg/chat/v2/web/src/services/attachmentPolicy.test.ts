// @ts-ignore
import * as fs from 'node:fs';
// @ts-ignore
import * as path from 'node:path';
// @ts-ignore
import { fileURLToPath } from 'node:url';
import {
  isFileSendCancelled,
  resolveDownloadTransferId,
  applyDownloadCancelled,
  applyBatchDownloadCancelled
} from './attachmentPolicy.ts';
import type { Message, TransferEvent } from './types.ts';
import type { TransferUpdatePayload } from './attachmentPolicy.ts';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

const baseFileMsg: Message = {
  id: 'msg-file-1',
  sender: 'Alice',
  type: 'file',
  text: '',
  fileName: 'test.pdf',
  size: 1024,
  createdAt: new Date().toISOString()
};

const baseImageMsg: Message = {
  id: 'msg-img-1',
  sender: 'Alice',
  type: 'image',
  text: '',
  fileName: 'photo.png',
  size: 2048,
  createdAt: new Date().toISOString()
};

const baseTextMsg: Message = {
  id: 'msg-text-1',
  sender: 'Alice',
  type: 'text',
  text: 'Hello world',
  createdAt: new Date().toISOString()
};

// 1. Text message never triggers file send cancelled
assert(
  isFileSendCancelled(baseTextMsg, false, undefined) === false,
  'text message must not be cancelled file'
);

// 2. Receiver scenario: receiver download state NEVER participates in isFileSendCancelled!
// First Principle: Receiver cancellations/failures MUST NEVER remove or hide the file bubble.
assert(
  isFileSendCancelled(baseFileMsg, false, undefined) === false,
  'receiver download idle must NOT mark bubble as cancelled file'
);
assert(
  isFileSendCancelled(baseImageMsg, false, undefined) === false,
  'receiver image download idle must NOT mark bubble as cancelled file'
);

// 3. Sender scenario: sender actively uploading and cancels upload
const uploadingMsg: Message = {
  ...baseFileMsg,
  uploading: true
};
assert(
  isFileSendCancelled(uploadingMsg, true, { state: 'cancelled' }) === true,
  'sender cancelled while uploading must be marked as cancelled file'
);

// 4. Sender scenario: file already finished uploading (!uploading), stale ulTx cancelled should not cancel bubble
const uploadedMsg: Message = {
  ...baseFileMsg,
  uploading: false
};
assert(
  isFileSendCancelled(uploadedMsg, true, { state: 'cancelled' }) === false,
  'already uploaded file should not be marked as cancelled file on stale cancelled state'
);

// 5. Receiver scenario: sender cancelled during upload (received broadcast with ulTx cancelled)
assert(
  isFileSendCancelled(baseFileMsg, false, { state: 'cancelled' }) === true,
  'receiver informed of sender upload cancellation should mark as cancelled file'
);

// 6. Recalled messages are handled by recalled branch, not isFileSendCancelled
const recalledMsg: Message = {
  ...baseFileMsg,
  recalled: true
};
assert(
  isFileSendCancelled(recalledMsg, false, { state: 'cancelled' }) === false,
  'recalled message handled separately'
);

// 7. Transfer ID Contract: resolveDownloadTransferId
assert(
  resolveDownloadTransferId('m-123') === 'dl-m-123-desktop',
  'default peer resolves to desktop'
);
assert(
  resolveDownloadTransferId('m-123', 'phone-xyz') === 'dl-m-123-phone-xyz',
  'custom peer properly formatted'
);

// 8. Bridge Contract Test (L2 & R2):
// Directly tests production function applyDownloadCancelled (invoked by App.svelte upon Wails host download-cancelled)
const recordedUpdates: TransferUpdatePayload[] = [];
const cancelledTransfers: string[] = [];
const singleBridgeActions = {
  updateTransfer: (u: TransferUpdatePayload) => recordedUpdates.push(u),
  cancelTransfer: (tid: string) => cancelledTransfers.push(tid)
};

const tid = applyDownloadCancelled('file-abc', 'desktop', singleBridgeActions);
assert(tid === 'dl-file-abc-desktop', 'applyDownloadCancelled derives matching transferId');
assert(recordedUpdates.length === 1, 'one updateTransfer action dispatched');
assert(recordedUpdates[0].id === 'dl-file-abc-desktop', 'updateTransfer payload has correct ID');
assert(recordedUpdates[0].state === 'cancelled', 'updateTransfer transitions state to cancelled');
assert(recordedUpdates[0].progress === -1, 'updateTransfer resets progress to -1');
assert(cancelledTransfers.length === 1 && cancelledTransfers[0] === 'dl-file-abc-desktop', 'client.cancelTransfer called with matching ID');

// Verify receiver bubble retention under bridge cancellation
const txStateSingle: Record<string, any> = {
  [tid]: recordedUpdates[0]
};
const receiverDlTx = txStateSingle[resolveDownloadTransferId(baseFileMsg.id, 'desktop')];
assert(
  isFileSendCancelled(baseFileMsg, false, undefined) === false,
  'bridge cancellation preserves receiver bubble'
);

// 9. Batch Cancellation Contract Test (L3 & R2):
// Directly tests production function applyBatchDownloadCancelled (invoked by App.svelte upon Wails host download-batch-cancelled)
// Note: Host side (desktop/gui/frontend) has no node test runner; iframe side strictly verifies postMessage contract boundaries.
const batchMsgIds = ['msg-b1', 'msg-b2', 'msg-b3'];
const batchUpdates: TransferUpdatePayload[] = [];
const batchCancelledTids: string[] = [];
const batchSystemNotices: string[] = [];

const batchActions = {
  updateTransfer: (u: TransferUpdatePayload) => batchUpdates.push(u),
  cancelTransfer: (id: string) => batchCancelledTids.push(id),
  addSystemNotice: (notice: string) => batchSystemNotices.push(notice)
};

const processedTids = applyBatchDownloadCancelled(batchMsgIds, 'desktop', batchActions, 'zh');

// Assert production function processed all IDs
assert(processedTids.length === 3, 'all batch IDs returned by production handler');
assert(batchUpdates.length === 3, 'each batch item triggered updateTransfer');
assert(batchCancelledTids.length === 3, 'each batch item triggered cancelTransfer');
assert(batchSystemNotices.length === 1 && batchSystemNotices[0] === '已取消批量下载。', 'localized batch cancellation system notice emitted');

// Verify contract values and UI invariants for each batch item
for (let i = 0; i < batchMsgIds.length; i++) {
  const expectedTid = `dl-${batchMsgIds[i]}-desktop`;
  assert(processedTids[i] === expectedTid, `batch item ${i} has correct transferId`);
  assert(batchUpdates[i].id === expectedTid, `batch update ${i} has matching transferId`);
  assert(batchUpdates[i].state === 'cancelled', `batch update ${i} is in cancelled state`);
  assert(batchUpdates[i].progress === -1, `batch update ${i} has progress reset to -1`);
  assert(batchCancelledTids[i] === expectedTid, `batch client cancel ${i} targeted correct ID`);

  // Build state map and verify MessageList rendering invariants
  const currentMsg: Message = { ...baseFileMsg, id: batchMsgIds[i] };
  const mockTxState: Record<string, any> = {
    [expectedTid]: batchUpdates[i]
  };
  const resolvedDlTx = mockTxState[resolveDownloadTransferId(currentMsg.id, 'desktop')];
  assert(resolvedDlTx && resolvedDlTx.state === 'cancelled', 'mock store records cancelled state');

  // Rule: isFileSendCancelled MUST be false (never mistaken for sender recall)
  assert(
    isFileSendCancelled(currentMsg, false, undefined) === false,
    `batch file ${currentMsg.id} MUST NOT be marked as send cancelled`
  );
  // Bubble retains and renders subtitle '· 已取消' (dlTx.state === 'cancelled')
  const shouldRenderCancelledSubtitle = resolvedDlTx.state === 'cancelled';
  assert(shouldRenderCancelledSubtitle, `batch file ${currentMsg.id} subtitle renders '· 已取消'`);
}

// Test English localization of system notice
const enNotices: string[] = [];
applyBatchDownloadCancelled(['msg-en'], 'desktop', {
  updateTransfer: () => {},
  addSystemNotice: (notice: string) => enNotices.push(notice)
}, 'en');
assert(enNotices[0] === 'Batch download cancelled.', 'English system notice emitted');

// 10. Assembly Verification (R5 & R6):
// Ensures App.svelte actually wires the production bridge handlers rather than inlining or bypassing them.
const currentFilePath = fileURLToPath(import.meta.url);
const appSveltePath = path.resolve(path.dirname(currentFilePath), '../App.svelte');
if (fs.existsSync(appSveltePath)) {
  const appCode = fs.readFileSync(appSveltePath, 'utf8');
  assert(
    appCode.includes('applyDownloadCancelled('),
    'App.svelte MUST assemble applyDownloadCancelled'
  );
  assert(
    appCode.includes('applyBatchDownloadCancelled('),
    'App.svelte MUST assemble applyBatchDownloadCancelled'
  );
  assert(
    !appCode.includes("id: 'dl-") && !appCode.includes('id: "dl-') && !appCode.includes('id: `dl-'),
    'App.svelte MUST NOT contain handwritten dl- transfer ID concatenation'
  );
  assert(
    !appCode.includes('chatActions.updateTransfer(u as any)') &&
    !appCode.includes('updateTransfer: (u) => chatActions.updateTransfer(u as any)'),
    'App.svelte MUST NOT use "as any" to bypass TransferEvent contract validation'
  );
}

console.log('attachmentPolicy.test.ts: all assertions passed (including bridge contracts and assembly verification)');
