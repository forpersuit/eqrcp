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
    revoked_at TEXT DEFAULT NULL, -- ISO time when status became revoked (abuse window)
    revoke_reason TEXT DEFAULT NULL, -- 'refund' | 'chargeback' | 'subscription' | 'admin' | 'test' | …
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
    FOREIGN KEY (license_code) REFERENCES licenses(license_code)
);

-- Indexing for speed
CREATE INDEX IF NOT EXISTS idx_activations_license ON activations(license_code);
CREATE INDEX IF NOT EXISTS idx_licenses_email_hash ON licenses(buyer_email_hash);
CREATE INDEX IF NOT EXISTS idx_licenses_created ON licenses(created_at);

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

-- Admin / ops error audit log (also ensured at runtime by ensureAuditLogTable)
CREATE TABLE IF NOT EXISTS system_error_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    level TEXT NOT NULL DEFAULT 'ERROR',       -- 'ERROR', 'WARN', 'CRITICAL'
    category TEXT NOT NULL,
    error_message TEXT NOT NULL,
    context_json TEXT,
    created_at TEXT NOT NULL
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


