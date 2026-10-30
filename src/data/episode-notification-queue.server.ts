type Statement = {
  bind(...values: unknown[]): Statement;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
};
type Database = {
  prepare(sql: string): Statement;
  batch(statements: Statement[]): Promise<unknown[]>;
};
type QueueProducer = {
  send(message: EpisodeNotificationJob, options?: { contentType?: "json" }): Promise<void>;
};
type QueueEnvironment = Record<string, unknown> & {
  YUME_DB?: unknown;
  YUME_WEB_TASKS?: QueueProducer;
};
type QueueMessage = {
  body: unknown;
  ack(): void;
  retry(options?: { delaySeconds?: number }): void;
};
type QueueBatch = { messages: QueueMessage[] };

export type EpisodeNotificationJob = {
  type: "episode_notification_fanout";
  notificationId: string;
  animeId: string;
  episodeNumber: number;
  animeTitle: string;
};

const SUBSCRIBER_PAGE_SIZE = 100;
const RETRY_DELAY_SECONDS = 30;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function isEpisodeNotificationJob(value: unknown): value is EpisodeNotificationJob {
  if (!isRecord(value)) return false;
  return value.type === "episode_notification_fanout"
    && typeof value.animeId === "string"
    && /^\d{1,20}$/.test(value.animeId)
    && Number.isSafeInteger(value.episodeNumber)
    && Number(value.episodeNumber) > 0
    && value.notificationId === `episode-${value.animeId}-${value.episodeNumber}`
    && typeof value.animeTitle === "string"
    && value.animeTitle.length > 0
    && value.animeTitle.length <= 300;
}

export async function enqueueEpisodeNotification(
  env: QueueEnvironment,
  animeId: string,
  episodeNumber: number,
  animeTitle: string,
): Promise<void> {
  const queue = env.YUME_WEB_TASKS;
  if (!queue || typeof queue.send !== "function") {
    throw new Error("YUME_WEB_TASKS Queue binding is unavailable");
  }
  const job: EpisodeNotificationJob = {
    type: "episode_notification_fanout",
    notificationId: `episode-${animeId}-${episodeNumber}`,
    animeId,
    episodeNumber,
    animeTitle: animeTitle.slice(0, 300),
  };
  if (!isEpisodeNotificationJob(job)) throw new Error("Invalid episode notification job");
  await queue.send(job, { contentType: "json" });
}

async function processEpisodeNotificationJob(db: Database, job: EpisodeNotificationJob): Promise<void> {
  const querySubscribers = (cursor: string) => db.prepare(
    "SELECT user_id FROM yume_anime_subscriptions WHERE anime_id=? AND active=1 AND user_id>? ORDER BY user_id LIMIT ?",
  ).bind(job.animeId, cursor, SUBSCRIBER_PAGE_SIZE).all<{ user_id: string }>();

  let cursor = "";
  let page = await querySubscribers(cursor);
  // Preserve the previous behavior: do not create a public notification if nobody subscribes.
  if (!page.results.length) return;

  const title = `${job.animeTitle} · Серия ${job.episodeNumber}`;
  const body = `Вышла новая серия аниме «${job.animeTitle}».`;
  await db.prepare(
    "INSERT OR IGNORE INTO yume_notifications(id,title,body,type,target_url,active) VALUES(?,?,?,'episode',?,0)",
  ).bind(job.notificationId, title, body, `/anime/${job.animeId}`).run();

  while (page.results.length) {
    await db.batch(page.results.map(({ user_id }) => db.prepare(
      "INSERT OR IGNORE INTO yume_notification_targets(notification_id,user_id) VALUES(?,?)",
    ).bind(job.notificationId, user_id)));

    cursor = page.results[page.results.length - 1].user_id;
    if (page.results.length < SUBSCRIBER_PAGE_SIZE) break;
    page = await querySubscribers(cursor);
  }
  await db.prepare("UPDATE yume_notifications SET active=1 WHERE id=? AND active=0").bind(job.notificationId).run();
}

export async function handleEpisodeNotificationQueue(batch: QueueBatch, input: unknown): Promise<void> {
  const env = isRecord(input) ? input as QueueEnvironment : {};
  const db = env.YUME_DB && typeof env.YUME_DB === "object" ? env.YUME_DB as Database : null;
  if (!db || typeof db.prepare !== "function" || typeof db.batch !== "function") {
    throw new Error("Episode notification Queue consumer has no YUME_DB binding");
  }

  for (const message of batch.messages) {
    try {
      if (!isEpisodeNotificationJob(message.body)) {
        console.error("[YUME][QUEUE] Discarding invalid episode notification message.");
        message.ack();
        continue;
      }
      await processEpisodeNotificationJob(db, message.body);
      message.ack();
    } catch (error) {
      console.error("[YUME][QUEUE] Episode notification fanout failed; message will retry.", error);
      message.retry({ delaySeconds: RETRY_DELAY_SECONDS });
    }
  }
}
