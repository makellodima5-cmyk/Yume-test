-- Speed up age-based cleanup and removal of legacy notification read/dismissal rows.
-- The newer v2 and target tables already have notification_id-leading indexes.
CREATE INDEX IF NOT EXISTS idx_yume_notifications_created_at
  ON yume_notifications(created_at);

CREATE INDEX IF NOT EXISTS idx_yume_notification_reads_notification
  ON yume_notification_reads(notification_id);

CREATE INDEX IF NOT EXISTS idx_yume_notification_dismissals_notification
  ON yume_notification_dismissals(notification_id);
