-- D1 Database Schema for EQT DRM
-- SSOT for table shapes used by eqt-drm-api and admin contracts (docs/admin/api-contract.md).
-- licenses: PK is license_code (no auto-increment id). Sort admin lists by created_at.
-- activations: unbind by id (activation_id). No device_fingerprint / device_name columns.

CREATE TABLE IF NOT EXISTS licenses (
    license_code TEXT PRIMARY KEY,
    tier TEXT NOT NULL,          -- 'PLUS' or 'PRO'
    status TEXT NOT NULL DEFAULT 'active', -- 'active', 'suspended', 'revoked'
    max_devices INTEGER DEFAULT 2,
    expires_at TEXT,             -- ISO format time, or 'LIFETIME' (promo: redeem-by deadline when duration_days set)
    duration_days INTEGER DEFAULT NULL,
    buyer_email_hash TEXT DEFAULT NULL,
    buyer_email TEXT DEFAULT NULL,
    paddle_transaction_id TEXT DEFAULT NULL,
    paddle_subscription_id TEXT DEFAULT NULL,
    source TEXT DEFAULT NULL,    -- 'purchase' | 'promo' | 'admin' | 'test'
    bound_device_id TEXT DEFAULT NULL, -- Bound test device ID for restricted beta licenses
    auto_renew INTEGER DEFAULT 1, -- 1 = auto-renewal on, 0 = canceled / off
    revoked_at TEXT DEFAULT NULL, -- ISO time when status became revoked (abuse window)
    revoke_reason TEXT DEFAULT NULL, -- 'refund' | 'chargeback' | 'subscription' | 'admin' | 'test' | …
    last_purchased_at TEXT DEFAULT NULL, -- ISO time of initial purchase or latest renewal
    paid_amount REAL DEFAULT NULL, -- Total amount charged in Paddle transaction (0 = coupon/trial, >0 = paid)
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS activations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    license_code TEXT NOT NULL,
    uuid_hash TEXT,
    cpu_hash TEXT,
    disk_hash TEXT,
    device_id TEXT DEFAULT NULL,
    activated_at TEXT NOT NULL,
    client_ip TEXT DEFAULT NULL,     -- CF-Connecting-IP at activate time
    ip_country TEXT DEFAULT NULL,    -- CF-IPCountry (ISO-3166-1 alpha-2) or XX
    user_agent TEXT DEFAULT NULL,    -- truncated UA for device-class hints
    city TEXT DEFAULT NULL,          -- CF-IPCity (e.g. Shenzhen, San Jose)
    region TEXT DEFAULT NULL,        -- CF-IPRegion/RegionCode (e.g. GD, CA)
    latitude REAL DEFAULT NULL,      -- CF-Latitude
    longitude REAL DEFAULT NULL,     -- CF-Longitude
    trace_id TEXT DEFAULT NULL,      -- request-level trace ID (§7.1)
    FOREIGN KEY (license_code) REFERENCES licenses(license_code)
);

-- Indexing for speed and device activation uniqueness
CREATE INDEX IF NOT EXISTS idx_activations_license ON activations(license_code);
CREATE UNIQUE INDEX IF NOT EXISTS idx_activations_license_device ON activations(license_code, device_id) WHERE device_id IS NOT NULL AND device_id != '';
CREATE INDEX IF NOT EXISTS idx_licenses_email_hash ON licenses(buyer_email_hash);
CREATE INDEX IF NOT EXISTS idx_licenses_created ON licenses(created_at);

-- A2 (audit licensing-flow-audit.md): atomic mint idempotency.
-- UNIQUE on paddle_transaction_id makes the SELECT→INSERT mint path atomic — a concurrent
-- redelivery of the same transaction cannot double-mint (2nd INSERT hits the constraint,
-- outer catch returns 500, Paddle retries, existing-row check then returns 200 idempotent).
-- SQLite unique indexes allow multiple NULLs, so non-purchase rows (source=promo/admin/test,
-- paddle_transaction_id NULL) are unaffected. Production D1 must be deduplicated BEFORE this
-- index is created (see ensureLicensePaddleTxnIndex: it pre-checks duplicates and skips with a WARN).
CREATE UNIQUE INDEX IF NOT EXISTS idx_licenses_paddle_txn ON licenses(paddle_transaction_id);

