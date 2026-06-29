CREATE TABLE IF NOT EXISTS feedbacks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category TEXT NOT NULL,
    contact TEXT,
    message TEXT NOT NULL,
    image_url TEXT,
    timestamp TEXT NOT NULL,
    client_version TEXT,
    client_os TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
