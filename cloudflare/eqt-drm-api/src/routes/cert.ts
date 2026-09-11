import { Env } from '../types';
import { logSystemError } from '../utils/error-logger';
import { isD1RateLimited, logRateLimitHit, clientIpFromRequest } from '../utils/rate-limit';
import { checkManualBlacklist } from '../utils/blacklist';
import { AcmeClient, computeDns01ChallengeValue } from '../utils/acme';

const CERT_TABLE_ENSURED = new WeakSet<object>();

/**
 * Ensures the device_cert_provisions table exists in D1.
 */
export async function ensureCertProvisionsTable(env: Env): Promise<void> {
  if (!env?.DB || CERT_TABLE_ENSURED.has(env.DB)) return;
  try {
    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS device_cert_provisions (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        node_id        TEXT NOT NULL,
        device_id      TEXT DEFAULT NULL,
        common_name    TEXT NOT NULL,
        expires_at     TEXT NOT NULL,
        provisioned_at TEXT NOT NULL,
        client_ip      TEXT DEFAULT NULL,
        trace_id       TEXT DEFAULT NULL
      )
    `).run();
    await env.DB.prepare(
      `CREATE INDEX IF NOT EXISTS idx_cert_provisions_node ON device_cert_provisions(node_id, provisioned_at)`
    ).run();
    await env.DB.prepare(
      `CREATE INDEX IF NOT EXISTS idx_cert_provisions_device ON device_cert_provisions(device_id)`
    ).run();
    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS node_public_keys (
        node_id           TEXT PRIMARY KEY,
        public_key_sha256 TEXT NOT NULL,
        device_id         TEXT DEFAULT NULL,
        first_bound_at    TEXT NOT NULL,
        last_seen_at      TEXT NOT NULL
      )
    `).run();
    await env.DB.prepare(
      `CREATE INDEX IF NOT EXISTS idx_node_public_keys_device ON node_public_keys(device_id)`
    ).run();
    CERT_TABLE_ENSURED.add(env.DB);
  } catch (err: any) {
    const msg = String(err?.message || err);
    if (/already exists/i.test(msg)) {
      CERT_TABLE_ENSURED.add(env.DB);
    } else {
      console.error('Failed to ensure device_cert_provisions or node_public_keys table:', err);
    }
  }
}

// ASN.1 DER Helper Functions
function encodeLength(len: number): Uint8Array {
  if (len < 128) {
    return new Uint8Array([len]);
  }
  const bytes: number[] = [];
  let temp = len;
  while (temp > 0) {
    bytes.unshift(temp & 0xff);
    temp = temp >> 8;
  }
  return new Uint8Array([0x80 | bytes.length, ...bytes]);
}

function encodeTLV(tag: number, value: Uint8Array): Uint8Array {
  const lenBuf = encodeLength(value.length);
  const out = new Uint8Array(1 + lenBuf.length + value.length);
  out[0] = tag;
  out.set(lenBuf, 1);
  out.set(value, 1 + lenBuf.length);
  return out;
}

function decodeLength(buf: Uint8Array, offset: number): { len: number; headerLen: number } {
  const b = buf[offset];
  if ((b & 0x80) === 0) {
    return { len: b, headerLen: 1 };
  }
  const numBytes = b & 0x7f;
  let len = 0;
  for (let i = 0; i < numBytes; i++) {
    len = (len << 8) | buf[offset + 1 + i];
  }
  return { len, headerLen: 1 + numBytes };
}

interface TLVNode {
  tag: number;
  len: number;
  headerLen: number;
  valStart: number;
  valEnd: number;
  raw: Uint8Array;
  value: Uint8Array;
  nextOffset: number;
}

function parseTLV(buf: Uint8Array, offset = 0): TLVNode | null {
  if (offset >= buf.length) return null;
  const tag = buf[offset];
  const { len, headerLen } = decodeLength(buf, offset + 1);
  const valStart = offset + 1 + headerLen;
  const valEnd = valStart + len;
  const raw = buf.subarray(offset, valEnd);
  const value = buf.subarray(valStart, valEnd);
  return { tag, len, headerLen, valStart, valEnd, raw, value, nextOffset: valEnd };
}

function parseChildren(valueBuf: Uint8Array): TLVNode[] {
  const children: TLVNode[] = [];
  let offset = 0;
  while (offset < valueBuf.length) {
    const tlv = parseTLV(valueBuf, offset);
    if (!tlv) break;
    children.push(tlv);
    offset = tlv.nextOffset;
  }
  return children;
}

export interface ParsedCSR {
  commonName: string;
  dnsNames: string[];
  subjectDER: Uint8Array;
  spkiDER: Uint8Array;
  rawDER: Uint8Array;
}

