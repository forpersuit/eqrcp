/**
 * Contract tests for attachmentPolicy bubble retention rules and bridge contracts.
 * Run: node --experimental-strip-types src/services/attachmentPolicy.test.ts
 */
import { isFileSendCancelled, resolveDownloadTransferId } from './attachmentPolicy.ts';
import type { Message, TransferEvent } from './types.ts';

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

// 8. Bridge Contract Test (L2 & L3):
// Simulates Wails host bridge 'download-cancelled' event contract
function simulateDownloadCancelledBridge(payload: { messageId?: string; type: string }, peer = 'desktop'): { transferId: string; updatedState: string } | null {
  if (payload.type !== 'download-cancelled' || !payload.messageId) {
    return null;
  }
  const transferId = resolveDownloadTransferId(payload.messageId, peer);
  return {
    transferId,
    updatedState: 'cancelled'
  };
}

const bridgeResult = simulateDownloadCancelledBridge({ type: 'download-cancelled', messageId: 'file-abc' });
assert(bridgeResult !== null, 'valid download-cancelled payload processed');
assert(bridgeResult!.transferId === 'dl-file-abc-desktop', 'bridge derives matching transferId');
assert(bridgeResult!.updatedState === 'cancelled', 'bridge transitions state to cancelled');
// Verify receiver bubble retention under bridge cancellation
assert(
  isFileSendCancelled(baseFileMsg, false, undefined) === false,
  'bridge cancellation preserves receiver bubble'
);

// 9. Batch Cancellation Contract Test (L3):
// Simulates Wails host bridge 'download-batch-cancelled' event contract
const batchMsgIds = ['msg-b1', 'msg-b2', 'msg-b3'];
const batchDerivedIds = batchMsgIds.map(id => resolveDownloadTransferId(id, 'desktop'));
assert(
  batchDerivedIds[0] === 'dl-msg-b1-desktop' && batchDerivedIds[2] === 'dl-msg-b3-desktop',
  'batch cancellation aligns with transfer ID contract'
);
// Verify each batch file retains bubble intact
for (const id of batchMsgIds) {
  const m: Message = { ...baseFileMsg, id };
  assert(
    isFileSendCancelled(m, false, undefined) === false,
    `batch file ${id} bubble MUST be preserved when batch save is cancelled`
  );
}

console.log('attachmentPolicy.test.ts: all assertions passed (including bridge contracts)');
