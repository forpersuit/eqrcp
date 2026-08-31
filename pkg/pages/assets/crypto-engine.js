/**
 * EQT End-to-End Encryption (E2EE) Cryptographic Engine
 * RFC 8439 XChaCha20-Poly1305 AEAD + RFC 5869 HKDF-SHA256 Key Derivation
 * 100% Constant-Time via Libsodium WebAssembly (Zero reliance on crypto.subtle / Secure Context)
 */
(function(global) {
  'use strict';

  class EQTCryptoEngine {
    constructor() {
      this.initialized = false;
      this.keys = {
        masterKey: null,
        kSend: null,
        kRecv: null,
        kWS: null,
        kAuth: null
      };
      this.sodium = null;
    }

    /**
     * Initializes the crypto engine with a 32-byte MasterKey
     * @param {Uint8Array|string} masterKey - 32-byte Uint8Array or hex/base64 string
     */
    async init(masterKey) {
      // 1. Ensure libsodium WASM is ready
      const sodiumObj = global.sodium || (typeof require !== 'undefined' ? require('./libsodium.js') : null);
      if (!sodiumObj) {
        throw new Error("libsodium WASM module is not loaded");
      }
      await sodiumObj.ready;
      this.sodium = sodiumObj;

      // 2. Parse MasterKey to 32 bytes Uint8Array
      let rawKey;
      if (typeof masterKey === 'string') {
        if (/^[0-9a-fA-F]{64}$/.test(masterKey)) {
          rawKey = this.sodium.from_hex(masterKey);
        } else {
          rawKey = this.sodium.from_base64(masterKey, this.sodium.base64_variants.ORIGINAL_NO_PADDING);
        }
      } else if (masterKey instanceof Uint8Array) {
        rawKey = new Uint8Array(masterKey);
      } else {
        throw new TypeError("MasterKey must be a 32-byte Uint8Array or Hex/Base64 string");
      }

      if (rawKey.length !== 32) {
        throw new Error(`MasterKey must be exactly 32 bytes, got ${rawKey.length}`);
      }

      this.keys.masterKey = rawKey;

      // 3. Derive subkeys using RFC 5869 HKDF-SHA256 via libsodium WASM HMAC-SHA256
      // NOTE: Zero reliance on crypto.subtle to guarantee 100% operation in non-secure LAN HTTP (http://192.168.x.x).
      // In libsodium: crypto_auth_hmacsha256(message, key) computes HMAC-SHA256(key, message)
      const hmacSha256 = (key, msg) => {
        return this.sodium.crypto_auth_hmacsha256(msg, key);
      };

      // HKDF-Extract(salt, IKM) -> PRK (salt is 32 zero bytes per architecture spec)
      const zeroSalt = new Uint8Array(32);
      const prk = hmacSha256(zeroSalt, rawKey);

      // HKDF-Expand(PRK, info, L=32) -> OKM
      const expand = (infoStr) => {
        const infoBytes = this.sodium.from_string(infoStr);
        const msg = new Uint8Array(infoBytes.length + 1);
        msg.set(infoBytes, 0);
        msg[infoBytes.length] = 1; // 0x01 for block 1 (32 bytes)
        const okm = hmacSha256(prk, msg);
        this.sodium.memzero(msg);
        return okm;
      };

      this.keys.kSend = expand('eqt-e2ee-v2-send');
      this.keys.kRecv = expand('eqt-e2ee-v2-recv');
      this.keys.kWS = expand('eqt-e2ee-v2-ws');
      this.keys.kAuth = expand('eqt-e2ee-v2-auth');

      this.sodium.memzero(prk);
      this.initialized = true;
      return this;
    }

    _ensureInit() {
      if (!this.initialized || !this.keys.masterKey) {
        throw new Error("EQTCryptoEngine is not initialized. Call init(masterKey) first.");
      }
    }

    /**
     * Constructs Additional Authenticated Data (AAD) for chunk: fileID || uint32_be(chunkIndex)
     */
    _makeChunkAAD(fileID, chunkIndex) {
      const fileIDBytes = this.sodium.from_string(fileID);
      const aad = new Uint8Array(fileIDBytes.length + 4);
      aad.set(fileIDBytes, 0);
      const view = new DataView(aad.buffer, aad.byteOffset, aad.byteLength);
      view.setUint32(fileIDBytes.length, chunkIndex, false); // BigEndian
      return aad;
    }

    /**
     * Constructs AAD for WebSocket / Chat packet: uint64_be(seq)
     */
    _makeSeqAAD(seq) {
      const aad = new Uint8Array(8);
      const view = new DataView(aad.buffer, aad.byteOffset, aad.byteLength);
      view.setBigUint64(0, BigInt(seq), false);
      return aad;
    }

    /**
     * Encrypts a 4MB file chunk.
     * Output format: [ChunkIndex(4B BE) | Nonce(24B) | Ciphertext + Tag(16B)]
     */
    encryptChunk(chunkBytes, chunkIndex, fileID, keyType = 'send') {
      this._ensureInit();
      const key = keyType === 'send' ? this.keys.kSend : this.keys.kRecv;
      const nonce = this.sodium.randombytes_buf(24);
      const aad = this._makeChunkAAD(fileID, chunkIndex);

      // libsodium's crypto_aead_xchacha20poly1305_ietf_encrypt appends 16-byte Poly1305 tag
      const ciphertextWithTag = this.sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
        chunkBytes,
        aad,
        null,
        nonce,
        key
      );

      // Assemble envelope: [ChunkIndex (4B) | Nonce (24B) | Ciphertext+Tag]
      const envelope = new Uint8Array(4 + 24 + ciphertextWithTag.length);
      const view = new DataView(envelope.buffer, envelope.byteOffset, envelope.byteLength);
      view.setUint32(0, chunkIndex, false);
      envelope.set(nonce, 4);
      envelope.set(ciphertextWithTag, 28);

      return envelope;
    }

    /**
     * Decrypts an encrypted chunk envelope.
     * Expects envelope format: [ChunkIndex(4B BE) | Nonce(24B) | Ciphertext + Tag(16B)]
     */
    decryptChunk(envelopeBytes, chunkIndex, fileID, keyType = 'recv') {
      this._ensureInit();
      if (envelopeBytes.length < 4 + 24 + 16) {
        throw new Error(`Envelope too short: ${envelopeBytes.length} bytes`);
      }

      const view = new DataView(envelopeBytes.buffer, envelopeBytes.byteOffset, envelopeBytes.byteLength);
      const envIndex = view.getUint32(0, false);
      if (envIndex !== chunkIndex) {
        throw new Error(`Chunk index mismatch: expected ${chunkIndex}, found ${envIndex}`);
      }

      const nonce = envelopeBytes.subarray(4, 28);
      const ciphertextWithTag = envelopeBytes.subarray(28);
      const key = keyType === 'recv' ? this.keys.kRecv : this.keys.sendKey || this.keys.kSend;
      const aad = this._makeChunkAAD(fileID, chunkIndex);

      return this.sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
        null,
        ciphertextWithTag,
        aad,
        nonce,
        key
      );
    }

    /**
     * Encrypts a message or packet (e.g. Chat WebSocket / Clipboard).
     * Output format: [Nonce(24B) | Ciphertext + Tag(16B)]
     */
    encryptPacket(plaintextBytes, seq = 0, customKey = null) {
      this._ensureInit();
      if (typeof plaintextBytes === 'string') {
        plaintextBytes = this.sodium.from_string(plaintextBytes);
      }
      const key = customKey || this.keys.kWS;
      const nonce = this.sodium.randombytes_buf(24);
      const aad = this._makeSeqAAD(seq);

      const ciphertextWithTag = this.sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
        plaintextBytes,
        aad,
        null,
        nonce,
        key
      );

      const envelope = new Uint8Array(24 + ciphertextWithTag.length);
      envelope.set(nonce, 0);
      envelope.set(ciphertextWithTag, 24);
      return envelope;
    }

    /**
     * Decrypts an encrypted packet envelope.
     */
    decryptPacket(envelopeBytes, seq = 0, customKey = null) {
      this._ensureInit();
      if (envelopeBytes.length < 24 + 16) {
        throw new Error(`Packet envelope too short: ${envelopeBytes.length} bytes`);
      }

      const key = customKey || this.keys.kWS;
      const nonce = envelopeBytes.subarray(0, 24);
      const ciphertextWithTag = envelopeBytes.subarray(24);
      const aad = this._makeSeqAAD(seq);

      return this.sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
        null,
        ciphertextWithTag,
        aad,
        nonce,
        key
      );
    }

    /**
     * Securely clears all sensitive key material from memory
     */
    wipe() {
      if (this.sodium && this.sodium.memzero) {
        for (const k in this.keys) {
          if (this.keys[k] && this.keys[k] instanceof Uint8Array) {
            this.sodium.memzero(this.keys[k]);
          }
        }
      }
      this.keys = { masterKey: null, kSend: null, kRecv: null, kWS: null, kAuth: null };
      this.initialized = false;
    }
  }

  // Export to global scope & CommonJS
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { EQTCryptoEngine };
  }
  global.EQTCryptoEngine = EQTCryptoEngine;
})(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : globalThis));
