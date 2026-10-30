import { describe, expect, it } from "vitest";
import {
  cleanupExpiredNotifications,
  cleanupFullyDismissedNotification,
} from "@/data/notification-cleanup.server";

describe("notification cleanup", () => {
  it("deletes a notification only through the all-recipients-dismissed predicate", async () => {
    const statements: string[] = [];
    let batches = 0;
    const db = {
      prepare(sql: string) {
        statements.push(sql);
        return { sql, bind() { return this; }, async all() { return { results: [] }; } };
      },
      async batch(items: unknown[]) {
        batches += 1;
        expect(items).toHaveLength(5);
        return [{ meta: { changes: 1 } }, {}, {}, {}, {}];
      },
    };

    await expect(cleanupFullyDismissedNotification(db, "notice-1")).resolves.toBe(true);
    expect(batches).toBe(1);
    expect(statements[0]).toContain("yume_notification_targets");
    expect(statements[0]).toContain("yume_notification_reads_v2");
    expect(statements[0]).toContain("yume_users");
    expect(statements.slice(1)).toEqual(expect.arrayContaining([
      expect.stringContaining("yume_notification_reads WHERE"),
      expect.stringContaining("yume_notification_dismissals WHERE"),
      expect.stringContaining("yume_notification_reads_v2 WHERE"),
      expect.stringContaining("yume_notification_targets WHERE"),
    ]));
  });

  it("removes expired notifications and all linked read and recipient rows in bounded batches", async () => {
    const selectedSql: string[] = [];
    const batches: string[][] = [];
    let selectCount = 0;
    const db = {
      prepare(sql: string) {
        selectedSql.push(sql);
        return {
          sql,
          bind() { return this; },
          async all() {
            selectCount += 1;
            return { results: selectCount === 1 ? [{ id: "old-1" }, { id: "old-2" }] : [] };
          },
        };
      },
      async batch(items: unknown[]) {
        batches.push(items.map((item) => (item as { sql: string }).sql));
        return [{}, {}, {}, {}, { meta: { changes: 2 } }];
      },
    };

    await expect(cleanupExpiredNotifications(db)).resolves.toBe(2);
    expect(selectedSql[0]).toContain("datetime('now', '-30 days')");
    expect(batches).toHaveLength(1);
    expect(batches[0]).toEqual(expect.arrayContaining([
      expect.stringContaining("DELETE FROM yume_notification_reads "),
      expect.stringContaining("DELETE FROM yume_notification_dismissals "),
      expect.stringContaining("DELETE FROM yume_notification_reads_v2 "),
      expect.stringContaining("DELETE FROM yume_notification_targets "),
      expect.stringContaining("DELETE FROM yume_notifications "),
    ]));
  });
});
