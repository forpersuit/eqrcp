/**
 * EQT End-to-End Encryption (E2EE) Cryptographic Engine
 * RFC 8439 XChaCha20-Poly1305 AEAD + RFC 5869 HKDF-SHA256 Key Derivation
 * 100% Constant-Time via Libsodium WebAssembly (Zero reliance on crypto.subtle / Secure Context)
 * Production-grade Structured Errors & Diagnostic Logging
 */
(function(global) {
  'use strict';

  /**
   * Standard Machine-Readable Error Codes for E2EE Cryptography
   */
  const CryptoErrorCode = Object.freeze({
    INVALID_KEY_SIZE:     'INVALID_KEY_SIZE',
    CIPHERTEXT_TOO_SHORT: 'CIPHERTEXT_TOO_SHORT',
    CHUNK_INDEX_MISMATCH: 'CHUNK_INDEX_MISMATCH',
    AUTH_FAILED:          'AUTH_FAILED',
    UNINITIALIZED:        'UNINITIALIZED',
    WASM_LOAD_FAILED:     'WASM_LOAD_FAILED',
    REPLAY_DETECTED:      'REPLAY_DETECTED',
    PARAM_ERROR:          'PARAM_ERROR'
  });

  /**
   * Structured Diagnostic Error for Cryptographic Operations
   */
  class CryptoError extends Error {
    constructor(code, message, context = {}) {
      super(message);
      this.name = 'CryptoError';
      this.code = code;
      this.op = context.op || '';
      this.chunkIndex = context.chunkIndex !== undefined ? context.chunkIndex : null;
      this.fileID = context.fileID || null;
      this.seq = context.seq !== undefined ? context.seq : null;
      // AUTH_FAILED / INVALID_KEY_SIZE are fatal non-retryable errors
      this.retryable = context.retryable !== undefined ? context.retryable : (code !== CryptoErrorCode.AUTH_FAILED && code !== CryptoErrorCode.INVALID_KEY_SIZE);
      this.timestamp = Date.now();
    }

    toJSON() {
      return {
        name: this.name,
        code: this.code,
        op: this.op,
        chunkIndex: this.chunkIndex,
        fileID: this.fileID,
        seq: this.seq,
        retryable: this.retryable,
        message: this.message,
        timestamp: this.timestamp
      };
    }
  }

  /**
   * Diagnostic Logger for E2EE Operations
   */
  const CryptoLogger = {
    _enabled: true,
    _format(level, op, msg, meta) {
      const ts = new Date().toISOString();
      const metaStr = meta ? ' ' + JSON.stringify(meta) : '';
      return `[${ts}] [E2EE-${level}] [${op}] ${msg}${metaStr}`;
    },
    debug(op, msg, meta) {
      if (this._enabled && (global.__EQT_DEBUG__ || (typeof process !== 'undefined' && process.env && process.env.EQT_DEBUG))) {
        console.debug(this._format('DEBUG', op, msg, meta));
      }
    },
    info(op, msg, meta) {
      if (this._enabled) {
        console.info(this._format('INFO', op, msg, meta));
      }
    },
    warn(op, msg, meta) {
      if (this._enabled) {
        console.warn(this._format('WARN', op, msg, meta));
      }
    },
    error(op, msg, meta) {
      if (this._enabled) {
        console.error(this._format('ERROR', op, msg, meta));
      }
    }
  };

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
      const op = 'init';
      // 1. Ensure libsodium WASM is ready
      const sodiumObj = global.sodium || (typeof require !== 'undefined' ? require('./libsodium.js') : null);
      if (!sodiumObj) {
        throw new CryptoError(CryptoErrorCode.WASM_LOAD_FAILED, "libsodium WASM module is not loaded in current scope", { op });
      }
      try {
        await sodiumObj.ready;
      } catch (err) {
        throw new CryptoError(CryptoErrorCode.WASM_LOAD_FAILED, "Failed to initialize libsodium WebAssembly runtime: " + (err.message || err), { op, cause: err });
      }
      this.sodium = sodiumObj;

      // 2. Parse MasterKey to 32 bytes Uint8Array
      let rawKey;
      if (typeof masterKey === 'string') {
        if (/^[0-9a-fA-F]{64}$/.test(masterKey)) {
          rawKey = this.sodium.from_hex(masterKey);
        } else {
          try {
            rawKey = this.sodium.from_base64(masterKey, this.sodium.base64_variants.ORIGINAL_NO_PADDING);
          } catch (e1) {
            try {
              rawKey = this.sodium.from_base64(masterKey, this.sodium.base64_variants.ORIGINAL);
            } catch (e2) {
              try {
                rawKey = this.sodium.from_base64(masterKey, this.sodium.base64_variants.URLSAFE_NO_PADDING);
              } catch (e3) {
                try {
                  rawKey = this.sodium.from_base64(masterKey, this.sodium.base64_variants.URLSAFE);
                } catch (e4) {
                  throw new CryptoError(CryptoErrorCode.INVALID_KEY_SIZE, "Failed to parse MasterKey Base64: " + e4.message, { op });
                }
              }
            }
          }
        }
      } else if (masterKey instanceof Uint8Array) {
        rawKey = new Uint8Array(masterKey);
      } else {
        throw new CryptoError(CryptoErrorCode.PARAM_ERROR, "MasterKey must be a 32-byte Uint8Array or Hex/Base64 string", { op });
      }

      if (rawKey.length !== 32) {
        throw new CryptoError(CryptoErrorCode.INVALID_KEY_SIZE, `MasterKey must be exactly 32 bytes, got ${rawKey.length}`, { op });
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
      CryptoLogger.debug(op, "Engine successfully initialized with 4 derived subkeys");
      return this;
    }

    _ensureInit(op) {
      if (!this.initialized || !this.keys.masterKey) {
        throw new CryptoError(CryptoErrorCode.UNINITIALIZED, "EQTCryptoEngine is not initialized. Call init(masterKey) first.", { op });
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
     * Constructs AAD for WebSocket / Chat packet: uint64_be(seq) || int64_be(timestamp) = 16 bytes
     */
    _makePacketAAD(seq, timestamp = 0) {
      const aad = new Uint8Array(16);
      const view = new DataView(aad.buffer, aad.byteOffset, aad.byteLength);
      view.setBigUint64(0, BigInt(seq), false);
      view.setBigInt64(8, BigInt(timestamp), false);
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
      const op = 'encryptChunk';
      this._ensureInit(op);
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
      const op = 'decryptChunk';
      this._ensureInit(op);
      if (envelopeBytes.length < 4 + 24 + 16) {
        throw new CryptoError(CryptoErrorCode.CIPHERTEXT_TOO_SHORT, `Envelope too short: ${envelopeBytes.length} bytes (minimum 44 bytes required)`, { op, chunkIndex, fileID });
      }

      const view = new DataView(envelopeBytes.buffer, envelopeBytes.byteOffset, envelopeBytes.byteLength);
      const envIndex = view.getUint32(0, false);
      if (envIndex !== chunkIndex) {
        throw new CryptoError(CryptoErrorCode.CHUNK_INDEX_MISMATCH, `Chunk index mismatch: expected ${chunkIndex}, found ${envIndex}`, { op, chunkIndex, fileID });
      }

      const nonce = envelopeBytes.subarray(4, 28);
      const ciphertextWithTag = envelopeBytes.subarray(28);
      const key = keyType === 'recv' ? this.keys.kRecv : (this.keys.sendKey || this.keys.kSend);
      const aad = this._makeChunkAAD(fileID, chunkIndex);

      try {
        return this.sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
          null,
          ciphertextWithTag,
          aad,
          nonce,
          key
        );
      } catch (err) {
        throw new CryptoError(CryptoErrorCode.AUTH_FAILED, "AEAD verification failed: chunk ciphertext/tag corrupted or wrong key", { op, chunkIndex, fileID });
      }
    }

    /**
     * Encrypts a small attachment (<= 20MB) as a single envelope without 4MB chunk index headers.
     * Output format: [Nonce(24B) | Ciphertext + Tag(16B)]
     */
    encryptAttachment(fileBytes, fileID, keyType = 'send') {
      const op = 'encryptAttachment';
      this._ensureInit(op);
      const key = keyType === 'send' ? this.keys.kSend : this.keys.kRecv;
      const nonce = this.sodium.randombytes_buf(24);
      const aad = this.sodium.from_string(fileID);

      const ciphertextWithTag = this.sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
        fileBytes,
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
     * Decrypts a small attachment (<= 20MB) envelope.
     * Expects format: [Nonce(24B) | Ciphertext + Tag(16B)]
     */
    decryptAttachment(envelopeBytes, fileID, keyType = 'recv') {
      const op = 'decryptAttachment';
      this._ensureInit(op);
      if (envelopeBytes.length < 24 + 16) {
        throw new CryptoError(CryptoErrorCode.CIPHERTEXT_TOO_SHORT, `Attachment envelope too short: ${envelopeBytes.length} bytes`, { op, fileID });
      }

      const nonce = envelopeBytes.subarray(0, 24);
      const ciphertextWithTag = envelopeBytes.subarray(24);
      const key = keyType === 'recv' ? this.keys.kRecv : this.keys.kSend;
      const aad = this.sodium.from_string(fileID);

      try {
        return this.sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
          null,
          ciphertextWithTag,
          aad,
          nonce,
          key
        );
      } catch (err) {
        throw new CryptoError(CryptoErrorCode.AUTH_FAILED, "Attachment AEAD verification failed: corrupted payload or wrong fileID", { op, fileID });
      }
    }

    /**
     * Encrypts a JSON object or string into a standardized E2EEEnvelope JSON object.
     * Matches Go's protocol.E2EEEnvelope shape.
     */
    encryptE2EEEnvelope(payload, seq, timestamp = Date.now()) {
      const op = 'encryptE2EEEnvelope';
      this._ensureInit(op);
      let payloadBytes;
      if (typeof payload === 'string') {
        payloadBytes = this.sodium.from_string(payload);
      } else if (payload instanceof Uint8Array) {
        payloadBytes = payload;
      } else {
        payloadBytes = this.sodium.from_string(JSON.stringify(payload));
      }

      const nonce = this.sodium.randombytes_buf(24);
      const aad = this._makePacketAAD(seq, timestamp);

      const ciphertextWithTag = this.sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
        payloadBytes,
        aad,
        null,
        nonce,
        this.keys.kWS
      );

      return {
        type: 'e2ee_envelope',
        version: 1,
        seq: Number(seq),
        timestamp: Number(timestamp),
        nonce: this.sodium.to_base64(nonce, this.sodium.base64_variants.ORIGINAL),
        ciphertext: this.sodium.to_base64(ciphertextWithTag, this.sodium.base64_variants.ORIGINAL)
      };
    }

    /**
     * Decrypts an E2EEEnvelope JSON object into plaintext Uint8Array bytes.
     */
    decryptE2EEEnvelope(env) {
      const op = 'decryptE2EEEnvelope';
      this._ensureInit(op);
      if (!env || env.type !== 'e2ee_envelope') {
        throw new CryptoError(CryptoErrorCode.PARAM_ERROR, "Invalid envelope format", { op });
      }

      const nonce = this.sodium.from_base64(env.nonce, this.sodium.base64_variants.ORIGINAL);
      const ciphertextWithTag = this.sodium.from_base64(env.ciphertext, this.sodium.base64_variants.ORIGINAL);
      const aad = this._makePacketAAD(env.seq, env.timestamp);

      try {
        return this.sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
          null,
          ciphertextWithTag,
          aad,
          nonce,
          this.keys.kWS
        );
      } catch (err) {
        throw new CryptoError(CryptoErrorCode.AUTH_FAILED, "WebSocket frame AEAD verification failed: tampered payload or sequence mismatch", { op, seq: env.seq });
      }
    }

    /**
     * Encrypts a message or packet (e.g. Chat WebSocket / Clipboard).
     * Output format: [Nonce(24B) | Ciphertext + Tag(16B)]
     */
    encryptPacket(plaintextBytes, seq = 0, customKey = null) {
      const op = 'encryptPacket';
      this._ensureInit(op);
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
      const op = 'decryptPacket';
      this._ensureInit(op);
      if (envelopeBytes.length < 24 + 16) {
        throw new CryptoError(CryptoErrorCode.CIPHERTEXT_TOO_SHORT, `Packet envelope too short: ${envelopeBytes.length} bytes`, { op, seq });
      }

      const key = customKey || this.keys.kWS;
      const nonce = envelopeBytes.subarray(0, 24);
      const ciphertextWithTag = envelopeBytes.subarray(24);
      const aad = this._makeSeqAAD(seq);

      try {
        return this.sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
          null,
          ciphertextWithTag,
          aad,
          nonce,
          key
        );
      } catch (err) {
        throw new CryptoError(CryptoErrorCode.AUTH_FAILED, "Packet AEAD verification failed: corrupted payload or sequence mismatch", { op, seq });
      }
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
      CryptoLogger.debug('wipe', "All cryptographic keys zeroized from memory");
    }
  }

  // Export to global scope & CommonJS
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { EQTCryptoEngine, CryptoError, CryptoErrorCode, CryptoLogger };
  }
  global.EQTCryptoEngine = EQTCryptoEngine;
  global.CryptoError = CryptoError;
  global.CryptoErrorCode = CryptoErrorCode;
  global.CryptoLogger = CryptoLogger;
})(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : globalThis));
