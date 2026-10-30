import { describe, expect, it } from "vitest";
import { handleNotifications } from "@/data/notifications.server";

describe("notification mutation origin checks", () => {
  it("rejects POST requests when browser origin signals are absent", async () => {
    const response = await handleNotifications(new Request("https://yume.test/api/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "read-all" }),
    }));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "cross_origin_request" });
  });

  it("rejects cross-origin POST requests before accessing account state", async () => {
    const response = await handleNotifications(new Request("https://yume.test/api/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://attacker.test" },
      body: JSON.stringify({ action: "read-all" }),
    }));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "cross_origin_request" });
  });
});
