import { describe, expect, it } from "vitest";
import { chunkAdminCatalogIds, isCatalogMetadataIncomplete, mapAdminCatalogScreenshots, normalizeAdminCatalogIds, isValidAdminImportTarget } from "@/data/admin-catalog-import.server";

describe("admin catalog import target", () => {
  it("accepts targets above the old 500-title application cap", () => {
    expect(isValidAdminImportTarget(501)).toBe(true);
    expect(isValidAdminImportTarget(100_000)).toBe(true);
    expect(isValidAdminImportTarget(1)).toBe(true);
    expect(isValidAdminImportTarget(0)).toBe(false);
    expect(isValidAdminImportTarget(-1)).toBe(false);
    expect(isValidAdminImportTarget(1.5)).toBe(false);
    expect(isValidAdminImportTarget(Number.MAX_SAFE_INTEGER + 1)).toBe(false);
  });
});

describe("admin catalog ID normalization", () => {
  it("accepts numeric IDs, removes duplicates, and ignores malformed IDs", () => {
    expect(normalizeAdminCatalogIds(["42", "42", "123", "../other-user", "x".repeat(21), 7, null]))
      .toEqual(["42", "123"]);
  });

  it("caps a request to 100 unique numeric IDs", () => {
    const input = Array.from({ length: 110 }, (_, index) => String(index + 1));
    expect(normalizeAdminCatalogIds(input)).toHaveLength(100);
    expect(normalizeAdminCatalogIds(input)[99]).toBe("100");
  });
});

describe("bounded Shikimori metadata lookup batches", () => {
  it("splits a 100-ID refresh page into requests below the upstream result cap", () => {
    const ids = Array.from({ length: 100 }, (_, index) => String(index + 1));
    const chunks = chunkAdminCatalogIds(ids);

    expect(chunks.map(chunk => chunk.length)).toEqual([40, 40, 20]);
    expect(chunks.flat()).toEqual(ids);
    expect(chunks.every(chunk => chunk.length <= 40)).toBe(true);
  });

  it("deduplicates and validates IDs before chunking", () => {
    expect(chunkAdminCatalogIds(["1", "1", "bad", "2"], 1)).toEqual([["1"], ["2"]]);
  });
});


describe("catalog metadata enrichment policy", () => {
  const completeRecord = {
    title: "Example", english_title: "Example", original_title: "Example",
    year: 2022, episodes: 12, rating: 8.2, genres_json: '["Драма"]',
    status: "Вышел", description: "A complete description",
    poster_url: "https://example.org/poster.jpg", banner_url: "https://example.org/banner.jpg",
    kind: "TV", age_rating: "12+", aired_on: "2022-01-01",
    studios_json: '["Studio"]', youtube_trailer_id: "dQw4w9WgXcQ",
  };

  it("skips fully populated rows instead of refetching them", () => {
    expect(isCatalogMetadataIncomplete(completeRecord)).toBe(false);
  });

  it("enriches a missing trailer without treating existing metadata as replaceable", () => {
    expect(isCatalogMetadataIncomplete({ ...completeRecord, youtube_trailer_id: null })).toBe(true);
  });

  it("treats announced anime with no episode count or air date as potentially complete", () => {
    expect(isCatalogMetadataIncomplete({
      ...completeRecord, status: "Анонс", episodes: 0, aired_on: null,
    })).toBe(false);
  });

  it("detects missing poster, description, and rating", () => {
    expect(isCatalogMetadataIncomplete({ ...completeRecord, poster_url: null })).toBe(true);
    expect(isCatalogMetadataIncomplete({ ...completeRecord, description: "" })).toBe(true);
    expect(isCatalogMetadataIncomplete({ ...completeRecord, rating: null })).toBe(true);
  });
});


describe("catalog import screenshot policy", () => {
  it("keeps at most five unique screenshots and prefers medium previews", () => {
    const screenshots = Array.from({ length: 8 }, (_, index) => ({
      originalUrl: `https://cdn.example.org/frame-${index + 1}.jpg`,
      x332Url: `https://cdn.example.org/preview-${index + 1}.jpg`,
      x166Url: `https://cdn.example.org/small-${index + 1}.jpg`,
    }));
    screenshots.splice(1, 0, { ...screenshots[0]! });
    expect(mapAdminCatalogScreenshots({ screenshots })).toEqual([
      { original: "https://cdn.example.org/frame-1.jpg", preview: "https://cdn.example.org/preview-1.jpg" },
      { original: "https://cdn.example.org/frame-2.jpg", preview: "https://cdn.example.org/preview-2.jpg" },
      { original: "https://cdn.example.org/frame-3.jpg", preview: "https://cdn.example.org/preview-3.jpg" },
      { original: "https://cdn.example.org/frame-4.jpg", preview: "https://cdn.example.org/preview-4.jpg" },
      { original: "https://cdn.example.org/frame-5.jpg", preview: "https://cdn.example.org/preview-5.jpg" },
    ]);
  });

  it("falls back to the original image when no preview URL is available", () => {
    expect(mapAdminCatalogScreenshots({ screenshots: [{ originalUrl: "https://cdn.example.org/frame.jpg" }] }))
      .toEqual([{ original: "https://cdn.example.org/frame.jpg", preview: "https://cdn.example.org/frame.jpg" }]);
  });
});
