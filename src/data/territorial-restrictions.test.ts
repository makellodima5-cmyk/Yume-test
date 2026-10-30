import { describe, expect, it } from "vitest";
import {
  filterAnimeForCountry,
  normalizeCountryCode,
  RU_RESTRICTED_ANIME_IDS,
} from "./territorial-restrictions";

const sampleAnime = [
  { id: "22319", title: "Title A" },
  { id: "6880", title: "Title B" },
  { id: "1818", title: "Title C" },
  { id: "99999", title: "Regular title" },
];

describe("YUME does not enforce title restrictions by visitor country", () => {
  it("returns all titles for every country, including Russia", () => {
    for (const country of ["RU", "ru", "NL", "US", undefined, "XX", "T1"]) {
      expect(filterAnimeForCountry(sampleAnime, country)).toEqual(sampleAnime);
    }
  });

  it("preserves an independent result array", () => {
    const result = filterAnimeForCountry(sampleAnime, "RU");
    expect(result).toEqual(sampleAnime);
    expect(result).not.toBe(sampleAnime);
  });

  it("retains the legacy ID constant as an empty list for compatibility", () => {
    expect(RU_RESTRICTED_ANIME_IDS).toEqual([]);
  });

  it("keeps country normalization independent from filtering", () => {
    expect(normalizeCountryCode("ru")).toBe("RU");
    expect(normalizeCountryCode(undefined)).toBeNull();
    expect(normalizeCountryCode("XX")).toBeNull();
    expect(normalizeCountryCode("T1")).toBeNull();
  });
});