export function parseCSR(pemStr: string): ParsedCSR {
  const cleanPEM = pemStr
    .replace(/-----BEGIN (NEW )?CERTIFICATE REQUEST-----/, '')
    .replace(/-----END (NEW )?CERTIFICATE REQUEST-----/, '')
    .replace(/\s+/g, '');

  if (!cleanPEM) {
    throw new Error('empty or invalid certificate request PEM');
  }

  // Base64 decode
  let binaryStr: string;
  if (typeof Buffer !== 'undefined') {
    binaryStr = Buffer.from(cleanPEM, 'base64').toString('binary');
  } else {
    binaryStr = atob(cleanPEM);
  }

  const der = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    der[i] = binaryStr.charCodeAt(i);
  }

  const root = parseTLV(der, 0);
  if (!root || root.tag !== 0x30) {
    throw new Error('CSR root must be ASN.1 SEQUENCE');
  }

  const rootChildren = parseChildren(root.value);
  if (rootChildren.length < 1) {
    throw new Error('invalid CSR structure: missing CertificationRequestInfo');
  }

  const reqInfo = rootChildren[0];
  const reqInfoChildren = parseChildren(reqInfo.value);
  if (reqInfoChildren.length < 3) {
    throw new Error('invalid CertificationRequestInfo: insufficient fields');
  }

  const subject = reqInfoChildren[1];
  const spki = reqInfoChildren[2];

  let commonName = '';
  const textDecoder = new TextDecoder('utf-8');

  // Extract CommonName from subject RDNs
  for (const rdn of parseChildren(subject.value)) {
    for (const atv of parseChildren(rdn.value)) {
      const parts = parseChildren(atv.value);
      if (parts.length >= 2 && parts[0].tag === 0x06) {
        const oid = parts[0].value;
        // OID 2.5.4.3 is 55 04 03 (CommonName)
        if (oid.length === 3 && oid[0] === 0x55 && oid[1] === 0x04 && oid[2] === 0x03) {
          commonName = textDecoder.decode(parts[1].value);
        }
      }
    }
  }

  // Extract SAN from attributes
  const dnsNames: string[] = [];
  if (reqInfoChildren.length > 3) {
    const attrs = reqInfoChildren[3];
    const raw = attrs.raw;
    // Look for SAN OID 2.5.29.17: 55 1d 11
    for (let i = 0; i < raw.length - 3; i++) {
      if (raw[i] === 0x55 && raw[i + 1] === 0x1d && raw[i + 2] === 0x11) {
        let p = i + 3;
        while (p < raw.length - 2) {
          if (raw[p] === 0x82) { // dNSName tag [2]
            const { len, headerLen } = decodeLength(raw, p + 1);
            const strBytes = raw.subarray(p + 1 + headerLen, p + 1 + headerLen + len);
            dnsNames.push(textDecoder.decode(strBytes));
            p = p + 1 + headerLen + len;
          } else {
            p++;
          }
        }
        break;
      }
    }
  }

  return {
    commonName,
    dnsNames,
    subjectDER: subject.raw,
    spkiDER: spki.raw,
    rawDER: der
  };
}

export function parseCertificateExpiry(pemStr: string): Date {
  const match = pemStr.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/);
  const targetPEM = match ? match[0] : pemStr;
  const cleanPEM = targetPEM
    .replace(/-----BEGIN CERTIFICATE-----/, '')
    .replace(/-----END CERTIFICATE-----/, '')
    .replace(/\s+/g, '');

  if (!cleanPEM) {
    throw new Error('empty or invalid certificate PEM');
  }

  let binaryStr: string;
  if (typeof Buffer !== 'undefined') {
    binaryStr = Buffer.from(cleanPEM, 'base64').toString('binary');
  } else {
    binaryStr = atob(cleanPEM);
  }

  const der = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    der[i] = binaryStr.charCodeAt(i);
  }

  const root = parseTLV(der, 0);
  if (!root || root.tag !== 0x30) {
    throw new Error('certificate root must be ASN.1 SEQUENCE');
  }

  const rootChildren = parseChildren(root.value);
  if (rootChildren.length < 3) {
    throw new Error('invalid X.509 certificate structure');
  }

  const tbs = rootChildren[0];
  const tbsChildren = parseChildren(tbs.value);
  let validityIdx = 3;
  if (tbsChildren.length > 0 && tbsChildren[0].tag === 0xa0) {
    validityIdx = 4;
  }
  if (tbsChildren.length <= validityIdx) {
    throw new Error('validity field not found in certificate TBS');
  }

  const validity = tbsChildren[validityIdx];
  const vChildren = parseChildren(validity.value);
  if (vChildren.length < 2) {
    throw new Error('invalid validity sequence in certificate');
  }

  const notAfterNode = vChildren[1];
  let timeStr = '';
  for (let i = 0; i < notAfterNode.value.length; i++) {
    timeStr += String.fromCharCode(notAfterNode.value[i]);
  }

  if (notAfterNode.tag === 0x17) {
    // UTCTime: YYMMDDHHMMSSZ
    const yy = parseInt(timeStr.substring(0, 2), 10);
    const year = yy >= 50 ? 1900 + yy : 2000 + yy;
    const month = parseInt(timeStr.substring(2, 4), 10) - 1;
    const day = parseInt(timeStr.substring(4, 6), 10);
    const hour = parseInt(timeStr.substring(6, 8), 10);
    const minute = parseInt(timeStr.substring(8, 10), 10);
    const second = parseInt(timeStr.substring(10, 12), 10);
    return new Date(Date.UTC(year, month, day, hour, minute, second));
  } else if (notAfterNode.tag === 0x18) {
    // GeneralizedTime: YYYYMMDDHHMMSSZ
    const year = parseInt(timeStr.substring(0, 4), 10);
    const month = parseInt(timeStr.substring(4, 6), 10) - 1;
    const day = parseInt(timeStr.substring(6, 8), 10);
    const hour = parseInt(timeStr.substring(8, 10), 10);
    const minute = parseInt(timeStr.substring(10, 12), 10);
    const second = parseInt(timeStr.substring(12, 14), 10);
    return new Date(Date.UTC(year, month, day, hour, minute, second));
  } else {
    throw new Error(`unsupported time tag in certificate validity: 0x${notAfterNode.tag.toString(16)}`);
  }
}

