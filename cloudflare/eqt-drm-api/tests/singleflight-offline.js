/**
 * Offline unit tests for SingleFlight request coalescing
 */

const path = require('path');
const fs = require('fs');

const compiledPath = path.join(__dirname, 'compiled', 'singleflight.js');

if (!fs.existsSync(compiledPath)) {
  console.error("Compiled singleflight module not found. Run esbuild first.");
  process.exit(1);
}

const { SingleFlightGroup } = require(compiledPath);

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${label}`);
  }
}

async function runTests() {
  console.log('Running SingleFlight unit tests...\n');

  const g = new SingleFlightGroup();

  // Test 1: Single execution returns shared=false
  {
    let callCount = 0;
    const res = await g.do('key1', async () => {
      callCount++;
      return 'val1';
    });
    assert(res.result === 'val1', 'T1: Correct result returned');
    assert(res.shared === false, 'T1: First call is not shared');
    assert(callCount === 1, 'T1: Underlying function called once');
    assert(g.activeCount() === 0, 'T1: Active count cleaned up');
  }

  // Test 2: Concurrent requests are coalesced
  {
    let callCount = 0;
    let finishExecution;
    const holdPromise = new Promise(resolve => { finishExecution = resolve; });

    const runFlight = (id) => g.do('key-concurrent', async () => {
      callCount++;
      await holdPromise;
      return { msg: 'success', timestamp: 12345 };
    });

    // Launch 5 concurrent calls
    const p1 = runFlight(1);
    const p2 = runFlight(2);
    const p3 = runFlight(3);
    const p4 = runFlight(4);
    const p5 = runFlight(5);

    assert(g.activeCount() === 1, 'T2: Only 1 in-flight task active');
    assert(g.has('key-concurrent'), 'T2: has() returns true while in-flight');

    // Release underlying task
    finishExecution();

    const [r1, r2, r3, r4, r5] = await Promise.all([p1, p2, p3, p4, p5]);

    assert(callCount === 1, 'T2: Underlying function strictly called only once for 5 concurrent callers');
    assert(r1.result.msg === 'success', 'T2: r1 got correct result');
    assert(r1.shared === false, 'T2: r1 is the leader (shared=false)');
    assert(r2.result.msg === 'success' && r2.shared === true, 'T2: r2 got shared result');
    assert(r3.result.msg === 'success' && r3.shared === true, 'T2: r3 got shared result');
    assert(r4.result.msg === 'success' && r4.shared === true, 'T2: r4 got shared result');
    assert(r5.result.msg === 'success' && r5.shared === true, 'T2: r5 got shared result');
    assert(g.activeCount() === 0, 'T2: Flight cleaned up after all complete');
  }

  // Test 3: Conflict detection via onConflict
  {
    let finishExecution;
    const holdPromise = new Promise(resolve => { finishExecution = resolve; });

    const p1 = g.do(
      'key-conflict',
      async () => {
        await holdPromise;
        return 'resA';
      },
      { csrHash: 'hashAAA' }
    );

    let conflictErrorCaught = false;
    try {
      await g.do(
        'key-conflict',
        async () => 'resB',
        { csrHash: 'hashBBB' },
        (existing, incoming) => {
          if (existing?.csrHash !== incoming?.csrHash) {
            const err = new Error('CSR conflict');
            err.code = 409;
            return err;
          }
        }
      );
    } catch (err) {
      if (err.message === 'CSR conflict' && err.code === 409) {
        conflictErrorCaught = true;
      }
    }

    assert(conflictErrorCaught, 'T3: Conflicting caller rejected immediately with 409');

    // Complete original
    finishExecution();
    const r1 = await p1;
    assert(r1.result === 'resA' && r1.shared === false, 'T3: Original caller completes successfully unaffected');
  }

  // Test 4: Error propagation and flight cleanup
  {
    let callCount = 0;
    let finishExecution;
    const holdPromise = new Promise((_, reject) => { finishExecution = reject; });

    const runFailingFlight = () => g.do('key-fail', async () => {
      callCount++;
      await holdPromise;
      return 'never';
    });

    const p1 = runFailingFlight();
    const p2 = runFailingFlight();

    finishExecution(new Error('Network boom'));

    let p1Err = null;
    let p2Err = null;
    try { await p1; } catch (e) { p1Err = e; }
    try { await p2; } catch (e) { p2Err = e; }

    assert(p1Err && p1Err.message === 'Network boom', 'T4: p1 received failure');
    assert(p2Err && p2Err.message === 'Network boom', 'T4: p2 received failure');
    assert(callCount === 1, 'T4: Failed task called exactly once');
    assert(g.activeCount() === 0, 'T4: Flight removed from map after failure');

    // Subsequent call after failure should execute anew
    const p3 = await g.do('key-fail', async () => 'recovered');
    assert(p3.result === 'recovered' && p3.shared === false, 'T4: Subsequent call runs anew after failure');
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error("Test execution error:", err);
  process.exit(1);
});
