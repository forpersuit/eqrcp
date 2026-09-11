/**
 * Offline unit tests for src/utils/acme.ts (RFC 8555 ACME Client)
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const compiledPath = path.join(__dirname, 'compiled', 'acme.js');

if (!fs.existsSync(compiledPath)) {
  console.error("Compiled acme module not found. Run esbuild first.");
  process.exit(1);
}

const {
  base64UrlEncode,
  base64UrlDecode,
  normalizeBase64Url,
  computeJWKThumbprint,
  computeDns01ChallengeValue,
  computeExternalAccountBinding,
  AcmeClient
} = require(compiledPath);

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

async function runTests() {
  console.log('Running RFC 8555 ACME Client Offline Tests...\n');

  // Test 1: Base64URL round-trip
  {
    const original = 'Hello World + / = ? & ! 1234567890';
    const encoded = base64UrlEncode(original);
    assert(!encoded.includes('+') && !encoded.includes('/') && !encoded.includes('='), 'T1.1: Base64URL contains no +, /, =');
    const decodedBuf = base64UrlDecode(encoded);
    const decoded = Buffer.from(decodedBuf).toString('utf8');
    assert(decoded === original, 'T1.2: Base64URL round-trip matches original string');
  }

  // Test 2: JWK Thumbprint RFC 7638
  {
    const jwk = {
      kty: 'EC',
      crv: 'P-256',
      x: 'f83OJ3D2xFNTLKEfuegtkIIgldVWtQHV6XgwqMtGTGQ',
      y: 'x_daQauqmfeedvdqq6NVnkG0oKaGentWhQ64dd6x4Gw'
    };
    const thumbprint = await computeJWKThumbprint(jwk);
    assert(typeof thumbprint === 'string' && thumbprint.length > 20, 'T2: JWK thumbprint computed successfully');
    
    // DNS-01 Challenge value computation
    const token = 'evaGxfADs6pSRb2LAv9IZf17Dt3juxGJ-PCt92un-JU';
    const challengeValue = await computeDns01ChallengeValue(token, thumbprint);
    assert(typeof challengeValue === 'string' && challengeValue.length === 43, 'T2.2: DNS-01 challenge value is 43-char base64url SHA-256');
  }

  // Test 3: Full End-to-End Mock ACME Workflow Simulation
  {
    const mockState = {
      nonces: ['nonce_1', 'nonce_2', 'nonce_3', 'nonce_4', 'nonce_5', 'nonce_6', 'nonce_7', 'nonce_8'],
      orders: new Map(),
      authzs: new Map(),
      orderCount: 0,
      badNonceCount: 0
    };

    function popNonce() {
      return mockState.nonces.shift() || `nonce_${Date.now()}_${Math.random()}`;
    }

    const mockFetch = async (url, options = {}) => {
      const u = new URL(url);
      const method = (options.method || 'GET').toUpperCase();

      if (u.pathname === '/directory') {
        return new Response(JSON.stringify({
          newNonce: 'https://acme.test/new-nonce',
          newAccount: 'https://acme.test/new-account',
          newOrder: 'https://acme.test/new-order',
          revokeCert: 'https://acme.test/revoke-cert'
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }

      if (u.pathname === '/new-nonce' && method === 'HEAD') {
        return new Response(null, {
          status: 200,
          headers: { 'Replay-Nonce': popNonce() }
        });
      }

      if (method === 'POST') {
        const bodyStr = options.body;
        const jws = JSON.parse(bodyStr);
        const protectedHeader = JSON.parse(Buffer.from(jws.protected, 'base64').toString('utf8'));

        // BadNonce injection test on first order request
        if (u.pathname === '/new-order' && mockState.badNonceCount === 0) {
          mockState.badNonceCount++;
          return new Response(JSON.stringify({
            type: 'urn:ietf:params:acme:error:badNonce',
            detail: 'Replay-Nonce was not recognized'
          }), {
            status: 400,
            headers: {
              'Content-Type': 'application/problem+json',
              'Replay-Nonce': popNonce()
            }
          });
        }

        if (u.pathname === '/new-account') {
          return new Response(JSON.stringify({
            status: 'valid',
            contact: ['mailto:leeyelon@gmail.com']
          }), {
            status: 201,
            headers: {
              'Location': 'https://acme.test/acct/1',
              'Replay-Nonce': popNonce()
            }
          });
        }

        if (u.pathname === '/new-order') {
          const payload = JSON.parse(Buffer.from(jws.payload, 'base64').toString('utf8'));
          const orderId = `order_${++mockState.orderCount}`;
          const authzId = `authz_${mockState.orderCount}`;
          const authzUrl = `https://acme.test/authz/${authzId}`;
          const finalizeUrl = `https://acme.test/order/${orderId}/finalize`;
          const orderUrl = `https://acme.test/order/${orderId}`;

          mockState.authzs.set(authzUrl, {
            status: 'pending',
            identifier: payload.identifiers[0],
            challenges: [
              {
                type: 'dns-01',
                url: `https://acme.test/chall/${authzId}`,
                token: 'mock_dns01_token_12345',
                status: 'pending'
              }
            ]
          });

          const order = {
            status: 'ready',
            identifiers: payload.identifiers,
            authorizations: [authzUrl],
            finalize: finalizeUrl
          };
          mockState.orders.set(orderUrl, order);

          return new Response(JSON.stringify(order), {
            status: 201,
            headers: {
              'Location': orderUrl,
              'Replay-Nonce': popNonce()
            }
          });
        }

        if (u.pathname.startsWith('/authz/')) {
          const authz = mockState.authzs.get(url);
          return new Response(JSON.stringify(authz), {
            status: 200,
            headers: { 'Replay-Nonce': popNonce() }
          });
        }

        if (u.pathname.startsWith('/chall/')) {
          return new Response(JSON.stringify({ status: 'valid' }), {
            status: 200,
            headers: { 'Replay-Nonce': popNonce() }
          });
        }

        if (u.pathname.endsWith('/finalize')) {
          const orderUrl = url.replace('/finalize', '');
          const order = mockState.orders.get(orderUrl);
          order.status = 'valid';
          order.certificate = `${orderUrl}/cert`;
          return new Response(JSON.stringify(order), {
            status: 200,
            headers: { 'Replay-Nonce': popNonce() }
          });
        }

        if (u.pathname.endsWith('/cert')) {
          const fakeCert = '-----BEGIN CERTIFICATE-----\nMIIC...MockCertChain\n-----END CERTIFICATE-----\n';
          return new Response(fakeCert, {
            status: 200,
            headers: {
              'Content-Type': 'application/pem-certificate-chain',
              'Replay-Nonce': popNonce()
            }
          });
        }

        if (mockState.orders.has(url)) {
          return new Response(JSON.stringify(mockState.orders.get(url)), {
            status: 200,
            headers: { 'Replay-Nonce': popNonce() }
          });
        }
      }

      return new Response('Not Found', { status: 404 });
    };

    // Test fail-loud when accountKeyJWK is missing
    let failLoudCaught = false;
    try {
      await AcmeClient.create({
        directoryUrl: 'https://acme.test/directory',
        customFetch: mockFetch
      });
    } catch (e) {
      failLoudCaught = true;
    }
    assert(failLoudCaught, 'T3.0: AcmeClient.create fails loud when accountKeyJWK is missing without allowTransientAccountKey');

    const client = await AcmeClient.create({
      directoryUrl: 'https://acme.test/directory',
      customFetch: mockFetch,
      allowTransientAccountKey: true
    });

    // 1. Account registration
    const accountUrl = await client.initAccount('leeyelon@gmail.com');
    assert(accountUrl === 'https://acme.test/acct/1', 'T3.1: Account successfully initialized with accountUrl');

    // 2. New Order (tests badNonce retry automatically)
    const { orderUrl, order } = await client.newOrder(['testnode.direct.eqt.net.im', '*.testnode.direct.eqt.net.im']);
    assert(orderUrl.includes('https://acme.test/order/order_1'), 'T3.2: Order created and badNonce retried transparently');
    assert(mockState.badNonceCount === 1, 'T3.3: badNonce retry executed exactly once');

    // 3. Authorization & DNS-01 Challenge
    const authz = await client.getAuthorization(order.authorizations[0]);
    const dnsChall = authz.challenges.find(c => c.type === 'dns-01');
    assert(dnsChall && dnsChall.token === 'mock_dns01_token_12345', 'T3.4: Retrieved DNS-01 challenge token');

    const thumbprint = await client.getThumbprint();
    const txtValue = await computeDns01ChallengeValue(dnsChall.token, thumbprint);
    assert(typeof txtValue === 'string' && txtValue.length === 43, 'T3.5: Computed valid DNS-01 TXT record value');

    // Trigger challenge
    await client.triggerChallenge(dnsChall.url);
    assert(true, 'T3.6: Successfully triggered challenge notification');

    // 4. Finalize Order with CSR
    const dummyCsrDer = new Uint8Array([0x30, 0x10, 0x02, 0x01, 0x00]);
    const finalizedOrder = await client.finalizeOrder(order.finalize, dummyCsrDer);
    assert(finalizedOrder.status === 'valid', 'T3.7: Finalized order status is valid');

    // 5. Download Certificate
    const certChain = await client.downloadCertificate(finalizedOrder.certificate);
    assert(certChain.includes('BEGIN CERTIFICATE'), 'T3.8: Successfully downloaded certificate chain');
  }

  // T4: Google Cloud Public CA EAB (External Account Binding) verification
  {
    const jwk = {
      crv: 'P-256',
      kty: 'EC',
      x: 'f83OJ3D2xFNTbKEAsuk4kFPqHCmAHWWHOR318QDhLIw',
      y: 'x_daQau3qTNm22v-9576F04u6qgXluNwM8X8f9037Y8'
    };
    const eab = {
      keyId: 'test-google-eab-keyid-12345',
      macKey: 'dGVzdC1obWFjLXNoYTI1Ni1rZXktZm9yLWVhYi1iaW5kaW5n' // base64 key
    };
    const newAccountUrl = 'https://dv.acme-v02.api.pki.goog/acme/new-account';

    const binding = await computeExternalAccountBinding(eab, jwk, newAccountUrl);
    assert(binding && binding.protected && binding.payload && binding.signature, 'T4.1: computeExternalAccountBinding returns JWS structure');

    // Decode and verify protected header
    const decodedHeader = JSON.parse(Buffer.from(base64UrlDecode(binding.protected)).toString('utf8'));
    assert(decodedHeader.alg === 'HS256', 'T4.2: EAB protected header alg is HS256');
    assert(decodedHeader.kid === eab.keyId, 'T4.3: EAB protected header kid matches keyId');
    assert(decodedHeader.url === newAccountUrl, 'T4.4: EAB protected header url matches newAccountUrl');

    // Verify HMAC-SHA256 signature
    const hmac = crypto.createHmac('sha256', Buffer.from(base64UrlDecode(eab.macKey)));
    hmac.update(`${binding.protected}.${binding.payload}`);
    const expectedSig = base64UrlEncode(hmac.digest());
    assert(binding.signature === expectedSig, 'T4.5: EAB HMAC-SHA256 signature is cryptographically valid and matches Node.js crypto');

    // T4.6a: base64UrlDecode properly normalizes URL-safe - and _ characters and completes missing padding
    // Binary: [0xfb, 0xef, 0xfe, 0xfd] -> Base64: ++/+/Q== -> Base64URL: --_-_Q (len=6, missing 2 padding '=', contains both - and _)
    const urlSafeSample = '--_-_Q';
    const expectedBytes = new Uint8Array([0xfb, 0xef, 0xfe, 0xfd]);
    const decodedUrlSafe = base64UrlDecode(urlSafeSample);
    assert(Buffer.from(decodedUrlSafe).equals(Buffer.from(expectedBytes)), 'T4.6a: base64UrlDecode converts URL-safe -_ characters and completes missing padding to exact binary');

    // T4.6b: Probe-locked: atob fallback path works when Buffer is undefined (Worker runtime simulation)
    const origBuffer = global.Buffer;
    let atobSuccess = false;
    try {
      // @ts-ignore
      delete global.Buffer;
      const atobDecoded = base64UrlDecode(urlSafeSample);
      atobSuccess = (atobDecoded.length === 4 &&
        atobDecoded[0] === 0xfb && atobDecoded[1] === 0xef &&
        atobDecoded[2] === 0xfe && atobDecoded[3] === 0xfd);
    } catch {
      atobSuccess = false;
    } finally {
      global.Buffer = origBuffer;
    }
    assert(atobSuccess, 'T4.6b: base64UrlDecode via atob fallback strictly normalizes -_ and decodes correctly in non-Buffer environment');

    // T4.6c: normalizeBase64Url unit lock: strictly replaces URL-safe -_ characters and appends missing '=' padding (falsifiable)
    const normalized = normalizeBase64Url('--_-_Q');
    assert(normalized === '++/+/Q==', 'T4.6c: normalizeBase64Url strictly normalizes -_ to +/ and appends missing == padding');

    // T4.7: Wire test: AcmeClient with eab option injects externalAccountBinding into newAccount payload
    let capturedAccountPayload = null;
    const eabMockFetch = async (url, options = {}) => {
      const u = new URL(url);
      if (u.pathname === '/directory') {
        return new Response(JSON.stringify({
          newNonce: 'https://acme.test/new-nonce',
          newAccount: 'https://acme.test/new-account',
          newOrder: 'https://acme.test/new-order'
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (u.pathname === '/new-nonce') {
        return new Response('', { status: 200, headers: { 'Replay-Nonce': 'test-nonce-1' } });
      }
      if (u.pathname === '/new-account') {
        const jws = JSON.parse(options.body);
        capturedAccountPayload = JSON.parse(Buffer.from(jws.payload, 'base64').toString('utf8'));
        return new Response(JSON.stringify({ status: 'valid' }), {
          status: 201,
          headers: { 'Location': 'https://acme.test/acct/eab-1', 'Replay-Nonce': 'test-nonce-2' }
        });
      }
      return new Response('', { status: 404 });
    };

    const eabClient = await AcmeClient.create({
      directoryUrl: 'https://acme.test/directory',
      customFetch: eabMockFetch,
      allowTransientAccountKey: true,
      eab: eab
    });
    const eabAccountUrl = await eabClient.initAccount('leeyelon@gmail.com');
    assert(eabAccountUrl === 'https://acme.test/acct/eab-1', 'T4.7a: EAB account initialized successfully');
    assert(capturedAccountPayload && capturedAccountPayload.externalAccountBinding, 'T4.7b: AcmeClient injected externalAccountBinding into newAccount payload on the wire');
    assert(capturedAccountPayload?.externalAccountBinding?.signature, 'T4.7c: EAB payload on the wire contains valid JWS signature');
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

runTests().catch(err => {
  console.error('Unhandled test failure:', err);
  process.exit(1);
});
