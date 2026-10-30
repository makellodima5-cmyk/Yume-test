import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

describe("automatic Worker maintenance", () => {
  it("keeps all scheduled refresh jobs disabled and exposes manual section refresh", async () => {
    const [viteConfig, catalogImporter, wranglerConfig, queueConfig, workflow, homeRoute, queueConsumer] = await Promise.all([
      readFile(resolve(process.cwd(), "vite.config.ts"), "utf8"),
      readFile(resolve(process.cwd(), "src/data/admin-catalog-import.server.ts"), "utf8"),
      readFile(resolve(process.cwd(), "wrangler.jsonc"), "utf8"),
      readFile(resolve(process.cwd(), "wrangler.queue.jsonc"), "utf8"),
      readFile(resolve(process.cwd(), ".github/workflows/cloudflare-worker.yml"), "utf8"),
      readFile(resolve(process.cwd(), "src/routes/index.tsx"), "utf8"),
      readFile(resolve(process.cwd(), "src/data/episode-notification-queue.server.ts"), "utf8"),
    ]);

    expect(viteConfig).not.toContain("catalog-refresh.ts");
    expect(wranglerConfig).not.toContain('"crons"');
    expect(wranglerConfig).toContain('"yume-web-tasks"');
    expect(wranglerConfig).toContain('"YUME_WEB_TASKS"');
    expect(queueConfig).toContain('"yume-web-tasks-dlq"');
    expect(queueConfig).toContain('"max_concurrency": 1');
    expect(queueConfig).toContain('"src/queue-worker.ts"');
    expect(queueConsumer).toContain("INSERT OR IGNORE INTO yume_notification_targets");
    expect(queueConsumer).toContain("message.retry({ delaySeconds: RETRY_DELAY_SECONDS })");
    expect(workflow).toContain("Automatic scheduled Worker jobs must remain disabled.");
    expect(workflow).toContain("Generated Worker entry still includes scheduled job");
    expect(catalogImporter).toContain('body.action === "refresh_section_metadata"');
    expect(catalogImporter).toContain('body.statusFilter === "ongoing" || body.statusFilter === "announcements"');
    expect(catalogImporter).toContain("UPDATE anime_catalog SET status=?, episodes=?, next_episode_at=?");
    expect(homeRoute).toContain('action:"refresh_section_metadata"');
    expect(homeRoute).not.toContain("setInterval(() => { void refreshSectionFeeds(); }");
    expect(homeRoute).toContain('anime.status === "Онгоинг"');
    expect(homeRoute).toContain('anime.status === "Анонс"');

    // Production deploy remains gated to pushes on main after tests/build checks.
    expect(workflow).toContain("if: github.event_name == 'push' && github.ref == 'refs/heads/main'");
    expect(workflow).toContain("secrets.CLOUDFLARE_API_TOKEN");
    expect(workflow).toContain("secrets.CLOUDFLARE_ACCOUNT_ID");
    expect(workflow).toContain("bunx wrangler@4 deploy --config wrangler.jsonc");
  });
});
