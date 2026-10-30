-- Retire browser OAuth identities and the unused date-of-birth field.
-- Keep only Telegram accounts, their active sessions, and their saved anime lists.
CREATE TABLE yume_users_new (
  id TEXT PRIMARY KEY NOT NULL,
  provider TEXT NOT NULL CHECK (provider = 'telegram'),
  provider_user_id TEXT NOT NULL,
  telegram_user_id TEXT NOT NULL UNIQUE,
  telegram_first_name TEXT,
  telegram_last_name TEXT,
  telegram_username TEXT,
  telegram_language_code TEXT,
  privacy_consent_at TEXT NOT NULL,
  privacy_policy_version TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (provider, provider_user_id)
);

INSERT INTO yume_users_new (
  id, provider, provider_user_id, telegram_user_id, telegram_first_name,
  telegram_last_name, telegram_username, telegram_language_code,
  privacy_consent_at, privacy_policy_version, created_at
)
SELECT
  id, provider, provider_user_id, telegram_user_id, telegram_first_name,
  telegram_last_name, telegram_username, telegram_language_code,
  privacy_consent_at, privacy_policy_version, created_at
FROM yume_users
WHERE provider = 'telegram' AND telegram_user_id IS NOT NULL;

CREATE TABLE yume_sessions_new (
  token_hash TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES yume_users_new(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO yume_sessions_new (token_hash, user_id, expires_at, created_at)
SELECT s.token_hash, s.user_id, s.expires_at, s.created_at
FROM yume_sessions s
JOIN yume_users_new u ON u.id = s.user_id;

CREATE TABLE yume_saved_anime_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES yume_users_new(id) ON DELETE CASCADE,
  list_type TEXT NOT NULL CHECK (list_type IN ('favorite', 'watchlist')),
  anime_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, list_type, anime_id)
);

INSERT INTO yume_saved_anime_new (id, user_id, list_type, anime_id, created_at)
SELECT saved.id, saved.user_id, saved.list_type, saved.anime_id, saved.created_at
FROM yume_saved_anime saved
JOIN yume_users_new users ON users.id = saved.user_id;

DROP TABLE yume_saved_anime;
DROP TABLE yume_sessions;
DROP TABLE yume_users;

ALTER TABLE yume_users_new RENAME TO yume_users;
ALTER TABLE yume_sessions_new RENAME TO yume_sessions;
ALTER TABLE yume_saved_anime_new RENAME TO yume_saved_anime;

CREATE INDEX IF NOT EXISTS idx_yume_sessions_expiry ON yume_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_yume_saved_anime_user_list ON yume_saved_anime(user_id, list_type, created_at);
