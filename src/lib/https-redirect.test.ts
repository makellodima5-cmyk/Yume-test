import { describe, expect, it } from "vitest";
import { redirectHttpToHttps } from "./https-redirect";

describe("redirectHttpToHttps", () => {
  it("permanently redirects HTTP while preserving path and query", () => {
    const request = { url: "http://yume-website.yumesupport833.workers.dev/anime/123?tab=episodes" };
    const response = redirectHttpToHttps(request);

    expect(response).not.toBeNull();
    expect(response?.status).toBe(308);
    expect(response?.headers.get("location")).toBe(
      "https://yume-website.yumesupport833.workers.dev/anime/123?tab=episodes",
    );
    expect(response?.headers.get("cache-control")).toBe("no-store");
  });

  it("removes explicit port 80 from the HTTPS destination", () => {
    const response = redirectHttpToHttps({ url: "http://yume-website.yumesupport833.workers.dev:80/path?q=1" });

    expect(response?.status).toBe(308);
    expect(response?.headers.get("location")).toBe(
      "https://yume-website.yumesupport833.workers.dev/path?q=1",
    );
  });

  it("does not redirect local development hosts", () => {
    expect(redirectHttpToHttps({ url: "http://localhost:8787/" })).toBeNull();
    expect(redirectHttpToHttps({ url: "http://127.0.0.1:8787/" })).toBeNull();
  });

  it("does not redirect an HTTPS request", () => {
    const request = { url: "https://yume-website.yumesupport833.workers.dev/anime/123?tab=episodes" };

    expect(redirectHttpToHttps(request)).toBeNull();
  });
});
