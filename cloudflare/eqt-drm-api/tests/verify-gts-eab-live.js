/**
 * Complete Live End-to-End Verification Test for Google Public CA (Google Trust Services / GTS)
 * RFC 8555 EAB Registration, DNS-01 Authorization, Order Finalization & Certificate Issuance.
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { execFile, execSync } = require('child_process');

const compiledPath = path.join(__dirname, 'compiled', 'acme.js');
if (!fs.existsSync(compiledPath)) {
  console.error("Compiled acme module not found. Run npm run test:acme:offline first.");
  process.exit(1);
}

const { AcmeClient, computeDns01ChallengeValue } = require(compiledPath);

const KEY_FILE = path.join(__dirname, '..', '.gts-account-key.json');
const DNS_ENDPOINTS = ['https://ns1-dns.eqt.net.im', 'https://ns2-dns.eqt.net.im'];
const DNS_TOKEN = '801d1a15916fc574b478da8b76039175a3e61781f1e04a121c3ac1c3a74175f1';

// Proxy-aware fetch helper for WSL environment
function proxyFetch(url, init = {}) {
  return new Promise((resolve, reject) => {
    const method = init.method || 'GET';
    const args = ['-s', '-i', '-x', 'socks5h://127.0.0.1:10808', '-X', method];
    if (init.headers) {
      const h = init.headers instanceof Headers ? Object.fromEntries(init.headers.entries()) : init.headers;
      for (const [k, v] of Object.entries(h)) {
        args.push('-H', `${k}: ${v}`);
      }
    }
    if (init.body) {
      args.push('--data-binary', typeof init.body === 'string' ? init.body : JSON.stringify(init.body));
    }
    args.push(typeof url === 'string' ? url : url.toString());

    execFile('curl', args, { maxBuffer: 10 * 1024 * 1024 }, (err, stdout) => {
      if (err) return reject(err);
      const str = stdout.toString();
      const parts = str.split('\r\n\r\n');
      const bodyPart = parts[parts.length - 1];
      const headerPart = parts.length >= 2 ? parts[parts.length - 2] : '';
      const lines = headerPart.split('\r\n');
      const statusMatch = lines[0]?.match(/HTTP\/\S+\s+(\d+)/);
      const status = statusMatch ? parseInt(statusMatch[1], 10) : 200;

      const headers = new Headers();
      for (let i = 1; i < lines.length; i++) {
        const colon = lines[i].indexOf(':');
        if (colon !== -1) {
          headers.append(lines[i].slice(0, colon).trim(), lines[i].slice(colon + 1).trim());
        }
      }

      resolve(new Response(bodyPart, { status, headers }));
    });
  });
}

async function setDnsRecord(record, value) {
  for (const ep of DNS_ENDPOINTS) {
    const res = await fetch(`${ep}/acme/challenge`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${DNS_TOKEN}`
      },
      body: JSON.stringify({ record, value, ttl: 120 })
    });
    if (!res.ok) throw new Error(`Failed to set DNS challenge on ${ep}: HTTP ${res.status}`);
  }
}

async function clearDnsRecord(record) {
  for (const ep of DNS_ENDPOINTS) {
    try {
      await fetch(`${ep}/acme/challenge?record=${encodeURIComponent(record)}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${DNS_TOKEN}` }
      });
    } catch (e) {
      console.warn(`Warning clearing DNS challenge on ${ep}:`, e.message);
    }
  }
}

async function main() {
  console.log('=== Google Public CA (GTS) EAB Full Issuance Live Test ===\n');

  // 1. Account setup
  if (!fs.existsSync(KEY_FILE)) {
    throw new Error(`Account key file ${KEY_FILE} not found.`);
  }
  const acctJwk = JSON.parse(fs.readFileSync(KEY_FILE, 'utf8'));

  const directoryUrl = 'https://dv.acme-v02.api.pki.goog/directory';
  const client = await AcmeClient.create({
    directoryUrl,
    accountKeyJWK: JSON.stringify(acctJwk),
    customFetch: proxyFetch,
    accountUrl: 'https://dv.acme-v02.api.pki.goog/account/BBVKP0RO-Ezg09bPT4QXjA'
  });

  console.log('[1/6] Authenticated with Google Public CA account:');
  console.log('      URL: https://dv.acme-v02.api.pki.goog/account/BBVKP0RO-Ezg09bPT4QXjA');

  // 2. Create Order
  const testDomain = 'gts-probe-test.direct.eqt.net.im';
  console.log(`\n[2/6] Ordering certificate for domain: ${testDomain}...`);
  const { orderUrl, order } = await client.newOrder([testDomain]);
  console.log(`      Order URL: ${orderUrl}`);
  console.log(`      Order status: ${order.status}`);

  // 3. Process Authorizations
  console.log('\n[3/6] Setting up DNS-01 challenge...');
  const thumbprint = await client.getThumbprint();
  const challengeRecord = `_acme-challenge.${testDomain}.`;
  let challengeVal = '';

  for (const authzUrl of order.authorizations) {
    const authz = await client.getAuthorization(authzUrl);
    console.log(`      Authorization: ${authz.identifier.value} (${authz.status})`);
    if (authz.status === 'valid') continue;

    const dnsChall = authz.challenges.find(c => c.type === 'dns-01');
    if (!dnsChall) throw new Error('No dns-01 challenge found in authorization');

    challengeVal = await computeDns01ChallengeValue(dnsChall.token, thumbprint);
    console.log(`      Injecting TXT record: ${challengeRecord} = "${challengeVal}"`);
    await setDnsRecord(challengeRecord, challengeVal);
    console.log('      TXT record published to dual authoritative DNS nodes.');

    console.log('      Triggering Google Public CA validation...');
    await client.triggerChallenge(dnsChall.url);
  }

  // 4. Poll Order until ready
  console.log('\n[4/6] Waiting for Google CA to validate DNS-01 challenge...');
  const readyOrder = await client.pollOrder(orderUrl, 'ready', 60000, 2000);
  console.log(`      Order status is now: ${readyOrder.status}`);

  // 5. Generate CSR and Finalize Order
  console.log('\n[5/6] Generating ECDSA P-256 CSR and finalizing order...');
  const tmpKey = '/tmp/gts_node.key';
  const tmpCsr = '/tmp/gts_node.csr';
  try {
    execSync(`openssl ecparam -name prime256v1 -genkey -noout -out ${tmpKey}`);
    execSync(`openssl req -new -sha256 -key ${tmpKey} -out ${tmpCsr} -subj "/CN=${testDomain}" -reqexts SAN -config <(printf "[req]\\ndefault_bits=2048\\ndistinguished_name=req_DN\\n[req_DN]\\n[SAN]\\nsubjectAltName=DNS:${testDomain}\\n")`, { shell: '/bin/bash' });
    const csrDer = execSync(`openssl req -in ${tmpCsr} -outform DER`);

    const finalized = await client.finalizeOrder(readyOrder.finalize, new Uint8Array(csrDer));
    console.log(`      Finalize triggered, order status: ${finalized.status}`);

    const validOrder = await client.pollOrder(orderUrl, 'valid', 60000, 2000);
    console.log(`      Order finalized successfully! Cert URL: ${validOrder.certificate}`);

    // 6. Download Certificate Chain
    console.log('\n[6/6] Downloading issued certificate chain from Google Public CA...');
    const certPem = await client.downloadCertificate(validOrder.certificate);
    console.log('\n✅ [CERTIFICATE ISSUED SUCCESSFULLY BY GOOGLE TRUST SERVICES!]');

    // Parse cert info
    const certText = execSync(`openssl x509 -noout -subject -issuer -dates`, { input: certPem }).toString();
    console.log('--- Certificate Details ---');
    console.log(certText.trim());
    console.log('---------------------------');
  } finally {
    try { fs.unlinkSync(tmpKey); } catch {}
    try { fs.unlinkSync(tmpCsr); } catch {}
    console.log('\nCleaning up DNS-01 challenge record...');
    await clearDnsRecord(challengeRecord);
    console.log('DNS cleanup completed.');
  }

  console.log('\n🎉 End-to-end verification passed 100% with real Google Trust Services CA!');
}

main().catch(err => {
  console.error('\n❌ Test execution failed:', err);
  process.exit(1);
});
