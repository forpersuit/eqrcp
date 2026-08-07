-- D1 Database Schema for EQT Feedback API
-- SSOT for the feedbacks table used by eqt-feedback-api.
-- 与生产 D1 表结构对齐(含 status 列),确保测试库可复现初始化:
--   npx wrangler d1 execute <db> --remote --file=schema.sql
CREATE TABLE IF NOT EXISTS feedbacks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category TEXT NOT NULL,
    contact TEXT,
    message TEXT NOT NULL,
    image_url TEXT,
    timestamp TEXT NOT NULL,
    client_version TEXT,
    client_os TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    status TEXT DEFAULT 'unread'
);
