export interface Env {
  DB: D1Database;
  ED25519_PRIVATE_KEY: string; // 64-char hex string (32 bytes raw private key)
  ADMIN_SECRET?: string;       // Secret header to allow manually generating licenses
  GITHUB_TOKEN?: string;       // Optional token to prevent GitHub Rate Limit
  GITHUB_REPO?: string;        // Optional repository path, default 'forpersuit/eqrcp'
  R2_PUBLIC_URL?: string;      // Optional public CDN url for R2 assets download redirection
  PADDLE_WEBHOOK_SECRET?: string; // Webhook secret key from Paddle notifications dashboard
  MAIL_SENDER?: string;
  MAIL_SENDER_PASSWORD?: string;
  MAIL_SEND_SERVER?: string;
  MAIL_SEND_SAFE_PORT?: string;
  TEST_MAIL_RECEIVER?: string;
  PADDLE_API_KEY?: string;
}

/** purchase | promo | admin | test — see docs/payment/license-source-and-refund-policy.md */
export type LicenseSource = 'purchase' | 'promo' | 'admin' | 'test';

export interface License {
  license_code: string;
  tier: 'PLUS' | 'PRO';
  status: 'active' | 'suspended' | 'revoked';
  max_devices: number;
  expires_at: string;
  duration_days: number | null;
  buyer_email_hash: string | null;
  buyer_email: string | null;
  paddle_transaction_id: string | null;
  paddle_subscription_id: string | null;
  source?: LicenseSource | string | null;
  revoked_at?: string | null;
  created_at: string;
}

export interface Activation {
  id: number;
  license_code: string;
  uuid_hash: string | null;
  cpu_hash: string | null;
  disk_hash: string | null;
  device_id: string | null;
  activated_at: string;
  client_ip?: string | null;
  ip_country?: string | null;
  user_agent?: string | null;
}

export interface UnbindRecord {
  id: number;
  license_code: string;
  activation_id: number;
  unbound_at: string;
}

export interface SystemErrorLog {
  id: number;
  level: 'ERROR' | 'WARN' | 'CRITICAL';
  category: string;
  error_message: string;
  context_json: string | null;
  created_at: string;
}

export const PRICE_LIFETIME_ID = "pri_01kxymyma34hgmndccwswheta3";
export const PRICE_YEARLY_ID = "pri_01kxymxqngex49tg65wb0701pc";

// Business Logic Constants
export const MAX_YEARLY_UNBINDS = 4;
export const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;
/** Rolling 365-day abusive refund/chargeback revocations before activate block. */
export const MAX_YEARLY_ABUSIVE_REFUNDS = 2;
