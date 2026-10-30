import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

describe("staging Worker isolation and scheduled maintenance", () => {
  it("uses only staging bindings and keeps deployment checks non-production", async () => {
    const [
      viteConfig,
      catalogImporter,
      stagingWorkerConfig,
      stagingQueueConfig,
      smokeWorkflow,
      qualityWorkflow,
      homeRoute,
      queueConsumer,
    ] = await Promise.all([
      readFile(resolve(process.cwd(), "vite.config.ts"), "utf8"),
      readFile(resolve(process.cwd(), "src/data/admin-catalog-import.server.ts"), "utf8"),
      readFile(resolve(process.cwd(), "wrangler.staging.jsonc"), "utf8"),
      readFile(resolve(process.cwd(), "wrangler.staging.queue.jsonc"), "utf8"),
      readFile(resolve(process.cwd(), ".github/workflows/staging-smoke.yml"), "utf8"),
      readFile(resolve(process.cwd(), ".github/workflows/quality.yml"), "utf8"),
      readFile(resolve(process.cwd(), "src/routes/index.tsx"), "utf8"),
      readFile(resolve(process.cwd(), "src/data/episode-notification-queue.server.ts"), "utf8"),
    ]);

    expect(viteConfig).not.toContain("catalog-refresh.ts");
    expect(stagingWorkerConfig).toContain('"name": "yume-staging"');
    expect(stagingWorkerConfig).not.toContain('"crons"');
    expect(stagingWorkerConfig).toContain('"database_name": "yume-staging-db"');
    expect(stagingWorkerConfig).toContain('"queue": "yume-staging-tasks"');
    expect(stagingWorkerConfig).toContain('"binding": "YUME_WEB_TASKS"');
    expect(stagingQueueConfig).toContain('"name": "yume-staging-queue-consumer"');
    expect(stagingQueueConfig).toContain('"dead_letter_queue": "yume-staging-tasks-dlq"');
    expect(stagingQueueConfig).toContain('"max_concurrency": 1');
    expect(stagingQueueConfig).toContain('"main": "src/queue-worker.ts"');
    expect(queueConsumer).toContain("INSERT OR IGNORE INTO yume_notification_targets");
    expect(queueConsumer).toContain("message.retry({ delaySeconds: RETRY_DELAY_SECONDS })");
    expect(smokeWorkflow).toContain("https://yume-staging.makellodima5.workers.dev");
    expect(smokeWorkflow).toContain("Staging rendered-route and SEO smoke tests passed.");
    expect(qualityWorkflow).toContain("bun run build");
    expect(qualityWorkflow).not.toContain("wrangler deploy");
    expect(qualityWorkflow).not.toContain("deploy:cloudflare");
    expect(qualityWorkflow).not.toContain("nitro deploy");
    expect(catalogImporter).toContain('body.action === "refresh_section_metadata"');
    expect(catalogImporter).toContain('body.statusFilter === "ongoing" || body.statusFilter === "announcements"');
    expect(catalogImporter).toContain("UPDATE anime_catalog SET status=?, episodes=?, next_episode_at=?");
    expect(homeRoute).toContain('action:"refresh_section_metadata"');
    expect(homeRoute).not.toContain("setInterval(() => { void refreshSectionFeeds(); }");
    expect(homeRoute).toContain('anime.status === "Онгоинг"');
    expect(homeRoute).toContain('anime.status === "Анонс"');
  });
});
