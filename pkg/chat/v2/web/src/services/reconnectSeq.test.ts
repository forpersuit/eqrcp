import { resolveConnectAfterSeq } from './reconnectSeq.ts';

function assertEqual(actual: number, expected: number, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}

// Cold start: empty local list + known join boundary → rehydrate from joinSeq.
assertEqual(resolveConnectAfterSeq(0, 5, 42), 5, 'cold start uses joinSeq');

// Warm reconnect: local messages still present → keep high watermark.
assertEqual(resolveConnectAfterSeq(3, 5, 42), 42, 'warm reconnect keeps afterSeq');

// Brand-new device: no join boundary yet.
assertEqual(resolveConnectAfterSeq(0, 0, 0), 0, 'brand new both zero');
assertEqual(resolveConnectAfterSeq(0, 0, 9), 9, 'brand new with stored afterSeq only');

// Empty list but joinSeq only (afterSeq never advanced past hello).
assertEqual(resolveConnectAfterSeq(0, 7, 0), 7, 'cold with afterSeq zero uses joinSeq');

console.log('reconnectSeq.test.ts: all assertions passed');
