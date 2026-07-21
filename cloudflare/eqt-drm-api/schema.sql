-- D1 Database Schema for EQT DRM

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

