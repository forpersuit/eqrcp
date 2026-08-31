/**
 * EQT E2EE Web Worker Pipeline for 4MB Chunk Encryption/Decryption
 * Uses Transferable Objects for Zero-Copy memory transfer between Main Thread & Worker.
 * Constant-time libsodium WASM + auto memzero on termination.
 */
/* global importScripts, sodium, EQTCryptoEngine */

if (typeof importScripts === 'function') {
  try {
    importScripts('libsodium.js', 'crypto-engine.js');
  } catch (e) {
    console.error("Worker failed to import scripts: ", e);
  }
}

let engine = null;

self.onmessage = async function(e) {
  const data = e.data;
  if (!data || !data.type) return;

  try {
    switch (data.type) {
      case 'INIT_KEYS':
        if (engine) {
          engine.wipe();
        }
        engine = new EQTCryptoEngine();
        await engine.init(data.masterKey);
        self.postMessage({ type: 'INIT_SUCCESS' });
        break;

      case 'ENCRYPT_CHUNK':
        if (!engine || !engine.initialized) {
          throw new Error("Worker cryptographic engine not initialized");
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
            byteLength: envelope.byteLength
          }, [envelope.buffer]);
        }
        break;

      case 'DECRYPT_CHUNK':
        if (!engine || !engine.initialized) {
          throw new Error("Worker cryptographic engine not initialized");
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
            byteLength: decrypted.byteLength
          }, [decrypted.buffer]);
        }
        break;

      case 'ZEROIZE_AND_CLOSE':
        if (engine) {
          engine.wipe();
          engine = null;
        }
        self.postMessage({ type: 'ZEROIZE_SUCCESS' });
        self.close();
        break;

      default:
        throw new Error("Unknown worker message type: " + data.type);
    }
  } catch (err) {
    self.postMessage({
      type: 'ERROR',
      chunkIndex: data.chunkIndex,
      fileId: data.fileId,
      error: err.message || String(err)
    });
  }
};
