import { describe, expect, it } from "vitest";
import {
  getSearchMatchScore,
  matchesSearchQuery,
  normalizeSearchText,
} from "@/data/search-text";

describe("YUME title search normalization", () => {
  it("treats ё and е, punctuation, and case as equivalent", () => {
    expect(normalizeSearchText("ЧЁРНЫЙ—Клевер")).toBe("черный клевер");
    expect(matchesSearchQuery("черный клевер", ["Чёрный клевер"])).toBe(true);
  });

  it("matches visually-confusable Latin and Cyrillic letters without changing stored titles", () => {
    expect(matchesSearchQuery("Черный клевер", ["Чёрный клeвер"])).toBe(true);
    expect(matchesSearchQuery("Black Clover", ["Black Clover"])).toBe(true);
  });

  it("corrects small spelling mistakes and adjacent transpositions", () => {
    expect(matchesSearchQuery("Black Clvoer", ["Black Clover"])).toBe(true);
    expect(matchesSearchQuery("Narut", ["Naruto"])).toBe(true);
  });

  it("can recover a Russian query typed with the English keyboard layout", () => {
    expect(matchesSearchQuery("xthysq rktdth", ["Чёрный клевер"])).toBe(true);
  });

  it("preserves Japanese kana distinctions and still matches existing original titles", () => {
    expect(normalizeSearchText("が")).not.toBe(normalizeSearchText("か"));
    expect(matchesSearchQuery("Naruto", ["Naruto", "ナルト"])).toBe(true);
  });

  it("ranks an exact match ahead of a typo-tolerant match", () => {
    const exact = getSearchMatchScore("Black Clover", ["Black Clover"]);
    const typo = getSearchMatchScore("Black Clvoer", ["Black Clover"]);
    expect(exact).toBe(0);
    expect(typo).not.toBeNull();
    expect(exact!).toBeLessThan(typo!);
  });

  it("does not apply fuzzy matching to very short accidental queries", () => {
    expect(matchesSearchQuery("cat", ["cut"])).toBe(false);
  });
});
