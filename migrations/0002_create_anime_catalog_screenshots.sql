CREATE TABLE IF NOT EXISTS anime_catalog_screenshots (
  anime_id TEXT NOT NULL,
  original_url TEXT NOT NULL,
  preview_url TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (anime_id, original_url)
);

CREATE INDEX IF NOT EXISTS idx_anime_catalog_screenshots_position
  ON anime_catalog_screenshots(anime_id, position);
