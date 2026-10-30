/**
 * Legacy compatibility helpers for older callers.
 *
 * YUME intentionally does not enforce title-level territorial restrictions.
 * Restrictions imposed by external players or content providers are outside
 * this helper and are not bypassed or modified here.
 */
export const RU_RESTRICTED_ANIME_IDS: readonly string[] = [];

export function normalizeCountryCode(country: unknown): string | null {
  if (typeof country !== "string") return null;
  const normalized = country.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(normalized) || normalized === "XX" || normalized === "T1") return null;
  return normalized;
}

/** Return the catalog unchanged, regardless of visitor country. */
export function filterAnimeForCountry<T extends { id: string }>(
  items: readonly T[],
  _country: unknown,
): T[] {
  return [...items];
}
