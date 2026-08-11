/**
 * Offline tests for trace_id functionality.
 *
 * Tests:
 *   - attachTraceId adds X-Trace-Id header
 *   - attachTraceId preserves existing headers
 *   - attachTraceId returns a new Response (immutable)
 *
 * Build:
 *   npx esbuild src/index.ts --bundle --external:cloudflare:* --outfile=tests/compiled/index.js --platform=node --format=cjs
 * Run:
 *   node tests/trace-id-offline.js
 */
const path = require('path');
const fs = require('fs');

const compiledPath = path.join(__dirname, 'compiled', 'index.js');
if (!fs.existsSync(compiledPath)) {
  console.error("Compiled index not found. Build with esbuild first:");
  console.error("  npx esbuild src/index.ts --bundle --external:cloudflare:* --outfile=tests/compiled/index.js --platform=node --format=cjs");
  process.exit(1);
}

const { attachTraceId } = require(compiledPath);

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) { passed++; console.log(`  ✓ ${msg}`); }
  else { failed++; console.error(`  ✗ ${msg}`); }
}

function assertEqual(actual, expected, msg) {
  if (actual === expected) { passed++; console.log(`  ✓ ${msg}`); }
  else { failed++; console.error(`  ✗ ${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); }
}

// ============================================================
// Test Suite: attachTraceId
// ============================================================
console.log('\n=== attachTraceId ===');

(async () => {

// Test 1: Adds X-Trace-Id header to response
{
  const resp = new Response('ok', { status: 200 });
  const result = attachTraceId(resp, 'test-uuid-1234');
  assertEqual(result.headers.get('X-Trace-Id'), 'test-uuid-1234', 'adds X-Trace-Id header');
  assertEqual(result.status, 200, 'preserves status code');
}

// Test 2: Preserves existing headers
{
  const resp = new Response('{"key":"val"}', {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'X-Custom': 'custom-val' },
  });
  const result = attachTraceId(resp, 'trace-abc');
  assertEqual(result.headers.get('Content-Type'), 'application/json', 'preserves Content-Type');
  assertEqual(result.headers.get('X-Custom'), 'custom-val', 'preserves custom header');
  assertEqual(result.headers.get('X-Trace-Id'), 'trace-abc', 'adds X-Trace-Id');
}

// Test 3: Returns a new Response (immutable — original is not modified)
{
  const resp = new Response('original', { status: 200 });
  const result = attachTraceId(resp, 'new-trace');
  assert(!resp.headers.has('X-Trace-Id'), 'original response is not modified');
  assert(result.headers.has('X-Trace-Id'), 'new response has X-Trace-Id');
}

// Test 4: Preserves response body
{
  const body = JSON.stringify({ hello: 'world' });
  const resp = new Response(body, {
    status: 201,
    headers: { 'Content-Type': 'application/json' },
  });
  const result = attachTraceId(resp, 'trace-body');
  const text = await result.text();
  assertEqual(text, body, 'preserves response body');
  assertEqual(result.status, 201, 'preserves status 201');
}

// Test 5: Handles empty trace_id gracefully
{
  const resp = new Response('ok', { status: 200 });
  const result = attachTraceId(resp, '');
  assertEqual(result.headers.get('X-Trace-Id'), '', 'sets empty trace_id');
}

// Test 6: Handles response with no existing headers
{
  const resp = new Response(null, { status: 204 });
  const result = attachTraceId(resp, 'no-headers-trace');
  assertEqual(result.headers.get('X-Trace-Id'), 'no-headers-trace', 'adds trace_id to headerless response');
  assertEqual(result.status, 204, 'preserves 204 status');
}

// ============================================================
// Summary
// ============================================================
const total = passed + failed;
console.log(`\n=== Results: ${passed}/${total} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
})();
