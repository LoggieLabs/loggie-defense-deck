-- Intake requests table
-- Stores encrypted submissions only - no plaintext ever exists server-side

CREATE TABLE IF NOT EXISTS intake_requests (
  id TEXT PRIMARY KEY,                              -- Deterministic ID from client (BLAKE3 hash)
  v TEXT NOT NULL,                                  -- Wire protocol version
  encrypted_json TEXT NOT NULL,                     -- Encrypted payload (verbatim from client)
  received_at TEXT NOT NULL DEFAULT (datetime('now')), -- ISO 8601 timestamp
  ip_hash TEXT,                                     -- Hashed client IP (privacy-preserving)
  ua TEXT,                                          -- User agent (optional)
  ref TEXT                                          -- Referrer (optional)
);

-- Index for time-based queries (if needed for admin/ops)
CREATE INDEX IF NOT EXISTS idx_intake_received_at ON intake_requests(received_at);