function formatUTCTime(d: Date): Uint8Array {
  const pad = (n: number) => (n < 10 ? '0' + n : '' + n);
  const yy = pad(d.getUTCFullYear() % 100);
  const mm = pad(d.getUTCMonth() + 1);
  const dd = pad(d.getUTCDate());
  const hh = pad(d.getUTCHours());
  const mi = pad(d.getUTCMinutes());
  const ss = pad(d.getUTCSeconds());
  const str = `${yy}${mm}${dd}${hh}${mi}${ss}Z`;
  const buf = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) buf[i] = str.charCodeAt(i);
  return buf;
}

function concatBuffers(...bufs: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const b of bufs) total += b.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const b of bufs) {
    out.set(b, offset);
    offset += b.length;
  }
  return out;
}

/**
 * Generates a 16-byte random serial number strictly conforming to RFC 5280 and X.690 DER INTEGER rules:
 * - MSB is 0 (positive integer without requiring a leading 0x00 padding byte)
 * - First byte is in range [0x01, 0x7f] (non-zero, preventing redundant leading zero)
 * - Exactly 16 bytes
 */
export function generateCompliantSerialNumber(): Uint8Array {
  const serialBytes = new Uint8Array(16);
  crypto.getRandomValues(serialBytes);
  serialBytes[0] = (serialBytes[0] & 0x7f) | 0x01; // Ensure positive and non-zero high byte
  return serialBytes;
}

/**
 * Issues an X.509 certificate conforming to RFC 5280 from a client CSR
 * using Web Crypto (ECDSA P-256 + SHA-256).
 */
