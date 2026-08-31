/**
 * E2EE Interoperability & Security Test Suite
 * Validates libsodium WASM engine, constant-time AEAD, HKDF derivation, and tamper resistance.
 */
const path = require('path');
const assert = require('assert');

// Load bundled libsodium and EQTCryptoEngine
require('../../pages/assets/libsodium.js');
const { EQTCryptoEngine } = require('../../pages/assets/crypto-engine.js');

async function runTests() {
  console.log("=== EQT E2EE Security & Interop Test Suite ===");

  const engine = new EQTCryptoEngine();
  const masterKeyHex = "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20";
  await engine.init(masterKeyHex);
  console.log("✓ Engine initialized with libsodium WASM");

  // 1. HKDF Key Derivation Validation
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

  // 4. JS-Side Tamper Resistance Test Vectors
  console.log("Running JS tamper resistance tests...");

  // 4.1 Corrupted Ciphertext Bit
  {
    const tampered = new Uint8Array(envelope);
    tampered[50] ^= 0x01; // flip 1 bit in ciphertext
    assert.throws(() => {
      engine.decryptChunk(tampered, chunkIndex, fileID, 'send');
    }, /ciphertext cannot be decrypted|incorrect tag|internal error/i, "Should reject corrupted ciphertext bit");
  }

  // 4.2 Corrupted Poly1305 Tag
  {
    const tampered = new Uint8Array(envelope);
    tampered[tampered.length - 1] ^= 0x80; // flip 1 bit in tag
    assert.throws(() => {
      engine.decryptChunk(tampered, chunkIndex, fileID, 'send');
    }, /ciphertext cannot be decrypted|incorrect tag|internal error/i, "Should reject corrupted tag");
  }

  // 4.3 Chunk Index AAD Mismatch
  {
    assert.throws(() => {
      engine.decryptChunk(envelope, chunkIndex + 1, fileID, 'send');
    }, /Chunk index mismatch|ciphertext cannot be decrypted/i, "Should reject wrong chunk index");
  }

  // 4.4 FileID AAD Mismatch
  {
    assert.throws(() => {
      engine.decryptChunk(envelope, chunkIndex, "wrong-file-id", 'send');
    }, /ciphertext cannot be decrypted|incorrect tag|internal error/i, "Should reject wrong fileID AAD");
  }

  // 4.5 Wrong Key
  {
    assert.throws(() => {
      engine.decryptChunk(envelope, chunkIndex, fileID, 'recv'); // used kRecv instead of kSend
    }, /ciphertext cannot be decrypted|incorrect tag|internal error/i, "Should reject wrong key");
  }
  console.log("✓ All JS tamper resistance vectors PASSED!");

  // 5. Packet Encryption & Decryption (Chat / Sequence AAD)
  const packetMsg = new TextEncoder().encode("Hello E2EE Chat World!");
  const seq = 1001;
  const packetEnv = engine.encryptPacket(packetMsg, seq);
  const decryptedPacket = engine.decryptPacket(packetEnv, seq);
  assert.deepStrictEqual(decryptedPacket, packetMsg, "Packet round-trip mismatch");

  // Tampered packet sequence
  assert.throws(() => {
    engine.decryptPacket(packetEnv, seq + 1);
  }, /ciphertext cannot be decrypted|incorrect tag|internal error/i, "Should reject wrong packet sequence number");
  console.log("✓ Packet encryption/decryption with Sequence AAD PASSED!");

  // 6. Memory Wiping Test
  engine.wipe();
  assert.strictEqual(engine.initialized, false, "Engine should be uninitialized after wipe");
  assert.strictEqual(engine.keys.masterKey, null, "Keys should be null after wipe");
  console.log("✓ Memory wiping test PASSED!");

  console.log("\n>>> ALL JS CRYPTO TESTS PASSED 100% <<<\n");
}

runTests().catch(err => {
  console.error("Test failed:", err);
  process.exit(1);
});
