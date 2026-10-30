CREATE TABLE IF NOT EXISTS anime_catalog (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL,
  english_title TEXT,
  original_title TEXT NOT NULL,
  year INTEGER NOT NULL DEFAULT 0,
  episodes INTEGER NOT NULL DEFAULT 0,
  rating REAL,
  genres_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'Неизвестно',
  description TEXT NOT NULL DEFAULT '',
  hue INTEGER NOT NULL DEFAULT 280,
  glyph TEXT NOT NULL DEFAULT 'Y',
  is_new INTEGER NOT NULL DEFAULT 0,
  popular INTEGER NOT NULL DEFAULT 0,
  poster_url TEXT,
  banner_url TEXT,
  kind TEXT,
  age_rating TEXT,
  next_episode_at TEXT,
  episodes_aired INTEGER NOT NULL DEFAULT 0,
  aired_on TEXT,
  studios_json TEXT NOT NULL DEFAULT '[]',
  youtube_trailer_id TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_anime_catalog_title ON anime_catalog(title);
CREATE INDEX IF NOT EXISTS idx_anime_catalog_position ON anime_catalog(position);

CREATE TABLE IF NOT EXISTS anime_catalog_meta (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);
