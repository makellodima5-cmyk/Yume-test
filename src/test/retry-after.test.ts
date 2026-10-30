import { describe, expect, it } from "vitest";
import { retryAfterMilliseconds } from "@/data/retry-after";

describe("Retry-After parser", () => {
  const now = Date.UTC(2026, 9, 24, 12, 0, 0);

  it("parses delta-seconds and enforces a minimal delay", () => {
    expect(retryAfterMilliseconds("2", now)).toBe(2000);
    expect(retryAfterMilliseconds("0", now)).toBe(1000);
  });

  it("parses HTTP dates using the supplied reference time", () => {
    expect(retryAfterMilliseconds(new Date(now + 10_000).toUTCString(), now)).toBe(10_000);
    expect(retryAfterMilliseconds(new Date(now - 10_000).toUTCString(), now)).toBe(1000);
  });

  it("returns null for empty or invalid values", () => {
    expect(retryAfterMilliseconds(null, now)).toBeNull();
    expect(retryAfterMilliseconds(" ", now)).toBeNull();
    expect(retryAfterMilliseconds("not a date", now)).toBeNull();
  });
});
