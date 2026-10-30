import { describe, expect, it } from "vitest";
import { filterEligibleAiringAnime, isEligibleAiringAnime, isNewRelease, isUpcomingAnnouncement, getExactReleaseDate } from "@/data/anime-sections";
import { ANIME } from "@/data/anime";
import type { Anime } from "@/data/anime";

const now = new Date("2026-10-21T12:00:00.000Z");

function anime(
  status: Anime["status"],
  airedOn?: string,
  year = 2026,
): Pick<Anime, "status" | "airedOn" | "year"> {
  return { status, year, ...(airedOn === undefined ? {} : { airedOn }) };
}

describe("anime section classification", () => {
  describe("upcoming announcements", () => {
    it("includes a future exact date and excludes today or dates in the past", () => {
      expect(isUpcomingAnnouncement(anime("Анонс", "2026-10-22"), now)).toBe(true);
      expect(isUpcomingAnnouncement(anime("Анонс", "2026-10-21"), now)).toBe(false);
      expect(isUpcomingAnnouncement(anime("Анонс", "2026-10-20"), now)).toBe(false);
    });

    it("uses a future year only when no exact premiere date is available", () => {
      expect(isUpcomingAnnouncement(anime("Анонс", undefined, 2027), now)).toBe(true);
      expect(isUpcomingAnnouncement(anime("Анонс", undefined, 2026), now)).toBe(false);
      expect(isUpcomingAnnouncement(anime("Анонс", "2026", 2026), now)).toBe(false);
    });

    it("does not place released or currently airing titles into announcements", () => {
      expect(isUpcomingAnnouncement(anime("Вышел", "2027-01-01", 2027), now)).toBe(false);
      expect(isUpcomingAnnouncement(anime("Онгоинг", "2027-01-01", 2027), now)).toBe(false);
    });
  });

  describe("new releases", () => {
    it("includes released titles dated within the last year", () => {
      expect(isNewRelease(anime("Вышел", "2026-02-15"), now)).toBe(true);
      expect(isNewRelease(anime("Вышел", "2025-10-22", 2025), now)).toBe(true);
    });

    it("excludes old, future, undated, announced, and currently airing titles", () => {
      expect(isNewRelease(anime("Вышел", "2025-10-20", 2025), now)).toBe(false);
      expect(isNewRelease(anime("Вышел", "2026-11-01"), now)).toBe(false);
      expect(isNewRelease(anime("Вышел", undefined), now)).toBe(false);
      expect(isNewRelease(anime("Анонс", "2026-11-01"), now)).toBe(false);
      expect(isNewRelease(anime("Онгоинг", "2026-10-10"), now)).toBe(false);
    });
  });

  describe("airing section", () => {
    it("includes only titles whose current Shikimori status is ongoing", () => {
      const base = { ...ANIME[0]!, id: "42" };
      expect(isEligibleAiringAnime({ ...base, status: "Онгоинг" })).toBe(true);
      expect(isEligibleAiringAnime({ ...base, status: "Вышел" })).toBe(false);
      expect(isEligibleAiringAnime({ ...base, status: "Анонс" })).toBe(false);
      expect(isEligibleAiringAnime({ ...base, status: "Неизвестно" })).toBe(false);
    });

    it("does not retain a stale D1 ongoing status when the title is absent from the current Shikimori ongoing feed", () => {
      const stale = { ...ANIME[0]!, id: "42", status: "Онгоинг" as const };
      const current = { ...ANIME[1]!, id: "43", status: "Онгоинг" as const };
      const released = { ...ANIME[2]!, id: "44", status: "Вышел" as const };
      expect(filterEligibleAiringAnime([stale, current, released], new Set(["43"])))
        .toEqual([current]);
      expect(filterEligibleAiringAnime([stale, current], new Set())).toEqual([]);
    });
  });

  it("rejects year-only and impossible calendar dates as exact dates", () => {
    expect(getExactReleaseDate("2027")).toBe(null);
    expect(getExactReleaseDate("2026-02-31")).toBe(null);
    expect(getExactReleaseDate("2026-10-21T00:00:00Z")).toBe("2026-10-21");
  });
});
