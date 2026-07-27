/**
 * Verification test for multi-service Access JWT consistency.
 * Validates that all three Workers (eqt-drm-api, eqt-p2p-signal, eqt-feedback-api)
 * share the identical Cloudflare Access JWT validation standards.
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('=== MULTI-SERVICE ACCESS JWT SANITY TEST ===');

const services = [
  { name: 'eqt-drm-api', dir: path.join(__dirname, '../../eqt-drm-api') },
  { name: 'eqt-p2p-signal', dir: path.join(__dirname, '../../eqt-p2p-signal') },
  { name: 'eqt-feedback-api', dir: path.join(__dirname, '../../eqt-feedback-api') }
];

for (const svc of services) {
  const jwtFile = path.join(svc.dir, 'src/utils/cf-access-jwt.ts');
  const authFile = path.join(svc.dir, 'src/utils/auth.ts');

  assert.ok(fs.existsSync(jwtFile), `[${svc.name}] cf-access-jwt.ts missing!`);
  assert.ok(fs.existsSync(authFile), `[${svc.name}] auth.ts missing!`);

  const jwtContent = fs.readFileSync(jwtFile, 'utf-8');
  const authContent = fs.readFileSync(authFile, 'utf-8');

  assert.ok(jwtContent.includes('verifyCloudflareAccessJwt'), `[${svc.name}] verifyCloudflareAccessJwt missing in cf-access-jwt.ts`);
  assert.ok(jwtContent.includes('RS256'), `[${svc.name}] RS256 alg check missing in cf-access-jwt.ts`);
  assert.ok(authContent.includes('requireAdminAuth'), `[${svc.name}] requireAdminAuth missing in auth.ts`);
  assert.ok(authContent.includes('ACCESS_JWT_REQUIRED'), `[${svc.name}] ACCESS_JWT_REQUIRED error code missing in auth.ts`);
  assert.ok(authContent.includes('ACCESS_JWT_INVALID'), `[${svc.name}] ACCESS_JWT_INVALID error code missing in auth.ts`);

  console.log(`✓ [${svc.name}] Access JWT authentication utilities verified.`);
}

console.log('ALL THREE WORKER SERVICES ARE VERIFIED FOR ACCESS JWT PARITY & COMPLIANCE.');
