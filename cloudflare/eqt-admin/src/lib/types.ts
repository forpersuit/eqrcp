/**
 * Admin API types aligned with docs/admin/api-contract.md and D1 schema.
 * Phase 1: pages should import from here; do not invent device_fingerprint / licenses.id.
 */

export type LicenseTier = 'PLUS' | 'PRO';
export type LicenseStatus = 'active' | 'suspended' | 'revoked';
export type ErrorLogLevel = 'ERROR' | 'WARN' | 'CRITICAL';

/** Row shape from activations table */
export interface Activation {
  id: number;
  license_code: string;
  uuid_hash?: string | null;
  cpu_hash?: string | null;
  disk_hash?: string | null;
  device_id?: string | null;
  activated_at: string;
}

/** licenses row + admin-computed fields */
export interface License {
  license_code: string;
  tier: LicenseTier | string;
  status: LicenseStatus | string;
  max_devices: number;
  expires_at?: string | null;
  duration_days?: number | null;
  buyer_email?: string | null;
  buyer_email_hash?: string | null;
  paddle_transaction_id?: string | null;
  paddle_subscription_id?: string | null;
  created_at: string;
  active_devices_count: number;
  activations: Activation[];
}

export interface SystemErrorLog {
  id: number;
  level: ErrorLogLevel | string;
  category: string;
  error_message: string;
  context_json: string | null;
  created_at: string;
}

export interface AdminAuditLog {
  id: number;
  action: 'GENERATE' | 'REVOKE' | 'UNBIND' | 'CLEAR_LOGS' | string;
  target_type: 'LICENSE' | 'ACTIVATION' | 'SYSTEM' | string;
  target_id: string | null;
  details_json: string | null;
  operator_ip: string | null;
  created_at: string;
}

export interface AdminHealthResponse {
  success: boolean;
  status: string;
  timestamp: string;
  metrics: {
    total_licenses: number;
    active_licenses?: number;
    today_activations?: number;
    total_error_logs: number;
    errors_24h?: number;
  };
  config: {
    smtp_configured: boolean;
    paddle_configured: boolean;
    r2_configured: boolean;
    db_status: string;
  };
}


export interface GenerateLicenseBody {
  tier: LicenseTier;
  max_devices?: number;
  expires_in_days?: number | null;
  duration_days?: number | null;
}

export interface GenerateLicenseResponse {
  success?: boolean;
  license_code: string;
  tier: string;
  max_devices: number;
  expires_at: string;
  duration_days: number | null;
  status: string;
}

/** Phase 1 target body for POST /admin/unbind */
export interface AdminUnbindBody {
  license_code: string;
  activation_id?: number;
}
