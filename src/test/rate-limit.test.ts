import { describe, expect, it, vi } from "vitest";
import { enforceRateLimit } from "@/lib/rate-limit";

describe("Cloudflare Worker rate limiting", () => {
  it("uses Cloudflare's client IP and endpoint scope as the rate-limit key", async () => {
    const limit = vi.fn(async (_input: { key: string }) => ({ success: true }));
    const decision = await enforceRateLimit(
      { limit },
      new Request("https://yume.test/api/kodik", {
        headers: { "CF-Connecting-IP": "203.0.113.10", "X-Forwarded-For": "198.51.100.7" },
      }),
      "kodik",
    );

    expect(decision).toBe("allowed");
    expect(limit).toHaveBeenCalledWith({ key: "kodik:203.0.113.10" });
  });

  it("reports a request as limited when the Cloudflare binding rejects it", async () => {
    const decision = await enforceRateLimit(
      { limit: async () => ({ success: false }) },
      new Request("https://yume.test/api/kodik", {
        headers: { "CF-Connecting-IP": "203.0.113.10" },
      }),
      "kodik",
    );

    expect(decision).toBe("limited");
  });

  it("fails closed when the binding or trusted client IP is unavailable", async () => {
    const limit = vi.fn(async () => ({ success: true }));

    expect(await enforceRateLimit(undefined, new Request("https://yume.test/"), "media"))
      .toBe("unavailable");
    expect(await enforceRateLimit(
      { limit },
      new Request("https://yume.test/"),
      "media",
    )).toBe("unavailable");
    expect(limit).not.toHaveBeenCalled();
  });

  it("fails closed if the binding throws instead of bypassing the limit", async () => {
    const decision = await enforceRateLimit(
      { limit: async () => { throw new Error("binding unavailable"); } },
      new Request("https://yume.test/api/kodik", {
        headers: { "CF-Connecting-IP": "203.0.113.10" },
      }),
      "kodik",
    );

    expect(decision).toBe("unavailable");
  });
});
