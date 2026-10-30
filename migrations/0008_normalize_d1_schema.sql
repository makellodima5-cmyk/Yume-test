-- Consolidate D1 schema objects that were previously created lazily by request handlers.
-- Existing rows and account data are preserved; all objects are created idempotently.

CREATE TABLE IF NOT EXISTS admin_catalog_exclusions (
  anime_id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL,
  deleted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS yume_admin_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL,
  status TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '{}',
  actor_telegram_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS admin_catalog_import_lock (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  token TEXT NOT NULL DEFAULT '',
  expires_at INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS admin_catalog_import_items (
  run_id TEXT NOT NULL,
  anime_id TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('added', 'skipped')),
  incomplete INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (run_id, anime_id)
);

INSERT OR IGNORE INTO admin_catalog_import_lock (id, token, expires_at) VALUES (1, '', 0);

INSERT OR IGNORE INTO anime_catalog_meta (key, value) VALUES
  ('admin_import_state', 'idle'),
  ('admin_import_block_18_plus', '1'),
  ('admin_import_cursor', '1'),
  ('admin_import_target', '0'),
  ('admin_import_added', '0'),
  ('admin_import_skipped', '0'),
  ('admin_import_incomplete', '0'),
  ('admin_import_errors', '0'),
  ('admin_import_resume_at', '0'),
  ('metadata_refresh_auto_enabled', '0');

CREATE TABLE IF NOT EXISTS yume_notifications (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'info',
  target_url TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by TEXT,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS yume_notification_reads (
  user_id TEXT NOT NULL REFERENCES yume_users(id) ON DELETE CASCADE,
  notification_id TEXT NOT NULL,
  read_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, notification_id)
);

CREATE TABLE IF NOT EXISTS yume_notification_dismissals (
  user_id TEXT NOT NULL REFERENCES yume_users(id) ON DELETE CASCADE,
  notification_id TEXT NOT NULL,
  dismissed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, notification_id)
);

CREATE TABLE IF NOT EXISTS yume_notification_reads_v2 (
  user_id TEXT NOT NULL REFERENCES yume_users(id) ON DELETE CASCADE,
  notification_id TEXT NOT NULL REFERENCES yume_notifications(id) ON DELETE CASCADE,
  read_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  dismissed_at TEXT,
  PRIMARY KEY (user_id, notification_id)
);

CREATE TABLE IF NOT EXISTS yume_notification_targets (
  notification_id TEXT NOT NULL REFERENCES yume_notifications(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES yume_users(id) ON DELETE CASCADE,
  PRIMARY KEY (notification_id, user_id)
);

CREATE TABLE IF NOT EXISTS yume_anime_subscriptions (
  user_id TEXT NOT NULL REFERENCES yume_users(id) ON DELETE CASCADE,
  anime_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  PRIMARY KEY (user_id, anime_id)
);

CREATE TABLE IF NOT EXISTS yume_episode_notification_state (
  anime_id TEXT PRIMARY KEY NOT NULL,
  last_episodes_aired INTEGER NOT NULL DEFAULT 0,
  last_checked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS yume_browser_auth (
  token_hash TEXT PRIMARY KEY NOT NULL,
  flow TEXT NOT NULL CHECK (flow IN ('login', 'register')),
  privacy_consent INTEGER NOT NULL DEFAULT 0 CHECK (privacy_consent IN (0, 1)),
  terms_consent INTEGER NOT NULL DEFAULT 0 CHECK (terms_consent IN (0, 1)),
  confirmation_code_hash TEXT,
  telegram_user_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'ready', 'consuming', 'consumed', 'error')),
  user_id TEXT REFERENCES yume_users(id) ON DELETE CASCADE,
  error_code TEXT,
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS yume_view_history (
  user_id TEXT NOT NULL REFERENCES yume_users(id) ON DELETE CASCADE,
  anime_id TEXT NOT NULL,
  viewed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  view_count INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (user_id, anime_id)
);

-- Match the catalog's stable pagination and status-filtered scans.
CREATE INDEX IF NOT EXISTS idx_anime_catalog_position_id ON anime_catalog(position, id);
CREATE INDEX IF NOT EXISTS idx_anime_catalog_status_position_id ON anime_catalog(status, position, id);
CREATE INDEX IF NOT EXISTS idx_anime_catalog_due_episodes
  ON anime_catalog(status, datetime(next_episode_at))
  WHERE next_episode_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_anime_catalog_missing_trailer
  ON anime_catalog(id)
  WHERE youtube_trailer_id IS NULL OR youtube_trailer_id = '';

-- Remove the older single-column index now covered by (position, id).
DROP INDEX IF EXISTS idx_anime_catalog_position;

-- Support the actual retry ordering and avoid retaining the shorter duplicate index.
DROP INDEX IF EXISTS idx_anime_catalog_screenshot_status_state;
CREATE INDEX IF NOT EXISTS idx_anime_catalog_screenshot_status_retry
  ON anime_catalog_screenshot_status(status, attempts, updated_at, anime_id);

CREATE INDEX IF NOT EXISTS idx_anime_catalog_screenshots_position
  ON anime_catalog_screenshots(anime_id, position);
CREATE INDEX IF NOT EXISTS idx_admin_catalog_import_items_run_outcome
  ON admin_catalog_import_items(run_id, outcome, incomplete);

-- User and notification lookups, joins, expiry cleanup, and FK cascades.
CREATE INDEX IF NOT EXISTS idx_yume_sessions_user_id ON yume_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_yume_notification_reads_v2_notification_user
  ON yume_notification_reads_v2(notification_id, user_id);
CREATE INDEX IF NOT EXISTS idx_yume_notification_targets_user
  ON yume_notification_targets(user_id, notification_id);
CREATE INDEX IF NOT EXISTS idx_yume_notifications_active_created
  ON yume_notifications(active, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_yume_anime_subscriptions_anime_active
  ON yume_anime_subscriptions(anime_id, active);
CREATE INDEX IF NOT EXISTS idx_yume_anime_subscriptions_user_active
  ON yume_anime_subscriptions(user_id, active, anime_id);
CREATE INDEX IF NOT EXISTS idx_yume_browser_auth_expiry
  ON yume_browser_auth(expires_at);
CREATE INDEX IF NOT EXISTS idx_yume_browser_auth_confirmation
  ON yume_browser_auth(confirmation_code_hash, telegram_user_id, status, expires_at DESC);
CREATE INDEX IF NOT EXISTS idx_yume_browser_auth_user
  ON yume_browser_auth(user_id);
CREATE INDEX IF NOT EXISTS idx_yume_view_history_user_viewed
  ON yume_view_history(user_id, viewed_at DESC);
