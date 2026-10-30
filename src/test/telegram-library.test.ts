import { describe, expect, it } from "vitest";
import { MAX_SAVED_ANIME_IDS, normalizeSavedAnimeIds, normalizeSavedAnimeLibrary } from "@/data/telegram-library.shared";

describe("Telegram saved-library validation", () => {
  it("deduplicates a valid list of Shikimori IDs", () => {
    expect(normalizeSavedAnimeIds(["20", "42", "20"])).toEqual(["20", "42"]);
  });

  it("rejects non-numeric IDs and non-array payloads", () => {
    expect(normalizeSavedAnimeIds(["42", "../other-user"])).toBeNull();
    expect(normalizeSavedAnimeIds("42")).toBeNull();
  });

  it("caps each list to a bounded number of IDs", () => {
    expect(MAX_SAVED_ANIME_IDS).toBe(500);
    expect(normalizeSavedAnimeIds(Array.from({ length: 501 }, (_, index) => String(index + 1)))).toBeNull();
  });

  it("validates both library lists together", () => {
    expect(normalizeSavedAnimeLibrary({ favoriteIds: ["1"], watchlistIds: ["2", "3"] })).toEqual({
      favoriteIds: ["1"],
      watchlistIds: ["2", "3"],
    });
    expect(normalizeSavedAnimeLibrary({ favoriteIds: ["1"], watchlistIds: [null] })).toBeNull();
  });
});
