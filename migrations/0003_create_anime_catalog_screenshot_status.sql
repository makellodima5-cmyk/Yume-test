CREATE TABLE IF NOT EXISTS anime_catalog_screenshot_status (
  anime_id TEXT PRIMARY KEY NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('done', 'retry', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_anime_catalog_screenshot_status_state
  ON anime_catalog_screenshot_status(status, attempts, updated_at);
