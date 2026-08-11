/**
 * Contract tests for H4 Enter-to-send policy.
 * Run: node --experimental-strip-types src/services/composerKey.test.ts
 */

function shouldSendOnEnter(opts: {
  key: string;
  shiftKey: boolean;
  isComposing: boolean;
  mobileLayout: boolean;
}): boolean {
  if (opts.key !== 'Enter' || opts.shiftKey || opts.isComposing) return false;
  if (opts.mobileLayout) return false;
  return true;
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

assert(
  shouldSendOnEnter({ key: 'Enter', shiftKey: false, isComposing: false, mobileLayout: false }) === true,
  'desktop Enter sends'
);
assert(
  shouldSendOnEnter({ key: 'Enter', shiftKey: true, isComposing: false, mobileLayout: false }) === false,
  'desktop Shift+Enter keeps newline'
);
assert(
  shouldSendOnEnter({ key: 'Enter', shiftKey: false, isComposing: false, mobileLayout: true }) === false,
  'mobile Enter keeps newline'
);
assert(
  shouldSendOnEnter({ key: 'Enter', shiftKey: false, isComposing: true, mobileLayout: false }) === false,
  'IME composing must not send'
);
assert(
  shouldSendOnEnter({ key: 'a', shiftKey: false, isComposing: false, mobileLayout: false }) === false,
  'non-Enter ignored'
);

console.log('composerKey.test.ts: all assertions passed');
