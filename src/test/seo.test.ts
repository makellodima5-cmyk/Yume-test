import { describe, expect, it } from "vitest";
import { absoluteImageUrl, canonicalUrl, sanitizeMetaDescription } from "@/data/seo";

describe("SEO helpers", () => {
  it("uses the current Cloudflare origin and canonicalizes internal paths without query or hash", () => {
    expect(canonicalUrl("/")).toBe("https://yume-staging.makellodima5.workers.dev/");
    expect(canonicalUrl("/anime/123?ref=search#details")).toBe(
      "https://yume-staging.makellodima5.workers.dev/anime/123",
    );
    expect(canonicalUrl("anime/123")).toBe("https://yume-staging.makellodima5.workers.dev/anime/123");
    expect(canonicalUrl("//evil.example/path")).toBe(
      "https://yume-staging.makellodima5.workers.dev/evil.example/path",
    );
  });

  it("strips markup and truncates descriptions at a word boundary", () => {
    expect(sanitizeMetaDescription("<b>Anime</b> [anime=12]text[/anime] &amp; more")).toBe(
      "Anime text & more",
    );
    expect(sanitizeMetaDescription("   ")).toContain("YUME");
    expect(sanitizeMetaDescription("A description that is deliberately longer than the configured maximum", "fallback", 36))
      .toBe("A description that is deliberately…");
  });

  it("returns only valid HTTP(S) image URLs as absolute URLs", () => {
    expect(absoluteImageUrl("/assets/cover.webp")).toBe(
      "https://yume-staging.makellodima5.workers.dev/assets/cover.webp",
    );
    expect(absoluteImageUrl("https://cdn.example/cover.webp")).toBe("https://cdn.example/cover.webp");
    expect(absoluteImageUrl("javascript:alert(1)")).toBeUndefined();
    expect(absoluteImageUrl("https://user:pass@example.com/cover.webp")).toBeUndefined();
    expect(absoluteImageUrl(undefined)).toBeUndefined();
  });
});
