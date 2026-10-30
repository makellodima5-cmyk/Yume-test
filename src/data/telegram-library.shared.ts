export const MAX_SAVED_ANIME_IDS = 500;

export type SavedAnimeLibrary = {
  favoriteIds: string[];
  watchlistIds: string[];
};

/** Validate imported/local IDs before they are accepted by the account library API. */
export function normalizeSavedAnimeIds(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > MAX_SAVED_ANIME_IDS) return null;
  const ids: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !/^\d{1,12}$/.test(item)) return null;
    ids.push(item);
  }
  return Array.from(new Set(ids));
}

export function normalizeSavedAnimeLibrary(value: unknown): SavedAnimeLibrary | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const favoriteIds = normalizeSavedAnimeIds(input.favoriteIds);
  const watchlistIds = normalizeSavedAnimeIds(input.watchlistIds);
  if (!favoriteIds || !watchlistIds) return null;
  return { favoriteIds, watchlistIds };
}
