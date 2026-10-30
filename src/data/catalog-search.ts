import type { View } from "@/components/yume/Header";

export type CatalogSearch = {
  section?: View;
  q?: string;
  page?: number;
  sort?: string;
  genres?: string;
  status?: string;
  from?: number;
  to?: number;
  rating?: number;
  kind?: string;
  age?: string;
  lang?: "ru" | "en";
};

function parseSearchNumber(value: unknown): number | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  if (typeof value === "string" && !value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function validateCatalogSearch(search: Record<string, unknown>): CatalogSearch {
  const page = parseSearchNumber(search.page);
  const from = parseSearchNumber(search.from);
  const to = parseSearchNumber(search.to);
  const rating = parseSearchNumber(search.rating);
  const validSections: View[] = [
    "home", "admin", "catalog", "collections", "profile", "popular", "new-releases",
    "announcements", "airing", "favorites", "watchlist", "history", "privacy", "privacy-policy", "notifications",
  ];

  return {
    q: typeof search.q === "string" ? search.q.slice(0, 120) : undefined,
    page: page !== undefined && Number.isInteger(page) && page > 0 ? Math.min(page, 10000) : undefined,
    sort: typeof search.sort === "string" && ["rating", "newest", "oldest", "title"].includes(search.sort)
      ? search.sort
      : undefined,
    genres: typeof search.genres === "string" ? search.genres.slice(0, 500) : undefined,
    status: typeof search.status === "string" &&
      ["Любой", "Онгоинг", "Анонс", "Вышел", "Неизвестно"].includes(search.status)
      ? search.status
      : undefined,
    from: from !== undefined && Number.isInteger(from) ? Math.max(1900, Math.min(from, 2100)) : undefined,
    to: to !== undefined && Number.isInteger(to) ? Math.max(1900, Math.min(to, 2100)) : undefined,
    rating: rating !== undefined ? Math.max(0, Math.min(rating, 9)) : undefined,
    kind: typeof search.kind === "string" ? search.kind.slice(0, 80) : undefined,
    age: typeof search.age === "string" ? search.age.slice(0, 30) : undefined,
    lang: search.lang === "ru" || search.lang === "en" ? search.lang : undefined,
    section: typeof search.section === "string" && validSections.includes(search.section as View)
      ? search.section as View
      : undefined,
  };
}
