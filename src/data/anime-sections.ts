import type { Anime } from "@/data/anime";
const DAY_MS = 24 * 60 * 60 * 1000;
const ISO_DATE_PREFIX = /^(\d{4}-\d{2}-\d{2})(?:$|T)/;

type ReleaseMetadata = Pick<Anime, "status" | "airedOn" | "year">;
type NewReleaseMetadata = Pick<Anime, "status" | "airedOn">;

/**
 * Returns a validated calendar date only when the source includes a full YYYY-MM-DD date.
 * Year-only and malformed values are deliberately not treated as exact release dates.
 */
export function getExactReleaseDate(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  const match = ISO_DATE_PREFIX.exec(value.trim());
  if (!match) return null;

  const date = match[1]!;
  const timestamp = Date.parse(date + "T00:00:00.000Z");
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== date) {
    return null;
  }
  return date;
}

/**
 * An announcement is upcoming only when its known premiere date is in the future.
 * If Shikimori has no exact date, only a future year is enough to keep it in this section;
 * an undated current-year announcement is ambiguous and is not presented as upcoming.
 */
export function isUpcomingAnnouncement(anime: ReleaseMetadata, now = new Date()): boolean {
  if (anime.status !== "Анонс") return false;

  const today = now.toISOString().slice(0, 10);
  const releaseDate = getExactReleaseDate(anime.airedOn);
  if (releaseDate) return releaseDate > today;

  return Number.isInteger(anime.year) && anime.year > now.getUTCFullYear();
}

/**
 * The "New release" section and badge are reserved for already-released titles with
 * an exact release date in the last year. Announcements and currently airing titles
 * stay in their own sections instead of being mislabeled as new releases.
 */
export function isNewRelease(
  anime: NewReleaseMetadata,
  now = new Date(),
  maxAgeDays = 365,
): boolean {
  if (anime.status !== "Вышел") return false;

  const releaseDate = getExactReleaseDate(anime.airedOn);
  if (!releaseDate || !Number.isFinite(maxAgeDays) || maxAgeDays < 0) return false;

  const todayTimestamp = Date.parse(now.toISOString().slice(0, 10) + "T00:00:00.000Z");
  const releaseTimestamp = Date.parse(releaseDate + "T00:00:00.000Z");
  const ageInDays = (todayTimestamp - releaseTimestamp) / DAY_MS;
  return ageInDays >= 0 && ageInDays <= maxAgeDays;
}

/**
 * Only titles that Shikimori currently marks as ongoing belong in the fallback
 * airing section. The live feed path already requests the same status upstream.
 */
export function isEligibleAiringAnime(anime: Anime): boolean {
  return anime.status === "Онгоинг";
}

/**
 * Intersect the persistent catalog with the current Shikimori ongoing feed.
 * A stale D1 status alone must never keep a title in the homepage's live airing section.
 */
export function filterEligibleAiringAnime(
  catalogItems: readonly Anime[],
  currentOngoingIds: ReadonlySet<string>,
): Anime[] {
  return catalogItems.filter((anime) =>
    currentOngoingIds.has(anime.id) && isEligibleAiringAnime(anime),
  );
}
