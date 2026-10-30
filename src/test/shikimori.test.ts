import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import {
  readShikimoriSharedCache,
  writeShikimoriSharedCache,
} from "@/data/shikimori-kv-cache.server";
import {
  mapAnime,
  normalizeShikimoriScreenshots,
  parseShikimoriSectionFeeds,
  parseShikimoriResponse,
  retryAfterMilliseconds,
  isSuccessfulEmptySeedPage,
  seedRequestForCursor,
  validateRequest,
  youtubeVideoId,
} from "@/data/shikimori";

describe("shared Shikimori Workers KV cache", () => {
  it("shares public cache entries across isolates and applies the configured TTL", async () => {
    const values = new Map<string, unknown>();
    const putOptions: Array<{ expirationTtl: number }> = [];
    const namespace = {
      get: async (key: string) => values.get(key) ?? null,
      put: async (key: string, value: string, options: { expirationTtl: number }) => {
        values.set(key, JSON.parse(value));
        putOptions.push(options);
      },
    };
    const bindings = env as unknown as Record<string, unknown>;
    const previous = bindings.YUME_SHIKIMORI_CACHE;
    bindings.YUME_SHIKIMORI_CACHE = namespace;

    try {
      await writeShikimoriSharedCache("test:public", { animeId: "42" }, 120_000);
      expect(putOptions).toEqual([{ expirationTtl: 120 }]);
      expect(await readShikimoriSharedCache("test:public")).toEqual({ animeId: "42" });

      values.set("yume:shikimori:v1:test:expired", { expiresAt: 0, value: { stale: true } });
      expect(await readShikimoriSharedCache("test:expired")).toBeNull();
    } finally {
      if (previous === undefined) delete bindings.YUME_SHIKIMORI_CACHE;
      else bindings.YUME_SHIKIMORI_CACHE = previous;
    }
  });
});

describe("Shikimori request validation", () => {
  it("clamps page and limit and falls back from unsupported query options", () => {
    expect(validateRequest({ page: 900, limit: 100, order: "invalid" as never, status: "invalid" as never, kind: "invalid" as never }))
      .toMatchObject({ page: 500, limit: 50, order: "ranked", status: undefined, kind: undefined });
    expect(validateRequest({ page: -2, limit: 0, search: "  Naruto  " })).toMatchObject({
      page: 1, limit: 50, search: "Naruto",
    });
  });

  it("keeps the upstream request validator bounded while catalog seeding can continue past page 500", () => {
    expect(seedRequestForCursor(510)).toMatchObject({ page: 501, limit: 50, order: "ranked" });
    expect(seedRequestForCursor(20)).toMatchObject({ page: 11, limit: 50, order: "ranked" });
    expect(isSuccessfulEmptySeedPage([], null, 20)).toBe(true);
    expect(isSuccessfulEmptySeedPage([], "Shikimori timeout", 20)).toBe(false);
    expect(isSuccessfulEmptySeedPage([{ id: "1" }], null, 20)).toBe(false);
  });

  it("limits user search text and accepts only numeric comma-separated IDs", () => {
    expect(validateRequest({ search: "x".repeat(150) }).search).toHaveLength(120);
    expect(validateRequest({ ids: "1,2,3" }).ids).toBe("1,2,3");
    expect(validateRequest({ ids: "1, two, 3" }).ids).toBeUndefined();
  });

  it("parses Retry-After seconds and dates and rejects invalid values", () => {
    expect(retryAfterMilliseconds("2")).toBe(2000);
    expect(retryAfterMilliseconds("0")).toBe(1000);
    expect(retryAfterMilliseconds("")).toBeNull();
    expect(retryAfterMilliseconds("not a date")).toBeNull();
    expect(retryAfterMilliseconds(new Date(Date.now() + 5000).toUTCString())).toBeGreaterThan(0);
  });
});

describe("Shikimori GraphQL responses", () => {
  it("treats a valid empty response as an empty result, not an exception", () => {
    expect(parseShikimoriResponse({ data: { animes: [] } })).toEqual({ items: [], error: null });
    expect(parseShikimoriResponse({ data: { animes: null } })).toEqual({ items: [], error: null });
    expect(parseShikimoriResponse({})).toEqual({ items: [], error: null });
  });

  it("returns upstream GraphQL errors without leaking partial items", () => {
    expect(parseShikimoriResponse({
      data: { animes: [{ id: "1", name: "partial" }] },
      errors: [{ message: "Rate limit" }, { message: "Unavailable" }],
    })).toEqual({ items: [], error: "Rate limit; Unavailable" });
  });

  it("filters excluded hentai genres from catalog results", () => {
    const result = parseShikimoriResponse({
      data: {
        animes: [
          { id: "1", name: "Allowed", genres: [{ id: "1", name: "Drama", russian: "Драма", kind: "genre" }] },
          { id: "2", name: "Excluded", genres: [{ id: "2", name: "Hentai", russian: "Хентай", kind: "genre" }] },
        ],
      },
    });
    expect(result.error).toBeNull();
    expect(result.items.map((anime) => anime.id)).toEqual(["1"]);
  });
});

