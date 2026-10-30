import { describe, expect, it } from "vitest";
import { redirectHttpToHttps } from "@/lib/https-redirect";

describe("HTTP-to-HTTPS redirect", () => {
  it("permanently redirects public HTTP requests while preserving path and query", () => {
    const response = redirectHttpToHttps({
      url: "http://yume.example/anime/123?lang=ru&source=home",
    });

    expect(response).not.toBeNull();
    expect(response?.status).toBe(308);
    expect(response?.headers.get("location")).toBe("https://yume.example/anime/123?lang=ru&source=home");
    expect(response?.headers.get("cache-control")).toBe("no-store");
    expect(response?.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("removes the default HTTP port but preserves a custom port", () => {
    expect(redirectHttpToHttps({ url: "http://yume.example:80/path" })?.headers.get("location"))
      .toBe("https://yume.example/path");
    expect(redirectHttpToHttps({ url: "http://yume.example:8080/path" })?.headers.get("location"))
      .toBe("https://yume.example:8080/path");
  });

  it("does not redirect HTTPS requests", () => {
    expect(redirectHttpToHttps({ url: "https://yume.example/path" })).toBeNull();
  });

  it("keeps local development on HTTP", () => {
    for (const url of [
      "http://localhost:3000/",
      "http://127.0.0.1:8787/",
      "http://[::1]:3000/",
      "http://app.localhost:3000/",
    ]) {
      expect(redirectHttpToHttps({ url })).toBeNull();
    }
  });
});
