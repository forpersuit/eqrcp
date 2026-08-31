/**
 * EQT E2EE Cryptographic Engine (RFC 8439 XChaCha20-Poly1305 + RFC 5869 HKDF-SHA256)
 * Pure, self-contained, zero-dependency browser implementation supporting Insecure Contexts (LAN HTTP).
 * Complies with EQT E2EE Architecture Specification v2 (20260901).
 */
(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.EQTCrypto = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // ==========================================
    // Constants & Domain Labels
    // ==========================================
    var KEY_SIZE = 32;          // 256-bit key
    var NONCE_SIZE = 24;        // 192-bit XChaCha20 nonce
    var TAG_SIZE = 16;          // 128-bit Poly1305 tag
    var CHUNK_HEADER_SIZE = 28; // 4B ChunkIndex + 24B Nonce

    var HKDF_INFO_SEND = "eqt-e2ee-v2-send";
    var HKDF_INFO_RECV = "eqt-e2ee-v2-recv";
    var HKDF_INFO_WS   = "eqt-e2ee-v2-ws";
    var HKDF_INFO_AUTH = "eqt-e2ee-v2-auth";

    // ==========================================
    // Memory Security & Utilities
    // ==========================================
    function wipe(buf) {
        if (!buf) return;
        if (buf.fill) {
            buf.fill(0);
        } else {
            for (var i = 0; i < buf.length; i++) {
                buf[i] = 0;
            }
        }
    }

    function randomBytes(length) {
        var buf = new Uint8Array(length);
        if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
            crypto.getRandomValues(buf);
        } else if (typeof msCrypto !== 'undefined' && msCrypto.getRandomValues) {
            msCrypto.getRandomValues(buf);
        } else {
            for (var i = 0; i < length; i++) {
                buf[i] = Math.floor(Math.random() * 256);
            }
        }
        return buf;
    }

    function hexToBytes(hex) {
        if (typeof hex !== 'string') return hex;
        var cleanHex = hex.replace(/[^0-9a-fA-F]/g, '');
        var len = cleanHex.length / 2;
        var bytes = new Uint8Array(len);
        for (var i = 0; i < len; i++) {
            bytes[i] = parseInt(cleanHex.substr(i * 2, 2), 16);
        }
        return bytes;
    }

    function bytesToHex(bytes) {
        var hex = [];
        for (var i = 0; i < bytes.length; i++) {
            var b = bytes[i].toString(16);
            if (b.length < 2) b = '0' + b;
            hex.push(b);
        }
        return hex.join('');
    }

    function stringToBytes(str) {
        if (typeof TextEncoder !== 'undefined') {
            return new TextEncoder().encode(str);
        }
        var utf8 = [];
        for (var i = 0; i < str.length; i++) {
            var charcode = str.charCodeAt(i);
            if (charcode < 0x80) utf8.push(charcode);
            else if (charcode < 0x800) {
                utf8.push(0xc0 | (charcode >> 6), 0x80 | (charcode & 0x3f));
            } else if (charcode < 0xd800 || charcode >= 0xe000) {
                utf8.push(0xe0 | (charcode >> 12), 0x80 | ((charcode >> 6) & 0x3f), 0x80 | (charcode & 0x3f));
            } else {
                i++;
                charcode = 0x10000 + (((charcode & 0x3ff) << 10) | (str.charCodeAt(i) & 0x3ff));
                utf8.push(0xf0 | (charcode >> 18), 0x80 | ((charcode >> 12) & 0x3f), 0x80 | ((charcode >> 6) & 0x3f), 0x80 | (charcode & 0x3f));
            }
        }
        return new Uint8Array(utf8);
    }

    function bytesToString(bytes) {
        if (typeof TextDecoder !== 'undefined') {
            return new TextDecoder().decode(bytes);
        }
        var str = '';
        for (var i = 0; i < bytes.length; i++) {
            str += String.fromCharCode(bytes[i]);
        }
        return decodeURIComponent(escape(str));
    }

    // ==========================================
    // SHA-256 & HMAC-SHA256 (RFC 2104 / FIPS 180-4)
    // ==========================================
    var K = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
        0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
        0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
        0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
        0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
    ];

    function rotr(n, x) {
        return (x >>> n) | (x << (32 - n));
    }

    function sha256(message) {
        var bytes = typeof message === 'string' ? stringToBytes(message) : message;
        var len = bytes.length;
        var bitLen = len * 8;

        var numBlocks = ((len + 8) >> 6) + 1;
        var totalLen = numBlocks << 6;
        var padded = new Uint8Array(totalLen);
        padded.set(bytes);
        padded[len] = 0x80;

        var view = new DataView(padded.buffer);
        view.setUint32(totalLen - 4, bitLen >>> 0, false);
        view.setUint32(totalLen - 8, Math.floor(bitLen / 0x100000000), false);

        var H = [
            0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
            0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
        ];

        var W = new Int32Array(64);

        for (var i = 0; i < totalLen; i += 64) {
            for (var t = 0; t < 16; t++) {
                W[t] = view.getInt32(i + (t * 4), false);
            }
            for (var t = 16; t < 64; t++) {
                var s0 = rotr(7, W[t - 15]) ^ rotr(18, W[t - 15]) ^ (W[t - 15] >>> 3);
                var s1 = rotr(17, W[t - 2]) ^ rotr(19, W[t - 2]) ^ (W[t - 2] >>> 10);
                W[t] = (W[t - 16] + s0 + W[t - 7] + s1) | 0;
            }

            var a = H[0], b = H[1], c = H[2], d = H[3],
                e = H[4], f = H[5], g = H[6], h = H[7];

            for (var t = 0; t < 64; t++) {
                var S1 = rotr(6, e) ^ rotr(11, e) ^ rotr(25, e);
                var ch = (e & f) ^ ((~e) & g);
                var temp1 = (h + S1 + ch + K[t] + W[t]) | 0;
                var S0 = rotr(2, a) ^ rotr(13, a) ^ rotr(22, a);
                var maj = (a & b) ^ (a & c) ^ (b & c);
                var temp2 = (S0 + maj) | 0;

                h = g;
                g = f;
                f = e;
                e = (d + temp1) | 0;
                d = c;
                c = b;
                b = a;
                a = (temp1 + temp2) | 0;
            }

            H[0] = (H[0] + a) | 0;
            H[1] = (H[1] + b) | 0;
            H[2] = (H[2] + c) | 0;
            H[3] = (H[3] + d) | 0;
            H[4] = (H[4] + e) | 0;
            H[5] = (H[5] + f) | 0;
            H[6] = (H[6] + g) | 0;
            H[7] = (H[7] + h) | 0;
        }

        var result = new Uint8Array(32);
        var resView = new DataView(result.buffer);
        for (var j = 0; j < 8; j++) {
            resView.setInt32(j * 4, H[j], false);
        }
        return result;
    }

    function hmacSha256(key, message) {
        var k = typeof key === 'string' ? stringToBytes(key) : key;
        var m = typeof message === 'string' ? stringToBytes(message) : message;

        var blockKey = new Uint8Array(64);
        if (k.length > 64) {
            var kh = sha256(k);
            blockKey.set(kh);
        } else {
            blockKey.set(k);
        }

        var oKeyPad = new Uint8Array(64);
        var iKeyPad = new Uint8Array(64);
        for (var i = 0; i < 64; i++) {
            oKeyPad[i] = blockKey[i] ^ 0x5c;
            iKeyPad[i] = blockKey[i] ^ 0x36;
        }

        var inner = new Uint8Array(64 + m.length);
        inner.set(iKeyPad);
        inner.set(m, 64);
        var innerHash = sha256(inner);

        var outer = new Uint8Array(64 + 32);
        outer.set(oKeyPad);
        outer.set(innerHash, 64);
        return sha256(outer);
    }

    // ==========================================
    // HKDF-SHA256 (RFC 5869)
    // ==========================================
    function hkdfExtract(salt, ikm) {
        var s = salt;
        if (!s || s.length === 0) {
            s = new Uint8Array(32); // 32 zeros
        }
        return hmacSha256(s, ikm);
    }

    function hkdfExpand(prk, info, length) {
        var infoBytes = typeof info === 'string' ? stringToBytes(info) : (info || new Uint8Array(0));
        var n = Math.ceil(length / 32);
        var okm = new Uint8Array(n * 32);
        var prev = new Uint8Array(0);

        for (var i = 1; i <= n; i++) {
            var curr = new Uint8Array(prev.length + infoBytes.length + 1);
            curr.set(prev);
            curr.set(infoBytes, prev.length);
            curr[curr.length - 1] = i;

            prev = hmacSha256(prk, curr);
            okm.set(prev, (i - 1) * 32);
        }

        return okm.slice(0, length);
    }

    function deriveKeys(masterKeyInput) {
        var masterKey = typeof masterKeyInput === 'string' ? hexToBytes(masterKeyInput) : masterKeyInput;
        if (!masterKey || masterKey.length !== KEY_SIZE) {
            throw new Error("Invalid MasterKey size: expected 32 bytes");
        }

        var prk = hkdfExtract(null, masterKey);

        var kSend = hkdfExpand(prk, HKDF_INFO_SEND, 32);
        var kRecv = hkdfExpand(prk, HKDF_INFO_RECV, 32);
        var kWS   = hkdfExpand(prk, HKDF_INFO_WS,   32);
        var kAuth = hkdfExpand(prk, HKDF_INFO_AUTH, 32);

        return {
            masterKey: masterKey,
            kSend: kSend,
            kRecv: kRecv,
            kWS: kWS,
            kAuth: kAuth,
            wipe: function () {
                wipe(masterKey);
                wipe(kSend);
                wipe(kRecv);
                wipe(kWS);
                wipe(kAuth);
                wipe(prk);
            }
        };
    }

    // ==========================================
    // ChaCha20, HChaCha20 & Poly1305 (RFC 8439)
    // ==========================================
    function rotl(n, x) {
        return (x << n) | (x >>> (32 - n));
    }

    function quarterRound(x, a, b, c, d) {
        x[a] = (x[a] + x[b]) | 0; x[d] = rotl(16, x[d] ^ x[a]);
        x[c] = (x[c] + x[d]) | 0; x[b] = rotl(12, x[b] ^ x[c]);
        x[a] = (x[a] + x[b]) | 0; x[d] = rotl(8,  x[d] ^ x[a]);
        x[c] = (x[c] + x[d]) | 0; x[b] = rotl(7,  x[b] ^ x[c]);
    }

    function hchacha20(key, nonce16) {
        var state = new Int32Array(16);
        state[0] = 0x61707865; state[1] = 0x3320646e; state[2] = 0x79622d32; state[3] = 0x6b206574;

        var keyView = new DataView(key.buffer, key.byteOffset, key.byteLength);
        for (var i = 0; i < 8; i++) {
            state[4 + i] = keyView.getInt32(i * 4, true);
        }

        var nonceView = new DataView(nonce16.buffer, nonce16.byteOffset, nonce16.byteLength);
        for (var j = 0; j < 4; j++) {
            state[12 + j] = nonceView.getInt32(j * 4, true);
        }

        for (var r = 0; r < 10; r++) {
            quarterRound(state, 0, 4, 8, 12);
            quarterRound(state, 1, 5, 9, 13);
            quarterRound(state, 2, 6, 10, 14);
            quarterRound(state, 3, 7, 11, 15);
            quarterRound(state, 0, 5, 10, 15);
            quarterRound(state, 1, 6, 11, 12);
            quarterRound(state, 2, 7, 8, 13);
            quarterRound(state, 3, 4, 9, 14);
        }

        var subkey = new Uint8Array(32);
        var subkeyView = new DataView(subkey.buffer);
        for (var k = 0; k < 4; k++) {
            subkeyView.setInt32(k * 4, state[k], true);
            subkeyView.setInt32((k + 4) * 4, state[k + 12], true);
        }
        return subkey;
    }

    function chacha20Process(key, nonce, counter, input) {
        var output = new Uint8Array(input.length);
        var state = new Int32Array(16);
        var block = new Int32Array(16);
        var blockBytes = new Uint8Array(block.buffer);

        var keyView = new DataView(key.buffer, key.byteOffset, key.byteLength);
        var nonceView = new DataView(nonce.buffer, nonce.byteOffset, nonce.byteLength);

        // Constant header
        state[0] = 0x61707865; state[1] = 0x3320646e; state[2] = 0x79622d32; state[3] = 0x6b206574;
        for (var i = 0; i < 8; i++) {
            state[4 + i] = keyView.getInt32(i * 4, true);
        }

        var inLen = input.length;
        var outOffset = 0;
        var inOffset = 0;
        var currentCounter = counter;

        while (inLen > 0) {
            state[12] = currentCounter | 0;
            state[13] = nonceView.getInt32(0, true);
            state[14] = nonceView.getInt32(4, true);
            state[15] = nonceView.getInt32(8, true);

            for (var j = 0; j < 16; j++) block[j] = state[j];

            for (var r = 0; r < 10; r++) {
                quarterRound(block, 0, 4, 8, 12);
                quarterRound(block, 1, 5, 9, 13);
                quarterRound(block, 2, 6, 10, 14);
                quarterRound(block, 3, 7, 11, 15);
                quarterRound(block, 0, 5, 10, 15);
                quarterRound(block, 1, 6, 11, 12);
                quarterRound(block, 2, 7, 8, 13);
                quarterRound(block, 3, 4, 9, 14);
            }

            for (var k = 0; k < 16; k++) {
                block[k] = (block[k] + state[k]) | 0;
            }

            var chunkLen = Math.min(64, inLen);
            for (var b = 0; b < chunkLen; b++) {
                output[outOffset + b] = input[inOffset + b] ^ blockBytes[b];
            }

            inLen -= chunkLen;
            outOffset += chunkLen;
            inOffset += chunkLen;
            currentCounter++;
        }

        return output;
    }

    // Poly1305 (RFC 8439) with Exact BigInt Precision
    function poly1305(key, msg) {
        var r0 = 0n;
        for (var i = 0; i < 16; i++) {
            r0 |= BigInt(key[i]) << (BigInt(i) * 8n);
        }
        var clampMask = 0x0ffffffc0ffffffc0ffffffc0fffffffn;
        var r = r0 & clampMask;

        var s = 0n;
        for (var i = 0; i < 16; i++) {
            s |= BigInt(key[16 + i]) << (BigInt(i) * 8n);
        }

        var P = (1n << 130n) - 5n;
        var a = 0n;

        for (var i = 0; i < msg.length; i += 16) {
            var blockLen = Math.min(16, msg.length - i);
            var n = 0n;
            for (var j = 0; j < blockLen; j++) {
                n |= BigInt(msg[i + j]) << (BigInt(j) * 8n);
            }
            n |= 1n << (BigInt(blockLen) * 8n);

            a = ((a + n) * r) % P;
        }

        a = (a + s) % (1n << 128n);

        var tag = new Uint8Array(16);
        for (var i = 0; i < 16; i++) {
            tag[i] = Number((a >> (BigInt(i) * 8n)) & 0xffn);
        }
        return tag;
    }

    // ==========================================
    // XChaCha20-Poly1305 AEAD Implementation
    // ==========================================
    function xchacha20poly1305Encrypt(plaintext, key, nonce24, aad) {
        if (key.length !== KEY_SIZE) throw new Error("Invalid key size");
        if (nonce24.length !== NONCE_SIZE) throw new Error("Invalid nonce size (expected 24 bytes)");

        // 1. Derive subkey using HChaCha20 over first 16 bytes of nonce
        var nonce16 = nonce24.slice(0, 16);
        var subkey = hchacha20(key, nonce16);

        // 2. ChaCha20 nonce: 4 zero bytes + last 8 bytes of nonce24
        var chachaNonce = new Uint8Array(12);
        chachaNonce.set(nonce24.slice(16, 24), 4);

        // 3. Generate Poly1305 one-time key by encrypting 32 zero bytes at counter 0
        var zeros32 = new Uint8Array(32);
        var polyKey = chacha20Process(subkey, chachaNonce, 0, zeros32);

        // 4. Encrypt plaintext at counter 1
        var ciphertext = chacha20Process(subkey, chachaNonce, 1, plaintext);

        // 5. Build Poly1305 data block: pad16(aad) || pad16(ciphertext) || len(aad)(8B) || len(ciphertext)(8B)
        var aadLen = aad ? aad.length : 0;
        var ctLen = ciphertext.length;
        var padAad = (16 - (aadLen % 16)) % 16;
        if (padAad === 16) padAad = 0;
        var padCt = (16 - (ctLen % 16)) % 16;
        if (padCt === 16) padCt = 0;

        var macData = new Uint8Array(aadLen + padAad + ctLen + padCt + 16);
        if (aadLen > 0) {
            macData.set(aad, 0);
        }
        macData.set(ciphertext, aadLen + padAad);

        var view = new DataView(macData.buffer);
        view.setBigUint64(macData.length - 16, BigInt(aadLen), true);
        view.setBigUint64(macData.length - 8, BigInt(ctLen), true);

        // 6. Compute Poly1305 Tag
        var tag = poly1305(polyKey, macData);

        wipe(subkey);
        wipe(polyKey);

        return {
            ciphertext: ciphertext,
            tag: tag
        };
    }

    function xchacha20poly1305Decrypt(ciphertext, tag, key, nonce24, aad) {
        if (key.length !== KEY_SIZE) throw new Error("Invalid key size");
        if (nonce24.length !== NONCE_SIZE) throw new Error("Invalid nonce size");
        if (tag.length !== TAG_SIZE) throw new Error("Invalid tag size");

        // 1. Derive subkey
        var nonce16 = nonce24.slice(0, 16);
        var subkey = hchacha20(key, nonce16);

        // 2. ChaCha20 nonce
        var chachaNonce = new Uint8Array(12);
        chachaNonce.set(nonce24.slice(16, 24), 4);

        // 3. Poly1305 Key
        var zeros32 = new Uint8Array(32);
        var polyKey = chacha20Process(subkey, chachaNonce, 0, zeros32);

        // 4. Verify Tag
        var aadLen = aad ? aad.length : 0;
        var ctLen = ciphertext.length;
        var padAad = (16 - (aadLen % 16)) % 16;
        if (padAad === 16) padAad = 0;
        var padCt = (16 - (ctLen % 16)) % 16;
        if (padCt === 16) padCt = 0;

        var macData = new Uint8Array(aadLen + padAad + ctLen + padCt + 16);
        if (aadLen > 0) {
            macData.set(aad, 0);
        }
        macData.set(ciphertext, aadLen + padAad);

        var view = new DataView(macData.buffer);
        view.setBigUint64(macData.length - 16, BigInt(aadLen), true);
        view.setBigUint64(macData.length - 8, BigInt(ctLen), true);

        var expectedTag = poly1305(polyKey, macData);

        // Constant-time compare
        var diff = 0;
        for (var i = 0; i < 16; i++) {
            diff |= tag[i] ^ expectedTag[i];
        }

        if (diff !== 0) {
            wipe(subkey);
            wipe(polyKey);
            throw new Error("Authentication tag verification failed (tampered or wrong key/AAD)");
        }

        // 5. Decrypt
        var plaintext = chacha20Process(subkey, chachaNonce, 1, ciphertext);

        wipe(subkey);
        wipe(polyKey);

        return plaintext;
    }

    // ==========================================
    // High-Level Envelope & Protocol Builders
    // ==========================================
    function buildChunkAAD(fileID, chunkIndex) {
        var idBytes = stringToBytes(fileID || "");
        var aad = new Uint8Array(idBytes.length + 4);
        aad.set(idBytes, 0);
        var view = new DataView(aad.buffer);
        view.setUint32(idBytes.length, chunkIndex, false); // Big-Endian
        return aad;
    }

    // Encrypt 4MB chunk: [ChunkIndex(4B) | Nonce(24B) | Ciphertext | Tag(16B)]
    function encryptChunk(plaintext, chunkIndex, key, fileID) {
        var nonce = randomBytes(NONCE_SIZE);
        var aad = buildChunkAAD(fileID, chunkIndex);
        var enc = xchacha20poly1305Encrypt(plaintext, key, nonce, aad);

        var envelope = new Uint8Array(CHUNK_HEADER_SIZE + enc.ciphertext.length + TAG_SIZE);
        var view = new DataView(envelope.buffer);
        view.setUint32(0, chunkIndex, false);
        envelope.set(nonce, 4);
        envelope.set(enc.ciphertext, CHUNK_HEADER_SIZE);
        envelope.set(enc.tag, CHUNK_HEADER_SIZE + enc.ciphertext.length);

        return envelope;
    }

    // Decrypt 4MB chunk: [ChunkIndex(4B) | Nonce(24B) | Ciphertext | Tag(16B)]
    function decryptChunk(envelope, expectedChunkIndex, key, fileID) {
        if (envelope.length < CHUNK_HEADER_SIZE + TAG_SIZE) {
            throw new Error("Ciphertext too short");
        }
        var view = new DataView(envelope.buffer, envelope.byteOffset, envelope.byteLength);
        var actualChunkIndex = view.getUint32(0, false);
        if (actualChunkIndex !== expectedChunkIndex) {
            throw new Error("ChunkIndex mismatch: expected " + expectedChunkIndex + ", got " + actualChunkIndex);
        }

        var nonce = envelope.slice(4, CHUNK_HEADER_SIZE);
        var ciphertext = envelope.slice(CHUNK_HEADER_SIZE, envelope.length - TAG_SIZE);
        var tag = envelope.slice(envelope.length - TAG_SIZE);
        var aad = buildChunkAAD(fileID, expectedChunkIndex);

        return xchacha20poly1305Decrypt(ciphertext, tag, key, nonce, aad);
    }

    // Encrypt single packet: [Nonce(24B) | Ciphertext | Tag(16B)]
    function encryptPacket(plaintext, key, aad) {
        var nonce = randomBytes(NONCE_SIZE);
        var pBytes = typeof plaintext === 'string' ? stringToBytes(plaintext) : plaintext;
        var aadBytes = aad ? (typeof aad === 'string' ? stringToBytes(aad) : aad) : null;
        var enc = xchacha20poly1305Encrypt(pBytes, key, nonce, aadBytes);

        var envelope = new Uint8Array(NONCE_SIZE + enc.ciphertext.length + TAG_SIZE);
        envelope.set(nonce, 0);
        envelope.set(enc.ciphertext, NONCE_SIZE);
        envelope.set(enc.tag, NONCE_SIZE + enc.ciphertext.length);
        return envelope;
    }

    // Decrypt single packet: [Nonce(24B) | Ciphertext | Tag(16B)]
    function decryptPacket(envelope, key, aad) {
        if (envelope.length < NONCE_SIZE + TAG_SIZE) {
            throw new Error("Packet envelope too short");
        }
        var nonce = envelope.slice(0, NONCE_SIZE);
        var ciphertext = envelope.slice(NONCE_SIZE, envelope.length - TAG_SIZE);
        var tag = envelope.slice(envelope.length - TAG_SIZE);
        var aadBytes = aad ? (typeof aad === 'string' ? stringToBytes(aad) : aad) : null;

        return xchacha20poly1305Decrypt(ciphertext, tag, key, nonce, aadBytes);
    }

    // Public API
    return {
        KEY_SIZE: KEY_SIZE,
        NONCE_SIZE: NONCE_SIZE,
        TAG_SIZE: TAG_SIZE,
        CHUNK_HEADER_SIZE: CHUNK_HEADER_SIZE,
        wipe: wipe,
        randomBytes: randomBytes,
        hexToBytes: hexToBytes,
        bytesToHex: bytesToHex,
        stringToBytes: stringToBytes,
        bytesToString: bytesToString,
        sha256: sha256,
        hmacSha256: hmacSha256,
        hkdfExtract: hkdfExtract,
        hkdfExpand: hkdfExpand,
        deriveKeys: deriveKeys,
        encryptChunk: encryptChunk,
        decryptChunk: decryptChunk,
        encryptPacket: encryptPacket,
        decryptPacket: decryptPacket,
        buildChunkAAD: buildChunkAAD
    };
}));
