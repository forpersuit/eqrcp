/**
 * Admin API types aligned with docs/admin/api-contract.md and D1 schema.
 * Do not invent device_fingerprint / licenses.id.
 */

export type LicenseTier = 'PLUS' | 'PRO';
export type LicenseStatus = 'active' | 'suspended' | 'revoked';
export type ErrorLogLevel = 'ERROR' | 'WARN' | 'CRITICAL';
export type AdminTab = 'overview' | 'audit' | 'ops' | 'licenses' | 'blacklist' | 'health' | 'metrics';
export type BlacklistKind = 'email' | 'device';
export type LicenseSource = 'purchase' | 'promo' | 'admin' | 'test';
export type RevokeReason = 'refund' | 'chargeback' | 'subscription' | 'admin' | 'test' | 'expired';
export type AdminAuditAction =
  | 'GENERATE'
  | 'REVOKE'
  | 'UNBIND'
  | 'CLEAR_LOGS'
  | 'QUERY_ACTIVATION_LOCATIONS'
  | 'QUERY_LIVE_DEVICES'
  | 'PRUNE'
  | 'BLACKLIST_ADD'
  | 'BLACKLIST_REMOVE';
export type AdminAuditTargetType = 'LICENSE' | 'ACTIVATION' | 'SYSTEM' | 'BLACKLIST';

/** GET/POST /api/v1/admin/blacklist */
export interface ManualBlacklistEntry {
  id: number;
  kind: BlacklistKind;
  email?: string | null;
  email_hash?: string | null;
  device_id?: string | null;
  uuid_hash?: string | null;
  cpu_hash?: string | null;
  disk_hash?: string | null;
  reason?: string | null;
  created_by?: string | null;
  created_at: string;
  active: number | boolean;
}

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

export interface License {
  license_code: string;
  tier: LicenseTier;
  status: LicenseStatus;
  max_devices: number;
  expires_at?: string | null;
  duration_days?: number | null;
  buyer_email?: string | null;
  buyer_email_hash?: string | null;
  paddle_transaction_id?: string | null;
  paddle_subscription_id?: string | null;
  source?: LicenseSource | null;
  bound_device_id?: string | null;
  revoked_at?: string | null;
  revoke_reason?: RevokeReason | null;
  created_at: string;
  active_devices_count: number;
  activations: Activation[];
}

export interface BetaTester {
  id: number;
  device_id?: string | null;
  email?: string | null;
  notes?: string | null;
  status: string;
  created_at: string;
}

export interface SystemErrorLog {
  id: number;
  level: ErrorLogLevel;
  category: string;
  error_message: string;
  context_json: string | null;
  created_at: string;
}

export interface AdminAuditLog {
  id: number;
  action: AdminAuditAction;
  target_type: AdminAuditTargetType;
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
  /** Cloudflare Access TEAM_DOMAIN + AUD present on Worker */
  access_configured?: boolean;
  /** @deprecated removed — Access JWT only */
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
  level: ErrorLogLevel;
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
  /** admin (default) | promo — purchase is only via Paddle */
  source?: 'admin' | 'promo';
}

export interface GenerateLicenseResponse {
  success?: boolean;
  license_code: string;
  tier: LicenseTier;
  max_devices: number;
  expires_at: string;
  duration_days: number | null;
  status: LicenseStatus;
  source?: LicenseSource;
  buyer_email?: string | null;
  email_sent?: boolean;
}

/** POST /admin/unbind */
export interface AdminUnbindBody {
  license_code: string;
  activation_id?: number;
}

/** Single location entry in GET /api/v1/admin/devices/live response */
export interface LiveDeviceLocation {
  country: string;
  region?: string | null;
  city?: string | null;
  latitude: number;
  longitude: number;
  paid_count: number;
  free_count: number;
  total_count: number;
  latest_seen_at: string;
}

/** Cross-region arc for a license code redeemed on devices in multiple locations */
export interface LiveDeviceArc {
  license_code: string;
  email?: string | null;
  from_country: string;
  from_city?: string | null;
  from_lat: number;
  from_lng: number;
  to_country: string;
  to_city?: string | null;
  to_lat: number;
  to_lng: number;
}

/** GET /api/v1/admin/metrics — business metrics dashboard (§7.2) */
export interface AdminMetricsResponse {
  success: boolean;
  timestamp: string;
  metrics: {
    daily_active_devices: number;
    activation_success_rate: number | null;
    tier_distribution: { tier: string; count: number }[];
    crash_trend: { date: string; count: number }[];
    rate_limit_hits_24h: number;
  };
}

/** Full response from GET /api/v1/admin/devices/live */
export interface LiveDevicesResponse {
  success: boolean;
  window: string;
  locations: LiveDeviceLocation[];
  total_active_devices: number;
  total_paid_devices: number;
  total_free_devices: number;
  cross_region_arcs?: LiveDeviceArc[];
}
