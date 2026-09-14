/**
 * Multi-CA Disaster Recovery and Automatic Failover Strategy Layer
 * 
 * Provides unified abstractions for ACME Certificate Authorities:
 *  - Primary: Google Trust Services (GTS) - EAB required, direct GFE
 *  - Secondary / Failover: Let's Encrypt (LE) - No EAB, routed via ns1/ns2 reverse proxy
 */

import { Env } from '../types';
import { ExternalAccountBindingOptions } from './acme';

export interface CAProvider {
  id: 'gts' | 'letsencrypt';
  name: string;
  circuitBreakerName: 'gts_ca' | 'letsencrypt_ca';
  requiresEAB: boolean;
  requiresOutboundProxy: boolean;
  supportsWildcard: boolean;
  getDirectoryUrl(env: Env): string;
  getEAB(env: Env): ExternalAccountBindingOptions | undefined;
  getAccountKey(env: Env): string | undefined;
  getContactEmail(env: Env): string | undefined;
}

export const GTS_PROVIDER: CAProvider = {
  id: 'gts',
  name: 'Google Trust Services',
  circuitBreakerName: 'gts_ca',
  requiresEAB: true,
  requiresOutboundProxy: false,
  supportsWildcard: true,
  getDirectoryUrl(env: Env): string {
    return env.ACME_GTS_DIRECTORY_URL || env.ACME_DIRECTORY_URL || 'https://dv.acme-v02.api.pki.goog/directory';
  },
  getEAB(env: Env): ExternalAccountBindingOptions | undefined {
    if (env.ACME_EAB_KID && env.ACME_EAB_HMAC_KEY) {
      return {
        keyId: env.ACME_EAB_KID,
        macKey: env.ACME_EAB_HMAC_KEY
      };
    }
    return undefined;
  },
  getAccountKey(env: Env): string | undefined {
    return env.ACME_ACCOUNT_KEY;
  },
  getContactEmail(env: Env): string | undefined {
    return env.ACME_EMAIL;
  }
};

export const LETSENCRYPT_PROVIDER: CAProvider = {
  id: 'letsencrypt',
  name: "Let's Encrypt",
  circuitBreakerName: 'letsencrypt_ca',
  requiresEAB: false,
  requiresOutboundProxy: true,
  supportsWildcard: true,
  getDirectoryUrl(env: Env): string {
    return env.ACME_LE_DIRECTORY_URL || 'https://acme-v02.api.letsencrypt.org/directory';
  },
  getEAB(_env: Env): ExternalAccountBindingOptions | undefined {
    return undefined;
  },
  getAccountKey(env: Env): string | undefined {
    return env.ACME_LE_ACCOUNT_KEY || env.ACME_ACCOUNT_KEY;
  },
  getContactEmail(env: Env): string | undefined {
    return env.ACME_LE_EMAIL || env.ACME_EMAIL;
  }
};

export const SUPPORTED_PROVIDERS: Record<string, CAProvider> = {
  gts: GTS_PROVIDER,
  letsencrypt: LETSENCRYPT_PROVIDER
};

export function getProvider(id: string): CAProvider {
  const p = SUPPORTED_PROVIDERS[id];
  if (!p) throw new Error(`Unknown CA Provider: ${id}`);
  return p;
}
