/**
 * Offline unit tests for cert.ts (LAN-TLS Certificate Provisioning)
 *
 * Tests:
 *   1. Method guard (405 for non-POST)
 *   2. Missing parameters (400)
 *   3. Invalid node_id (400)
 *   4. Timestamp skew (400)
 *   5. Blacklisted device (403)
 *   6. Rate limit exceeded (429)
 *   7. Invalid CSR PEM (400)
 *   8. CommonName mismatch (400)
 *   9. SAN mismatch (400)
 *  10. Successful issuance (200 OK) + X.509 structure + D1 audit record
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const compiledPath = path.join(__dirname, 'compiled', 'cert.js');

if (!fs.existsSync(compiledPath)) {
  console.error("Compiled cert module not found. Run esbuild first.");
  process.exit(1);
}

const { handleCertRoutes, parseCSR, parseCertificateExpiry, setDns01Challenge, generateCompliantSerialNumber, issueCertificateFromCSR, confirmDnsPropagation, certProvisionSingleFlight } = require(compiledPath);

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

// ── Mock D1 Helpers ──────────────────────────────────────────

function makeMockDb(opts = {}) {
  const provisions = [];
  const rateLimits = new Map();
  const blacklists = opts.blacklists || [];
  const nodeKeys = new Map();
  const circuitBreakers = new Map();
  const tokenBuckets = new Map();

  return {
    _provisions: provisions,
    _rateLimits: rateLimits,
    _nodeKeys: nodeKeys,
    _circuitBreakers: circuitBreakers,
    _tokenBuckets: tokenBuckets,
    prepare(sql) {
      const stmt = {
        _sql: sql,
        _binds: [],
        bind(...args) {
          this._binds = args;
          return this;
        },
        async first() {
          if (sql.includes('FROM manual_blacklist')) {
            const devId = this._binds[0];
            const hit = blacklists.find(b => b.device_id === devId && b.active !== 0);
            return hit || null;
          }
          if (sql.includes('UPDATE rate_limits') && sql.includes('RETURNING')) {
            const key = this._binds[0];
            const maxAttempts = this._binds[1];
            const nowIso = this._binds[2];
            const windowMs = this._binds[3];
            const existing = rateLimits.get(key);
            if (existing && existing.count < maxAttempts) {
              const elapsed = Date.now() - new Date(existing.window_start).getTime();
              if (elapsed <= windowMs) {
                existing.count += 1;
                return { count: existing.count, window_start: existing.window_start };
              }
            }
            return null;
          }
          if (sql.includes('INSERT INTO rate_limits') && sql.includes('RETURNING')) {
            const key = this._binds[0];
            const nowIso = this._binds[1];
            const windowMs = this._binds[4];
            const existing = rateLimits.get(key);
            if (!existing) {
              rateLimits.set(key, { count: 1, window_start: nowIso });
              return { count: 1, window_start: nowIso };
            }
            const elapsed = Date.now() - new Date(existing.window_start).getTime();
            if (elapsed > windowMs) {
              rateLimits.set(key, { count: 1, window_start: nowIso });
              return { count: 1, window_start: nowIso };
            }
            return null;
          }
          if (sql.includes('UPDATE token_buckets') && sql.includes('RETURNING')) {
            const key = this._binds[2];
            const tb = tokenBuckets.get(key);
            if (tb && tb.tokens >= 1.0) {
              tb.tokens -= 1.0;
              return { tokens: tb.tokens };
            }
            return null;
          }
          if (sql.includes('FROM rate_limits')) {
            const key = this._binds[0];
            const val = rateLimits.get(key);
            return val ? { ...val } : null;
          }
          if (sql.includes('FROM node_public_keys')) {
            const nodeId = this._binds[0];
            return nodeKeys.get(nodeId) || null;
          }
          if (sql.includes('FROM circuit_breakers')) {
            const name = this._binds[0];
            return circuitBreakers.get(name) || null;
          }
          if (sql.includes('FROM token_buckets')) {
            const key = this._binds[0];
            return tokenBuckets.get(key) || null;
          }
          return null;
        },
        async all() {
          return { results: [] };
        },
        async run() {
          if (sql.includes('INSERT INTO device_cert_provisions')) {
            provisions.push({
              node_id: this._binds[0],
              device_id: this._binds[1],
              common_name: this._binds[2],
              expires_at: this._binds[3],
              provisioned_at: this._binds[4],
              client_ip: this._binds[5],
              trace_id: this._binds[6]
            });
            return { meta: { changes: 1 } };
          }
          if (sql.includes('INSERT INTO node_public_keys')) {
            const nodeId = this._binds[0];
            const pubKeyHash = this._binds[1];
            const deviceId = this._binds[2];
            nodeKeys.set(nodeId, {
              node_id: nodeId,
              public_key_sha256: pubKeyHash,
              device_id: deviceId
            });
            return { meta: { changes: 1 } };
          }
          if (sql.includes('UPDATE node_public_keys')) {
            if (sql.includes('SET public_key_sha256 =')) {
              const pubKey = this._binds[0];
              if (this._binds.length >= 4) {
                const newDeviceId = this._binds[1];
                const lastSeen = this._binds[2];
                const nodeId = this._binds[3];
                const existing = nodeKeys.get(nodeId);
                if (existing) {
                  existing.public_key_sha256 = pubKey;
                  if (newDeviceId && !existing.device_id) {
                    existing.device_id = newDeviceId;
                  }
                  existing.last_seen_at = lastSeen;
                }
              } else {
                const lastSeen = this._binds[1];
                const nodeId = this._binds[2];
                const existing = nodeKeys.get(nodeId);
                if (existing) {
                  existing.public_key_sha256 = pubKey;
                  existing.last_seen_at = lastSeen;
                }
              }
            } else {
              const lastSeen = this._binds[0];
              const nodeId = this._binds[1];
              const existing = nodeKeys.get(nodeId);
              if (existing) {
                existing.last_seen_at = lastSeen;
              }
            }
            return { meta: { changes: 1 } };
          }
          if (sql.includes('INSERT OR REPLACE INTO rate_limits')) {
            const key = this._binds[0];
            const nowIso = this._binds[1];
            rateLimits.set(key, { count: 1, window_start: nowIso });
            return { meta: { changes: 1 } };
          }
          if (sql.includes('UPDATE rate_limits SET count = count + 1')) {
            const key = this._binds[0];
            const existing = rateLimits.get(key);
            if (existing) {
              existing.count += 1;
            }
            return { meta: { changes: 1 } };
          }
          if (sql.includes('UPDATE rate_limits SET count = MAX(0, count - 1)')) {
            const key = this._binds[0];
            const windowStart = this._binds[1];
            const existing = rateLimits.get(key);
            if (existing) {
              if (!windowStart || existing.window_start === windowStart) {
                existing.count = Math.max(0, existing.count - 1);
              }
            }
            return { meta: { changes: 1 } };
          }
          if (sql.includes('INSERT INTO circuit_breakers') || sql.includes('INSERT OR REPLACE INTO circuit_breakers')) {
            const name = this._binds[0];
            const state = this._binds[1];
            const failureCount = this._binds[2];
            let successCount = 0;
            let lastFailureTime = null;
            let cooldownUntil = null;
            let lastRetryAfter = 0;
            let updatedAt = new Date().toISOString();

            if (this._binds.length === 8) {
              lastFailureTime = this._binds[4];
              cooldownUntil = this._binds[5];
              lastRetryAfter = this._binds[6];
              updatedAt = this._binds[7];
            } else if (this._binds.length === 7) {
              successCount = this._binds[3];
              cooldownUntil = this._binds[4];
              lastRetryAfter = this._binds[5];
              updatedAt = this._binds[6];
            } else if (this._binds.length === 4) {
              updatedAt = this._binds[3];
            }

            circuitBreakers.set(name, {
              name,
              state,
              failure_count: failureCount,
              success_count: successCount,
              last_failure_time: lastFailureTime,
              cooldown_until: cooldownUntil,
              last_retry_after: lastRetryAfter,
              updated_at: updatedAt
            });
            return { meta: { changes: 1 } };
          }
          if (sql.includes('UPDATE circuit_breakers')) {
            if (sql.includes("SET state = 'HALF_OPEN'")) {
              const updatedAt = this._binds[0];
              const name = this._binds[1];
              const checkTime = this._binds[2];
              const row = circuitBreakers.get(name);
              if (row && row.state === 'OPEN') {
                const cdTime = row.cooldown_until ? new Date(row.cooldown_until).getTime() : 0;
                const nowTime = checkTime ? new Date(checkTime).getTime() : Date.now();
                if (!row.cooldown_until || nowTime >= cdTime) {
                  row.state = 'HALF_OPEN';
                  row.updated_at = updatedAt;
                  return { meta: { changes: 1 } };
                }
              }
              return { meta: { changes: 0 } };
            }
            if (sql.includes("SET state = ?") || sql.includes("SET state = 'CLOSED'")) {
              const state = this._binds[0];
              const failureCount = this._binds[1];
              const updatedAt = this._binds[2];
              const name = this._binds[3];
              const row = circuitBreakers.get(name);
              if (row) {
                row.state = state;
                row.failure_count = failureCount;
                row.success_count = (row.success_count || 0) + 1;
                row.cooldown_until = null;
                row.last_retry_after = 0;
                row.updated_at = updatedAt;
              }
              return { meta: { changes: 1 } };
            }
            return { meta: { changes: 1 } };
          }
          if (sql.includes('INSERT OR IGNORE INTO token_buckets') || sql.includes('INSERT OR REPLACE INTO token_buckets')) {
            const key = this._binds[0];
            const capacity = this._binds[1];
            const lastRefill = this._binds[2];
            const refillRate = this._binds[4];
            if (!tokenBuckets.has(key)) {
              tokenBuckets.set(key, { key, tokens: capacity, last_refill: lastRefill, capacity, refill_rate: refillRate });
            }
            return { meta: { changes: 1 } };
          }
          if (sql.includes('UPDATE token_buckets')) {
            const tokens = this._binds[0];
            const lastRefill = this._binds[1];
            const capacity = this._binds[2];
            const refillRate = this._binds[3];
            const key = this._binds[4];
            if (stmt._db) {
              stmt._db._tokenBuckets.set(key, { key, tokens, last_refill: lastRefill, capacity, refill_rate: refillRate });
            }
            return { meta: { changes: 1 } };
          }
          return { meta: { changes: 1 } };
        }
      };
      stmt._db = this;
      return stmt;
    }

  };
}

function makeMockCtx() {
  const promises = [];
  return {
    waitUntil(p) {
      promises.push(Promise.resolve(p));
    },
    async drain() {
      await Promise.all(promises);
    }
  };
}

// ── Test CSR Generator using Node.js crypto ─────────────────

function generateTestCSR(nodeID, customCN, customSANs) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', {
    namedCurve: 'P-256'
  });

  const nodeDomain = customCN || `${nodeID}.direct.eqt.net.im`;
  const sans = customSANs || [nodeDomain, `*.${nodeDomain}`];

  // Helper to encode DER TLV
  function encodeLength(len) {
    if (len < 128) return Buffer.from([len]);
    const bytes = [];
    let temp = len;
    while (temp > 0) {
      bytes.unshift(temp & 0xff);
      temp = temp >> 8;
    }
    return Buffer.from([0x80 | bytes.length, ...bytes]);
  }
  function encodeTLV(tag, val) {
    const len = encodeLength(val.length);
    return Buffer.concat([Buffer.from([tag]), len, val]);
  }

  // Version 0
  const versionDER = encodeTLV(0x02, Buffer.from([0x00]));

  // Subject Name: CN=nodeDomain, O=EQT LAN-TLS
  const cnVal = encodeTLV(0x13, Buffer.from(nodeDomain, 'utf8'));
  const cnSeq = encodeTLV(0x30, Buffer.concat([Buffer.from([0x06, 0x03, 0x55, 0x04, 0x03]), cnVal]));
  const orgVal = encodeTLV(0x13, Buffer.from('EQT LAN-TLS', 'utf8'));
  const orgSeq = encodeTLV(0x30, Buffer.concat([Buffer.from([0x06, 0x03, 0x55, 0x04, 0x0a]), orgVal]));
  const subjectDER = encodeTLV(0x30, Buffer.concat([encodeTLV(0x31, orgSeq), encodeTLV(0x31, cnSeq)]));

  // SubjectPublicKeyInfo (export SPKI from crypto)
  const spkiDer = publicKey.export({ type: 'spki', format: 'der' });

  // Attributes: ExtensionRequest with SAN
  const sanEntries = sans.map(name => encodeTLV(0x82, Buffer.from(name, 'utf8')));
  const sanSeq = encodeTLV(0x30, Buffer.concat(sanEntries));
  const sanExt = encodeTLV(0x30, Buffer.concat([
    Buffer.from([0x06, 0x03, 0x55, 0x1d, 0x11]),
    encodeTLV(0x04, sanSeq)
  ]));
  const extsSeq = encodeTLV(0x30, sanExt);
  // ExtensionRequest OID 1.2.840.113549.1.9.14 (2a 86 48 86 f7 0d 01 09 0e)
  const extReqAttr = encodeTLV(0x30, Buffer.concat([
    Buffer.from([0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x09, 0x0e]),
    encodeTLV(0x31, extsSeq)
  ]));
  const attrsDER = encodeTLV(0xa0, extReqAttr);

  // CertificationRequestInfo
  const reqInfoDER = encodeTLV(0x30, Buffer.concat([
    versionDER,
    subjectDER,
    spkiDer,
    attrsDER
  ]));

  // Signature: ecdsa-with-SHA256 (1.2.840.10045.4.3.2)
  const sigAlgDER = Buffer.from([0x30, 0x0a, 0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x04, 0x03, 0x02]);
  const signer = crypto.createSign('SHA256');
  signer.update(reqInfoDER);
  const derSig = signer.sign({ key: privateKey, dsaEncoding: 'der' });
  const sigBitString = encodeTLV(0x03, Buffer.concat([Buffer.from([0x00]), derSig]));

  const csrDER = encodeTLV(0x30, Buffer.concat([reqInfoDER, sigAlgDER, sigBitString]));
  const b64 = csrDER.toString('base64');
  const lines = b64.match(/.{1,64}/g) || [];
  const csrPEM = `-----BEGIN CERTIFICATE REQUEST-----\n${lines.join('\n')}\n-----END CERTIFICATE REQUEST-----\n`;
  return {
    csrPEM,
    privateKey,
    publicKey
  };
}

function signNodePayload(privateKey, nodeID, timestamp) {
  const signer = crypto.createSign('SHA256');
  signer.update(`${nodeID}:${timestamp}`);
  return signer.sign({ key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64');
}

// ── Test Suite Execution ─────────────────────────────────────

async function runTests() {
  console.log('Running LAN-TLS Certificate Provisioning Offline Tests...\n');

  const validNodeID = 'a1b2c3d4e5f6';
  const { csrPEM: validCSRPEM, privateKey: validPrivateKey } = generateTestCSR(validNodeID);

  // Test 1: Method Guard
  {
    const db = makeMockDb();
    const ctx = makeMockCtx();
    const req = new Request('http://api.test/api/v1/cert/provision', { method: 'GET' });
    const url = new URL(req.url);
    const resp = await handleCertRoutes(req, { DB: db }, ctx, url, {});
    assert(resp.status === 405, 'T1: Rejects non-POST method with 405');
  }

  // Test 2: Missing Parameters
  {
    const db = makeMockDb();
    const ctx = makeMockCtx();
    const req = new Request('http://api.test/api/v1/cert/provision', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ node_id: validNodeID })
    });
    const url = new URL(req.url);
    const resp = await handleCertRoutes(req, { DB: db }, ctx, url, {});
    const data = await resp.json();
    assert(resp.status === 400 && data.reason_key === 'missing_parameters', 'T2: Missing csr_pem returns 400 missing_parameters');
  }

  // Test 3: Invalid node_id
  {
    const db = makeMockDb();
    const ctx = makeMockCtx();
    const req = new Request('http://api.test/api/v1/cert/provision', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ node_id: 'invalid-node-id!', csr_pem: validCSRPEM })
    });
    const url = new URL(req.url);
    const resp = await handleCertRoutes(req, { DB: db }, ctx, url, {});
    const data = await resp.json();
    assert(resp.status === 400 && data.reason_key === 'invalid_node_id', 'T3: Invalid node_id returns 400 invalid_node_id');
  }

  // Test 4: Missing Timestamp Header
  {
    const db = makeMockDb();
    const ctx = makeMockCtx();
    const req = new Request('http://api.test/api/v1/cert/provision', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ node_id: validNodeID, csr_pem: validCSRPEM })
    });
    const url = new URL(req.url);
    const resp = await handleCertRoutes(req, { DB: db }, ctx, url, {});
    const data = await resp.json();
    assert(resp.status === 400 && data.reason_key === 'missing_timestamp', 'T4: Missing timestamp returns 400 missing_timestamp');
  }

  // Test 5: Timestamp Skew (+/- 60s tolerance)
  {
    const db = makeMockDb();
    const ctx = makeMockCtx();
    const oldTs = Math.floor(Date.now() / 1000) - 120; // 2 minutes ago (> 60s)
    const req = new Request('http://api.test/api/v1/cert/provision', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-EQT-Timestamp': String(oldTs)
      },
      body: JSON.stringify({ node_id: validNodeID, csr_pem: validCSRPEM })
    });
    const url = new URL(req.url);
    const resp = await handleCertRoutes(req, { DB: db }, ctx, url, {});
    const data = await resp.json();
    assert(resp.status === 400 && data.reason_key === 'timestamp_skew', 'T5: Skewed timestamp (>60s) returns 400 timestamp_skew');
  }

  // Test 6: Missing Device Signature Header
  {
    const db = makeMockDb();
    const ctx = makeMockCtx();
    const nowTs = Math.floor(Date.now() / 1000);
    const req = new Request('http://api.test/api/v1/cert/provision', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-EQT-Timestamp': String(nowTs)
      },
      body: JSON.stringify({ node_id: validNodeID, csr_pem: validCSRPEM })
    });
    const url = new URL(req.url);
    const resp = await handleCertRoutes(req, { DB: db }, ctx, url, {});
    const data = await resp.json();
    assert(resp.status === 401 && data.reason_key === 'missing_signature', 'T6: Missing signature header returns 401 missing_signature');
  }

  // Test 7: Blacklisted Device
  {
    const db = makeMockDb({
      blacklists: [{ device_id: 'banned_device_123', active: 1, reason: 'Device flagged for abuse' }]
    });
    const ctx = makeMockCtx();
    const nowTs = Math.floor(Date.now() / 1000);
    const sig = signNodePayload(validPrivateKey, validNodeID, nowTs);
    const req = new Request('http://api.test/api/v1/cert/provision', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-EQT-Device-ID': 'banned_device_123',
        'X-EQT-Timestamp': String(nowTs),
        'X-EQT-Device-Signature': sig
      },
      body: JSON.stringify({ node_id: validNodeID, csr_pem: validCSRPEM })
    });
    const url = new URL(req.url);
    const resp = await handleCertRoutes(req, { DB: db }, ctx, url, {});
    const data = await resp.json();
    assert(resp.status === 403 && (data.reason_key === 'blacklisted' || data.reason_key === 'blacklist_device'), 'T7: Blacklisted device returns 403 blacklisted');
  }

  // Test 8: Rate Limiting (exceeded after 3 requests)
  {
    const db = makeMockDb();
    const ctx = makeMockCtx();
    const nowTs = Math.floor(Date.now() / 1000);
    const sig = signNodePayload(validPrivateKey, validNodeID, nowTs);

    for (let i = 1; i <= 3; i++) {
      const req = new Request('http://api.test/api/v1/cert/provision', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-EQT-Timestamp': String(nowTs),
          'X-EQT-Device-Signature': sig,
          'X-EQT-Device-ID': 'test_device_valid_8'
        },
        body: JSON.stringify({ node_id: validNodeID, csr_pem: validCSRPEM })
      });
      const resp = await handleCertRoutes(req, { DB: db }, ctx, new URL(req.url), {});
      assert(resp.status === 200, `T8.${i}: Request ${i} allowed within quota`);
    }

    // 4th request must be rate-limited
    const req4 = new Request('http://api.test/api/v1/cert/provision', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-EQT-Timestamp': String(nowTs),
        'X-EQT-Device-Signature': sig,
        'X-EQT-Device-ID': 'test_device_valid_8'
      },
      body: JSON.stringify({ node_id: validNodeID, csr_pem: validCSRPEM })
    });
    const resp4 = await handleCertRoutes(req4, { DB: db }, ctx, new URL(req4.url), {});
    const data4 = await resp4.json();
    assert(resp4.status === 429 && data4.reason_key === 'rate_limited', 'T8.4: 4th request returns 429 rate_limited');
    assert(resp4.headers.get('Retry-After') === '86400', 'T8.5: 429 response contains Retry-After: 86400');
  }

  // Test 9: Corrupted CSR PEM
  {
    const db = makeMockDb();
    const ctx = makeMockCtx();
    const nowTs = Math.floor(Date.now() / 1000);
    const sig = signNodePayload(validPrivateKey, validNodeID, nowTs);
    const req = new Request('http://api.test/api/v1/cert/provision', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-EQT-Timestamp': String(nowTs),
        'X-EQT-Device-Signature': sig
      },
      body: JSON.stringify({ node_id: validNodeID, csr_pem: '-----BEGIN CERTIFICATE REQUEST-----\ncorrupted_data\n-----END CERTIFICATE REQUEST-----' })
    });
    const url = new URL(req.url);
    const resp = await handleCertRoutes(req, { DB: db }, ctx, url, {});
    const data = await resp.json();
    assert(resp.status === 400 && data.reason_key === 'invalid_csr', 'T9: Corrupted CSR returns 400 invalid_csr');
  }

  // Test 10: CommonName Mismatch
  {
    const db = makeMockDb();
    const ctx = makeMockCtx();
    const nowTs = Math.floor(Date.now() / 1000);
    const { csrPEM: mismatchedCSR, privateKey: mismatchKey } = generateTestCSR(validNodeID, 'othernode.direct.eqt.net.im');
    const sig = signNodePayload(mismatchKey, validNodeID, nowTs);
    const req = new Request('http://api.test/api/v1/cert/provision', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-EQT-Timestamp': String(nowTs),
        'X-EQT-Device-Signature': sig
      },
      body: JSON.stringify({ node_id: validNodeID, csr_pem: mismatchedCSR })
    });
    const url = new URL(req.url);
    const resp = await handleCertRoutes(req, { DB: db }, ctx, url, {});
    const data = await resp.json();
    assert(resp.status === 400 && data.reason_key === 'invalid_csr', 'T10: CommonName mismatch returns 400 invalid_csr');
  }

  // Test 11: SAN Missing Wildcard
  {
    const db = makeMockDb();
    const ctx = makeMockCtx();
    const nowTs = Math.floor(Date.now() / 1000);
    const { csrPEM: incompleteSANCSR, privateKey: incompleteKey } = generateTestCSR(validNodeID, `${validNodeID}.direct.eqt.net.im`, [`${validNodeID}.direct.eqt.net.im`]);
    const sig = signNodePayload(incompleteKey, validNodeID, nowTs);
    const req = new Request('http://api.test/api/v1/cert/provision', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-EQT-Timestamp': String(nowTs),
        'X-EQT-Device-Signature': sig
      },
      body: JSON.stringify({ node_id: validNodeID, csr_pem: incompleteSANCSR })
    });
    const url = new URL(req.url);
    const resp = await handleCertRoutes(req, { DB: db }, ctx, url, {});
    const data = await resp.json();
    assert(resp.status === 400 && data.reason_key === 'invalid_csr', 'T11: Incomplete SAN returns 400 invalid_csr');
  }

  // Test 12: Invalid Proof-of-Possession Signature (Rogue Private Key)
  {
    const db = makeMockDb();
    const ctx = makeMockCtx();
    const nowTs = Math.floor(Date.now() / 1000);
    const rogueKeyPair = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const rogueSig = signNodePayload(rogueKeyPair.privateKey, validNodeID, nowTs);
    const req = new Request('http://api.test/api/v1/cert/provision', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-EQT-Timestamp': String(nowTs),
        'X-EQT-Device-Signature': rogueSig
      },
      body: JSON.stringify({ node_id: validNodeID, csr_pem: validCSRPEM })
    });
    const url = new URL(req.url);
    const resp = await handleCertRoutes(req, { DB: db }, ctx, url, {});
    const data = await resp.json();
    assert(resp.status === 401 && data.reason_key === 'invalid_signature', 'T12: Rogue signature returns 401 invalid_signature');
  }

  // Test 13: Successful Issuance & X.509 Verification with Valid POPO
  {
    const db = makeMockDb();
    const ctx = makeMockCtx();
    const testNode = 'f1e2d3c4b5a6';
    const { csrPEM: csr, privateKey: testKey } = generateTestCSR(testNode);
    const nowTs = Math.floor(Date.now() / 1000);
    const sig = signNodePayload(testKey, testNode, nowTs);

    const req = new Request('http://api.test/api/v1/cert/provision', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-EQT-Device-ID': 'test_device_uuid_99',
        'X-EQT-Timestamp': String(nowTs),
        'X-EQT-Device-Signature': sig,
        'X-Trace-Id': 'test-trace-12345'
      },
      body: JSON.stringify({ node_id: testNode, csr_pem: csr })
    });
    const url = new URL(req.url);
    const resp = await handleCertRoutes(req, { DB: db }, ctx, url, {});
    await ctx.drain();

    assert(resp.status === 200, 'T13.1: Successful provisioning returns 200 OK');
    const data = await resp.json();
    assert(typeof data.cert_pem === 'string' && data.cert_pem.includes('BEGIN CERTIFICATE'), 'T13.2: Returns valid cert_pem');
    assert(typeof data.expires_at === 'string', 'T13.3: Returns valid ISO expires_at');

    // Verify D1 provision audit row
    assert(db._provisions.length === 1, 'T13.4: Recorded 1 provision record in D1');
    const prov = db._provisions[0];
    assert(prov.node_id === testNode, 'T13.5: D1 record has matching node_id');
    assert(prov.device_id === 'test_device_uuid_99', 'T13.6: D1 record has matching device_id');
    assert(prov.common_name === `${testNode}.direct.eqt.net.im`, 'T13.7: D1 record has correct common_name');
    assert(prov.trace_id === 'test-trace-12345', 'T13.8: D1 record has preserved trace_id');

    // Parse issued cert using crypto.X509Certificate (Node 15.6+)
    const x509 = new crypto.X509Certificate(data.cert_pem);
    assert(x509.subject.includes(`CN=${testNode}.direct.eqt.net.im`), 'T13.9: X509 Subject CN matches node domain');
    assert(x509.subjectAltName.includes(`DNS:${testNode}.direct.eqt.net.im`), 'T13.10: X509 SAN includes exact node domain');
    assert(x509.subjectAltName.includes(`DNS:*.${testNode}.direct.eqt.net.im`), 'T13.11: X509 SAN includes wildcard sub-domain');
    
    // Check 90 days validity window
    const validToMs = new Date(x509.validTo).getTime();
    const daysUntilExpiry = (validToMs - Date.now()) / (24 * 3600 * 1000);
    assert(daysUntilExpiry >= 88 && daysUntilExpiry <= 91, 'T13.12: X509 certificate has ~90 days validity window');

    // Test 14: ASN.1 Leaf NotAfter Expiry Extraction (FINDING 7)
    const parsedExpiry = parseCertificateExpiry(data.cert_pem);
    assert(parsedExpiry instanceof Date, 'T14.1: parseCertificateExpiry returns a Date instance');
    assert(parsedExpiry.toISOString() === new Date(x509.validTo).toISOString(), 'T14.2: parseCertificateExpiry matches x509.validTo exactly');
  }

  // Test 15: ACME Fail-Loud on Misconfiguration (FINDING 5)
  {
    const testNode = 'a1b2c3d4e5f6';
    const { csrPEM: csr, privateKey: testKey } = generateTestCSR(testNode);
    const nowTs = Math.floor(Date.now() / 1000);
    const sig = signNodePayload(testKey, testNode, nowTs);

    // 15.1: Missing ACME_DNS_API_ENDPOINTS
    const req1 = new Request('http://api.test/api/v1/cert/provision', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-EQT-Timestamp': String(nowTs),
        'X-EQT-Device-Signature': sig,
        'X-EQT-Device-ID': 'test_device_valid_15'
      },
      body: JSON.stringify({ node_id: testNode, csr_pem: csr })
    });
    const resp1 = await handleCertRoutes(req1, {
      DB: makeMockDb(),
      ACME_DIRECTORY_URL: 'https://acme-v02.api.letsencrypt.org/directory'
    }, makeMockCtx(), new URL(req1.url), {});
    const d1 = await resp1.json();
    assert(resp1.status === 500 && d1.reason_key === 'acme_misconfigured', 'T15.1: Missing ACME_DNS_API_ENDPOINTS fails loud with 500 acme_misconfigured');

    // 15.2: Missing ACME_DNS_API_TOKEN
    const req2 = new Request('http://api.test/api/v1/cert/provision', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-EQT-Timestamp': String(nowTs),
        'X-EQT-Device-Signature': sig,
        'X-EQT-Device-ID': 'test_device_valid_15'
      },
      body: JSON.stringify({ node_id: testNode, csr_pem: csr })
    });
    const resp2 = await handleCertRoutes(req2, {
      DB: makeMockDb(),
      ACME_DIRECTORY_URL: 'https://acme-v02.api.letsencrypt.org/directory',
      ACME_DNS_API_ENDPOINTS: 'https://ns1.test'
    }, makeMockCtx(), new URL(req2.url), {});
    const d2 = await resp2.json();
    assert(resp2.status === 500 && d2.reason_key === 'acme_misconfigured', 'T15.2: Missing ACME_DNS_API_TOKEN fails loud with 500 acme_misconfigured');

    // 15.3: Missing ACME_ACCOUNT_KEY
    const req3 = new Request('http://api.test/api/v1/cert/provision', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-EQT-Timestamp': String(nowTs),
        'X-EQT-Device-Signature': sig,
        'X-EQT-Device-ID': 'test_device_valid_15'
      },
      body: JSON.stringify({ node_id: testNode, csr_pem: csr })
    });
    const resp3 = await handleCertRoutes(req3, {
      DB: makeMockDb(),
      ACME_DIRECTORY_URL: 'https://acme-v02.api.letsencrypt.org/directory',
      ACME_DNS_API_ENDPOINTS: 'https://ns1.test',
      ACME_DNS_API_TOKEN: 'secret-token'
    }, makeMockCtx(), new URL(req3.url), {});
    const d3 = await resp3.json();
    assert(resp3.status === 500 && d3.reason_key === 'acme_misconfigured', 'T15.3: Missing ACME_ACCOUNT_KEY fails loud with 500 acme_misconfigured');
  }

  // Test 16: DNS-01 Challenge Strict Dual-Endpoint Consistency (FINDING 6)
  {
    const originalFetch = globalThis.fetch;
    let fetchCalls = 0;
    globalThis.fetch = async (url) => {
      fetchCalls++;
      if (url.includes('ns1.test')) {
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      }
      return new Response('Internal Server Error', { status: 500 });
    };

    let caughtErr = null;
    try {
      await setDns01Challenge(['https://ns1.test', 'https://ns2.test'], 'test-token', '_acme.test.', 'val123');
    } catch (e) {
      caughtErr = e;
    } finally {
      globalThis.fetch = originalFetch;
    }
    assert(caughtErr !== null && caughtErr.message.includes('failed to set DNS challenge on 1/2 authoritative endpoint(s)'), 'T16: setDns01Challenge fails loud if any single authoritative endpoint fails');
  }

  // Test 17: FINDING 8 - Immediate Rollback of Partial Succeeded Endpoints (Zero DNS Residue)
  {
    const originalFetch = globalThis.fetch;
    const deleteCalls = [];
    globalThis.fetch = async (url, opts) => {
      if (opts && opts.method === 'DELETE') {
        deleteCalls.push(url);
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (url.includes('ns1.test')) {
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      }
      return new Response('Internal Server Error', { status: 500 });
    };

    let caughtErr = null;
    try {
      await setDns01Challenge(['https://ns1.test', 'https://ns2.test'], 'test-token', '_acme-challenge.node1.direct.eqt.net.im.', 'chalValXYZ');
    } catch (e) {
      caughtErr = e;
    } finally {
      globalThis.fetch = originalFetch;
    }

    assert(caughtErr !== null, 'T17.1: setDns01Challenge threw on partial failure');
    assert(deleteCalls.length === 1 && deleteCalls[0].includes('ns1.test') && deleteCalls[0].includes('chalValXYZ'), 'T17.2: immediate rollback DELETE dispatched to succeeded ns1.test (zero residue)');
  }

  // Test 18: DER INTEGER Serial Number Normalization (1,000-iteration reproducible regression touching production code)
  {
    let derValidCount = 0;
    // 18.1: Test production generateCompliantSerialNumber() 1,000 times
    for (let i = 0; i < 1000; i++) {
      const serial = generateCompliantSerialNumber();

      // DER INTEGER rules check:
      // 1. Must be positive (MSB of first byte must be 0)
      const isPositive = (serial[0] & 0x80) === 0;
      // 2. Must not have redundant leading zero (first byte must be >= 0x01 and <= 0x7f)
      const noRedundantZero = serial[0] >= 0x01 && serial[0] <= 0x7f;
      // 3. Length must be exactly 16 bytes
      const exactLen = serial.length === 16;

      if (isPositive && noRedundantZero && exactLen) {
        derValidCount++;
      }
    }
    assert(derValidCount === 1000, `T18.1: 1,000/1,000 production serial numbers verified 100% compliant with DER INTEGER rules`);

    // 18.2: Test actual certificate generation via production issueCertificateFromCSR()
    const { csrPEM: testCsr } = generateTestCSR('t18node001234');
    const parsed = await parseCSR(testCsr);
    let certDerValid = true;
    for (let i = 0; i < 10; i++) {
      const issued = await issueCertificateFromCSR(parsed, 90);
      const x509 = new crypto.X509Certificate(issued.certPEM);
      // Serial number is a 32-hex character string
      const serialHex = x509.serialNumber;
      const firstByte = parseInt(serialHex.slice(0, 2), 16);
      if (firstByte < 0x01 || firstByte > 0x7f) {
        certDerValid = false;
      }
    }
    assert(certDerValid, 'T18.2: Production issueCertificateFromCSR outputs valid DER serial numbers across repeated issuances');
  }

  // Test 19: End-to-End ACME Route Execution via handleCertRoutes (FINDING 9 Regression Guard)
  {
    const originalFetch = globalThis.fetch;
    const dnsSetCalls = [];
    const dnsDeleteCalls = [];
    const callTracer = [];
    const authoritativeStorage = {
      'https://ns1.test': {},
      'https://ns2.test': {}
    };
    let globalCallSeq = 0;
    const acctKey = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const acctJwk = acctKey.privateKey.export({ format: 'jwk' });

    const acmeNode = 'ac1de0123456';
    const { csrPEM: acmeCsr, privateKey: acmeDevKey } = generateTestCSR(acmeNode);
    const nowTs = Math.floor(Date.now() / 1000);
    const sig = signNodePayload(acmeDevKey, acmeNode, nowTs);

    // Mock dummy issued cert PEM for download
    const dummyIssued = await issueCertificateFromCSR(await parseCSR(acmeCsr), 90);

    let isFinalized = false;
    let nonceCounter = 1;
    globalThis.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : (input instanceof Request ? input.url : String(input));
      const method = (init && init.method) ? init.method.toUpperCase() : 'GET';

      if (url === 'https://acme.test/directory') {
        return new Response(JSON.stringify({
          newNonce: 'https://acme.test/nonce',
          newAccount: 'https://acme.test/new-acct',
          newOrder: 'https://acme.test/new-order'
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url === 'https://acme.test/nonce') {
        return new Response(null, { status: 200, headers: { 'Replay-Nonce': `nonce-${nonceCounter++}` } });
      }
      if (url === 'https://acme.test/new-acct') {
        return new Response(JSON.stringify({ status: 'valid' }), {
          status: 200,
          headers: { 'Location': 'https://acme.test/acct/1', 'Replay-Nonce': `nonce-${nonceCounter++}`, 'Content-Type': 'application/json' }
        });
      }
      if (url === 'https://acme.test/new-order') {
        return new Response(JSON.stringify({
          status: 'pending',
          authorizations: ['https://acme.test/authz/1'],
          finalize: 'https://acme.test/finalize/1'
        }), {
          status: 201,
          headers: { 'Location': 'https://acme.test/order/1', 'Replay-Nonce': `nonce-${nonceCounter++}`, 'Content-Type': 'application/json' }
        });
      }
      if (url === 'https://acme.test/authz/1') {
        return new Response(JSON.stringify({
          status: 'pending',
          identifier: { value: `${acmeNode}.direct.eqt.net.im` },
          challenges: [{ type: 'dns-01', url: 'https://acme.test/chal/1', token: 'tokenXYZ' }]
        }), { status: 200, headers: { 'Replay-Nonce': `nonce-${nonceCounter++}`, 'Content-Type': 'application/json' } });
      }
      if (url.includes('/acme/challenge')) {
        const u = new URL(url);
        const origin = u.origin;
        if (method === 'POST') {
          globalCallSeq++;
          callTracer.push({ type: 'setDns01Challenge', seq: globalCallSeq, url });
          const b = init ? JSON.parse(init.body) : null;
          dnsSetCalls.push({ url, body: b });
          if (b && b.record && b.value) {
            const canon = b.record.toLowerCase().replace(/\.+$/, '') + '.';
            if (!authoritativeStorage[origin]) authoritativeStorage[origin] = {};
            if (!authoritativeStorage[origin][canon]) authoritativeStorage[origin][canon] = [];
            if (!authoritativeStorage[origin][canon].includes(b.value)) {
              authoritativeStorage[origin][canon].push(b.value);
            }
          }
          return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (method === 'GET') {
          globalCallSeq++;
          callTracer.push({ type: 'confirmDnsPropagation', seq: globalCallSeq, url });
          const records = authoritativeStorage[origin] || {};
          return new Response(JSON.stringify({ records }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (method === 'DELETE') {
          globalCallSeq++;
          callTracer.push({ type: 'clearDns01Challenge', seq: globalCallSeq, url });
          dnsDeleteCalls.push(url);
          return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
      }
      if (url === 'https://acme.test/chal/1') {
        globalCallSeq++;
        callTracer.push({ type: 'triggerChallenge', seq: globalCallSeq, url });
        return new Response(JSON.stringify({ status: 'valid' }), { status: 200, headers: { 'Replay-Nonce': `nonce-${nonceCounter++}` } });
      }
      if (url === 'https://acme.test/order/1') {
        return new Response(JSON.stringify({
          status: isFinalized ? 'valid' : 'ready',
          finalize: 'https://acme.test/finalize/1',
          certificate: isFinalized ? 'https://acme.test/cert/1' : undefined
        }), { status: 200, headers: { 'Replay-Nonce': `nonce-${nonceCounter++}`, 'Content-Type': 'application/json' } });
      }
      if (url === 'https://acme.test/finalize/1') {
        isFinalized = true;
        return new Response(JSON.stringify({
          status: 'valid',
          certificate: 'https://acme.test/cert/1'
        }), { status: 200, headers: { 'Replay-Nonce': `nonce-${nonceCounter++}`, 'Content-Type': 'application/json' } });
      }
      if (url === 'https://acme.test/cert/1') {
        return new Response(dummyIssued.certPEM, { status: 200, headers: { 'Content-Type': 'application/pem-certificate-chain' } });
      }

      return new Response('Not Found', { status: 404 });
    };

    let acmeResp = null;
    let acmeData = null;
    try {
      const req = new Request('http://api.test/api/v1/cert/provision', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-EQT-Timestamp': String(nowTs),
          'X-EQT-Device-Signature': sig,
          'X-EQT-Device-ID': 'test_device_valid_19'
        },
        body: JSON.stringify({ node_id: acmeNode, csr_pem: acmeCsr })
      });

      acmeResp = await handleCertRoutes(req, {
        DB: makeMockDb(),
        ENVIRONMENT: 'test',
        ACME_DIRECTORY_URL: 'https://acme.test/directory',
        ACME_DNS_API_ENDPOINTS: 'https://ns1.test,https://ns2.test',
        ACME_DNS_API_TOKEN: 'secret-dns-token',
        ACME_ACCOUNT_KEY: JSON.stringify(acctJwk)
      }, makeMockCtx(), new URL(req.url), {});

      acmeData = await acmeResp.json();
    } finally {
      globalThis.fetch = originalFetch;
    }

    assert(acmeResp && acmeResp.status === 200, 'T19.1: ACME issuance path executes end-to-end with 200 OK (no ReferenceError/500)');
    assert(acmeData && acmeData.cert_pem && acmeData.expires_at, 'T19.2: ACME response contains valid cert_pem and expires_at');
    assert(dnsSetCalls.length === 2, 'T19.3: DNS challenge set on all authoritative endpoints');
    assert(dnsSetCalls[0].body && dnsSetCalls[0].body.record === `_acme-challenge.${acmeNode}.direct.eqt.net.im.`, 'T19.4: DNS challenge recordName correctly constructed with device node');

    const setSeqs = callTracer.filter(c => c.type === 'setDns01Challenge').map(c => c.seq);
    const confirmSeqs = callTracer.filter(c => c.type === 'confirmDnsPropagation').map(c => c.seq);
    const triggerSeqs = callTracer.filter(c => c.type === 'triggerChallenge').map(c => c.seq);

    const maxSet = Math.max(...setSeqs);
    const minConfirm = Math.min(...confirmSeqs);
    const maxConfirm = Math.max(...confirmSeqs);
    const minTrigger = Math.min(...triggerSeqs);

    // 形状锁说明：T19.4b / T19.5 / T19.6 严格约束「线上观测到 confirmDnsPropagation (GET) 介于 setDns01Challenge 与 triggerChallenge 之间」的时序形状；其逐值校验逻辑与超时抛错的语义效力由下方的 T19b 专项反向控制用例全权承担。
    assert(setSeqs.length > 0 && confirmSeqs.length > 0 && triggerSeqs.length > 0,
      'T19.4b: callTracer captured all three phases (guards against vacuous Infinity comparison)');
    assert(maxSet < minConfirm, `T19.5: Invariant locked: max(setDns01Challenge)=${maxSet} < min(confirmDnsPropagation)=${minConfirm}`);
    assert(maxConfirm < minTrigger, `T19.6: Invariant locked: max(confirmDnsPropagation)=${maxConfirm} < min(triggerChallenge)=${minTrigger}`);
  }

  // Test 19b: Unit Tests for confirmDnsPropagation (Positive confirmation & retry & failure modes)
  {
    const originalFetch = globalThis.fetch;
    const testEndpoints = ['https://ns1.test', 'https://ns2.test'];
    const testRecord = '_acme-challenge.testnode.direct.eqt.net.im.';
    const testValues = ['token_value_a', 'token_value_b'];

    // 19b.1: Immediate success
    {
      globalThis.fetch = async (url, init) => {
        return new Response(JSON.stringify({
          records: {
            [testRecord]: testValues
          }
        }), { status: 200 });
      };
      let ok = true;
      try {
        await confirmDnsPropagation(testEndpoints, 'token', testRecord, testValues, 2000, 50);
      } catch (e) {
        ok = false;
      }
      assert(ok, 'T19b.1: confirmDnsPropagation succeeds when all endpoints return expected challenge values');
    }

    // 19b.2: Retry until ready
    {
      let attempts = 0;
      globalThis.fetch = async (url, init) => {
        attempts++;
        if (attempts < 3) {
          return new Response(JSON.stringify({ records: {} }), { status: 200 });
        }
        return new Response(JSON.stringify({
          records: {
            [testRecord]: testValues
          }
        }), { status: 200 });
      };
      let ok = true;
      try {
        await confirmDnsPropagation(testEndpoints, 'token', testRecord, testValues, 3000, 50);
      } catch (e) {
        ok = false;
      }
      assert(ok && attempts >= 3, 'T19b.2: confirmDnsPropagation retries and succeeds once authoritative records appear');
    }

    // 19b.3: Timeout throws loud error with detailed diagnostics
    {
      globalThis.fetch = async (url, init) => {
        return new Response(JSON.stringify({ records: { [testRecord]: ['some_other_value'] } }), { status: 200 });
      };
      let caughtError = null;
      try {
        await confirmDnsPropagation(testEndpoints, 'token', testRecord, testValues, 300, 50);
      } catch (e) {
        caughtError = e;
      } finally {
        globalThis.fetch = originalFetch;
      }
      assert(caughtError !== null, 'T19b.3: confirmDnsPropagation throws when propagation deadline exceeded');
      assert(caughtError && caughtError.message.includes('DNS-01 propagation positive confirmation failed'), 'T19b.4: Timeout error contains diagnostic context and observed values');
    }
  }

  // Test 20: First-Use Public Key Binding (TOFU) & Authorized Key Rotation
  {
    const tofuNode = 'e1f2a3b4c5d6';
    const { csrPEM: csr1, privateKey: priv1 } = generateTestCSR(tofuNode);
    const { csrPEM: csr2, privateKey: priv2 } = generateTestCSR(tofuNode); // Different keypair for same node!
    const db = makeMockDb();
    const ctx = makeMockCtx();
    const nowTs = Math.floor(Date.now() / 1000);
    const testDeviceId = 'legit_device_uuid_tofu_1';

    // 20.0: Initial registration without device_id succeeds (TOFU for telemetry-disabled/offline nodes), recording null device_id
    const noDevNode = 'e1f2a3b4c5d0';
    const { csrPEM: csrNoDev, privateKey: privNoDev } = generateTestCSR(noDevNode);
    const sigNoDev = signNodePayload(privNoDev, noDevNode, nowTs);
    const req0 = new Request('http://api.test/api/v1/cert/provision', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-EQT-Timestamp': String(nowTs),
        'X-EQT-Device-Signature': sigNoDev
      },
      body: JSON.stringify({ node_id: noDevNode, csr_pem: csrNoDev })
    });
    const resp0 = await handleCertRoutes(req0, { DB: db }, ctx, new URL(req0.url), {});
    await ctx.drain();
    assert(resp0.status === 200, 'T20.0: Initial registration without device_id succeeds with 200 (preserves offline/telemetry-disabled compatibility)');
    const noDevEntry = db._nodeKeys.get(noDevNode);
    assert(noDevEntry && noDevEntry.device_id === null, 'T20.0: D1 records null device_id when not provided on initial binding');

    // 20.1: 1st request with priv1 and testDeviceId binds tofuNode to pubkey1
    const sig1 = signNodePayload(priv1, tofuNode, nowTs);
    const req1 = new Request('http://api.test/api/v1/cert/provision', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-EQT-Timestamp': String(nowTs),
        'X-EQT-Device-Signature': sig1,
        'X-EQT-Device-ID': testDeviceId
      },
      body: JSON.stringify({ node_id: tofuNode, csr_pem: csr1 })
    });
    const resp1 = await handleCertRoutes(req1, { DB: db }, ctx, new URL(req1.url), {});
    await ctx.drain();
    assert(resp1.status === 200, 'T20.1: Initial registration with key 1 succeeds and binds key');
    const boundEntry = db._nodeKeys.get(tofuNode);
    assert(boundEntry && boundEntry.device_id === testDeviceId, 'T20.1: D1 records correct initial device_id binding');
    const initialKey = boundEntry.public_key_sha256;

    // 20.2: 2nd request with priv2 and rogue device_id must be rejected with 403 node_key_mismatch
    const sig2 = signNodePayload(priv2, tofuNode, nowTs);
    const req2Rogue = new Request('http://api.test/api/v1/cert/provision', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-EQT-Timestamp': String(nowTs),
        'X-EQT-Device-Signature': sig2,
        'X-EQT-Device-ID': 'rogue_attacker_device'
      },
      body: JSON.stringify({ node_id: tofuNode, csr_pem: csr2 })
    });
    const resp2Rogue = await handleCertRoutes(req2Rogue, { DB: db }, ctx, new URL(req2Rogue.url), {});
    const data2Rogue = await resp2Rogue.json();
    assert(resp2Rogue.status === 403 && data2Rogue.reason_key === 'node_key_mismatch', 'T20.2: Mismatched public key from different device returns 403 node_key_mismatch');

    // 20.3: 3rd request with priv2 but matching testDeviceId must SUCCEED with 200 and UPDATE pubkey in D1!
    const req2Legit = new Request('http://api.test/api/v1/cert/provision', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-EQT-Timestamp': String(nowTs),
        'X-EQT-Device-Signature': sig2,
        'X-EQT-Device-ID': testDeviceId
      },
      body: JSON.stringify({ node_id: tofuNode, csr_pem: csr2 })
    });
    const resp2Legit = await handleCertRoutes(req2Legit, { DB: db }, ctx, new URL(req2Legit.url), {});
    await ctx.drain();
    assert(resp2Legit.status === 200, 'T20.3: Key rotation for matching device_id returns 200 OK');
    const rebindEntry = db._nodeKeys.get(tofuNode);
    assert(rebindEntry && rebindEntry.public_key_sha256 !== initialKey, 'T20.3: D1 public_key_sha256 successfully updated upon authorized rebind');

    // 20.4: Initial registration without device_id succeeds (TOFU for telemetry-disabled)
    const nullNode = 'f0a1b2c3d4e5';
    const { csrPEM: nullCsr1, privateKey: nullPriv1 } = generateTestCSR(nullNode);
    const sigNull1 = signNodePayload(nullPriv1, nullNode, nowTs);
    const reqNull1 = new Request('http://api.test/api/v1/cert/provision', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-EQT-Timestamp': String(nowTs),
        'X-EQT-Device-Signature': sigNull1
      },
      body: JSON.stringify({ node_id: nullNode, csr_pem: nullCsr1 })
    });
    const respNull1 = await handleCertRoutes(reqNull1, { DB: db }, ctx, new URL(reqNull1.url), {});
    await ctx.drain();
    assert(respNull1.status === 200, 'T20.4: Initial binding without device_id succeeds with 200');
    const entryNull1 = db._nodeKeys.get(nullNode);
    assert(entryNull1 && entryNull1.device_id === null, 'T20.4: D1 records null device_id initially');
    const initialNullKey = entryNull1.public_key_sha256;

    // 20.4b: Hijack attempt by third party with new key without device_id must be REJECTED (403 fail-closed)
    const { csrPEM: rogueCsr, privateKey: roguePriv } = generateTestCSR(nullNode);
    const sigRogue = signNodePayload(roguePriv, nullNode, nowTs);
    const reqRogue = new Request('http://api.test/api/v1/cert/provision', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-EQT-Timestamp': String(nowTs),
        'X-EQT-Device-Signature': sigRogue
      },
      body: JSON.stringify({ node_id: nullNode, csr_pem: rogueCsr })
    });
    const respRogue = await handleCertRoutes(reqRogue, { DB: db }, ctx, new URL(reqRogue.url), {});
    const dataRogue = await respRogue.json();
    assert(respRogue.status === 403 && dataRogue.reason_key === 'node_key_mismatch', 'T20.4b: Unauthenticated rebind on null-bound node strictly rejected with 403 fail-closed');
    const entryAfterRogue = db._nodeKeys.get(nullNode);
    assert(entryAfterRogue && entryAfterRogue.public_key_sha256 === initialNullKey, 'T20.4b: D1 public_key_sha256 unchanged, hijacking prevented');

    // 20.5: Hostile takeover attempt with forged/arbitrary device_id must also be REJECTED (403 fail-closed)
    const reqHostile = new Request('http://api.test/api/v1/cert/provision', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-EQT-Timestamp': String(nowTs),
        'X-EQT-Device-Signature': sigRogue,
        'X-EQT-Device-ID': 'attacker_chosen_device_id_x'
      },
      body: JSON.stringify({ node_id: nullNode, csr_pem: rogueCsr })
    });
    const respHostile = await handleCertRoutes(reqHostile, { DB: db }, ctx, new URL(reqHostile.url), {});
    const dataHostile = await respHostile.json();
    assert(respHostile.status === 403 && dataHostile.reason_key === 'node_key_mismatch', 'T20.5: Hostile device_id stamp on null-bound node rejected with 403');
    const entryAfterHostile = db._nodeKeys.get(nullNode);
    assert(entryAfterHostile && entryAfterHostile.device_id === null, 'T20.5: D1 device_id remains null, owner not locked out');
  }

  // Test 21: IP Rate Limiting
  {
    const testIp = '198.51.100.42';
    const db = makeMockDb();
    const ctx = makeMockCtx();
    const nowTs = Math.floor(Date.now() / 1000);

    // Exhaust 10 requests from same IP with different node_ids
    let lastResp = null;
    for (let i = 0; i < 10; i++) {
      const iterNode = `aa000000000${i}`;
      const { csrPEM, privateKey } = generateTestCSR(iterNode);
      const sig = signNodePayload(privateKey, iterNode, nowTs);
      const req = new Request('http://api.test/api/v1/cert/provision', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-EQT-Timestamp': String(nowTs),
          'X-EQT-Device-Signature': sig,
          'X-EQT-Device-ID': 'test_ip_rate_device',
          'CF-Connecting-IP': testIp
        },
        body: JSON.stringify({ node_id: iterNode, csr_pem: csrPEM })
      });
      lastResp = await handleCertRoutes(req, { DB: db }, ctx, new URL(req.url), {});
      assert(lastResp.status === 200, `T21.1: Request ${i + 1} from IP ${testIp} permitted`);
    }

    // 11th request from same IP should be blocked
    const blockedNode = 'aa0000000010';
    const { csrPEM: blockedCsr, privateKey: blockedPriv } = generateTestCSR(blockedNode);
    const blockedSig = signNodePayload(blockedPriv, blockedNode, nowTs);
    const blockedReq = new Request('http://api.test/api/v1/cert/provision', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-EQT-Timestamp': String(nowTs),
        'X-EQT-Device-Signature': blockedSig,
        'CF-Connecting-IP': testIp
      },
      body: JSON.stringify({ node_id: blockedNode, csr_pem: blockedCsr })
    });
    const blockedResp = await handleCertRoutes(blockedReq, { DB: db }, ctx, new URL(blockedReq.url), {});
    const blockedData = await blockedResp.json();
    assert(blockedResp.status === 429 && blockedData.reason_key === 'ip_rate_limited', 'T21.2: 11th request from same IP blocked with 429 ip_rate_limited');

    // T21.3: Adaptive Circuit Breaker & Token Bucket Traffic Smoothing (Abolition of arbitrary 40/week ceiling)
    const prodAcctKey = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const prodAcctJwk = prodAcctKey.privateKey.export({ format: 'jwk' });
    const prodEnv = {
      DB: db,
      ENVIRONMENT: 'production',
      ACME_DIRECTORY_URL: 'https://acme.test/directory',
      ACME_DNS_API_ENDPOINTS: 'https://ns1.test,https://ns2.test',
      ACME_DNS_API_TOKEN: 'secret-dns-token',
      ACME_ACCOUNT_KEY: JSON.stringify(prodAcctJwk)
    };

    // Pre-seed rate_limits with 40 hits for obsolete 'cert_provision:global_acme' to prove it is ignored
    const obsoleteGlobalKey = 'cert_provision:global_acme';
    db._rateLimits.set(obsoleteGlobalKey, { count: 40, window_start: new Date().toISOString() });

    // T21.3a: Verify that having 40 prior hits does NOT block request with global_rate_limited
    // Pre-seed token bucket with 5 tokens and circuit breaker in CLOSED state
    db._tokenBuckets.set('cert_provision:acme_smoothing', {
      key: 'cert_provision:acme_smoothing',
      tokens: 5,
      last_refill: new Date().toISOString(),
      capacity: 5,
      refill_rate: 10 / 60
    });
    db._circuitBreakers.set('gts_ca', {
      name: 'gts_ca',
      state: 'CLOSED',
      failure_count: 0,
      success_count: 40,
      last_failure_time: null,
      cooldown_until: null,
      last_retry_after: 0,
      updated_at: new Date().toISOString()
    });

    const globalNode = 'bb0000000001';
    const { csrPEM: globalCsr, privateKey: globalPriv } = generateTestCSR(globalNode);
    const globalSig = signNodePayload(globalPriv, globalNode, nowTs);

    function createGlobalReq() {
      return new Request('http://api.test/api/v1/cert/provision', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-EQT-Timestamp': String(nowTs),
          'X-EQT-Device-Signature': globalSig,
          'X-EQT-Device-ID': 'test_ip_rate_device',
          'CF-Connecting-IP': '198.51.100.99'
        },
        body: JSON.stringify({ node_id: globalNode, csr_pem: globalCsr })
      });
    }

    // Mock fetch for ACME calls
    const originalFetch = globalThis.fetch;
    let acmeCallCount = 0;
    try {
      globalThis.fetch = async (input, init) => {
        acmeCallCount++;
        const url = typeof input === 'string' ? input : (input instanceof Request ? input.url : String(input));
        if (url === 'https://acme.test/directory') {
          return new Response(JSON.stringify({
            newNonce: 'https://acme.test/nonce',
            newAccount: 'https://acme.test/new-acct',
            newOrder: 'https://acme.test/new-order'
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (url === 'https://acme.test/nonce') {
          return new Response(null, { status: 200, headers: { 'Replay-Nonce': 'nonce-test-1' } });
        }
        if (url === 'https://acme.test/new-acct') {
          return new Response(JSON.stringify({ status: 'valid' }), {
            status: 200,
            headers: { 'Location': 'https://acme.test/acct/1', 'Replay-Nonce': 'nonce-test-2', 'Content-Type': 'application/json' }
          });
        }
        if (url === 'https://acme.test/new-order') {
          // Simulate upstream CA 429 Too Many Requests with Retry-After: 90
          return new Response(JSON.stringify({
            type: 'urn:ietf:params:acme:error:rateLimited',
            detail: 'Rate limit exceeded on CA operations'
          }), {
            status: 429,
            headers: { 'Content-Type': 'application/json', 'Retry-After': '90' }
          });
        }
        return new Response('not found', { status: 404 });
      };

      const req1 = createGlobalReq();
      const resp1 = await handleCertRoutes(req1, prodEnv, ctx, new URL(req1.url), {});
      const data1 = await resp1.json();

      // T21.3a: Verify request is NOT blocked by arbitrary 40-count ceiling (reason_key !== 'global_rate_limited')
      assert(data1.reason_key !== 'global_rate_limited', 'T21.3a: Production ACME request is not blocked by arbitrary 40/week ceiling');

      // T21.3c: Verify upstream 429 trips circuit to OPEN and client receives 429 ca_rate_limited with Retry-After 90
      assert(resp1.status === 429 && data1.reason_key === 'ca_rate_limited' && resp1.headers.get('Retry-After') === '90', 'T21.3c: Upstream CA 429 returns ca_rate_limited with exact Retry-After 90s');

      const cbState = db._circuitBreakers.get('gts_ca');
      assert(cbState && cbState.state === 'OPEN' && cbState.last_retry_after === 90, 'T21.3c2: Circuit breaker tripped to OPEN in database');

      // T21.3d: Fast rejection while circuit is OPEN
      // Next request during cooldown is rejected immediately with 429 ca_circuit_open WITHOUT hitting upstream
      const callCountBefore = acmeCallCount;
      const req2 = createGlobalReq();
      const resp2 = await handleCertRoutes(req2, prodEnv, ctx, new URL(req2.url), {});
      const data2 = await resp2.json();
      assert(resp2.status === 429 && data2.reason_key === 'ca_circuit_open' && acmeCallCount === callCountBefore, 'T21.3d: Fast rejection with ca_circuit_open while circuit is OPEN (zero upstream calls)');

      // T21.3b: Token Bucket traffic smoothing test
      // Reset circuit to CLOSED, empty token bucket to 0
      cbState.state = 'CLOSED';
      db._tokenBuckets.set('cert_provision:acme_smoothing', {
        key: 'cert_provision:acme_smoothing',
        tokens: 0.1,
        last_refill: new Date().toISOString(),
        capacity: 5,
        refill_rate: 10 / 60
      });
      const reqTb = createGlobalReq();
      const respTb = await handleCertRoutes(reqTb, prodEnv, ctx, new URL(reqTb.url), {});
      const dataTb = await respTb.json();
      assert(respTb.status === 429 && dataTb.reason_key === 'ca_traffic_smoothing', 'T21.3b: Outbound request smoothed with 429 ca_traffic_smoothing when token bucket empty');

      // T21.3e: Half-Open probe and auto-recovery after cooldown
      // Refill token bucket, set cooldown_until to the past
      db._tokenBuckets.set('cert_provision:acme_smoothing', {
        key: 'cert_provision:acme_smoothing',
        tokens: 5,
        last_refill: new Date().toISOString(),
        capacity: 5,
        refill_rate: 10 / 60
      });
      cbState.state = 'OPEN';
      cbState.cooldown_until = new Date(Date.now() - 1000).toISOString();
      db._rateLimits.delete('cert_provision:bb0000000001');

      // Mock successful order for probe
      const dummyCert = await issueCertificateFromCSR(await parseCSR(globalCsr), 90);
      globalThis.fetch = async (input, init) => {
        const url = typeof input === 'string' ? input : (input instanceof Request ? input.url : String(input));
        if (url === 'https://acme.test/directory') {
          return new Response(JSON.stringify({
            newNonce: 'https://acme.test/nonce',
            newAccount: 'https://acme.test/new-acct',
            newOrder: 'https://acme.test/new-order'
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (url === 'https://acme.test/nonce') {
          return new Response(null, { status: 200, headers: { 'Replay-Nonce': 'nonce-probe' } });
        }
        if (url === 'https://acme.test/new-acct') {
          return new Response(JSON.stringify({ status: 'valid' }), {
            status: 200,
            headers: { 'Location': 'https://acme.test/acct/1', 'Replay-Nonce': 'nonce-probe-2', 'Content-Type': 'application/json' }
          });
        }
        if (url === 'https://acme.test/new-order') {
          return new Response(JSON.stringify({
            status: 'valid',
            authorizations: [],
            finalize: 'https://acme.test/finalize/probe',
            certificate: 'https://acme.test/cert/probe'
          }), {
            status: 201,
            headers: { 'Location': 'https://acme.test/order/probe', 'Replay-Nonce': 'nonce-probe-3', 'Content-Type': 'application/json' }
          });
        }
        if (url === 'https://acme.test/finalize/probe') {
          return new Response(JSON.stringify({
            status: 'valid',
            certificate: 'https://acme.test/cert/probe'
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (url === 'https://acme.test/order/probe') {
          return new Response(JSON.stringify({
            status: 'valid',
            certificate: 'https://acme.test/cert/probe'
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (url === 'https://acme.test/cert/probe') {
          return new Response(dummyCert.certPEM, { status: 200, headers: { 'Content-Type': 'application/pem-certificate-chain' } });
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      };


      const reqProbe = createGlobalReq();
      const respProbe = await handleCertRoutes(reqProbe, prodEnv, ctx, new URL(reqProbe.url), {});
      const dataProbe = await respProbe.json();
      assert(respProbe.status === 200 && dataProbe.cert_pem != null, 'T21.3e: Probe in HALF_OPEN succeeds with 200 OK');
      assert(cbState.state === 'CLOSED' && cbState.failure_count === 0, 'T21.3e2: Circuit breaker successfully self-healed back to CLOSED');
    } finally {
      globalThis.fetch = originalFetch;
    }
  }

  // ── Test 22: SingleFlight Concurrency Request Coalescing ──────
  {
    console.log('\n--- Test 22: SingleFlight Concurrency Coalescing & Conflict Prevention ---');
    certProvisionSingleFlight.clear();

    const db = makeMockDb();
    const ctx = { waitUntil: (p) => p };
    const singleFlightNode = 'cc0000000001';
    const { csrPEM: singleFlightCsr, privateKey: sfPriv } = generateTestCSR(singleFlightNode);
    const ts = Math.floor(Date.now() / 1000);
    const sig = signNodePayload(sfPriv, singleFlightNode, ts);

    const sfAcctKey = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const sfAcctJwk = sfAcctKey.privateKey.export({ format: 'jwk' });
    const dummyCert = await issueCertificateFromCSR(await parseCSR(singleFlightCsr), 90);

    let newOrderCount = 0;
    let holdOrder;
    const holdOrderPromise = new Promise(resolve => { holdOrder = resolve; });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, opts) => {
      if (url === 'https://acme.test/directory') {
        return new Response(JSON.stringify({
          newNonce: 'https://acme.test/new-nonce',
          newAccount: 'https://acme.test/new-acct',
          newOrder: 'https://acme.test/new-order'
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url === 'https://acme.test/new-nonce') {
        return new Response(null, { status: 200, headers: { 'Replay-Nonce': 'nonce-sf' } });
      }
      if (url === 'https://acme.test/new-acct') {
        return new Response(JSON.stringify({ status: 'valid' }), {
          status: 200,
          headers: { 'Location': 'https://acme.test/acct/sf', 'Replay-Nonce': 'nonce-sf-2', 'Content-Type': 'application/json' }
        });
      }
      if (url === 'https://acme.test/new-order') {
        newOrderCount++;
        await holdOrderPromise; // Hold here to guarantee concurrency
        return new Response(JSON.stringify({
          status: 'ready',
          authorizations: [],
          finalize: 'https://acme.test/finalize/sf',
          certificate: 'https://acme.test/cert/sf'
        }), {
          status: 201,
          headers: { 'Location': 'https://acme.test/order/sf', 'Replay-Nonce': 'nonce-sf-2', 'Content-Type': 'application/json' }
        });
      }
      if (url === 'https://acme.test/finalize/sf' || url === 'https://acme.test/order/sf') {
        return new Response(JSON.stringify({
          status: 'valid',
          certificate: 'https://acme.test/cert/sf'
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url === 'https://acme.test/cert/sf') {
        return new Response(dummyCert.certPEM, { status: 200, headers: { 'Content-Type': 'application/pem-certificate-chain' } });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };

    try {
      const sfEnv = {
        DB: db,
        ENVIRONMENT: 'production',
        ACME_DIRECTORY_URL: 'https://acme.test/directory',
        ACME_DNS_API_ENDPOINTS: 'https://ns1.test,https://ns2.test',
        ACME_DNS_API_TOKEN: 'secret-dns-token',
        ACME_ACCOUNT_KEY: JSON.stringify(sfAcctJwk)
      };

      const makeReq = (csrToUse, sigToUse) => new Request('https://drm.eqt.net.im/api/v1/cert/provision', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-EQT-Timestamp': String(ts),
          'X-EQT-Device-Signature': sigToUse || sig,
          'X-EQT-Device-ID': 'sf-device-01'
        },
        body: JSON.stringify({
          node_id: singleFlightNode,
          csr_pem: csrToUse || singleFlightCsr
        })
      });

      // Launch 5 concurrent requests with identical NodeID and CSR
      const p1 = handleCertRoutes(makeReq(), sfEnv, ctx, new URL('https://drm.eqt.net.im/api/v1/cert/provision'), {});
      const p2 = handleCertRoutes(makeReq(), sfEnv, ctx, new URL('https://drm.eqt.net.im/api/v1/cert/provision'), {});
      const p3 = handleCertRoutes(makeReq(), sfEnv, ctx, new URL('https://drm.eqt.net.im/api/v1/cert/provision'), {});
      const p4 = handleCertRoutes(makeReq(), sfEnv, ctx, new URL('https://drm.eqt.net.im/api/v1/cert/provision'), {});
      const p5 = handleCertRoutes(makeReq(), sfEnv, ctx, new URL('https://drm.eqt.net.im/api/v1/cert/provision'), {});

      // Test conflicting CSR while flight is active
      const { csrPEM: differentCsr, privateKey: diffPriv } = generateTestCSR(singleFlightNode); // Different keypair!
      const diffSig = signNodePayload(diffPriv, singleFlightNode, ts);
      const pConflict = handleCertRoutes(makeReq(differentCsr, diffSig), sfEnv, ctx, new URL('https://drm.eqt.net.im/api/v1/cert/provision'), {});

      const respConflict = await pConflict;
      assert(respConflict.status === 409, 'T22.1: Concurrent conflicting CSR for same node rejected with 409');
      const conflictData = await respConflict.json();
      assert(conflictData.reason_key === 'concurrent_csr_conflict', 'T22.1b: Rejection reason_key is concurrent_csr_conflict');

      // Now release the held order
      holdOrder();

      const [r1, r2, r3, r4, r5] = await Promise.all([p1, p2, p3, p4, p5]);

      assert(newOrderCount === 1, 'T22.2: Outbound ACME newOrder strictly executed only once for 5 concurrent callers');
      assert(r1.status === 200, 'T22.3: r1 returned 200 OK');
      assert(r2.status === 200, 'T22.3: r2 returned 200 OK');
      assert(r3.status === 200, 'T22.3: r3 returned 200 OK');
      assert(r4.status === 200, 'T22.3: r4 returned 200 OK');
      assert(r5.status === 200, 'T22.3: r5 returned 200 OK');

      assert(r1.headers.get('X-SingleFlight-Shared') == null, 'T22.4: Leader request r1 is not marked shared');
      assert(r2.headers.get('X-SingleFlight-Shared') === 'true', 'T22.4: Follower r2 marked with X-SingleFlight-Shared: true');
      assert(r3.headers.get('X-SingleFlight-Shared') === 'true', 'T22.4: Follower r3 marked with X-SingleFlight-Shared: true');
      assert(r4.headers.get('X-SingleFlight-Shared') === 'true', 'T22.4: Follower r4 marked with X-SingleFlight-Shared: true');
      assert(r5.headers.get('X-SingleFlight-Shared') === 'true', 'T22.4: Follower r5 marked with X-SingleFlight-Shared: true');

      const d1Rate = db._rateLimits.get(`cert_provision:${singleFlightNode}`);
      assert(d1Rate && d1Rate.count === 1, 'T22.5: D1 rate limit only recorded 1 count instead of 5 for coalesced requests');
    } finally {
      globalThis.fetch = originalFetch;
      certProvisionSingleFlight.clear();
    }
  }

  // ── Test 23: Two-Phase Rate Limiting (2PC Hold & Release) ─────
  {
    console.log('\n--- Test 23: Two-Phase Rate Limiting (2PC Hold & Release) ---');
    const db = makeMockDb();
    const ctx = { waitUntil: (p) => p };
    const twoPcNode = 'ee0000000001';
    const { csrPEM: validCsr, privateKey: validPriv } = generateTestCSR(twoPcNode);
    const ts = Math.floor(Date.now() / 1000);
    const sig = signNodePayload(validPriv, twoPcNode, ts);

    // 1. Send invalid CSR (fails at parseCSR with 400)
    const reqInvalid = new Request('https://drm.eqt.net.im/api/v1/cert/provision', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-EQT-Timestamp': String(ts),
        'X-EQT-Device-Signature': sig,
        'X-EQT-Device-ID': '2pc-device'
      },
      body: JSON.stringify({
        node_id: twoPcNode,
        csr_pem: '-----BEGIN CERTIFICATE REQUEST-----\nBADBASE64\n-----END CERTIFICATE REQUEST-----'
      })
    });

    const respInvalid = await handleCertRoutes(reqInvalid, { DB: db }, ctx, new URL(reqInvalid.url), {});
    assert(respInvalid.status === 400, 'T23.1: Invalid CSR returns 400');
    const rateAfterFail = db._rateLimits.get(`cert_provision:${twoPcNode}`);
    assert(rateAfterFail && rateAfterFail.count === 0, 'T23.1b: Slot was released after failure, count is 0');

    // 2. Now send valid CSRs: should allow 3 full successes
    for (let i = 1; i <= 3; i++) {
      const reqValid = new Request('https://drm.eqt.net.im/api/v1/cert/provision', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-EQT-Timestamp': String(ts),
          'X-EQT-Device-Signature': sig,
          'X-EQT-Device-ID': '2pc-device'
        },
        body: JSON.stringify({
          node_id: twoPcNode,
          csr_pem: validCsr
        })
      });
      const resp = await handleCertRoutes(reqValid, { DB: db }, ctx, new URL(reqValid.url), {});
      assert(resp.status === 200, `T23.2: Valid issuance ${i}/3 succeeded with 200 OK`);
      const rateState = db._rateLimits.get(`cert_provision:${twoPcNode}`);
      assert(rateState.count === i, `T23.2b: D1 rate count committed to ${i}`);
    }

    // 3. 4th attempt exceeds max 3 limit
    const reqExceed = new Request('https://drm.eqt.net.im/api/v1/cert/provision', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-EQT-Timestamp': String(ts),
        'X-EQT-Device-Signature': sig,
        'X-EQT-Device-ID': '2pc-device'
      },
      body: JSON.stringify({
        node_id: twoPcNode,
        csr_pem: validCsr
      })
    });
    const respExceed = await handleCertRoutes(reqExceed, { DB: db }, ctx, new URL(reqExceed.url), {});
    assert(respExceed.status === 429, 'T23.3: 4th attempt correctly blocked with 429 rate_limited');
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

runTests().catch(err => {
  console.error('Unhandled test failure:', err);
  process.exit(1);
});

