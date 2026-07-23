/**
 * Admin API types aligned with docs/admin/api-contract.md and D1 schema.
 * Do not invent device_fingerprint / licenses.id.
 */

export type LicenseTier = 'PLUS' | 'PRO';
export type LicenseStatus = 'active' | 'suspended' | 'revoked';
export type ErrorLogLevel = 'ERROR' | 'WARN' | 'CRITICAL';
export type AdminTab = 'overview' | 'audit' | 'ops' | 'licenses' | 'health';

/** Row shape from activations table */
export interface Activation {
  id: number;
  license_code: string;
  uuid_hash?: string | null;
  cpu_hash?: string | null;
  disk_hash?: string | null;
  device_id?: string | null;
  activated_at: string;
  /** Populated on new activations after v1.16.3 network meta capture */
  client_ip?: string | null;
  ip_country?: string | null;
  user_agent?: string | null;
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

/** GET /api/v1/admin/health — env readiness + live probes */
export interface AdminHealthConfig {
  db_status: string;
  db_connected?: boolean;
  smtp_configured: boolean;
  paddle_configured: boolean;
  /** Alias of paddle_configured (explicit name) */
  paddle_webhook_configured?: boolean;
  r2_configured: boolean;
  ed25519_key_configured?: boolean;
  admin_secret_configured?: boolean;
}

export interface HealthProbeResult {
  ok: boolean;
  latency_ms: number;
  error: string | null;
  skipped?: boolean;
  mode?: string;
}

export interface HealthRecentEvent {
  id: number;
  level: string;
  category: string;
  error_message: string;
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
  config: AdminHealthConfig;
  probes?: {
    smtp?: HealthProbeResult;
    paddle?: HealthProbeResult;
    db?: HealthProbeResult;
  };
  recent_events?: HealthRecentEvent[];
}

export interface GenerateLicenseBody {
  tier: LicenseTier;
  max_devices?: number;
  expires_in_days?: number | null;
  duration_days?: number | null;
  buyer_email?: string;
  send_email?: boolean;
}

export interface GenerateLicenseResponse {
  success?: boolean;
  license_code: string;
  tier: string;
  max_devices: number;
  expires_at: string;
  duration_days: number | null;
  status: string;
  buyer_email?: string | null;
  email_sent?: boolean;
}

/** POST /admin/unbind */
export interface AdminUnbindBody {
  license_code: string;
  activation_id?: number;
}
