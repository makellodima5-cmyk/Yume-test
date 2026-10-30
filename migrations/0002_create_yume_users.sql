CREATE TABLE IF NOT EXISTS yume_users (
  id TEXT PRIMARY KEY NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('vk', 'yandex')),
  provider_user_id TEXT NOT NULL,
  birth_date TEXT NOT NULL,
  privacy_consent_at TEXT NOT NULL,
  privacy_policy_version TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (provider, provider_user_id)
);

CREATE TABLE IF NOT EXISTS yume_sessions (
  token_hash TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES yume_users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_yume_sessions_expiry ON yume_sessions(expires_at);
