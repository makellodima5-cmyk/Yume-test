import { describe, expect, it } from "vitest";
import { validateCatalogSearch } from "@/data/catalog-search";
import { getCatalogPageCount, paginateCatalog } from "@/data/catalog-utils";

describe("catalog URL search validation", () => {
  it("accepts supported state and normalizes bounded numeric values", () => {
    expect(validateCatalogSearch({
      section: "catalog",
      q: "  Naruto  ",
      page: "12",
      sort: "newest",
      genres: "Экшен,Фэнтези",
      status: "Онгоинг",
      from: "1800",
      to: "2200",
      rating: "10",
      kind: "TV",
      age: "12+",
      lang: "en",
    })).toEqual({
      section: "catalog",
      q: "  Naruto  ",
      page: 12,
      sort: "newest",
      genres: "Экшен,Фэнтези",
      status: "Онгоинг",
      from: 1900,
      to: 2100,
      rating: 9,
      kind: "TV",
      age: "12+",
      lang: "en",
    });
  });

  it("rejects unsupported values and malformed numbers", () => {
    expect(validateCatalogSearch({
      section: "not-a-section",
      page: "1.5",
      sort: "random",
      status: "unknown",
      from: "2020.5",
      rating: "NaN",
    })).toEqual({
      section: undefined,
      q: undefined,
      page: undefined,
      sort: undefined,
      genres: undefined,
      status: undefined,
      from: undefined,
      to: undefined,
      rating: undefined,
      kind: undefined,
      age: undefined,
      lang: undefined,
    });
  });

  it("caps page numbers and string lengths", () => {
    const result = validateCatalogSearch({
      page: 20000,
      q: "q".repeat(200),
      genres: "g".repeat(700),
      kind: "k".repeat(100),
      age: "a".repeat(40),
      lang: "fr",
    });
    expect(result.page).toBe(10000);
    expect(result.q).toHaveLength(120);
    expect(result.genres).toHaveLength(500);
    expect(result.kind).toHaveLength(80);
    expect(result.age).toHaveLength(30);
  });
});


describe("server catalog pagination contract", () => {
  it("returns only the requested 20-item slice and preserves stable page boundaries", () => {
    const all = Array.from({ length: 63 }, (_, index) => ({ id: index + 1 }));
    expect(paginateCatalog(all, 2, 20).map((item) => item.id)).toEqual(Array.from({ length: 20 }, (_, index) => index + 21));
    expect(getCatalogPageCount(all.length, 20)).toBe(4);
    expect(paginateCatalog(all, 4, 20).map((item) => item.id)).toEqual([61, 62, 63]);
  });
});
