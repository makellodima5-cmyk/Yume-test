import { describe, expect, it } from "vitest";
import {
  enqueueEpisodeNotification,
  handleEpisodeNotificationQueue,
  isEpisodeNotificationJob,
} from "@/data/episode-notification-queue.server";

const validJob = {
  type: "episode_notification_fanout",
  notificationId: "episode-123-7",
  animeId: "123",
  episodeNumber: 7,
  animeTitle: "Тестовое аниме",
};

describe("episode notification Queue", () => {
  it("validates and enqueues stable idempotency keys", async () => {
    expect(isEpisodeNotificationJob(validJob)).toBe(true);
    expect(isEpisodeNotificationJob({ ...validJob, notificationId: "episode-123-8" })).toBe(false);

    let sent: unknown;
    let contentType: string | undefined;
    await enqueueEpisodeNotification({
      YUME_WEB_TASKS: {
        async send(message, options) {
          sent = message;
          contentType = options?.contentType;
        },
      },
    }, "123", 7, "Тестовое аниме");

    expect(sent).toEqual(validJob);
    expect(contentType).toBe("json");
  });

  it("acknowledges a completed job after inserting its notification", async () => {
    const statements: string[] = [];
    const db = {
      prepare(sql: string) {
        statements.push(sql);
        return {
          bind() { return this; },
          async run() { return {}; },
          async all() { return { results: [{ user_id: "user-1" }] }; },
        };
      },
      async batch() { return []; },
    };
    let acknowledged = false;
    let retried = false;
    await handleEpisodeNotificationQueue({
      messages: [{
        body: validJob,
        ack() { acknowledged = true; },
        retry() { retried = true; },
      }],
    }, { YUME_DB: db });

    expect(acknowledged).toBe(true);
    expect(retried).toBe(false);
    expect(statements.some((sql) => sql.includes("INSERT OR IGNORE INTO yume_notifications") && sql.includes("active) VALUES") && sql.endsWith(",0)"))).toBe(true);
    expect(statements.some((sql) => sql.includes("UPDATE yume_notifications SET active=1"))).toBe(true);
    expect(statements.some((sql) => sql.includes("SELECT user_id FROM yume_anime_subscriptions"))).toBe(true);
  });

  it("retries a failed database operation instead of acknowledging it", async () => {
    const db = {
      prepare() {
        return {
          bind() { return this; },
          async run() { throw new Error("temporary D1 failure"); },
          async all() { return { results: [{ user_id: "user-1" }] }; },
        };
      },
      async batch() { return []; },
    };
    let retryDelay: number | undefined;
    let acknowledged = false;
    await handleEpisodeNotificationQueue({
      messages: [{
        body: validJob,
        ack() { acknowledged = true; },
        retry(options) { retryDelay = options?.delaySeconds; },
      }],
    }, { YUME_DB: db });

    expect(acknowledged).toBe(false);
    expect(retryDelay).toBe(30);
  });
});
