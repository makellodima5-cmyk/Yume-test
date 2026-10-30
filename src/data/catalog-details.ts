import type { Anime } from "@/data/anime";

/**
 * Keep catalogue identity fields stable while treating details as provider-owned
 * data. A live score wins when present; a missing provider score does not erase
 * the last known value.
 */
export function mergeLiveAnimeDetails(stored: Anime, live: Anime): Anime {
  return {
    ...stored,
    ...live,
    id: stored.id,
    title: stored.title,
    englishTitle: stored.englishTitle ?? live.englishTitle,
    original: stored.original || live.original,
    posterUrl: stored.posterUrl || live.posterUrl,
    rating: live.rating ?? stored.rating,
  };
}

/** A past episode timestamp is not a useful "next episode" announcement. */
export function isUpcomingEpisodeDate(value: string | undefined, now = Date.now()): boolean {
  if (!value) return false;
  const dateOnly = /^(\d{4}-\d{2}-\d{2})$/.exec(value);
  if (dateOnly) return dateOnly[1]! >= new Date(now).toISOString().slice(0, 10);
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp > now;
}

/** Rank related catalog entries by shared genres, then by rating. */
export function selectRelatedAnime(anime: Anime, candidates: readonly Anime[], limit = 6): Anime[] {
  const safeLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 6;
  return candidates
    .filter((candidate) => candidate.id !== anime.id)
    .slice()
    .sort((a, b) => {
      const sharedA = a.genres.filter((genre) => anime.genres.includes(genre)).length;
      const sharedB = b.genres.filter((genre) => anime.genres.includes(genre)).length;
      return sharedB - sharedA || (b.rating ?? -1) - (a.rating ?? -1);
    })
    .slice(0, safeLimit);
}