-- A3 (audit licensing-flow-audit.md): D1-persistent rate limiter for activate/verify.
-- Key format: "activate:<license_code>" or "verify:<license_code>".
-- Window resets when window_start + window_ms passes current time.
-- Pruned lazily by isD1RateLimited (old windows are overwritten, not accumulated).
CREATE TABLE IF NOT EXISTS rate_limits (
    key TEXT PRIMARY KEY,
    count INTEGER NOT NULL DEFAULT 1,
    window_start TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS verification_codes (
    -- PK value is purpose-prefixed: "portal:user@x.com" or "checkout:user@x.com"
    -- (column name remains email for backward compatibility with existing D1 rows)
    email TEXT PRIMARY KEY,
    code TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT DEFAULT NULL   -- ISO time; used for 60s send-code rate limit
);

CREATE TABLE IF NOT EXISTS user_sessions (
    session_token TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS unbind_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    license_code TEXT NOT NULL,
    activation_id INTEGER NOT NULL,
    unbound_at TEXT NOT NULL,
    FOREIGN KEY (license_code) REFERENCES licenses(license_code)
);

CREATE INDEX IF NOT EXISTS idx_unbind_license ON unbind_records(license_code);
CREATE UNIQUE INDEX IF NOT EXISTS idx_unbind_license_activation ON unbind_records(license_code, activation_id);

-- Admin / ops error audit log (also ensured at runtime by ensureAuditLogTable)
CREATE TABLE IF NOT EXISTS system_error_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    level TEXT NOT NULL DEFAULT 'ERROR',       -- 'ERROR', 'WARN', 'CRITICAL'
    category TEXT NOT NULL,
    error_message TEXT NOT NULL,
    context_json TEXT,
    created_at TEXT NOT NULL,
    trace_id TEXT                              -- request-level trace ID (§7.1)
);

CREATE INDEX IF NOT EXISTS idx_system_error_logs_created ON system_error_logs(created_at);

-- Admin operation audit log for tracking high-privilege actions (generate, revoke, unbind, clear_logs)
CREATE TABLE IF NOT EXISTS admin_audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action TEXT NOT NULL,                      -- 'GENERATE', 'REVOKE', 'UNBIND', 'CLEAR_LOGS'
    target_type TEXT,                          -- 'LICENSE', 'ACTIVATION', 'SYSTEM'
    target_id TEXT,                            -- license_code or activation_id
    details_json TEXT,
    operator_ip TEXT,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_created ON admin_audit_logs(created_at);

-- Operator-managed bans (email / device). Auto abuse window is separate (see blacklist.ts).
CREATE TABLE IF NOT EXISTS manual_blacklist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,                 -- 'email' | 'device'
    email TEXT DEFAULT NULL,
    email_hash TEXT DEFAULT NULL,
    device_id TEXT DEFAULT NULL,
    uuid_hash TEXT DEFAULT NULL,
    cpu_hash TEXT DEFAULT NULL,
    disk_hash TEXT DEFAULT NULL,
    reason TEXT DEFAULT NULL,
    created_by TEXT DEFAULT NULL,
    created_at TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1  -- 0 = unbanned (soft)
);

CREATE INDEX IF NOT EXISTS idx_manual_bl_email_hash ON manual_blacklist(email_hash);
CREATE INDEX IF NOT EXISTS idx_manual_bl_device_id ON manual_blacklist(device_id);
CREATE INDEX IF NOT EXISTS idx_manual_bl_active ON manual_blacklist(active);

CREATE TABLE IF NOT EXISTS device_registry (
    device_id     TEXT PRIMARY KEY,
    uuid_hash     TEXT,
    cpu_hash      TEXT,
    disk_hash     TEXT,
    tier_label    TEXT NOT NULL DEFAULT 'free',      -- 'free' | 'paid'
    license_code  TEXT DEFAULT NULL,                 -- associated license code when paid
    email         TEXT DEFAULT NULL,                 -- buyer email associated on activation
    registered_at TEXT NOT NULL,
    last_seen_at  TEXT,                               -- last app startup / active check time
    last_ip       TEXT DEFAULT NULL,
    ip_country    TEXT DEFAULT NULL,
    city          TEXT DEFAULT NULL,
    region        TEXT DEFAULT NULL,
    latitude      REAL DEFAULT NULL,
    longitude     REAL DEFAULT NULL,
    app_version   TEXT DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS idx_registry_live ON device_registry(tier_label, last_seen_at);
CREATE INDEX IF NOT EXISTS idx_registry_last_seen ON device_registry(last_seen_at);
CREATE INDEX IF NOT EXISTS idx_registry_uuid ON device_registry(uuid_hash);
CREATE INDEX IF NOT EXISTS idx_registry_cpu ON device_registry(cpu_hash);
CREATE INDEX IF NOT EXISTS idx_registry_disk ON device_registry(disk_hash);

-- Pending lifetime upgrades for yearly licenses (§6.7)
CREATE TABLE IF NOT EXISTS license_upgrades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_email TEXT NOT NULL,
    target_license_code TEXT NOT NULL,
    lifetime_txn_id TEXT NOT NULL,
    purchased_at TEXT NOT NULL,
    effective_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'applied' | 'cancelled'
    created_at TEXT NOT NULL
);

-- Partial unique index: at most one pending upgrade per license, enforced at DB level.
-- INSERT OR IGNORE + this index make concurrent same-code purchases atomic (no orphan rows).
CREATE UNIQUE INDEX IF NOT EXISTS idx_upgrades_target ON license_upgrades(target_license_code) WHERE status = 'pending';
CREATE UNIQUE INDEX IF NOT EXISTS idx_upgrades_lifetime_txn ON license_upgrades(lifetime_txn_id);

