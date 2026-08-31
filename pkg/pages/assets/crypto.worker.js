/**
 * EQT E2EE Web Worker Pipeline for 4MB Chunk Encryption/Decryption
 * Uses Transferable Objects for Zero-Copy memory transfer between Main Thread & Worker.
 * Complies with Memory Security Rules (Auto memzero on termination).
 */
/* global importScripts, EQTCrypto */

if (typeof importScripts === 'function') {
    try {
        importScripts('crypto-engine.js');
    } catch (e) {
        console.error("Worker failed to import crypto-engine.js: ", e);
    }
}

var keys = null;
var role = 'client';

self.onmessage = function (e) {
    var data = e.data;
    if (!data || !data.type) return;

    try {
        switch (data.type) {
            case 'INIT_KEYS':
                if (keys) {
                    keys.wipe();
                    keys = null;
                }
                keys = EQTCrypto.deriveKeys(data.masterKey);
                role = data.role || 'client';
                self.postMessage({ type: 'INIT_SUCCESS' });
                break;

            case 'ENCRYPT_CHUNK':
                if (!keys) {
                    throw new Error("Worker keys not initialized");
                }
                var plainBuf = new Uint8Array(data.buffer);
                var key = data.useRecvKey ? keys.kRecv : keys.kSend;
                var envelope = EQTCrypto.encryptChunk(plainBuf, data.chunkIndex, key, data.fileId);
                
                // Zero-copy transfer back to main thread
                self.postMessage({
                    type: 'ENCRYPT_SUCCESS',
                    chunkIndex: data.chunkIndex,
                    fileId: data.fileId,
                    buffer: envelope.buffer,
                    byteLength: envelope.byteLength
                }, [envelope.buffer]);
                break;

            case 'DECRYPT_CHUNK':
                if (!keys) {
                    throw new Error("Worker keys not initialized");
                }
                var cipherBuf = new Uint8Array(data.buffer);
                var dKey = data.useSendKey ? keys.kSend : keys.kRecv;
                var decrypted = EQTCrypto.decryptChunk(cipherBuf, data.chunkIndex, dKey, data.fileId);

                // Zero-copy transfer back to main thread
                self.postMessage({
                    type: 'DECRYPT_SUCCESS',
                    chunkIndex: data.chunkIndex,
                    fileId: data.fileId,
                    buffer: decrypted.buffer,
                    byteLength: decrypted.byteLength
                }, [decrypted.buffer]);
                break;

            case 'ZEROIZE_AND_CLOSE':
                if (keys) {
                    keys.wipe();
                    keys = null;
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
