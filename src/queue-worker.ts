import { handleEpisodeNotificationQueue } from "./data/episode-notification-queue.server";
import { setCatalogRuntimeEnvironment } from "./data/catalog-d1.server";
import { runStagingCatalogSeedStep } from "./data/admin-catalog-import.server";
import { runScheduledNotificationCleanup } from "./data/notification-cleanup.server";

type QueueMessage = {
  body: unknown;
  ack(): void;
  retry(options?: { delaySeconds?: number }): void;
};
type QueueBatch = { messages: QueueMessage[] };

// Dedicated Worker consumer keeps Queue delivery separate from the Nitro HTTP Worker.
export default {
  async queue(batch: QueueBatch, env: unknown): Promise<void> {
    await handleEpisodeNotificationQueue(batch, env);
  },

  async scheduled(controller: unknown, env: unknown): Promise<void> {
    setCatalogRuntimeEnvironment(env);
    const bindings = env && typeof env === "object" ? env as Record<string, unknown> : {};
    const cron = controller && typeof controller === "object"
      ? (controller as { cron?: unknown }).cron
      : undefined;

    if (cron === "*/2 * * * *" && bindings.YUME_STAGING_SEED_ENABLED === "true") {
      const target = Number(bindings.YUME_STAGING_CATALOG_TARGET ?? 300);
      const result = await runStagingCatalogSeedStep(target);
      console.info("[YUME][STAGING_SEED] Catalog seed step completed.", result?.progress ?? null);
      return;
    }

    if (cron === "0 3 * * *") {
      await runScheduledNotificationCleanup(env);
    }
  },
};