-- Processed Paddle transactions history for strict idempotency across renewals and initial purchases
CREATE TABLE IF NOT EXISTS paddle_processed_transactions (
    transaction_id TEXT PRIMARY KEY,
    license_code TEXT NOT NULL,
    action TEXT NOT NULL,                  -- 'initial' | 'renewal' | 'upgrade'
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_processed_txns_license ON paddle_processed_transactions(license_code);

-- Sandbox beta test qualifications whitelist
CREATE TABLE IF NOT EXISTS sandbox_beta_testers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT DEFAULT NULL,
    email TEXT DEFAULT NULL,
    notes TEXT DEFAULT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_beta_device ON sandbox_beta_testers(device_id) WHERE device_id IS NOT NULL AND device_id != '';
CREATE UNIQUE INDEX IF NOT EXISTS idx_beta_email ON sandbox_beta_testers(email) WHERE email IS NOT NULL AND email != '';

-- Free-tier daily usage tracking per device for authoritative cloud quota enforcement (§8)
CREATE TABLE IF NOT EXISTS free_daily_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT NOT NULL,
    usage_date TEXT NOT NULL,
    used_seconds INTEGER NOT NULL DEFAULT 0,
    used_transfers INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_free_daily_usage_dev_date ON free_daily_usage(device_id, usage_date);
CREATE INDEX IF NOT EXISTS idx_free_daily_usage_date ON free_daily_usage(usage_date);

-- Download Telemetry tracking records (§5.1 in docs/future/20260830)
CREATE TABLE IF NOT EXISTS download_records (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    version        TEXT NOT NULL,               -- e.g. "v1.36.24"
    filename       TEXT NOT NULL,               -- e.g. "EQT-v1.36.24-windows-amd64.zip"
    client_ip_hash TEXT DEFAULT NULL,           -- SHA-256(ip + salt) for privacy
    ip_country     TEXT DEFAULT NULL,           -- CF-IPCountry ("CN", "US", etc.)
    colo           TEXT DEFAULT NULL,           -- CF-Colo ("HKG", "SJC", etc.)
    city           TEXT DEFAULT NULL,           -- CF-IPCity (from visitor location headers)
    region         TEXT DEFAULT NULL,           -- CF-IPRegion / RegionCode
    latitude       REAL DEFAULT NULL,           -- CF-IPLatitude
    longitude      REAL DEFAULT NULL,           -- CF-IPLongitude
    user_agent     TEXT DEFAULT NULL,
    referer        TEXT DEFAULT NULL,
    source         TEXT NOT NULL DEFAULT 'website', -- 'website' | 'desktop_update' | 'direct'
    created_at     TEXT NOT NULL                -- ISO 8601 UTC
);

CREATE INDEX IF NOT EXISTS idx_downloads_version_time ON download_records(version, created_at);
CREATE INDEX IF NOT EXISTS idx_downloads_country_time ON download_records(ip_country, created_at);
CREATE INDEX IF NOT EXISTS idx_downloads_dedup ON download_records(client_ip_hash, filename, created_at);

-- Daily aggregated download stats for 90-day data retention (§7.6/G5)
CREATE TABLE IF NOT EXISTS daily_download_stats (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    stat_date    TEXT NOT NULL,               -- "YYYY-MM-DD"
    version      TEXT NOT NULL,               -- "v1.36.24"
    ip_country   TEXT NOT NULL,               -- "CN", "US", "XX"
    source       TEXT NOT NULL DEFAULT 'website', -- 'website' | 'desktop_update'
    download_cnt INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_download_dim ON daily_download_stats(stat_date, version, ip_country, source);
CREATE INDEX IF NOT EXISTS idx_daily_download_date ON daily_download_stats(stat_date);

-- E2EE Session Storage (RFC 5869 / Phase 2)
-- Ephemeral 10-minute TTL session token exchange table.
-- device_id is UNIQUE to enforce 1 PC = 1 active session singleton.
CREATE TABLE IF NOT EXISTS e2ee_sessions (
    session_id TEXT PRIMARY KEY,
    license_code TEXT NOT NULL,
    device_id TEXT NOT NULL,
    claim_token_hash TEXT NOT NULL,
    encrypted_master_key TEXT NOT NULL,
    k_auth_hash TEXT NOT NULL,
    expires_at INTEGER NOT NULL,  -- Unix epoch timestamp (seconds)
    created_at INTEGER NOT NULL   -- Unix epoch timestamp (seconds)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_e2ee_device ON e2ee_sessions(device_id);
CREATE INDEX IF NOT EXISTS idx_e2ee_claim_token ON e2ee_sessions(claim_token_hash);
CREATE INDEX IF NOT EXISTS idx_e2ee_expires ON e2ee_sessions(expires_at);
