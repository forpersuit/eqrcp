const assert = require('assert');
const crypto = require('crypto');
const EQTCrypto = require('../../pages/assets/crypto-engine.js');

console.log("=== Testing EQT JS Crypto Engine ===");

// 1. Test HKDF-SHA256
const masterKeyHex = "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20";
const masterKey = EQTCrypto.hexToBytes(masterKeyHex);
const keys = EQTCrypto.deriveKeys(masterKey);

assert.strictEqual(keys.kSend.length, 32, "K_send must be 32 bytes");
assert.strictEqual(keys.kRecv.length, 32, "K_recv must be 32 bytes");
assert.strictEqual(keys.kWS.length, 32, "K_ws must be 32 bytes");
assert.strictEqual(keys.kAuth.length, 32, "K_auth must be 32 bytes");

console.log("✓ HKDF Key Derivation PASSED");
console.log("  K_send:", EQTCrypto.bytesToHex(keys.kSend));
console.log("  K_recv:", EQTCrypto.bytesToHex(keys.kRecv));
console.log("  K_ws:  ", EQTCrypto.bytesToHex(keys.kWS));
console.log("  K_auth:", EQTCrypto.bytesToHex(keys.kAuth));

// 2. Test 4MB Chunk Encryption & Decryption
const fileId = "test-file-uuid-7788";
const chunkIndex = 3;
const plaintextStr = "Hello World! This is a test chunk encrypted with XChaCha20-Poly1305.";
const plaintext = EQTCrypto.stringToBytes(plaintextStr);

const envelope = EQTCrypto.encryptChunk(plaintext, chunkIndex, keys.kSend, fileId);
assert.strictEqual(envelope.length, EQTCrypto.CHUNK_HEADER_SIZE + plaintext.length + EQTCrypto.TAG_SIZE);

const decrypted = EQTCrypto.decryptChunk(envelope, chunkIndex, keys.kSend, fileId);
assert.strictEqual(EQTCrypto.bytesToString(decrypted), plaintextStr, "Decrypted chunk must match plaintext");
console.log("✓ 4MB Chunk Encrypt/Decrypt PASSED");

// 3. Test Tamper Detection
const tampered = new Uint8Array(envelope);
tampered[tampered.length - 1] ^= 0x01; // flip 1 bit

assert.throws(() => {
    EQTCrypto.decryptChunk(tampered, chunkIndex, keys.kSend, fileId);
}, /Authentication tag verification failed/, "Tampered ciphertext must throw error");
console.log("✓ Tampered Tag Verification Exception PASSED");

// 4. Test AAD ChunkIndex Replay Attack
assert.throws(() => {
    EQTCrypto.decryptChunk(envelope, 0, keys.kSend, fileId); // wrong chunk index
}, /ChunkIndex mismatch/, "Replayed chunk index must be rejected");
console.log("✓ AAD Chunk Index Replay Attack Defense PASSED");

// 5. Test Packet Encryption (WebSocket & Small Attachment)
const aadStr = "seq:42|ts:1725100000";
const packet = EQTCrypto.encryptPacket(plaintext, keys.kWS, aadStr);
const decPacket = EQTCrypto.decryptPacket(packet, keys.kWS, aadStr);
assert.strictEqual(EQTCrypto.bytesToString(decPacket), plaintextStr);

assert.throws(() => {
    EQTCrypto.decryptPacket(packet, keys.kWS, "seq:43|ts:1725100000");
}, /Authentication tag verification failed/);
console.log("✓ Packet Encrypt/Decrypt & AAD Authentication PASSED");

// 6. Test Memory Wiping
keys.wipe();
assert(keys.kSend.every(b => b === 0), "kSend must be zeroed");
assert(keys.kRecv.every(b => b === 0), "kRecv must be zeroed");
console.log("✓ Memory Zeroization PASSED");

// 7. Benchmark 4MB Chunk Processing
const chunk4MB = new Uint8Array(4 * 1024 * 1024);
for (let i = 0; i < chunk4MB.length; i++) chunk4MB[i] = i & 0xff;

const benchKeys = EQTCrypto.deriveKeys(masterKey);
console.log("\nRunning 4MB Benchmark in pure JS...");

const startEnc = Date.now();
const enc4MB = EQTCrypto.encryptChunk(chunk4MB, 0, benchKeys.kSend, "bench-file");
const encDuration = (Date.now() - startEnc) / 1000;
console.log(`4MB Encrypt Time: ${encDuration.toFixed(3)}s (${(4 / encDuration).toFixed(1)} MB/s)`);

const startDec = Date.now();
const dec4MB = EQTCrypto.decryptChunk(enc4MB, 0, benchKeys.kSend, "bench-file");
const decDuration = (Date.now() - startDec) / 1000;
console.log(`4MB Decrypt Time: ${decDuration.toFixed(3)}s (${(4 / decDuration).toFixed(1)} MB/s)`);

assert.strictEqual(dec4MB.length, chunk4MB.length);
console.log("\n=== ALL JS CRYPTO TESTS PASSED ===");
