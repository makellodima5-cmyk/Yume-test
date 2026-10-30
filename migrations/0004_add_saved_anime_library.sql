-- Store Telegram account favorites and watchlist on the server instead of only in browser localStorage.
CREATE TABLE IF NOT EXISTS yume_saved_anime (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES yume_users(id) ON DELETE CASCADE,
  list_type TEXT NOT NULL CHECK (list_type IN ('favorite', 'watchlist')),
  anime_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, list_type, anime_id)
);

CREATE INDEX IF NOT EXISTS idx_yume_saved_anime_user_list
  ON yume_saved_anime (user_id, list_type, created_at);
