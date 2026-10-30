import { describe, expect, it } from "vitest";
import { ANIME } from "@/data/anime";
import { isUpcomingEpisodeDate, mergeLiveAnimeDetails, selectRelatedAnime } from "@/data/catalog-details";

describe("live anime detail merge", () => {
  it("keeps the stored identity and poster while using fresh Shikimori metadata", () => {
    const stored = {
      ...ANIME[0]!,
      id: "42",
      title: "Stored title",
      englishTitle: "Stored English title",
      original: "Stored original",
      posterUrl: "https://cdn.example/stored-poster.jpg",
      rating: 7.1,
      description: "Stale description",
      status: "Онгоинг" as const,
      nextEpisodeAt: "2026-10-25T12:00:00Z",
      genres: ["Старый жанр"],
    };
    const live = {
      ...stored,
      title: "Live title",
      englishTitle: "Live English title",
      original: "Live original",
      posterUrl: "https://cdn.example/live-poster.jpg",
      rating: 8.9,
      description: "Fresh description",
      status: "Вышел" as const,
      nextEpisodeAt: undefined,
      genres: ["Новый жанр"],
      episodesAired: 12,
      airedOn: "2026-10-01",
    };

    expect(mergeLiveAnimeDetails(stored, live)).toMatchObject({
      id: "42",
      title: "Stored title",
      englishTitle: "Stored English title",
      original: "Stored original",
      posterUrl: "https://cdn.example/stored-poster.jpg",
      rating: 8.9,
      description: "Fresh description",
      status: "Вышел",
      nextEpisodeAt: undefined,
      genres: ["Новый жанр"],
      episodesAired: 12,
      airedOn: "2026-10-01",
    });
  });

  it("uses live artwork and rating only when the stored values are missing", () => {
    const stored = { ...ANIME[0]!, posterUrl: undefined, rating: null };
    const live = { ...ANIME[0]!, posterUrl: "https://cdn.example/live.jpg", rating: 8.2 };

    expect(mergeLiveAnimeDetails(stored, live)).toMatchObject({
      posterUrl: "https://cdn.example/live.jpg",
      rating: 8.2,
    });
  });
});

describe("next episode date validation", () => {
  it("rejects past timestamps and accepts future timestamps", () => {
    const now = Date.parse("2026-10-28T12:00:00Z");
    expect(isUpcomingEpisodeDate("2026-10-25T12:00:00Z", now)).toBe(false);
    expect(isUpcomingEpisodeDate("2026-10-29T12:00:00Z", now)).toBe(true);
  });

  it("keeps date-only releases through the end of their calendar day", () => {
    const now = Date.parse("2026-10-28T23:00:00Z");
    expect(isUpcomingEpisodeDate("2026-10-28", now)).toBe(true);
    expect(isUpcomingEpisodeDate("2026-10-27", now)).toBe(false);
  });
});

describe("related anime selection", () => {
  it("prioritizes shared genres before rating and excludes the current title", () => {
    const anime = { ...ANIME[0]!, id: "current", genres: ["Экшен", "Фэнтези"] };
    const candidates = [
      { ...ANIME[1]!, id: "same-genre", genres: ["Экшен"], rating: 7 },
      { ...ANIME[2]!, id: "two-genres", genres: ["Экшен", "Фэнтези"], rating: 6 },
      { ...ANIME[3]!, id: "unrelated", genres: ["Комедия"], rating: 9.9 },
      { ...anime, rating: 10 },
    ];

    expect(selectRelatedAnime(anime, candidates).map((item) => item.id))
      .toEqual(["two-genres", "same-genre", "unrelated"]);
  });

  it("honors the limit and does not mutate the candidate array", () => {
    const anime = { ...ANIME[0]!, id: "current", genres: ["Экшен"] };
    const candidates = [
      { ...ANIME[1]!, id: "first", genres: ["Экшен"], rating: 8 },
      { ...ANIME[2]!, id: "second", genres: ["Экшен"], rating: 9 },
    ];
    const originalIds = candidates.map((item) => item.id);
    expect(selectRelatedAnime(anime, candidates, 1).map((item) => item.id)).toEqual(["second"]);
    expect(candidates.map((item) => item.id)).toEqual(originalIds);
  });
});
