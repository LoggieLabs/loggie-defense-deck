-- Admin workflow columns (metadata only - never stores plaintext)

ALTER TABLE intake_requests ADD COLUMN status TEXT NOT NULL DEFAULT 'new';
ALTER TABLE intake_requests ADD COLUMN processed_at TEXT;
ALTER TABLE intake_requests ADD COLUMN note TEXT;
ALTER TABLE intake_requests ADD COLUMN viewed_at TEXT;

CREATE INDEX IF NOT EXISTS idx_intake_status ON intake_requests(status);

-- Audit trail for admin actions
CREATE TABLE IF NOT EXISTS intake_events (
  rowid INTEGER PRIMARY KEY AUTOINCREMENT,
  intake_id TEXT NOT NULL,
  event TEXT NOT NULL,
  actor TEXT,
  at TEXT NOT NULL DEFAULT (datetime('now')),
  meta TEXT,
  FOREIGN KEY (intake_id) REFERENCES intake_requests(id)
);

CREATE INDEX IF NOT EXISTS idx_intake_events_intake_id ON intake_events(intake_id);
CREATE INDEX IF NOT EXISTS idx_intake_events_at ON intake_events(at);
