import assert from 'node:assert';
import type { CommandEnvelope, EventEnvelope, E2EEEnvelope } from './types';

console.log('e2eeEnvelope.test.ts: running E2EE type and envelope assertions...');

// 1. CommandEnvelope with E2EE payload
const cmd: CommandEnvelope = {
  type: 'e2ee_envelope',
  version: 1,
  seq: 42,
  timestamp: 1725105600123,
  nonce: '123456789012345678901234',
  ciphertext: 'c2VjcmV0LW1lc3NhZ2U='
};

assert.strictEqual(cmd.type, 'e2ee_envelope');
assert.strictEqual(cmd.seq, 42);
assert.strictEqual(cmd.version, 1);

// 2. EventEnvelope with E2EE payload
const event: EventEnvelope = {
  type: 'e2ee_envelope',
  time: new Date().toISOString(),
  e2ee: {
    type: 'e2ee_envelope',
    version: 1,
    seq: 42,
    timestamp: 1725105600123,
    nonce: '123456789012345678901234',
    ciphertext: 'c2VjcmV0LW1lc3NhZ2U='
  }
};

assert.strictEqual(event.type, 'e2ee_envelope');
assert.strictEqual(event.e2ee?.seq, 42);

// 3. Simulated localStorage sequence persistence (D10 regression check)
const storage: Record<string, string> = {};
const mockLocalStorage = {
  getItem: (k: string) => storage[k] || null,
  setItem: (k: string, v: string) => { storage[k] = v; }
};

const token = 'room-abc';
const peer = 'peer-123';
const seqKey = `eqt_e2ee_seq_${token}_${peer}`;

// Instance 1 sends 10 messages
let outSeq = 1;
for (let i = 0; i < 10; i++) {
  const current = parseInt(mockLocalStorage.getItem(seqKey) || '0', 10);
  const next = Math.max(current + 1, outSeq);
  outSeq = next + 1;
  mockLocalStorage.setItem(seqKey, String(next));
}
assert.strictEqual(mockLocalStorage.getItem(seqKey), '10');

// Instance 2 (after page refresh / recreate) restores and continues from 11
const restoredSeq = parseInt(mockLocalStorage.getItem(seqKey) || '0', 10);
let instance2OutSeq = restoredSeq > 0 ? restoredSeq + 1 : 1;
assert.strictEqual(instance2OutSeq, 11);

// Instance 2 sends 1st message -> seq 11
const current2 = parseInt(mockLocalStorage.getItem(seqKey) || '0', 10);
const next2 = Math.max(current2 + 1, instance2OutSeq);
instance2OutSeq = next2 + 1;
mockLocalStorage.setItem(seqKey, String(next2));
assert.strictEqual(next2, 11);
assert.strictEqual(mockLocalStorage.getItem(seqKey), '11');

console.log('e2eeEnvelope.test.ts: all assertions passed (including D10 seq persistence)');
