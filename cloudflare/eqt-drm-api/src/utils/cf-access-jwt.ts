/**
 * Cloudflare Access JWT validation for Admin API.
 * Docs: https://developers.cloudflare.com/cloudflare-one/identity/authorization-cookie/validating-json/
 */

export interface AccessJwtResult {
  ok: boolean;
  email?: string;
  error?: string;
}

interface JwkKey {
  kid?: string;
  kty: string;
  alg?: string;
  n?: string;
  e?: string;
  use?: string;
}

interface CertsResponse {
  keys: JwkKey[];
  public_cert?: { kid: string; cert: string };
  public_certs?: Array<{ kid: string; cert: string }>;
}

// Cache JWKS per isolate (refresh every hour)
let cachedKeys: { fetchedAt: number; keys: CryptoKey[]; kids: Map<string, CryptoKey> } | null = null;
const JWKS_TTL_MS = 60 * 60 * 1000;

function base64UrlToBytes(b64url: string): Uint8Array {
  const padded = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
  const bin = atob(padded + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function parseJwtParts(token: string): { header: any; payload: any; signingInput: string; signature: Uint8Array } | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(new TextDecoder().decode(base64UrlToBytes(parts[0])));
    const payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(parts[1])));
    const signature = base64UrlToBytes(parts[2]);
    return { header, payload, signingInput: `${parts[0]}.${parts[1]}`, signature };
  } catch {
    return null;
  }
}

async function importJwk(jwk: JwkKey): Promise<CryptoKey | null> {
  if (jwk.kty !== 'RSA' || !jwk.n || !jwk.e) return null;
  try {
    return await crypto.subtle.importKey(
      'jwk',
      {
        kty: 'RSA',
        n: jwk.n,
        e: jwk.e,
        alg: jwk.alg || 'RS256',
        ext: true,
        key_ops: ['verify']
      },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify']
    );
  } catch {
    return null;
  }
}

async function loadAccessKeys(teamDomain: string): Promise<{ keys: CryptoKey[]; kids: Map<string, CryptoKey> }> {
  const now = Date.now();
  if (cachedKeys && now - cachedKeys.fetchedAt < JWKS_TTL_MS) {
    return cachedKeys;
  }

  const domain = teamDomain.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const url = `https://${domain}/cdn-cgi/access/certs`;
  const res = await fetch(url, { cf: { cacheTtl: 3600, cacheEverything: true } } as any);
  if (!res.ok) {
    throw new Error(`Failed to fetch Access certs: HTTP ${res.status}`);
  }
  const body = (await res.json()) as CertsResponse;
  const keys: CryptoKey[] = [];
  const kids = new Map<string, CryptoKey>();

  for (const jwk of body.keys || []) {
    const key = await importJwk(jwk);
    if (!key) continue;
    keys.push(key);
    if (jwk.kid) kids.set(jwk.kid, key);
  }

  cachedKeys = { fetchedAt: now, keys, kids };
  return cachedKeys;
}

function audMatches(claimAud: unknown, expectedAud: string): boolean {
  if (!expectedAud) return false;
  if (typeof claimAud === 'string') return claimAud === expectedAud;
  if (Array.isArray(claimAud)) return claimAud.includes(expectedAud);
  return false;
}

function emailAllowed(email: string, allowList: string[]): boolean {
  if (!allowList.length) return true; // if unset, any Access-authenticated email ok
  const lower = email.toLowerCase();
  return allowList.some((e) => e.toLowerCase() === lower);
}

/**
 * Verify Cloudflare Access application JWT.
 * @param teamDomain e.g. myteam.cloudflareaccess.com
 * @param expectedAud Application AUD tag from Zero Trust dashboard
 * @param allowedEmails comma-separated allowlist (empty = any email in JWT)
 */
export async function verifyCloudflareAccessJwt(
  token: string,
  teamDomain: string,
  expectedAud: string,
  allowedEmails: string[] = []
): Promise<AccessJwtResult> {
  const parsed = parseJwtParts(token);
  if (!parsed) return { ok: false, error: 'Malformed Access JWT' };

  const { header, payload, signingInput, signature } = parsed;
  if (header.alg !== 'RS256') {
    return { ok: false, error: `Unsupported JWT alg: ${header.alg}` };
  }

  if (payload.exp && Number(payload.exp) * 1000 < Date.now() - 30_000) {
    return { ok: false, error: 'Access JWT expired' };
  }

  if (!audMatches(payload.aud, expectedAud)) {
    return { ok: false, error: 'Access JWT audience mismatch' };
  }

  const domain = teamDomain.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const iss = String(payload.iss || '');
  if (iss && !iss.includes(domain) && !iss.endsWith(domain)) {
    // iss is typically https://<team>.cloudflareaccess.com
    if (!iss.includes(domain.split('.')[0])) {
      return { ok: false, error: 'Access JWT issuer mismatch' };
    }
  }

  let keyset: { keys: CryptoKey[]; kids: Map<string, CryptoKey> };
  try {
    keyset = await loadAccessKeys(domain);
  } catch (e: any) {
    return { ok: false, error: e?.message || 'JWKS fetch failed' };
  }

  const candidates: CryptoKey[] = [];
  if (header.kid && keyset.kids.has(header.kid)) {
    candidates.push(keyset.kids.get(header.kid)!);
  } else {
    candidates.push(...keyset.keys);
  }

  const data = new TextEncoder().encode(signingInput);
  let verified = false;
  for (const key of candidates) {
    try {
      const ok = await crypto.subtle.verify(
        { name: 'RSASSA-PKCS1-v1_5' },
        key,
        signature,
        data
      );
      if (ok) {
        verified = true;
        break;
      }
    } catch {
      // try next key
    }
  }

  if (!verified) {
    return { ok: false, error: 'Access JWT signature invalid' };
  }

  const email = String(payload.email || payload.common_name || '').trim().toLowerCase();
  if (!email) {
    return { ok: false, error: 'Access JWT missing email claim' };
  }
  if (!emailAllowed(email, allowedEmails)) {
    return { ok: false, error: `Email not allowed: ${email}` };
  }

  return { ok: true, email };
}