export async function issueCertificateFromCSR(
  csr: ParsedCSR,
  validityDays = 90,
  signingKey?: CryptoKey
): Promise<{ certPEM: string; expiresAt: string }> {
  // 1. Version [0] EXPLICIT INTEGER (v3: 2) -> A0 03 02 01 02
  const versionDER = new Uint8Array([0xa0, 0x03, 0x02, 0x01, 0x02]);

  // 2. Serial Number (INTEGER, positive random 16 bytes with non-zero high byte for canonical DER)
  const serialBytes = generateCompliantSerialNumber();
  const serialDER = encodeTLV(0x02, serialBytes);

  // 3. Signature Algorithm Identifier (ecdsa-with-SHA256: 1.2.840.10045.4.3.2)
  // 30 0a 06 08 2a 86 48 ce 3d 04 03 02
  const sigAlgDER = new Uint8Array([0x30, 0x0a, 0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x04, 0x03, 0x02]);

  // 4. Issuer Name (SEQUENCE) -> O=EQT LAN-TLS, CN=EQT LAN-TLS Intermediate CA
  const enc = new TextEncoder();
  const issuerCNVal = enc.encode('EQT LAN-TLS Intermediate CA');
  const issuerOrgVal = enc.encode('EQT LAN-TLS');

  const issuerCN = encodeTLV(0x30, concatBuffers(
    new Uint8Array([0x06, 0x03, 0x55, 0x04, 0x03]),
    encodeTLV(0x13, issuerCNVal)
  ));
  const issuerOrg = encodeTLV(0x30, concatBuffers(
    new Uint8Array([0x06, 0x03, 0x55, 0x04, 0x0a]),
    encodeTLV(0x13, issuerOrgVal)
  ));
  const issuerDER = encodeTLV(0x30, concatBuffers(
    encodeTLV(0x31, issuerOrg),
    encodeTLV(0x31, issuerCN)
  ));

  // 5. Validity (SEQUENCE: notBefore UTCTime, notAfter UTCTime)
  const notBefore = new Date(Date.now() - 3600 * 1000); // Backdate 1 hour for clock skew
  const notAfter = new Date(Date.now() + validityDays * 24 * 3600 * 1000);
  const validityDER = encodeTLV(0x30, concatBuffers(
    encodeTLV(0x17, formatUTCTime(notBefore)),
    encodeTLV(0x17, formatUTCTime(notAfter))
  ));

  // 6. Subject (from CSR)
  const subjectDER = csr.subjectDER;

  // 7. SubjectPublicKeyInfo (from CSR)
  const spkiDER = csr.spkiDER;

  // 8. Extensions [3] EXPLICIT (SAN + BasicConstraints)
  const sanEntries = csr.dnsNames.map(name => encodeTLV(0x82, enc.encode(name)));
  const sanSeq = encodeTLV(0x30, concatBuffers(...sanEntries));
  const sanExtValue = encodeTLV(0x04, sanSeq);
  const sanExt = encodeTLV(0x30, concatBuffers(
    new Uint8Array([0x06, 0x03, 0x55, 0x1d, 0x11]), // 2.5.29.17
    sanExtValue
  ));

  // Basic Constraints: 2.5.29.19 (cA=false)
  const bcExtValue = encodeTLV(0x04, encodeTLV(0x30, new Uint8Array(0)));
  const bcExt = encodeTLV(0x30, concatBuffers(
    new Uint8Array([0x06, 0x03, 0x55, 0x1d, 0x13]),
    bcExtValue
  ));

  const extensionsSeq = encodeTLV(0x30, concatBuffers(sanExt, bcExt));
  const extensionsDER = encodeTLV(0xa3, extensionsSeq);

  // Assemble TBSCertificate
  const tbsDER = encodeTLV(0x30, concatBuffers(
    versionDER,
    serialDER,
    sigAlgDER,
    issuerDER,
    validityDER,
    subjectDER,
    spkiDER,
    extensionsDER
  ));

  // 9. Sign TBSCertificate with ECDSA P-256
  let caKey: CryptoKey;
  if (signingKey) {
    caKey = signingKey;
  } else {
    const keyPair = (await crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['sign']
    )) as CryptoKeyPair;
    caKey = keyPair.privateKey;
  }

  const rawSig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    caKey,
    tbsDER
  );

  // WebCrypto ECDSA returns IEEE P1363 format (r || s, 64 bytes for P-256).
  // Standard X.509 requires ASN.1 DER SEQUENCE { r INTEGER, s INTEGER }.
  const p1363Sig = new Uint8Array(rawSig);
  const rBytes = p1363Sig.subarray(0, 32);
  const sBytes = p1363Sig.subarray(32, 64);

  function makeDerInteger(bytes: Uint8Array): Uint8Array {
    let start = 0;
    while (start < bytes.length - 1 && bytes[start] === 0) {
      start++;
    }
    const trimmed = bytes.subarray(start);
    if ((trimmed[0] & 0x80) !== 0) {
      const padded = new Uint8Array(trimmed.length + 1);
      padded[0] = 0x00;
      padded.set(trimmed, 1);
      return encodeTLV(0x02, padded);
    }
    return encodeTLV(0x02, trimmed);
  }

  const rDER = makeDerInteger(rBytes);
  const sDER = makeDerInteger(sBytes);
  const derSig = encodeTLV(0x30, concatBuffers(rDER, sDER));

  // signatureValue BIT STRING: 03 <len> 00 <derSig>
  const sigBitString = encodeTLV(0x03, concatBuffers(new Uint8Array([0x00]), derSig));

  // Complete Certificate SEQUENCE
  const certDER = encodeTLV(0x30, concatBuffers(
    tbsDER,
    sigAlgDER,
    sigBitString
  ));

  // Convert to PEM
  let binaryStr = '';
  for (let i = 0; i < certDER.length; i++) {
    binaryStr += String.fromCharCode(certDER[i]);
  }
  let b64: string;
  if (typeof Buffer !== 'undefined') {
    b64 = Buffer.from(certDER).toString('base64');
  } else {
    b64 = btoa(binaryStr);
  }

  const lines = b64.match(/.{1,64}/g) || [];
  const certPEM = `-----BEGIN CERTIFICATE-----\n${lines.join('\n')}\n-----END CERTIFICATE-----\n`;

  return {
    certPEM,
    expiresAt: notAfter.toISOString()
  };
}

export async function setDns01Challenge(
  endpoints: string[],
  token: string,
  record: string,
  value: string,
  ttl = 300
): Promise<void> {
  const errors: string[] = [];
  const succeededEndpoints: string[] = [];
  for (const ep of endpoints) {
    try {
      const url = `${ep.replace(/\/+$/, '')}/acme/challenge`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ record, value, ttl })
      });
      if (!res.ok) {
        errors.push(`${ep}: HTTP ${res.status}`);
      } else {
        succeededEndpoints.push(ep);
      }
    } catch (e: any) {
      errors.push(`${ep}: ${e?.message}`);
    }
  }
  if (errors.length > 0) {
    // Immediate rollback of any endpoints that succeeded before throwing (FINDING 8: zero DNS TXT residue)
    if (succeededEndpoints.length > 0) {
      try {
        await clearDns01Challenge(succeededEndpoints, token, record, value);
      } catch (rollbackErr: any) {
        console.warn(`[ACME] Rollback warning clearing partial DNS challenge: ${rollbackErr?.message}`);
      }
    }
    throw new Error(`failed to set DNS challenge on ${errors.length}/${endpoints.length} authoritative endpoint(s): ${errors.join(', ')}`);
  }
}

