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

const { handleCertRoutes, parseCSR, parseCertificateExpiry, setDns01Challenge, generateCompliantSerialNumber, issueCertificateFromCSR } = require(compiledPath);

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

  return {
    _provisions: provisions,
    _rateLimits: rateLimits,
    _nodeKeys: nodeKeys,
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
          if (sql.includes('FROM rate_limits')) {
            const key = this._binds[0];
            return rateLimits.get(key) || null;
          }
          if (sql.includes('FROM node_public_keys')) {
            const nodeId = this._binds[0];
            return nodeKeys.get(nodeId) || null;
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
            const nodeId = this._binds[1];
            const existing = nodeKeys.get(nodeId);
            if (existing) {
              existing.last_seen_at = this._binds[0];
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
          return { meta: { changes: 1 } };
        }
      };
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
          'X-EQT-Device-Signature': sig
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
        'X-EQT-Device-Signature': sig
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
        'X-EQT-Device-Signature': sig
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
        'X-EQT-Device-Signature': sig
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
        'X-EQT-Device-Signature': sig
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
        if (method === 'POST') {
          dnsSetCalls.push({ url, body: init ? JSON.parse(init.body) : null });
          return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (method === 'DELETE') {
          dnsDeleteCalls.push(url);
          return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
      }
      if (url === 'https://acme.test/chal/1') {
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
          'X-EQT-Device-Signature': sig
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
  }

  // Test 20: First-Use Public Key Binding (TOFU)
  {
    const tofuNode = 'e1f2a3b4c5d6';
    const { csrPEM: csr1, privateKey: priv1 } = generateTestCSR(tofuNode);
    const { csrPEM: csr2, privateKey: priv2 } = generateTestCSR(tofuNode); // Different keypair for same node!
    const db = makeMockDb();
    const ctx = makeMockCtx();
    const nowTs = Math.floor(Date.now() / 1000);

    // 1st request with priv1 binds tofuNode to pubkey1
    const sig1 = signNodePayload(priv1, tofuNode, nowTs);
    const req1 = new Request('http://api.test/api/v1/cert/provision', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-EQT-Timestamp': String(nowTs),
        'X-EQT-Device-Signature': sig1
      },
      body: JSON.stringify({ node_id: tofuNode, csr_pem: csr1 })
    });
    const resp1 = await handleCertRoutes(req1, { DB: db }, ctx, new URL(req1.url), {});
    await ctx.drain();
    assert(resp1.status === 200, 'T20.1: Initial registration with key 1 succeeds and binds key');

    // 2nd request with priv2 (different key!) must be rejected with 403 node_key_mismatch
    const sig2 = signNodePayload(priv2, tofuNode, nowTs);
    const req2 = new Request('http://api.test/api/v1/cert/provision', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-EQT-Timestamp': String(nowTs),
        'X-EQT-Device-Signature': sig2
      },
      body: JSON.stringify({ node_id: tofuNode, csr_pem: csr2 })
    });
    const resp2 = await handleCertRoutes(req2, { DB: db }, ctx, new URL(req2.url), {});
    const data2 = await resp2.json();
    assert(resp2.status === 403 && data2.reason_key === 'node_key_mismatch', 'T20.2: Mismatched public key for bound node returns 403 node_key_mismatch');
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
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

runTests().catch(err => {
  console.error('Unhandled test failure:', err);
  process.exit(1);
});

