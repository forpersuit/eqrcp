-- D1 Database Schema for EQT DRM
-- SSOT for table shapes used by eqt-drm-api and admin contracts (docs/admin/api-contract.md).
-- licenses: PK is license_code (no auto-increment id). Sort admin lists by created_at.
-- activations: unbind by id (activation_id). No device_fingerprint / device_name columns.

CREATE TABLE IF NOT EXISTS licenses (
    license_code TEXT PRIMARY KEY,
    tier TEXT NOT NULL,          -- 'PLUS' or 'PRO'
    status TEXT NOT NULL DEFAULT 'active', -- 'active', 'suspended', 'revoked'
    max_devices INTEGER DEFAULT 2,
    expires_at TEXT,             -- ISO format time, or 'LIFETIME'
    duration_days INTEGER DEFAULT NULL,
    buyer_email_hash TEXT DEFAULT NULL,
    buyer_email TEXT DEFAULT NULL,
    paddle_transaction_id TEXT DEFAULT NULL,
    paddle_subscription_id TEXT DEFAULT NULL,
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
    FOREIGN KEY (license_code) REFERENCES licenses(license_code)
);

-- Indexing for speed
CREATE INDEX IF NOT EXISTS idx_activations_license ON activations(license_code);

CREATE TABLE IF NOT EXISTS verification_codes (
    email TEXT PRIMARY KEY,
    code TEXT NOT NULL,
    expires_at TEXT NOT NULL
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

-- Admin / ops audit log (also ensured at runtime by ensureAuditLogTable)
CREATE TABLE IF NOT EXISTS system_error_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    level TEXT NOT NULL DEFAULT 'ERROR',       -- 'ERROR', 'WARN', 'CRITICAL'
    category TEXT NOT NULL,
    error_message TEXT NOT NULL,
    context_json TEXT,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_system_error_logs_created ON system_error_logs(created_at);