export async function clearDns01Challenge(
  endpoints: string[],
  token: string,
  record: string,
  value: string
): Promise<void> {
  for (const ep of endpoints) {
    try {
      const url = `${ep.replace(/\/+$/, '')}/acme/challenge?record=${encodeURIComponent(record)}&value=${encodeURIComponent(value)}`;
      await fetch(url, {
        method: 'DELETE',
        headers: {
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        }
      });
    } catch (e: any) {
      console.warn(`[ACME] Failed to delete DNS challenge on ${ep}:`, e?.message);
    }
  }
}

/**
 * Primary HTTP router for Certificate operations (/api/v1/cert/*)
 */
export async function handleCertRoutes(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  url: URL,
  corsHeaders: Record<string, string>
): Promise<Response | null> {
  // Only handle /api/v1/cert/provision
  if (url.pathname !== '/api/v1/cert/provision') {
    return null;
  }

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  const startTime = Date.now();
  const traceId = request.headers.get('X-Trace-Id') || crypto.randomUUID();
  const clientIp = clientIpFromRequest(request);
  const deviceIdHeader = request.headers.get('X-EQT-Device-ID') || '';
  const timestampHeader = request.headers.get('X-EQT-Timestamp') || '';

  let body: any = {};
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({
      error: 'Invalid JSON payload in request body',
      reason_key: 'invalid_json'
    }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  const { csr_pem, node_id } = body;
  const cleanNode = String(node_id || '').toLowerCase().trim();

  // 1. Validate required fields
  if (!csr_pem || !cleanNode) {
    return new Response(JSON.stringify({
      error: 'Both node_id and csr_pem are required',
      reason_key: 'missing_parameters'
    }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  // 2. Validate node_id format: strict 12-char lowercase hex
  if (!/^[a-f0-9]{12}$/.test(cleanNode)) {
    return new Response(JSON.stringify({
      error: `Invalid node_id: must be a 12-character hex string (got ${cleanNode})`,
      reason_key: 'invalid_node_id'
    }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  // 3. Timestamp anti-replay check (strict +/- 60 seconds tolerance)
  if (!timestampHeader) {
    return new Response(JSON.stringify({
      error: 'Missing required timestamp header (X-EQT-Timestamp)',
      reason_key: 'missing_timestamp'
    }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  const clientTs = parseInt(timestampHeader, 10);
  const nowSec = Math.floor(Date.now() / 1000);
  if (isNaN(clientTs) || Math.abs(nowSec - clientTs) > 60) {
    console.warn(`[LAN-TLS-PROVISION] [WARN] Timestamp skew rejected: nodeID=${cleanNode} clientTs=${clientTs} nowSec=${nowSec}`);
    return new Response(JSON.stringify({
      error: 'Request timestamp is outside the allowed tolerance (+/- 60s)',
      reason_key: 'timestamp_skew'
    }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  // 3.1 Device Signature Proof-of-Possession Header Check
  const sigHeader = request.headers.get('X-EQT-Device-Signature') || request.headers.get('X-EQT-Hardware-Signature');
  if (!sigHeader) {
    console.warn(`[LAN-TLS-PROVISION] [REJECT] Missing signature header for nodeID=${cleanNode}`);
    return new Response(JSON.stringify({
      error: 'Missing required device signature header (X-EQT-Device-Signature)',
      reason_key: 'missing_signature'
    }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  console.log(`[LAN-TLS-PROVISION] [START] Provision request received for nodeID=${cleanNode}, deviceID=${deviceIdHeader}, ip=${clientIp}, traceId=${traceId}`);

  // 4. Blacklist check (if device_id is provided)
  if (deviceIdHeader) {
    const blCheck = await checkManualBlacklist(env, null, '', '', '', {
      checkEmail: false,
      checkDevice: true,
      deviceId: deviceIdHeader
    });
    if (blCheck.isAbusive) {
      console.warn(`[LAN-TLS-PROVISION] [REJECT] Device ${deviceIdHeader} is blacklisted: ${blCheck.reason}`);
      return new Response(JSON.stringify({
        error: blCheck.reason,
        reason_key: blCheck.reasonKey || 'blacklisted'
      }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
  }

  const acmeRequested = Boolean(env.ACME_DIRECTORY_URL || (env.ENVIRONMENT === 'test' && env.ACME_DNS_API_ENDPOINTS));

  // 5. Multi-tier Rate Limiting Defense (Node-level, IP-level, Global Production ceiling)
  // 5.1 Node-ID Rate Limit: Maximum 3 certificate provisions per 24 hours per node_id
  const rateLimitKey = `cert_provision:${cleanNode}`;
  const rateLimited = await isD1RateLimited(env, rateLimitKey, 3, 24 * 3600 * 1000);
  if (rateLimited) {
    await logRateLimitHit(env, 'CERT_PROVISION', rateLimitKey, {
      node_id: cleanNode,
      device_id: deviceIdHeader,
      client_ip: clientIp,
      trace_id: traceId
    });
    console.warn(`[LAN-TLS-PROVISION] [RATE-LIMIT] nodeID=${cleanNode} exceeded 24h limit`);
    return new Response(JSON.stringify({
      error: 'Certificate issuance rate limit exceeded (maximum 3 requests per 24 hours)',
      reason_key: 'rate_limited',
      retry_after: 86400
    }), {
      status: 429,
      headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Retry-After': '86400' }
    });
  }

  // 5.2 IP-level Rate Limit: Maximum 10 certificate provisions per 24 hours per IP
  if (clientIp && clientIp !== 'unknown' && clientIp !== '127.0.0.1') {
    const ipRateLimitKey = `cert_provision:ip:${clientIp}`;
    const ipRateLimited = await isD1RateLimited(env, ipRateLimitKey, 10, 24 * 3600 * 1000);
    if (ipRateLimited) {
      await logRateLimitHit(env, 'CERT_PROVISION_IP', ipRateLimitKey, {
        node_id: cleanNode,
        device_id: deviceIdHeader,
        client_ip: clientIp,
        trace_id: traceId
      });
      console.warn(`[LAN-TLS-PROVISION] [RATE-LIMIT] IP ${clientIp} exceeded 24h limit`);
      return new Response(JSON.stringify({
        error: 'Too many certificate requests from this IP address (maximum 10 per 24 hours)',
        reason_key: 'ip_rate_limited',
        retry_after: 86400
      }), {
        status: 429,
        headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Retry-After': '86400' }
      });
    }
  }

  // 5.3 Global Production Safety Guard: Prevent burning Let's Encrypt 50 certs/week ceiling
  if (env.ENVIRONMENT === 'production' && acmeRequested) {
    const globalRateLimitKey = 'cert_provision:global_acme';
    const globalRateLimited = await isD1RateLimited(env, globalRateLimitKey, 40, 7 * 24 * 3600 * 1000);
    if (globalRateLimited) {
      await logRateLimitHit(env, 'CERT_PROVISION_GLOBAL', globalRateLimitKey, {
        node_id: cleanNode,
        device_id: deviceIdHeader,
        client_ip: clientIp,
        trace_id: traceId
      });
      console.error(`[LAN-TLS-PROVISION] [RATE-LIMIT] Global ACME production safety threshold reached (40/week)`);
      return new Response(JSON.stringify({
        error: 'Global production certificate issuance threshold reached. Plain LAN HTTP fallback active.',
        reason_key: 'global_rate_limited',
        retry_after: 604800
      }), {
        status: 429,
        headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Retry-After': '604800' }
      });
    }
  }

  // 6. Cryptographic CSR Parsing & Domain Sanity Check
  let parsedCSR: ParsedCSR;
  try {
    parsedCSR = parseCSR(String(csr_pem));
  } catch (err: any) {
    console.error(`[LAN-TLS-PROVISION] [ERROR] Phase=CSR_PARSE nodeID=${cleanNode} err=${err?.message}`);
    return new Response(JSON.stringify({
      error: `Invalid certificate signing request: ${err?.message}`,
      reason_key: 'invalid_csr'
    }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  const expectedCommonName = `${cleanNode}.direct.eqt.net.im`;
  const expectedWildcard = `*.${cleanNode}.direct.eqt.net.im`;

  if (parsedCSR.commonName !== expectedCommonName) {
    console.warn(`[LAN-TLS-PROVISION] [ERROR] CommonName mismatch: got ${parsedCSR.commonName}, want ${expectedCommonName}`);
    return new Response(JSON.stringify({
      error: `CommonName in CSR (${parsedCSR.commonName}) does not match required node domain (${expectedCommonName})`,
      reason_key: 'invalid_csr'
    }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  // Verify SAN contains both exact domain and wildcard subdomain
  const hasExact = parsedCSR.dnsNames.includes(expectedCommonName);
  const hasWildcard = parsedCSR.dnsNames.includes(expectedWildcard);
  if (!hasExact || !hasWildcard) {
    console.warn(`[LAN-TLS-PROVISION] [ERROR] SAN mismatch: names=${JSON.stringify(parsedCSR.dnsNames)}, need exact and wildcard`);
    return new Response(JSON.stringify({
      error: `Subject Alternative Names in CSR must include both ${expectedCommonName} and ${expectedWildcard}`,
      reason_key: 'invalid_csr'
    }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  // 6.1 Cryptographic Proof of Possession (POPO) Verification
  try {
    const clientPubKey = await crypto.subtle.importKey(
      'spki',
      parsedCSR.spkiDER,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify']
    );

    let sigBinary: string;
    if (typeof Buffer !== 'undefined') {
      sigBinary = Buffer.from(sigHeader, 'base64').toString('binary');
    } else {
      sigBinary = atob(sigHeader);
    }
    const rawSig = new Uint8Array(sigBinary.length);
    for (let i = 0; i < sigBinary.length; i++) {
      rawSig[i] = sigBinary.charCodeAt(i);
    }

    if (rawSig.length !== 64) {
      throw new Error(`invalid signature length: expected 64 bytes IEEE P1363, got ${rawSig.length}`);
    }

    const canonicalMsg = new TextEncoder().encode(`${cleanNode}:${clientTs}`);
    const valid = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      clientPubKey,
      rawSig,
      canonicalMsg
    );

    if (!valid) {
      console.warn(`[LAN-TLS-PROVISION] [REJECT] Signature mismatch for nodeID=${cleanNode}, clientTs=${clientTs}`);
      return new Response(JSON.stringify({
        error: 'Invalid device signature: proof-of-possession verification failed',
        reason_key: 'invalid_signature'
      }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
  } catch (err: any) {
    console.warn(`[LAN-TLS-PROVISION] [REJECT] Signature verification error nodeID=${cleanNode}: ${err?.message}`);
    return new Response(JSON.stringify({
      error: `Device signature verification error: ${err?.message}`,
      reason_key: 'invalid_signature'
    }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  // 6.2 Node-to-PublicKey Cryptographic Binding (TOFU / First-Use Binding)
  try {
    await ensureCertProvisionsTable(env);
    const pubKeyHashBuf = await crypto.subtle.digest('SHA-256', parsedCSR.spkiDER);
    const pubKeyFingerprint = Array.from(new Uint8Array(pubKeyHashBuf))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    const existingKey = await env.DB.prepare(
      `SELECT public_key_sha256 FROM node_public_keys WHERE node_id = ?`
    ).bind(cleanNode).first<{ public_key_sha256: string }>();

    if (existingKey) {
      if (existingKey.public_key_sha256 !== pubKeyFingerprint) {
        console.warn(`[LAN-TLS-PROVISION] [REJECT] Key mismatch for nodeID=${cleanNode}: bound=${existingKey.public_key_sha256} req=${pubKeyFingerprint}`);
        return new Response(JSON.stringify({
          error: 'Device public key mismatch: this node ID is cryptographically bound to a different keypair',
          reason_key: 'node_key_mismatch'
        }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
      ctx.waitUntil((async () => {
        try {
          await env.DB.prepare(`
            UPDATE node_public_keys SET last_seen_at = ? WHERE node_id = ?
          `).bind(new Date().toISOString(), cleanNode).run();
        } catch (_) {}
      })());
    } else {
      ctx.waitUntil((async () => {
        try {
          await env.DB.prepare(`
            INSERT INTO node_public_keys (node_id, public_key_sha256, device_id, first_bound_at, last_seen_at)
            VALUES (?, ?, ?, ?, ?)
          `).bind(
            cleanNode,
            pubKeyFingerprint,
            deviceIdHeader || null,
            new Date().toISOString(),
            new Date().toISOString()
          ).run();
        } catch (bindErr) {
          console.error(`[LAN-TLS-PROVISION] Failed to bind node public key in D1:`, bindErr);
        }
      })());
    }
  } catch (bindingErr: any) {
    console.warn(`[LAN-TLS-PROVISION] Public key binding check error for nodeID=${cleanNode}:`, bindingErr);
  }

  // 7. Certificate Issuance Engine (RFC 8555 ACME DNS-01 or Fallback Signer)
  try {
    let certPEM: string;
    let expiresAt: string;

    if (acmeRequested) {
      if (!env.ACME_DNS_API_ENDPOINTS) {
        console.error(`[LAN-TLS-PROVISION] [CONFIG-ERROR] ACME requested but ACME_DNS_API_ENDPOINTS is missing`);
        return new Response(JSON.stringify({
          error: 'ACME configuration error: ACME_DNS_API_ENDPOINTS is required for DNS-01 challenges',
          reason_key: 'acme_misconfigured'
        }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
      if (!env.ACME_DNS_API_TOKEN) {
        console.error(`[LAN-TLS-PROVISION] [CONFIG-ERROR] ACME requested but ACME_DNS_API_TOKEN is missing`);
        return new Response(JSON.stringify({
          error: 'ACME configuration error: ACME_DNS_API_TOKEN is required for authoritative DNS updates',
          reason_key: 'acme_misconfigured'
        }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
      if (!env.ACME_ACCOUNT_KEY) {
        console.error(`[LAN-TLS-PROVISION] [CONFIG-ERROR] ACME requested but ACME_ACCOUNT_KEY is missing`);
        return new Response(JSON.stringify({
          error: 'ACME configuration error: ACME_ACCOUNT_KEY is required to prevent account exhaustion',
          reason_key: 'acme_misconfigured'
        }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      console.log(`[LAN-TLS-PROVISION] [ACME] Starting RFC 8555 Let's Encrypt DNS-01 issuance for nodeID=${cleanNode}...`);
      const endpoints = env.ACME_DNS_API_ENDPOINTS.split(',').map(s => s.trim()).filter(Boolean);
      const dnsToken = env.ACME_DNS_API_TOKEN;

      // Route outbound ACME requests to Let's Encrypt via secure reverse proxies (ns1/ns2)
      // to circumvent Cloudflare Edge 525 SSL Handshake Loop while maintaining end-to-end JWS integrity
      const proxyBases = endpoints.map(ep => `${ep.replace(/\/+$/, '')}/le-proxy`);
      const acmeCustomFetch: typeof fetch = async (input, init) => {
        const originalUrl = typeof input === 'string' ? input : (input instanceof Request ? input.url : String(input));
        let proxyPath = '';
        let isLE = false;
        if (originalUrl.startsWith('https://acme-v02.api.letsencrypt.org')) {
          proxyPath = originalUrl.slice('https://acme-v02.api.letsencrypt.org'.length);
          isLE = true;
        } else if (originalUrl.startsWith('https://acme-staging-v02.api.letsencrypt.org')) {
          proxyPath = originalUrl.slice('https://acme-staging-v02.api.letsencrypt.org'.length);
          isLE = true;
        }

        if (isLE && proxyBases.length > 0) {
          let lastErr: any;
          for (const base of proxyBases) {
            try {
              const targetUrl = `${base}${proxyPath}`;
              const res = await fetch(targetUrl, init);
              if (res.status !== 502 && res.status !== 504) {
                return res;
              }
            } catch (err: any) {
              lastErr = err;
            }
          }
          if (lastErr) throw lastErr;
        }

        return await fetch(input, init);
      };

      const acmeClient = await AcmeClient.create({
        directoryUrl: env.ACME_DIRECTORY_URL || 'https://acme-v02.api.letsencrypt.org/directory',
        accountKeyJWK: env.ACME_ACCOUNT_KEY,
        customFetch: acmeCustomFetch
      });
      if (env.ACME_EMAIL) {
        await acmeClient.initAccount(env.ACME_EMAIL);
      }

      const { orderUrl, order } = await acmeClient.newOrder([expectedCommonName, expectedWildcard]);
      const thumbprint = await acmeClient.getThumbprint();

      const cleanupTasks: Array<() => Promise<void>> = [];
      try {
        for (const authzUrl of order.authorizations) {
          const authz = await acmeClient.getAuthorization(authzUrl);
          if (authz.status === 'valid') continue;

          const dnsChall = authz.challenges.find(c => c.type === 'dns-01');
          if (!dnsChall) {
            throw new Error(`no dns-01 challenge found in authorization for ${authz.identifier.value}`);
          }

          const challengeVal = await computeDns01ChallengeValue(dnsChall.token, thumbprint);
          const recordName = `_acme-challenge.${cleanNode}.direct.eqt.net.im.`;
          // Pre-register cleanup task before setting challenge to guarantee cleanup on timeout/abort (FINDING 8)
          cleanupTasks.push(() => clearDns01Challenge(endpoints, dnsToken, recordName, challengeVal));
          await setDns01Challenge(endpoints, dnsToken, recordName, challengeVal);

          await acmeClient.triggerChallenge(dnsChall.url);
        }

        // Wait for all DNS authorizations to be verified and the order to transition to 'ready'
        await acmeClient.pollOrder(orderUrl, 'ready', 60000, 2000);

        await acmeClient.finalizeOrder(order.finalize, parsedCSR.rawDER);
        const validOrder = await acmeClient.pollOrder(orderUrl, 'valid', 90000, 2500);
        if (!validOrder.certificate) {
          throw new Error('ACME order finalized but no certificate URL was returned');
        }

        certPEM = await acmeClient.downloadCertificate(validOrder.certificate);
        try {
          expiresAt = parseCertificateExpiry(certPEM).toISOString();
        } catch (e: any) {
          console.warn(`[ACME] Failed to parse leaf cert expiry, falling back to 90d default: ${e?.message}`);
          expiresAt = new Date(Date.now() + 90 * 24 * 3600 * 1000).toISOString();
        }
      } finally {
        ctx.waitUntil(Promise.all(cleanupTasks.map(fn => fn().catch(err => console.warn('[ACME] DNS cleanup warning:', err)))));
      }
    } else {
      console.log(`[LAN-TLS-PROVISION] [ISSUE] Issuing certificate via standalone CA for nodeID=${cleanNode}...`);
      const issued = await issueCertificateFromCSR(parsedCSR, 90);
      certPEM = issued.certPEM;
      expiresAt = issued.expiresAt;
    }

    // 8. Record audit log into D1 asynchronously
    ctx.waitUntil((async () => {
      try {
        await ensureCertProvisionsTable(env);
        await env.DB.prepare(`
          INSERT INTO device_cert_provisions (node_id, device_id, common_name, expires_at, provisioned_at, client_ip, trace_id)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).bind(
          cleanNode,
          deviceIdHeader || null,
          expectedCommonName,
          expiresAt,
          new Date().toISOString(),
          clientIp || null,
          traceId
        ).run();
      } catch (logErr) {
        console.error(`[LAN-TLS-PROVISION] Failed to record provision in D1:`, logErr);
      }
    })());

    console.log(`[LAN-TLS-PROVISION] [SUCCESS] Certificate issued successfully for nodeID=${cleanNode} in ${Date.now() - startTime}ms (expiresAt=${expiresAt})`);

    return new Response(JSON.stringify({
      cert_pem: certPEM,
      expires_at: expiresAt
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (err: any) {
    console.error(`[LAN-TLS-PROVISION] [ERROR] Issuance failure for nodeID=${cleanNode}:`, err);
    ctx.waitUntil(logSystemError(
      env,
      'CERT_PROVISION_ERROR',
      'ERROR',
      err,
      { node_id: cleanNode, device_id: deviceIdHeader, ip: clientIp },
      traceId
    ));

    return new Response(JSON.stringify({
      error: 'An unexpected error occurred while issuing the certificate',
      reason_key: 'internal_error'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}
