/**
 * EQT E2EE Web Worker Pipeline for 4MB Chunk Encryption/Decryption
 * Uses Transferable Objects for Zero-Copy memory transfer between Main Thread & Worker.
 * Constant-time libsodium WASM + auto memzero on termination.
 * Production-grade Structured Error Handling & Telemetry.
 */
/* global importScripts, sodium, EQTCryptoEngine, CryptoError, CryptoErrorCode, CryptoLogger */

if (typeof importScripts === 'function') {
  try {
    importScripts('libsodium.js', 'crypto-engine.js');
  } catch (e) {
    console.error("[E2EE-Worker] Failed to importScripts: ", e);
  }
}

let engine = null;

self.onmessage = async function(e) {
  const data = e.data;
  if (!data || !data.type) return;

  const startTime = Date.now();

  try {
    switch (data.type) {
      case 'INIT_KEYS':
        if (engine) {
          engine.wipe();
        }
        engine = new EQTCryptoEngine();
        await engine.init(data.masterKey);
        self.postMessage({
          type: 'INIT_SUCCESS',
          durationMs: Date.now() - startTime
        });
        break;

      case 'ENCRYPT_CHUNK':
        if (!engine || !engine.initialized) {
          throw new CryptoError(CryptoErrorCode.UNINITIALIZED, "Worker cryptographic engine is not initialized", { op: 'ENCRYPT_CHUNK', chunkIndex: data.chunkIndex, fileID: data.fileId });
        }
        {
          const plainBuf = new Uint8Array(data.buffer);
          const keyType = data.useRecvKey ? 'recv' : 'send';
          const envelope = engine.encryptChunk(plainBuf, data.chunkIndex, data.fileId, keyType);

          // Zero-copy transfer back to main thread
          self.postMessage({
            type: 'ENCRYPT_SUCCESS',
            chunkIndex: data.chunkIndex,
            fileId: data.fileId,
            buffer: envelope.buffer,
            byteLength: envelope.byteLength,
            durationMs: Date.now() - startTime
          }, [envelope.buffer]);
        }
        break;

      case 'DECRYPT_CHUNK':
        if (!engine || !engine.initialized) {
          throw new CryptoError(CryptoErrorCode.UNINITIALIZED, "Worker cryptographic engine is not initialized", { op: 'DECRYPT_CHUNK', chunkIndex: data.chunkIndex, fileID: data.fileId });
        }
        {
          const cipherBuf = new Uint8Array(data.buffer);
          const keyType = data.useSendKey ? 'send' : 'recv';
          const decrypted = engine.decryptChunk(cipherBuf, data.chunkIndex, data.fileId, keyType);

          // Zero-copy transfer back to main thread
          self.postMessage({
            type: 'DECRYPT_SUCCESS',
            chunkIndex: data.chunkIndex,
            fileId: data.fileId,
            buffer: decrypted.buffer,
            byteLength: decrypted.byteLength,
            durationMs: Date.now() - startTime
          }, [decrypted.buffer]);
        }
        break;

      case 'ZEROIZE_AND_CLOSE':
        if (engine) {
          engine.wipe();
          engine = null;
        }
        self.postMessage({ type: 'ZEROIZE_SUCCESS', durationMs: Date.now() - startTime });
        self.close();
        break;

      default:
        throw new CryptoError(CryptoErrorCode.PARAM_ERROR, "Unknown worker message type: " + data.type, { op: data.type });
    }
  } catch (err) {
    const isCryptoErr = err && err.name === 'CryptoError';
    self.postMessage({
      type: 'ERROR',
      code: isCryptoErr ? err.code : 'UNKNOWN_ERROR',
      op: data.type,
      chunkIndex: data.chunkIndex !== undefined ? data.chunkIndex : null,
      fileId: data.fileId || null,
      error: err.message || String(err),
      retryable: isCryptoErr ? err.retryable : false,
      durationMs: Date.now() - startTime
    });
  }
};
