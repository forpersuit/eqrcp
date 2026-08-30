import {
  Env,
  PROD_PRICE_LIFETIME_ID,
  PROD_PRICE_YEARLY_ID,
  SANDBOX_PRICE_LIFETIME_ID,
  SANDBOX_PRICE_YEARLY_ID
} from '../types';

/**
 * Determine whether the current runtime environment is a Test / Sandbox context.
 * Evaluates both the explicit ENVIRONMENT variable and request URL hostname.
 */
export function isTestEnvironment(env: Env, url?: URL): boolean {
  if (env.ENVIRONMENT === 'test') {
    return true;
  }
  if (url) {
    const host = url.hostname.toLowerCase();
    if (host.includes('-test.') || host === 'localhost' || host === '127.0.0.1') {
      return true;
    }
  }
  return false;
}

/**
 * Fail-Fast Environmental & Secret Alignment Guard.
 * Enforces strict bidirectional segregation between Production (Live) and Test (Sandbox) environments.
 * Prevents catastrophic cross-environment secret leaks:
 * 1. Injecting Sandbox API key into Production Worker
 * 2. Injecting Live API key into Test Worker
 * 3. Configuring Sandbox Price IDs on Production Worker
 * 4. Configuring Live Price IDs on Test Worker
 */
export function assertEnvironmentAlignment(env: Env, url?: URL): void {
  const isTest = isTestEnvironment(env, url);
  const apiKey = (env.PADDLE_API_KEY || '').trim();
  const isSandboxKey = apiKey.startsWith('pdl_sdbx_');
  const isLiveKey = apiKey.startsWith('pdl_live_');

  // 1. Paddle API Key Alignment
  if (apiKey) {
    if (isTest && isLiveKey) {
      throw new Error('CRITICAL SECURITY CONFIG MISMATCH: Test worker must not use Paddle live key (pdl_live_*)!');
    }
    if (!isTest && isSandboxKey) {
      throw new Error('CRITICAL SECURITY CONFIG MISMATCH: Production worker must not use Paddle sandbox key (pdl_sdbx_*)!');
    }
  }

  // 2. Paddle Price ID Alignment
  const lifetimePrice = env.PADDLE_PRICE_ID_PLUS_LIFETIME || env.PRICE_LIFETIME_ID || '';
  const yearlyPrice = env.PADDLE_PRICE_ID_PLUS_YEARLY || env.PRICE_YEARLY_ID || '';

  if (!isTest) {
    // Production worker MUST NOT have Sandbox prices configured
    if (lifetimePrice === SANDBOX_PRICE_LIFETIME_ID || yearlyPrice === SANDBOX_PRICE_YEARLY_ID) {
      throw new Error('CRITICAL CONFIG MISMATCH: Production worker must not be configured with Paddle Sandbox price IDs!');
    }
    // Production worker MUST have TELEMETRY_SALT configured for privacy-compliant IP hashing
    if (!env.TELEMETRY_SALT || !env.TELEMETRY_SALT.trim()) {
      throw new Error('CRITICAL SECURITY CONFIG MISMATCH: Production worker must have TELEMETRY_SALT configured!');
    }
  } else if (env.ENVIRONMENT === 'test') {
    // Test worker configured with ENVIRONMENT='test' MUST NOT have Live production prices configured
    if (lifetimePrice === PROD_PRICE_LIFETIME_ID || yearlyPrice === PROD_PRICE_YEARLY_ID) {
      throw new Error('CRITICAL CONFIG MISMATCH: Test worker must not be configured with Paddle Live production price IDs!');
    }
  }
}
