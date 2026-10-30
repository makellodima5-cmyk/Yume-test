type Statement = {
  bind(...values: unknown[]): Statement;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
};
type Database = {
  prepare(sql: string): Statement;
  batch(statements: Statement[]): Promise<unknown[]>;
};

const EXPIRY_PAGE_SIZE = 200;
const MAX_EXPIRY_BATCHES = 10;

function changedRows(result: unknown): number {
  if (!result || typeof result !== "object") return 0;
  const meta = (result as { meta?: { changes?: unknown } }).meta;
  return typeof meta?.changes === "number" ? meta.changes : 0;
}

/**
 * Remove a notification as soon as every snapshotted recipient has dismissed it.
 * Legacy untargeted notifications are treated as broadcasts to all registered users.
 */
export async function cleanupFullyDismissedNotification(db: Database, notificationId: string): Promise<boolean> {
  const results = await db.batch([
    db.prepare(
      "DELETE FROM yume_notifications WHERE id=? AND active=1 AND (" +
      "(" +
      "EXISTS (SELECT 1 FROM yume_notification_targets t WHERE t.notification_id=yume_notifications.id) " +
      "AND NOT EXISTS (" +
      "SELECT 1 FROM yume_notification_targets t " +
      "LEFT JOIN yume_notification_reads_v2 r ON r.notification_id=t.notification_id AND r.user_id=t.user_id " +
      "WHERE t.notification_id=yume_notifications.id AND r.dismissed_at IS NULL" +
      ")" +
      ") OR (" +
      "NOT EXISTS (SELECT 1 FROM yume_notification_targets t WHERE t.notification_id=yume_notifications.id) " +
      "AND NOT EXISTS (" +
      "SELECT 1 FROM yume_users u WHERE NOT EXISTS (" +
      "SELECT 1 FROM yume_notification_reads_v2 r " +
      "WHERE r.notification_id=yume_notifications.id AND r.user_id=u.id AND r.dismissed_at IS NOT NULL" +
      ")" +
      ")" +
      ")" +
      ")",
    ).bind(notificationId),
    db.prepare(
      "DELETE FROM yume_notification_reads WHERE notification_id=? " +
      "AND NOT EXISTS (SELECT 1 FROM yume_notifications WHERE id=?)",
    ).bind(notificationId, notificationId),
    db.prepare(
      "DELETE FROM yume_notification_dismissals WHERE notification_id=? " +
      "AND NOT EXISTS (SELECT 1 FROM yume_notifications WHERE id=?)",
    ).bind(notificationId, notificationId),
    db.prepare(
      "DELETE FROM yume_notification_reads_v2 WHERE notification_id=? " +
      "AND NOT EXISTS (SELECT 1 FROM yume_notifications WHERE id=?)",
    ).bind(notificationId, notificationId),
    db.prepare(
      "DELETE FROM yume_notification_targets WHERE notification_id=? " +
      "AND NOT EXISTS (SELECT 1 FROM yume_notifications WHERE id=?)",
    ).bind(notificationId, notificationId),
  ]);
  return changedRows(results[0]) > 0;
}

/**
 * Daily bounded cleanup. Each D1 batch is transactional and removes child rows
 * before the notification row, including legacy read/dismissal tables without FKs.
 */
export async function cleanupExpiredNotifications(db: Database): Promise<number> {
  let deleted = 0;

  for (let batchNumber = 0; batchNumber < MAX_EXPIRY_BATCHES; batchNumber += 1) {
    const stale = await db.prepare(
      "SELECT id FROM yume_notifications " +
      "WHERE created_at <= datetime('now', '-30 days') " +
      "ORDER BY created_at ASC LIMIT ?",
    ).bind(EXPIRY_PAGE_SIZE).all<{ id: string }>();

    const ids = stale.results.map((row) => row.id).filter((id) => typeof id === "string" && id.length > 0);
    if (!ids.length) break;

    const placeholders = ids.map(() => "?").join(", ");
    const values = [...ids];
    const results = await db.batch([
      db.prepare("DELETE FROM yume_notification_reads WHERE notification_id IN (" + placeholders + ")").bind(...values),
      db.prepare("DELETE FROM yume_notification_dismissals WHERE notification_id IN (" + placeholders + ")").bind(...values),
      db.prepare("DELETE FROM yume_notification_reads_v2 WHERE notification_id IN (" + placeholders + ")").bind(...values),
      db.prepare("DELETE FROM yume_notification_targets WHERE notification_id IN (" + placeholders + ")").bind(...values),
      db.prepare(
        "DELETE FROM yume_notifications WHERE id IN (" + placeholders + ") " +
        "AND created_at <= datetime('now', '-30 days')",
      ).bind(...values),
    ]);

    deleted += changedRows(results[4]);
    if (ids.length < EXPIRY_PAGE_SIZE) break;
  }

  return deleted;
}

export async function runScheduledNotificationCleanup(input: unknown): Promise<number> {
  const env = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const db = env.YUME_DB && typeof env.YUME_DB === "object" ? env.YUME_DB as Database : null;
  if (!db || typeof db.prepare !== "function" || typeof db.batch !== "function") {
    throw new Error("Notification cleanup has no YUME_DB binding");
  }
  const deleted = await cleanupExpiredNotifications(db);
  console.info("[YUME][NOTIFICATION_CLEANUP] Expired notifications removed:", deleted);
  return deleted;
}
