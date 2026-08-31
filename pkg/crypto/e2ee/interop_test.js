/**
 * E2EE Interoperability & Security Test Suite
 * Validates libsodium WASM engine, constant-time AEAD, HKDF derivation, and tamper resistance.
 * Validates structured CryptoError and machine-readable error codes.
 * Includes Non-Secure Context (HTTP LAN) simulation (crypto.subtle = undefined).
 */
const path = require('path');
const assert = require('assert');

// Load bundled libsodium and EQTCryptoEngine
require('../../pages/assets/libsodium.js');
const { EQTCryptoEngine, CryptoError, CryptoErrorCode } = require('../../pages/assets/crypto-engine.js');

async function runTests() {
  console.log("=== EQT E2EE Security & Interop Test Suite ===");

  const engine = new EQTCryptoEngine();
  const masterKeyHex = "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20";
  await engine.init(masterKeyHex);
  console.log("✓ Engine initialized with libsodium WASM");

  // 1. HKDF Key Derivation Validation (Pure WASM HMAC-SHA256)
  const expectedKSend = "a018f378a93cb3bf437192eab4a6b46513ec5cf1e9a5a7211f936689fd9feffd";
  const expectedKRecv = "d1b5aaec98f0f930c7b5f94d82a6f19a16a92007454f6b9a2f4f74ceba803825";
  const expectedKWS = "c2f31346f033615a4af3cdbd8e4e612fe591b75d21223c999b5d2158607c63f7";
  const expectedKAuth = "694274bd605eb866d866f5737fb9bc7d6778a09b4a586739581bcf7a73c7a496";

  assert.strictEqual(engine.sodium.to_hex(engine.keys.kSend), expectedKSend, "kSend mismatch");
  assert.strictEqual(engine.sodium.to_hex(engine.keys.kRecv), expectedKRecv, "kRecv mismatch");
  assert.strictEqual(engine.sodium.to_hex(engine.keys.kWS), expectedKWS, "kWS mismatch");
  assert.strictEqual(engine.sodium.to_hex(engine.keys.kAuth), expectedKAuth, "kAuth mismatch");
  console.log("✓ HKDF derived keys match RFC 5869 / Go test vectors 100%");

  // 2. 4MB Chunk Encryption & Decryption
  const chunkSize = 4 * 1024 * 1024;
  const chunkData = new Uint8Array(chunkSize);
  for (let i = 0; i < chunkSize; i++) chunkData[i] = (i * 7 + 13) & 0xff;

  const fileID = "file-test-abc-123";
  const chunkIndex = 42;

  const envelope = engine.encryptChunk(chunkData, chunkIndex, fileID, 'send');
  assert.strictEqual(envelope.length, 4 + 24 + chunkSize + 16, "Envelope length mismatch");

  const decrypted = engine.decryptChunk(envelope, chunkIndex, fileID, 'send');
  assert.strictEqual(decrypted.length, chunkSize, "Decrypted length mismatch");
  assert.deepStrictEqual(decrypted, chunkData, "Decrypted content does not match original");
  console.log("✓ 4MB Chunk Encryption & Decryption round-trip verified");

  // 3. Sustained Throughput Benchmark (DoD check: >= 60 MB/s)
  console.log("Running sustained 4MB chunk throughput benchmark...");
  const N = 15; // 60 MB
  const t0 = Date.now();
  let cipherList = [];
  for (let i = 0; i < N; i++) {
    cipherList.push(engine.encryptChunk(chunkData, i, fileID, 'send'));
  }
  const encDurationSec = (Date.now() - t0) / 1000;
  const encThroughput = (N * 4) / encDurationSec;
  console.log(`- Encrypt Throughput: ${encThroughput.toFixed(1)} MB/s (${(encDurationSec / N * 1000).toFixed(1)} ms/chunk)`);
  assert(encThroughput >= 60, `Encryption throughput ${encThroughput.toFixed(1)} MB/s is below DoD requirement (>= 60 MB/s)`);

  const t1 = Date.now();
  for (let i = 0; i < N; i++) {
    engine.decryptChunk(cipherList[i], i, fileID, 'send');
  }
  const decDurationSec = (Date.now() - t1) / 1000;
  const decThroughput = (N * 4) / decDurationSec;
  console.log(`- Decrypt Throughput: ${decThroughput.toFixed(1)} MB/s (${(decDurationSec / N * 1000).toFixed(1)} ms/chunk)`);
  assert(decThroughput >= 60, `Decryption throughput ${decThroughput.toFixed(1)} MB/s is below DoD requirement (>= 60 MB/s)`);
  console.log("✓ DoD Throughput standard (>= 60 MB/s) PASSED!");

  // 4. JS-Side Tamper Resistance Test Vectors & Structured Error Checks
  console.log("Running JS tamper resistance & structured error tests...");

  // 4.1 Corrupted Ciphertext Bit
  {
    const tampered = new Uint8Array(envelope);
    tampered[50] ^= 0x01; // flip 1 bit in ciphertext
    try {
      engine.decryptChunk(tampered, chunkIndex, fileID, 'send');
      assert.fail("Should have thrown on corrupted ciphertext");
    } catch (err) {
      assert.strictEqual(err.name, 'CryptoError', "Error should be instance of CryptoError");
      assert.strictEqual(err.code, CryptoErrorCode.AUTH_FAILED, "Error code should be AUTH_FAILED");
      assert.strictEqual(err.retryable, false, "Auth failure is fatal non-retryable");
    }
  }

  // 4.2 Corrupted Poly1305 Tag
  {
    const tampered = new Uint8Array(envelope);
    tampered[tampered.length - 1] ^= 0x80; // flip 1 bit in tag
    try {
      engine.decryptChunk(tampered, chunkIndex, fileID, 'send');
      assert.fail("Should have thrown on corrupted tag");
    } catch (err) {
      assert.strictEqual(err.code, CryptoErrorCode.AUTH_FAILED, "Error code should be AUTH_FAILED");
    }
  }

  // 4.3 Chunk Index AAD Mismatch
  {
    try {
      engine.decryptChunk(envelope, chunkIndex + 1, fileID, 'send');
      assert.fail("Should have thrown on wrong chunk index");
    } catch (err) {
      assert.strictEqual(err.code, CryptoErrorCode.CHUNK_INDEX_MISMATCH, "Error code should be CHUNK_INDEX_MISMATCH");
    }
  }

  // 4.4 FileID AAD Mismatch
  {
    try {
      engine.decryptChunk(envelope, chunkIndex, "wrong-file-id", 'send');
      assert.fail("Should have thrown on wrong fileID AAD");
    } catch (err) {
      assert.strictEqual(err.code, CryptoErrorCode.AUTH_FAILED, "Error code should be AUTH_FAILED");
    }
  }

  // 4.5 Wrong Key
  {
    try {
      engine.decryptChunk(envelope, chunkIndex, fileID, 'recv'); // used kRecv instead of kSend
      assert.fail("Should have thrown on wrong key");
    } catch (err) {
      assert.strictEqual(err.code, CryptoErrorCode.AUTH_FAILED, "Error code should be AUTH_FAILED");
    }
  }
  console.log("✓ All JS tamper resistance vectors & structured CryptoError codes PASSED!");

  // 5. Packet Encryption & Decryption (Chat / Sequence AAD)
  const packetMsg = "Hello E2EE Chat World!";
  const seq = 1001;
  const packetEnv = engine.encryptPacket(packetMsg, seq);
  const decryptedPacket = engine.decryptPacket(packetEnv, seq);
  assert.deepStrictEqual(decryptedPacket, engine.sodium.from_string(packetMsg), "Packet round-trip mismatch");

  // Tampered packet sequence
  try {
    engine.decryptPacket(packetEnv, seq + 1);
    assert.fail("Should have thrown on sequence mismatch");
  } catch (err) {
    assert.strictEqual(err.code, CryptoErrorCode.AUTH_FAILED, "Packet seq tampering code should be AUTH_FAILED");
  }
  console.log("✓ Packet encryption/decryption with Sequence AAD PASSED!");

  // 6. Memory Wiping Test
  engine.wipe();
  assert.strictEqual(engine.initialized, false, "Engine should be uninitialized after wipe");
  assert.strictEqual(engine.keys.masterKey, null, "Keys should be null after wipe");
  try {
    engine.encryptPacket("test", 1);
    assert.fail("Should throw when uninitialized");
  } catch (err) {
    assert.strictEqual(err.code, CryptoErrorCode.UNINITIALIZED, "Uninitialized call throws UNINITIALIZED error code");
  }
  console.log("✓ Memory wiping test PASSED!");

  // 7. Non-Secure Context Test (Simulating http://192.168.x.x LAN mobile browser where crypto.subtle is undefined)
  console.log("Running Non-Secure Context (HTTP LAN) simulation test (crypto.subtle = undefined)...");
  const origCrypto = global.crypto;
  try {
    global.crypto = {
      getRandomValues: (arr) => origCrypto.getRandomValues(arr)
      // crypto.subtle is intentionally undefined!
    };
    const lanEngine = new EQTCryptoEngine();
    await lanEngine.init(masterKeyHex);
    assert.strictEqual(lanEngine.initialized, true, "Engine must initialize without crypto.subtle");
    assert.strictEqual(lanEngine.sodium.to_hex(lanEngine.keys.kSend), expectedKSend, "kSend matches in LAN context");
    assert.strictEqual(lanEngine.sodium.to_hex(lanEngine.keys.kRecv), expectedKRecv, "kRecv matches in LAN context");
    assert.strictEqual(lanEngine.sodium.to_hex(lanEngine.keys.kWS), expectedKWS, "kWS matches in LAN context");
    assert.strictEqual(lanEngine.sodium.to_hex(lanEngine.keys.kAuth), expectedKAuth, "kAuth matches in LAN context");

    const testPlain = new Uint8Array([10, 20, 30, 40, 50]);
    const testEnv = lanEngine.encryptChunk(testPlain, 0, "lan-file-01", 'send');
    const testDec = lanEngine.decryptChunk(testEnv, 0, "lan-file-01", 'send');
    assert.deepStrictEqual(testDec, testPlain, "LAN context chunk encryption/decryption works 100%");
    console.log("✓ Non-Secure Context (HTTP LAN) simulation PASSED with zero crypto.subtle dependency!");
  } finally {
    global.crypto = origCrypto;
  }

  console.log("\n>>> ALL JS CRYPTO TESTS PASSED 100% <<<\n");
}

runTests().catch(err => {
  console.error("Test failed:", err);
  process.exit(1);
});
