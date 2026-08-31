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

console.log('e2eeEnvelope.test.ts: all assertions passed');