describe("live Shikimori section feeds", () => {
  it("parses fresh status feeds, deduplicates aliases, and excludes hentai", () => {
    const payload = {
      data: {
        airingPage1: [
          { id: "10", name: "Still airing", status: "ongoing", score: "8.8" },
          { id: "11", name: "Excluded", status: "ongoing", genres: [{ id: "1", name: "Hentai", russian: "Хентай", kind: "genre" }] },
        ],
        airingPage2: [{ id: "10", name: "Duplicate from another page", status: "ongoing", score: "8.8" }],
        announcementsPage1: [{ id: "12", name: "Upcoming", status: "anons", airedOn: { date: "2027-01-01", year: 2027 } }],
        newReleasesPage1: [{ id: "13", name: "Completed", status: "released", score: "9.1" }],
        newReleasesPage2: [],
        popularPage1: [{ id: "13", name: "Completed", status: "released", score: "9.1" }],
        popularPage2: [],
      },
    };

    const feeds = parseShikimoriSectionFeeds(payload as never);
    expect(feeds?.airing.map((item) => item.id)).toEqual(["10"]);
    expect(feeds?.announcements.map((item) => item.id)).toEqual(["12"]);
    expect(feeds?.newReleases.map((item) => item.id)).toEqual(["13"]);
    expect(feeds?.popular.map((item) => item.id)).toEqual(["13"]);
    expect(parseShikimoriSectionFeeds({ data: { animes: [] }, errors: [{ message: "Partial failure" }] })).toBeNull();
  });
});

describe("Shikimori video URL validation", () => {
  it("extracts IDs from supported YouTube URL formats", () => {
    expect(youtubeVideoId("https://youtu.be/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(youtubeVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(youtubeVideoId("https://youtube.com/embed/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });

  it("requests video fields when the admin catalog seed opts in", () => {
    expect(validateRequest({ includeVideos: true }).includeVideos).toBe(true);
  });

  it("maps a Shikimori video as a trailer when it has a valid YouTube ID", () => {
    const mapped = mapAnime({
      id: "42",
      name: "Anime",
      videos: [{ id: 7, url: "https://youtube.com/watch?v=dQw4w9WgXcQ", name: "Main video", kind: "other" }],
    });
    expect(mapped.youtubeTrailerId).toBe("dQw4w9WgXcQ");
  });

  it("rejects non-YouTube hosts and malformed IDs", () => {
    expect(youtubeVideoId("https://example.com/watch?v=dQw4w9WgXcQ")).toBeUndefined();
    expect(youtubeVideoId("javascript:alert(1)")).toBeUndefined();
    expect(youtubeVideoId("https://youtu.be/short")).toBeUndefined();
  });
});

describe("Shikimori screenshot normalization", () => {
  it("normalizes image URLs, uses previews as a fallback, and removes duplicate frames", () => {
    expect(normalizeShikimoriScreenshots([
      { original: "http://images.example/frame-1.jpg", preview: "https://images.example/preview-1.jpg" },
      { original: "http://images.example/frame-1.jpg", preview: "https://images.example/preview-duplicate.jpg" },
      { preview: "//images.example/frame-2.jpg" },
      { original: "javascript:alert(1)", preview: "data:image/png;base64,AAAA" },
    ])).toEqual([
      { originalUrl: "https://images.example/frame-1.jpg", previewUrl: "https://images.example/preview-1.jpg" },
      { originalUrl: "https://images.example/frame-2.jpg", previewUrl: "https://images.example/frame-2.jpg" },
    ]);
  });

  it("returns no screenshots for malformed payloads and caps large galleries", () => {
    expect(normalizeShikimoriScreenshots({ screenshots: [] })).toEqual([]);
    expect(normalizeShikimoriScreenshots(Array.from({ length: 30 }, (_, i) => ({
      original: "https://images.example/" + i + ".jpg",
    })))).toHaveLength(24);
  });
});

describe("Shikimori anime metadata mapping", () => {
  it("handles missing or malformed optional metadata without invalid numbers", () => {
    const mapped = mapAnime({
      id: "42",
      name: "Original title",
      english: null,
      russian: null,
      kind: null,
      score: "not-a-score",
      status: "unknown",
      episodes: null,
      episodesAired: null,
      airedOn: null,
      releasedOn: null,
      description: null,
      poster: { mainUrl: "javascript:alert(1)", previewUrl: "http://example.com/poster.jpg" },
      opengraphImageUrl: null,
      genres: [{ id: "1", name: "Hentai", russian: "Хентай", kind: "genre" }],
      nextEpisodeAt: null,
      rating: "unknown",
      studios: [{ name: "  Studio A " }, { name: "Studio A" }],
    });

    expect(mapped.id).toBe("42");
    expect(mapped.title).toBe("Original title");
    expect(mapped.rating).toBeNull();
    expect(mapped.year).toBe(0);
    expect(mapped.episodes).toBe(0);
    expect(mapped.episodesAired).toBe(0);
    expect(mapped.posterUrl).toContain("https://example.com/poster.jpg");
    expect(mapped.ageRating).toBeUndefined();
    expect(mapped.genres).toEqual(["Хентай"]);
    expect(mapped.studios).toEqual(["Studio A"]);
    expect(mapped.youtubeTrailerId).toBeUndefined();
  });
});
