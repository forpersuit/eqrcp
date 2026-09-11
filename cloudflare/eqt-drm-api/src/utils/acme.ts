/**
 * Lightweight native Web Crypto implementation of RFC 8555 (ACME)
 * specifically designed for Cloudflare Workers and Serverless environments.
 *
 * Capabilities:
 *  - Standard ECDSA P-256 (ES256) JWS signing without external npm dependencies
 *  - RFC 7638 JWK Thumbprint computation
 *  - RFC 8555 Section 8.4 DNS-01 Key Authorization & TXT challenge computation
 *  - Replay-Nonce auto-retry on badNonce
 *  - Zero external npm packages, 100% native Web Crypto standard
 */

export function base64UrlEncode(buf: Uint8Array | string): string {
  let binary = '';
  if (typeof buf === 'string') {
    const enc = new TextEncoder().encode(buf);
    for (let i = 0; i < enc.length; i++) binary += String.fromCharCode(enc[i]);
  } else {
    for (let i = 0; i < buf.length; i++) binary += String.fromCharCode(buf[i]);
  }
  const b64 = typeof Buffer !== 'undefined' ? Buffer.from(binary, 'binary').toString('base64') : btoa(binary);
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function normalizeBase64Url(str: string): string {
  let b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  return b64;
}

export function base64UrlDecode(str: string): Uint8Array {
  const b64 = normalizeBase64Url(str);
  const binary = typeof Buffer !== 'undefined' ? Buffer.from(b64, 'base64').toString('binary') : atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export interface JwkKey {
  kty: string;
  crv: string;
  x: string;
  y: string;
  d?: string;
}

/**
 * Computes canonical JWK Thumbprint (RFC 7638) for an EC P-256 key.
 * Required fields in lexicographic order: crv, kty, x, y.
 */
export async function computeJWKThumbprint(jwk: JwkKey): Promise<string> {
  const canonical = JSON.stringify({
    crv: jwk.crv,
    kty: jwk.kty,
    x: jwk.x,
    y: jwk.y
  });
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return base64UrlEncode(new Uint8Array(digest));
}

/**
 * Computes the DNS-01 TXT record value from challenge token and account key thumbprint.
 * Value = Base64URL(SHA256(token + "." + thumbprint))
 */
export async function computeDns01ChallengeValue(token: string, thumbprint: string): Promise<string> {
  const keyAuth = `${token}.${thumbprint}`;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(keyAuth));
  return base64UrlEncode(new Uint8Array(digest));
}

export interface AcmeDirectory {
  newNonce: string;
  newAccount: string;
  newOrder: string;
  revokeCert?: string;
  keyChange?: string;
}

export interface AcmeOrder {
  status: 'pending' | 'ready' | 'processing' | 'valid' | 'invalid';
  expires?: string;
  identifiers: Array<{ type: string; value: string }>;
  authorizations: string[];
  finalize: string;
  certificate?: string;
}

export interface AcmeAuthorization {
  status: 'pending' | 'valid' | 'invalid' | 'deactivated' | 'expired';
  identifier: { type: string; value: string };
  challenges: Array<{
    type: string;
    url: string;
    token: string;
    status: 'pending' | 'processing' | 'valid' | 'invalid';
  }>;
}

export interface ExternalAccountBindingOptions {
  keyId: string;
  macKey: string; // Base64 or Base64URL encoded HMAC-SHA256 key from CA
}

/**
 * Computes RFC 8555 Section 7.3.4 External Account Binding (EAB) JWS
 * for Certificate Authorities requiring EAB (e.g. Google Trust Services / GTS Public CA).
 */
export async function computeExternalAccountBinding(
  eab: ExternalAccountBindingOptions,
  accountPublicJwk: JwkKey,
  newAccountUrl: string
): Promise<{
  protected: string;
  payload: string;
  signature: string;
}> {
  const protectedHeader = {
    alg: 'HS256',
    kid: eab.keyId,
    url: newAccountUrl
  };
  const protectedB64 = base64UrlEncode(JSON.stringify(protectedHeader));
  const payloadB64 = base64UrlEncode(JSON.stringify(accountPublicJwk));

  const rawKey = base64UrlDecode(eab.macKey);
  const hmacKey = await crypto.subtle.importKey(
    'raw',
    rawKey,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const dataToSign = new TextEncoder().encode(`${protectedB64}.${payloadB64}`);
  const sigBuf = await crypto.subtle.sign('HMAC', hmacKey, dataToSign);
  const signatureB64 = base64UrlEncode(new Uint8Array(sigBuf));

  return {
    protected: protectedB64,
    payload: payloadB64,
    signature: signatureB64
  };
}

export class AcmeClient {
  private directoryUrl: string;
  private directory?: AcmeDirectory;
  private accountKey: CryptoKey;
  private publicJwk: JwkKey;
  private accountUrl?: string;
  private nonce?: string;
  private customFetch: typeof fetch;
  private eab?: ExternalAccountBindingOptions;

  constructor(opts: {
    directoryUrl: string;
    accountKey: CryptoKey;
    publicJwk: JwkKey;
    accountUrl?: string;
    customFetch?: typeof fetch;
    eab?: ExternalAccountBindingOptions;
  }) {
    this.directoryUrl = opts.directoryUrl;
    this.accountKey = opts.accountKey;
    this.publicJwk = opts.publicJwk;
    this.accountUrl = opts.accountUrl;
    this.customFetch = opts.customFetch || globalThis.fetch.bind(globalThis);
    this.eab = opts.eab;
  }

  static async create(opts: {
    directoryUrl?: string;
    accountKeyJWK?: string;
    accountUrl?: string;
    customFetch?: typeof fetch;
    allowTransientAccountKey?: boolean;
    eab?: ExternalAccountBindingOptions;
  }): Promise<AcmeClient> {
    const dirUrl = opts.directoryUrl || 'https://acme-staging-v02.api.letsencrypt.org/directory';

    let keyPair: CryptoKeyPair;
    let publicJwk: JwkKey;

    if (opts.accountKeyJWK) {
      const parsed = JSON.parse(opts.accountKeyJWK);
      const privKey = await crypto.subtle.importKey(
        'jwk',
        parsed,
        { name: 'ECDSA', namedCurve: 'P-256' },
        true,
        ['sign']
      );
      publicJwk = {
        kty: parsed.kty,
        crv: parsed.crv,
        x: parsed.x,
        y: parsed.y
      };
      return new AcmeClient({
        directoryUrl: dirUrl,
        accountKey: privKey,
        publicJwk,
        accountUrl: opts.accountUrl,
        customFetch: opts.customFetch,
        eab: opts.eab
      });
    }

    if (opts.allowTransientAccountKey) {
      keyPair = (await crypto.subtle.generateKey(
        { name: 'ECDSA', namedCurve: 'P-256' },
        true,
        ['sign', 'verify']
      )) as CryptoKeyPair;
      const jwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey) as JwkKey;
      publicJwk = {
        kty: jwk.kty,
        crv: jwk.crv,
        x: jwk.x,
        y: jwk.y
      };

      return new AcmeClient({
        directoryUrl: dirUrl,
        accountKey: keyPair.privateKey,
        publicJwk,
        accountUrl: opts.accountUrl,
        customFetch: opts.customFetch,
        eab: opts.eab
      });
    }

    throw new Error('accountKeyJWK is required for AcmeClient to ensure consistent account identity (fail loud)');
  }

  async getDirectory(): Promise<AcmeDirectory> {
    if (!this.directory) {
      const res = await this.customFetch(this.directoryUrl);
      if (!res.ok) {
        throw new Error(`failed to load ACME directory: HTTP ${res.status}`);
      }
      this.directory = await res.json() as AcmeDirectory;
    }
    return this.directory;
  }

  async getNonce(): Promise<string> {
    if (this.nonce) {
      const n = this.nonce;
      this.nonce = undefined;
      return n;
    }
    const dir = await this.getDirectory();
    const res = await this.customFetch(dir.newNonce, { method: 'HEAD' });
    const nonce = res.headers.get('Replay-Nonce');
    if (!nonce) {
      throw new Error('ACME server did not return Replay-Nonce');
    }
    return nonce;
  }

  async postSigned(url: string, payload: any): Promise<Response> {
    let attempt = 0;
    while (attempt < 3) {
      attempt++;
      const nonce = await this.getNonce();
      const protectedHeader: Record<string, any> = {
        alg: 'ES256',
        nonce,
        url
      };

      if (this.accountUrl) {
        protectedHeader.kid = this.accountUrl;
      } else {
        protectedHeader.jwk = this.publicJwk;
      }

      const protectedB64 = base64UrlEncode(JSON.stringify(protectedHeader));
      const payloadB64 = payload === '' ? '' : base64UrlEncode(typeof payload === 'string' ? payload : JSON.stringify(payload));
      const signingInput = `${protectedB64}.${payloadB64}`;

      const rawSig = await crypto.subtle.sign(
        { name: 'ECDSA', hash: 'SHA-256' },
        this.accountKey,
        new TextEncoder().encode(signingInput)
      );
      const sigB64 = base64UrlEncode(new Uint8Array(rawSig));

      const jwsBody = JSON.stringify({
        protected: protectedB64,
        payload: payloadB64,
        signature: sigB64
      });

      const res = await this.customFetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/jose+json'
        },
        body: jwsBody
      });

      // Update nonce if returned in header
      const newNonce = res.headers.get('Replay-Nonce');
      if (newNonce) {
        this.nonce = newNonce;
      }

      if (res.status === 400) {
        const cloned = res.clone();
        try {
          const errData = await cloned.json() as any;
          if (errData?.type === 'urn:ietf:params:acme:error:badNonce') {
            console.warn('[ACME] badNonce encountered, retrying with fresh nonce...');
            continue;
          }
        } catch {
          // ignore json parse error
        }
      }

      return res;
    }

    throw new Error('ACME request failed after retrying badNonce');
  }

  async initAccount(contactEmail?: string): Promise<string> {
    if (this.accountUrl) return this.accountUrl;

    const dir = await this.getDirectory();
    const payload: Record<string, any> = {
      termsOfServiceAgreed: true
    };
    if (contactEmail) {
      payload.contact = [`mailto:${contactEmail}`];
    }
    if (this.eab) {
      payload.externalAccountBinding = await computeExternalAccountBinding(
        this.eab,
        this.publicJwk,
        dir.newAccount
      );
    }

    const res = await this.postSigned(dir.newAccount, payload);
    if (!res.ok && res.status !== 200 && res.status !== 201) {
      const errText = await res.text();
      throw new Error(`failed to create/retrieve ACME account (HTTP ${res.status}): ${errText}`);
    }

    const loc = res.headers.get('Location');
    if (!loc) {
      throw new Error('missing Location header in ACME newAccount response');
    }
    this.accountUrl = loc;
    return this.accountUrl;
  }

  async newOrder(domains: string[]): Promise<{ orderUrl: string; order: AcmeOrder }> {
    await this.initAccount();
    const dir = await this.getDirectory();

    const identifiers = domains.map(d => ({ type: 'dns', value: d }));
    const res = await this.postSigned(dir.newOrder, { identifiers });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`failed to create ACME order: HTTP ${res.status}: ${errText}`);
    }

    const orderUrl = res.headers.get('Location');
    if (!orderUrl) {
      throw new Error('missing Location header in newOrder response');
    }

    const order = await res.json() as AcmeOrder;
    return { orderUrl, order };
  }

  async getAuthorization(authzUrl: string): Promise<AcmeAuthorization> {
    const res = await this.postSigned(authzUrl, '');
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`failed to get authorization: HTTP ${res.status}: ${errText}`);
    }
    return await res.json() as AcmeAuthorization;
  }

  async triggerChallenge(challengeUrl: string): Promise<void> {
    const res = await this.postSigned(challengeUrl, {});
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`failed to trigger challenge: HTTP ${res.status}: ${errText}`);
    }
  }

  async finalizeOrder(finalizeUrl: string, csrDer: Uint8Array): Promise<AcmeOrder> {
    const csrB64 = base64UrlEncode(csrDer);
    const res = await this.postSigned(finalizeUrl, { csr: csrB64 });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`failed to finalize ACME order: HTTP ${res.status}: ${errText}`);
    }
    return await res.json() as AcmeOrder;
  }

  async pollOrder(
    orderUrl: string,
    targetStatus: 'ready' | 'valid' = 'valid',
    maxWaitMs = 60000,
    intervalMs = 2000
  ): Promise<AcmeOrder> {
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      const res = await this.postSigned(orderUrl, '');
      if (!res.ok) {
        throw new Error(`failed to poll order: HTTP ${res.status}`);
      }
      const order = await res.json() as AcmeOrder;
      if (order.status === targetStatus || (targetStatus === 'ready' && order.status === 'valid')) {
        return order;
      }
      if (order.status === 'invalid') {
        throw new Error('ACME order transitioned to invalid');
      }
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
    throw new Error(`ACME order poll timeout waiting for ${targetStatus} after ${maxWaitMs}ms`);
  }

  async downloadCertificate(certUrl: string): Promise<string> {
    const res = await this.postSigned(certUrl, '');
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`failed to download certificate: HTTP ${res.status}: ${errText}`);
    }
    return await res.text();
  }

  getThumbprint(): Promise<string> {
    return computeJWKThumbprint(this.publicJwk);
  }
}
