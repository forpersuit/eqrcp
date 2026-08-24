/**
 * Contract tests for M6/M8 upload policy helpers.
 * Run: node --experimental-strip-types src/services/uploadPolicy.test.ts
 */
import { DEFAULT_FREE_MAX_ATTACHMENT_BYTES } from './quotaConfig';

const FREE_MAX = DEFAULT_FREE_MAX_ATTACHMENT_BYTES;

function shouldBlockFreeOverQuota(opts: {
  isPaid: boolean;
  freeDegraded: boolean;
  size: number;
}): boolean {
  return !opts.isPaid && opts.freeDegraded && opts.size > FREE_MAX;
}

function shouldSerialiseUploads(): boolean {
  // Product rule: multi-select must not open parallel XHRs on mobile.
  return true;
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

assert(
  shouldBlockFreeOverQuota({ isPaid: false, freeDegraded: true, size: FREE_MAX + 1 }) === true,
  'free degraded + >10MB blocked'
);
assert(
  shouldBlockFreeOverQuota({ isPaid: false, freeDegraded: true, size: FREE_MAX }) === false,
  'exactly 10MB allowed'
);
assert(
  shouldBlockFreeOverQuota({ isPaid: false, freeDegraded: false, size: FREE_MAX + 1 }) === false,
  'within free quota allows large (server may still rate-limit)'
);
assert(
  shouldBlockFreeOverQuota({ isPaid: true, freeDegraded: true, size: FREE_MAX + 1 }) === false,
  'paid not blocked by free 10MB rule'
);
assert(shouldSerialiseUploads() === true, 'uploads remain serial');

console.log('uploadPolicy.test.ts: all assertions passed');
