-- Extend YUME accounts to support Telegram identity while preserving existing VK/Yandex users and sessions.
CREATE TABLE yume_users_new (
  id TEXT PRIMARY KEY NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('vk', 'yandex', 'telegram')),
  provider_user_id TEXT NOT NULL,
  telegram_user_id TEXT UNIQUE,
  telegram_first_name TEXT,
  telegram_last_name TEXT,
  telegram_username TEXT,
  telegram_language_code TEXT,
  birth_date TEXT,
  privacy_consent_at TEXT NOT NULL,
  privacy_policy_version TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (provider, provider_user_id)
);

INSERT INTO yume_users_new (id, provider, provider_user_id, birth_date, privacy_consent_at, privacy_policy_version, created_at)
SELECT id, provider, provider_user_id, birth_date, privacy_consent_at, privacy_policy_version, created_at FROM yume_users;

CREATE TABLE yume_sessions_new (
  token_hash TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES yume_users_new(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO yume_sessions_new (token_hash, user_id, expires_at, created_at)
SELECT token_hash, user_id, expires_at, created_at FROM yume_sessions;

DROP TABLE yume_sessions;
DROP TABLE yume_users;
ALTER TABLE yume_users_new RENAME TO yume_users;
ALTER TABLE yume_sessions_new RENAME TO yume_sessions;
CREATE INDEX IF NOT EXISTS idx_yume_sessions_expiry ON yume_sessions(expires_at);
