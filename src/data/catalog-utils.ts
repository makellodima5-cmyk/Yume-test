import type { Anime } from "@/data/anime";
import type { Language } from "@/data/preferences";
import type { CatalogFiltersValue } from "@/components/yume/CatalogFilters";
import { getSearchMatchScore, normalizeSearchText } from "@/data/search-text";

export type CatalogSort = "rating" | "newest" | "oldest" | "title";

export function filterAndSortCatalog(
  animeItems: Anime[],
  query: string,
  filters: CatalogFiltersValue,
  sortBy: CatalogSort,
  language: Language,
  translateGenre: (genre: string, language: Language) => string,
): Anime[] {
  const locale = language === "en" ? "en" : "ru";
  const normalizedQuery = normalizeSearchText(query, locale);
  const yearFrom = filters.yearFrom.trim() ? Number(filters.yearFrom) : null;
  const yearTo = filters.yearTo.trim() ? Number(filters.yearTo) : null;
  const relevance = new Map<Anime, number>();

  return animeItems.filter((anime) => {
    const matchScore = getSearchMatchScore(normalizedQuery, [
      { value: anime.title, priority: 0 },
      { value: anime.englishTitle ?? "", priority: 0 },
      { value: anime.original, priority: 0 },
      ...anime.genres.flatMap((genre) => [
        { value: genre, priority: 100 },
        { value: translateGenre(genre, language), priority: 100 },
      ]),
    ], locale);
    const matchesQuery = matchScore !== null;
    if (matchScore !== null) relevance.set(anime, matchScore);
    const matchesGenres = filters.genres.length === 0 || filters.genres.some((genre) => anime.genres.includes(genre));
    const matchesStatus = filters.status === "Любой" || anime.status === filters.status;
    const matchesFrom = yearFrom === null || anime.year >= yearFrom;
    const matchesTo = yearTo === null || anime.year <= yearTo;
    // A non-zero rating filter is a minimum; 0 means no rating filter.
    const matchesRating = filters.minRating === 0 || (anime.rating !== null && anime.rating >= filters.minRating);
    const animeType = anime.kind || (anime.episodes === 1 ? "Фильм" : "TV");
    const matchesType = filters.type === "Любой" || animeType === filters.type;
    const matchesAge = filters.ageRating === "Любой" || anime.ageRating === filters.ageRating;
    return matchesQuery && matchesGenres && matchesStatus && matchesFrom && matchesTo &&
      matchesRating && matchesType && matchesAge;
  }).sort((a, b) => {
    if (normalizedQuery) {
      const relevanceDifference = (relevance.get(a) ?? Number.MAX_SAFE_INTEGER) -
        (relevance.get(b) ?? Number.MAX_SAFE_INTEGER);
      if (relevanceDifference !== 0) return relevanceDifference;
    }
    if (sortBy === "newest") return b.year - a.year || (b.rating ?? -1) - (a.rating ?? -1);
    if (sortBy === "oldest") return a.year - b.year || (b.rating ?? -1) - (a.rating ?? -1);
    if (sortBy === "title") {
      const locale = language === "en" ? "en" : "ru";
      const titleA = language === "en" ? (a.englishTitle || a.original || a.title) : a.title;
      const titleB = language === "en" ? (b.englishTitle || b.original || b.title) : b.title;
      return titleA.localeCompare(titleB, locale);
    }
    return (b.rating ?? -1) - (a.rating ?? -1);
  });
}

export function paginateCatalog<T>(items: T[], page: number, pageSize: number): T[] {
  if (!Number.isFinite(pageSize) || pageSize < 1) return [];
  const size = Math.floor(pageSize);
  const safePage = Number.isFinite(page) ? Math.max(1, Math.floor(page)) : 1;
  return items.slice((safePage - 1) * size, safePage * size);
}

export function getCatalogPageCount(totalItems: number, pageSize: number): number {
  const size = Math.floor(pageSize);
  if (!Number.isFinite(pageSize) || size < 1) return 1;
  return Math.max(1, Math.ceil(Math.max(0, totalItems) / size));
}
