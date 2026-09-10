/**
 * Contract tests for attachmentPolicy bubble retention rules.
 * Run: node --experimental-strip-types src/services/attachmentPolicy.test.ts
 */
import { isFileSendCancelled } from './attachmentPolicy.ts';
import type { Message } from './types.ts';

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
  isFileSendCancelled(baseTextMsg, false, undefined, undefined) === false,
  'text message must not be cancelled file'
);

// 2. Receiver scenario: dlTx is cancelled (user closed save dialog, cancelled download, etc.)
// First Principle: Download cancellation MUST NEVER remove or cancel the file bubble!
assert(
  isFileSendCancelled(baseFileMsg, false, undefined, { state: 'cancelled' }) === false,
  'receiver download cancelled must NOT mark bubble as cancelled file'
);
assert(
  isFileSendCancelled(baseImageMsg, false, undefined, { state: 'cancelled' }) === false,
  'receiver image download cancelled must NOT mark bubble as cancelled file'
);

// 3. Receiver scenario: dlTx is running or failed
assert(
  isFileSendCancelled(baseFileMsg, false, undefined, { state: 'running' }) === false,
  'receiver download running is not cancelled file'
);
assert(
  isFileSendCancelled(baseFileMsg, false, undefined, { state: 'failed' }) === false,
  'receiver download failed is not cancelled file'
);

// 4. Sender scenario: sender actively uploading and cancels upload
const uploadingMsg: Message = {
  ...baseFileMsg,
  uploading: true
};
assert(
  isFileSendCancelled(uploadingMsg, true, { state: 'cancelled' }, undefined) === true,
  'sender cancelled while uploading must be marked as cancelled file'
);

// 5. Sender scenario: file already finished uploading (!uploading), old ulTx cancelled should not cancel bubble
const uploadedMsg: Message = {
  ...baseFileMsg,
  uploading: false
};
assert(
  isFileSendCancelled(uploadedMsg, true, { state: 'cancelled' }, undefined) === false,
  'already uploaded file should not be marked as cancelled file on stale cancelled state'
);

// 6. Receiver scenario: sender cancelled during upload (received broadcast with ulTx cancelled)
assert(
  isFileSendCancelled(baseFileMsg, false, { state: 'cancelled' }, undefined) === true,
  'receiver informed of sender upload cancellation should mark as cancelled file'
);

// 7. Recalled messages are handled by recalled branch, not isFileSendCancelled
const recalledMsg: Message = {
  ...baseFileMsg,
  recalled: true
};
assert(
  isFileSendCancelled(recalledMsg, false, { state: 'cancelled' }, { state: 'cancelled' }) === false,
  'recalled message handled separately'
);

console.log('attachmentPolicy.test.ts: all assertions passed');
