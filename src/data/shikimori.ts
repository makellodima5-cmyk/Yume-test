import { createServerFn } from "@tanstack/react-start";
import { readShikimoriSharedCache, writeShikimoriSharedCache } from "@/data/shikimori-kv-cache.server";
import type { Anime } from "@/data/anime";
import { isNewRelease } from "@/data/anime-sections";
import { getPersistentAnimeDetails, getPersistentCatalog, getPersistentAnimeScreenshots, savePersistentAnimeScreenshots, refreshPersistentAnimeIdentity, type CatalogResult, type CatalogSeedPageResult } from "@/data/catalog-d1.server";
import { isUpcomingEpisodeDate, mergeLiveAnimeDetails } from "@/data/catalog-details";
import { retryAfterMilliseconds } from "@/data/retry-after";
export { retryAfterMilliseconds };
import { filterCatalogForCurrentRequest } from "@/data/territorial-restrictions.server";

const API_URL = "https://shikimori.io/api/graphql";
const SCREENSHOT_API_URL = "https://shikimori.one/api/animes/";
const CACHE_TTL_MS = 5 * 60 * 1000;
const SCREENSHOT_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

export type ShikimoriScreenshot = { originalUrl: string; previewUrl: string };
const screenshotCache = new Map<string, { expiresAt: number; items: ShikimoriScreenshot[] }>();
const responseCache = new Map<string, { expiresAt: number; items: Anime[] }>();
// A 429 opens a per-isolate circuit breaker to avoid repeated upstream bursts.
let shikimoriCooldownUntil = 0;
const SHIKIMORI_429_COOLDOWN_MS = 60 * 1000;
const SEED_REQUEST_DELAY_MS = 1250;

async function hashShikimoriCacheKey(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

type ShikimoriRequest = {
  page?: number;
  limit?: number;
  order?: "ranked" | "popularity" | "aired_on" | "updated_at_desc" | "created_at_desc";
  search?: string;
  status?: "ongoing" | "released" | "anons";
  kind?: "tv" | "movie" | "ova" | "ona" | "special" | "music";
  ids?: string;
  includeVideos?: boolean;
};

type ShikimoriGraphQLAnime = {
  id: string;
  name: string;
  english?: string | string[] | null;
  russian?: string | null;
  kind?: string | null;
  score?: number | string | null;
  status?: string | null;
  episodes?: number | null;
  episodesAired?: number | null;
  airedOn?: { date?: string | null; year?: number | null } | null;
  releasedOn?: { date?: string | null; year?: number | null } | null;
  description?: string | null;
  poster?: {
    originalUrl?: string | null;
    mainUrl?: string | null;
    previewUrl?: string | null;
  } | null;
  opengraphImageUrl?: string | null;
  genres?: { id: string; name: string; russian: string; kind: string }[] | null;
  nextEpisodeAt?: string | null;
  rating?: string | null;
  studios?: { name: string }[] | null;
  videos?: ShikimoriGraphQLVideo[] | null;
};

type ShikimoriGraphQLVideo = {
  id?: string | number | null;
  url?: string | null;
  name?: string | null;
  kind?: string | null;
  playerUrl?: string | null;
  imageUrl?: string | null;
};

type GraphQLResponse = {
  data?: { animes?: ShikimoriGraphQLAnime[] | null; [key: string]: ShikimoriGraphQLAnime[] | null | undefined };
  errors?: { message?: string }[];
};

export type ShikimoriSectionFeeds = {
  popular: Anime[];
  newReleases: Anime[];
  announcements: Anime[];
  airing: Anime[];
};

export function parseShikimoriResponse(payload: GraphQLResponse): { items: Anime[]; error: string | null } {
  if (payload.errors?.length) {
    return {
      items: [],
      error: payload.errors.map((error) => error.message).filter(Boolean).join("; ") || "Shikimori GraphQL error",
    };
  }
  return {
    items: (payload.data?.animes ?? []).filter((item) => !hasExcludedGenre(item)).map(mapAnime),
    error: null,
  };
}

const EXCLUDED_GENRE_NAMES = new Set(["хентай", "hentai"]);

function hasExcludedGenre(item: ShikimoriGraphQLAnime): boolean {
  return (item.genres ?? []).some((genre) =>
    [genre.russian, genre.name].some((name) =>
      EXCLUDED_GENRE_NAMES.has((name ?? "").normalize("NFKC").trim().toLocaleLowerCase()),
    ),
  );
}

const ANIME_VIDEO_FIELDS = "videos { id url name kind playerUrl imageUrl }";

const ANIME_FIELDS = [
  "id",
  "name",
  "english",
  "russian",
  "kind",
  "score",
  "status",
  "episodes",
  "episodesAired",
  "airedOn { date year }",
  "releasedOn { date year }",
  "description",
  "poster { originalUrl mainUrl previewUrl }",
  "opengraphImageUrl",
  "genres { id name russian kind }",
  "nextEpisodeAt",
  "rating",
  "studios { name }",
].join(" ");

const SECTION_ANIME_FIELDS = [
  "id",
  "name",
  "english",
  "russian",
  "kind",
  "score",
  "status",
  "episodes",
  "episodesAired",
  "airedOn { date year }",
  "releasedOn { date year }",
  "poster { originalUrl mainUrl previewUrl }",
  "opengraphImageUrl",
  "genres { id name russian kind }",
  "nextEpisodeAt",
  "rating",
].join(" ");

function cleanDescription(value: string | null | undefined): string {
  return (value ?? "")
    .replace(/\[(?:character|anime|manga|person)=[^\]]+\]/gi, "")
    .replace(/\[\/(?:character|anime|manga|person)\]/gi, "")
    .replace(/<[^>]*>/g, "")
    .replace(/\r\n/g, "\n")
    .trim();
}

function safeImageUrl(value: string | null | undefined): string | undefined {
  if (!value?.trim()) return undefined;

  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
    // Avoid mixed-content failures if the source returns a legacy HTTP image URL.
    url.protocol = "https:";
    return url.toString();
  } catch {
    return undefined;
  }
}

export function normalizeShikimoriScreenshots(payload: unknown): ShikimoriScreenshot[] {
  if (!Array.isArray(payload)) return [];
  const result: ShikimoriScreenshot[] = [];
  const seen = new Set<string>();
  for (const value of payload) {
    if (!value || typeof value !== "object") continue;
    const row = value as { original?: unknown; preview?: unknown };
    const normalizeUrl = (input: unknown) => {
      if (typeof input !== "string" || !input.trim()) return undefined;
      const raw = input.trim();
      const normalized = safeImageUrl(raw.startsWith("//") ? "https:" + raw : raw);
      if (!normalized) return undefined;
      try {
        const hostname = new URL(normalized).hostname.toLowerCase();
        return hostname === "example.com" || hostname.endsWith(".example.com") ? undefined : normalized;
      } catch { return undefined; }
    };
    const original = normalizeUrl(row.original);
    const preview = normalizeUrl(row.preview);
    const primary = original ?? preview;
    if (!primary || seen.has(primary)) continue;
    seen.add(primary);
    result.push({ originalUrl: primary, previewUrl: preview ?? primary });
    if (result.length >= 24) break;
  }
  return result;
}

function cleanName(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function mapStatus(value: string | null | undefined): Anime["status"] {
  if (value === "ongoing") return "Онгоинг";
  if (value === "anons") return "Анонс";
  if (value === "released") return "Вышел";
  return "Неизвестно";
}

function mapKind(value: string | null | undefined): string {
  switch (value) {
    case "tv":
      return "TV";
    case "movie":
      return "Фильм";
    case "ova":
      return "OVA";
    case "ona":
      return "ONA";
    case "special":
      return "Спешл";
    case "music":
      return "Музыкальное";
    default:
      return value ?? "";
  }
}

function mapAgeRating(value: string | null | undefined): string | undefined {
  switch (value) {
    case "g":
    case "pg":
      return "Без ограничений";
    case "pg_13":
      return "12+";
    case "r":
    case "r_plus":
      return "16+";
    case "rx":
      return "18+";
    default:
      return undefined;
  }
}

export function youtubeVideoId(value: string | null | undefined): string | undefined {
  if (!value?.trim()) return undefined;
  try {
    const url = new URL(value.trim());
    const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    let candidate = "";
    if (hostname === "youtu.be") {
      candidate = url.pathname.split("/").filter(Boolean)[0] ?? "";
    } else if (["youtube.com", "m.youtube.com", "music.youtube.com", "youtube-nocookie.com"].includes(hostname)) {
      if (url.pathname === "/watch") candidate = url.searchParams.get("v") ?? "";
      else {
        const match = /^\/(?:embed|shorts|live|v)\/([^/?#]+)/.exec(url.pathname);
        candidate = match?.[1] ?? "";
      }
    }
    return /^[A-Za-z0-9_-]{11}$/.test(candidate) ? candidate : undefined;
  } catch {
    return undefined;
  }
}

function findYouTubeTrailerId(videos: ShikimoriGraphQLVideo[] | null | undefined): string | undefined {
  const candidates = (videos ?? [])
    .map((video) => {
      const sources = [video.playerUrl, video.url];
      const id = sources.map(youtubeVideoId).find(Boolean);
      const kind = (video.kind ?? "").toLocaleLowerCase();
      const name = (video.name ?? "").toLocaleLowerCase();
      const isTrailerKind = kind === "pv" || kind === "character_trailer";
      const isTrailerName = /trailer|preview|\bpv\b|промо|трейлер|тизер|予告/i.test(name);
      const priority = isTrailerKind ? 0 : isTrailerName ? 1 : 2;
      // Shikimori metadata for video kind/name is not always consistent.
      // Prefer explicit trailers, but retain valid YouTube videos as a fallback.
      return id ? { id, priority, isTrailer: isTrailerKind || isTrailerName } : null;
    })
    .filter((value): value is { id: string; priority: number; isTrailer: boolean } => value !== null)
    .sort((a, b) => Number(b.isTrailer) - Number(a.isTrailer) || a.priority - b.priority);
  return candidates[0]?.id;
}

export function mapAnime(item: ShikimoriGraphQLAnime): Anime {
  const rawYear = Number(item.airedOn?.year ?? item.releasedOn?.year ?? 0);
  const year = Number.isInteger(rawYear) && rawYear > 0 ? rawYear : 0;
  const score = item.score == null || item.score === "" ? null : Number(item.score);
  const rating = score !== null && Number.isFinite(score) && score > 0 && score <= 10 ? score : null;
  const episodes = Math.max(0, Math.floor(Number(item.episodes ?? 0) || 0));
  const episodesAired = Math.max(0, Math.floor(Number(item.episodesAired ?? 0) || 0));
  const status = mapStatus(item.status);
  const airedOn = item.airedOn?.date || item.releasedOn?.date || undefined;
  const rawGenres = item.genres ?? [];
  const genres = Array.from(new Set(
    rawGenres
      .filter((genre) => genre.kind === "genre")
      .map((genre) => cleanName(genre.russian) || cleanName(genre.name))
      .filter(Boolean),
  ));
  const posterUrl =
    safeImageUrl(item.poster?.mainUrl) ||
    safeImageUrl(item.poster?.previewUrl) ||
    safeImageUrl(item.poster?.originalUrl);
  const bannerUrl =
    safeImageUrl(item.opengraphImageUrl) ||
    safeImageUrl(item.poster?.originalUrl) ||
    posterUrl;
  const originalTitle = cleanName(item.name) || "Без названия";
  const russianTitle = cleanName(item.russian);
  const englishValue = Array.isArray(item.english) ? item.english[0] : item.english;
  const englishTitle = cleanName(englishValue);
  const idNumber = Number(item.id);
  const safeHue = Number.isFinite(idNumber) ? Math.abs(idNumber * 37) % 360 : 280;
  const description = cleanDescription(item.description);

  return {
    id: String(item.id),
    title: russianTitle || englishTitle || originalTitle,
    englishTitle: englishTitle || originalTitle,
    original: originalTitle,
    year,
    episodes,
    rating,
    genres,
    status,
    description,
    hue: safeHue,
    glyph: Array.from(originalTitle)[0] || "Y",
    isNew: isNewRelease({ status, airedOn }),
    popular: rating !== null && rating >= 8.5,
    posterUrl,
    bannerUrl,
    kind: mapKind(item.kind),
    ageRating: mapAgeRating(item.rating),
    nextEpisodeAt: isUpcomingEpisodeDate(item.nextEpisodeAt || undefined) ? item.nextEpisodeAt || undefined : undefined,
    episodesAired,
    airedOn,
    studios: Array.from(new Set((item.studios ?? []).map((studio) => cleanName(studio.name)).filter(Boolean))),
    youtubeTrailerId: findYouTubeTrailerId(item.videos),
  };
}

export function validateRequest(input: ShikimoriRequest): ShikimoriRequest {
  const limit = Math.min(50, Math.max(1, Math.floor(Number(input.limit ?? 50) || 50)));
  const page = Math.min(500, Math.max(1, Math.floor(Number(input.page ?? 1) || 1)));
  const allowedOrders = ["ranked", "popularity", "aired_on", "updated_at_desc", "created_at_desc"];
  const allowedStatuses = ["ongoing", "released", "anons"];
  const allowedKinds = ["tv", "movie", "ova", "ona", "special", "music"];
  const search = typeof input.search === "string" ? input.search.trim().slice(0, 120) : "";
  const ids = typeof input.ids === "string" && /^\d+(?:,\d+)*$/.test(input.ids)
    ? input.ids.slice(0, 500)
    : undefined;

  return {
    page,
    limit,
    order: allowedOrders.includes(input.order ?? "") ? input.order : "ranked",
    search: search || undefined,
    status: allowedStatuses.includes(input.status ?? "") ? input.status : undefined,
    kind: allowedKinds.includes(input.kind ?? "") ? input.kind : undefined,
    ids,
    includeVideos: input.includeVideos === true,
  };
}

async function fetchShikimoriAnimes(data: ShikimoriRequest) {
  const key = JSON.stringify(data);
  const cached = responseCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return { items: cached.items, error: null as string | null };
  }

  const sharedCached = await readShikimoriSharedCache<Anime[]>("graphql:" + await hashShikimoriCacheKey(key));
  if (sharedCached) {
    responseCache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, items: sharedCached });
    return { items: sharedCached, error: null as string | null };
  }

  if (Date.now() < shikimoriCooldownUntil) {
    return {
      items: [] as Anime[],
      error: "Источник каталога временно ограничил запросы. Повтори попытку немного позже.",
      retryAfterMs: Math.max(1000, shikimoriCooldownUntil - Date.now()),
    };
  }

  const args = [
    "page: " + (data.page ?? 1),
    "limit: " + (data.limit ?? 50),
    "order: " + (data.order ?? "ranked"),
  ];
  if (data.search) args.push("search: " + JSON.stringify(data.search));
  if (data.status) args.push("status: " + JSON.stringify(data.status));
  if (data.kind) args.push("kind: " + JSON.stringify(data.kind));
  if (data.ids) args.push("ids: " + JSON.stringify(data.ids));

  const fields = ANIME_FIELDS + (data.includeVideos ? " " + ANIME_VIDEO_FIELDS : "");
  const query = "query { animes(" + args.join(", ") + ") { " + fields + " } }";

  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": "YUME/1.0",
      },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(12000),
    });

    if (response.status === 429) {
      const retryAfterMs = retryAfterMilliseconds(response.headers.get("Retry-After"))
        ?? SHIKIMORI_429_COOLDOWN_MS;
      shikimoriCooldownUntil = Math.max(shikimoriCooldownUntil, Date.now() + retryAfterMs);
      console.warn("[YUME] Shikimori returned HTTP 429; pausing requests for", retryAfterMs, "ms.");
      return {
        items: [] as Anime[],
        error: "Источник каталога временно ограничил запросы. Повтори попытку немного позже.",
        retryAfterMs,
      };
    }
    if (!response.ok) {
      throw new Error("Shikimori returned HTTP " + response.status);
    }

    const payload = (await response.json()) as GraphQLResponse;
    const parsed = parseShikimoriResponse(payload);
    if (parsed.error) throw new Error(parsed.error);
    const items = parsed.items;
    responseCache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, items });
    await writeShikimoriSharedCache("graphql:" + await hashShikimoriCacheKey(key), items, CACHE_TTL_MS);
    if (responseCache.size > 160) {
      const now = Date.now();
      for (const [cacheKey, entry] of responseCache) {
        if (entry.expiresAt <= now) responseCache.delete(cacheKey);
      }
      while (responseCache.size > 160) {
        const oldestKey = responseCache.keys().next().value;
        if (oldestKey === undefined) break;
        responseCache.delete(oldestKey);
      }
    }
    return { items, error: null as string | null };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Shikimori API error";
    console.error("[YUME] Shikimori catalog request failed:", message);
    return {
      items: [] as Anime[],
      error: "Не удалось загрузить каталог Shikimori. Проверь подключение и обнови страницу.",
    };
  }
}
export const getShikimoriAnimes = createServerFn({ method: "GET" })
  .validator((input: ShikimoriRequest) => validateRequest(input))
  .handler(async ({ data }) => filterCatalogForCurrentRequest(await fetchShikimoriAnimes(data)));

const SECTION_FEED_CACHE_TTL_MS = 2 * 60 * 1000;
let sectionFeedCache: { expiresAt: number; feeds: ShikimoriSectionFeeds } | null = null;
let sectionFeedRequest: Promise<ShikimoriSectionFeeds | null> | null = null;

function dedupeSectionItems(items: Anime[]): Anime[] {
  const unique = new Map<string, Anime>();
  for (const item of items) unique.set(item.id, item);
  return Array.from(unique.values());
}

/**
 * Current data for existing homepage sections, fetched in one GraphQL round-trip.
 * D1 remains the durable catalogue; these feeds refresh status/rating snapshots.
 */
export function parseShikimoriSectionFeeds(payload: GraphQLResponse): ShikimoriSectionFeeds | null {
  if (payload.errors?.length || !payload.data) return null;
  const names = [
    "popularPage1", "popularPage2", "newReleasesPage1", "newReleasesPage2",
    "announcementsPage1", "airingPage1", "airingPage2",
  ];
  if (!names.some((name) => Array.isArray(payload.data?.[name]))) return null;

  const read = (...keys: string[]) => dedupeSectionItems(keys.flatMap((key) =>
    (payload.data?.[key] ?? []).filter((item) => !hasExcludedGenre(item)).map(mapAnime),
  ));

  return {
    popular: read("popularPage1", "popularPage2"),
    newReleases: read("newReleasesPage1", "newReleasesPage2"),
    announcements: read("announcementsPage1"),
    airing: read("airingPage1", "airingPage2"),
  };
}

async function fetchShikimoriSectionFeeds(): Promise<ShikimoriSectionFeeds | null> {
  const now = Date.now();
  if (sectionFeedCache && sectionFeedCache.expiresAt > now) return sectionFeedCache.feeds;
  if (sectionFeedRequest) return sectionFeedRequest;

  // Set the in-flight promise before awaiting KV so concurrent requests in this
  // isolate share the same cache lookup and upstream refresh.
  sectionFeedRequest = (async () => {
    const sharedFeeds = await readShikimoriSharedCache<ShikimoriSectionFeeds>("section-feeds");
    if (sharedFeeds) {
      sectionFeedCache = { expiresAt: Date.now() + SECTION_FEED_CACHE_TTL_MS, feeds: sharedFeeds };
      return sharedFeeds;
    }
    if (Date.now() < shikimoriCooldownUntil) return null;

    const fields = SECTION_ANIME_FIELDS;
    const query = [
      "query {",
      "  popularPage1: animes(page: 1, limit: 50, order: \"ranked\") { " + fields + " }",
      "  popularPage2: animes(page: 2, limit: 50, order: \"ranked\") { " + fields + " }",
      "  newReleasesPage1: animes(page: 1, limit: 50, order: \"aired_on\", status: \"released\") { " + fields + " }",
      "  newReleasesPage2: animes(page: 2, limit: 50, order: \"aired_on\", status: \"released\") { " + fields + " }",
      "  announcementsPage1: animes(page: 1, limit: 50, order: \"aired_on\", status: \"anons\") { " + fields + " }",
      "  airingPage1: animes(page: 1, limit: 50, order: \"ranked\", status: \"ongoing\") { " + fields + " }",
      "  airingPage2: animes(page: 2, limit: 50, order: \"ranked\", status: \"ongoing\") { " + fields + " }",
      "}",
    ].join("\n");

    try {
      const response = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "User-Agent": "YUME/1.0",
        },
        body: JSON.stringify({ query }),
        signal: AbortSignal.timeout(12000),
      });

      if (response.status === 429) {
        const retryAfterMs = retryAfterMilliseconds(response.headers.get("Retry-After"))
          ?? SHIKIMORI_429_COOLDOWN_MS;
        shikimoriCooldownUntil = Math.max(shikimoriCooldownUntil, Date.now() + retryAfterMs);
        console.warn("[YUME] Shikimori section feed returned HTTP 429; pausing requests for", retryAfterMs, "ms.");
        return null;
      }
      if (!response.ok) throw new Error("Shikimori section feed returned HTTP " + response.status);

      const payload = await response.json() as GraphQLResponse;
      const feeds = parseShikimoriSectionFeeds(payload);
      if (!feeds) {
        console.warn("[YUME] Shikimori section feed response was incomplete or returned GraphQL errors.");
        return null;
      }
      sectionFeedCache = { expiresAt: Date.now() + SECTION_FEED_CACHE_TTL_MS, feeds };
      await writeShikimoriSharedCache("section-feeds", feeds, SECTION_FEED_CACHE_TTL_MS);
      return feeds;
    } catch (error) {
      console.error("[YUME] Failed to refresh live section feeds:", error instanceof Error ? error.message : "Unknown Shikimori error");
      return null;
    }
  })();

  try {
    return await sectionFeedRequest;
  } finally {
    sectionFeedRequest = null;
  }
}

export const getShikimoriSectionFeeds = createServerFn({ method: "GET" })
  .handler(async () => fetchShikimoriSectionFeeds());

const CATALOG_CACHE_TTL_MS = 30 * 60 * 1000;

const PRIORITY_SEED_REQUESTS: ShikimoriRequest[] = [
  ...Array.from({ length: 10 }, (_, index) => ({ page: index + 1, limit: 50, order: "ranked" as const })),
  ...Array.from({ length: 3 }, (_, index) => ({ page: index + 1, limit: 50, order: "aired_on" as const })),
  ...Array.from({ length: 3 }, (_, index) => ({ page: index + 1, limit: 50, order: "popularity" as const })),
  ...Array.from({ length: 2 }, (_, index) => ({ page: index + 1, limit: 50, order: "created_at_desc" as const })),
  ...Array.from({ length: 2 }, (_, index) => ({ page: index + 1, limit: 50, order: "popularity" as const, status: "anons" as const })),
];

export function isSuccessfulEmptySeedPage(items: readonly unknown[], error: string | null | undefined, cursor: number): boolean {
  return !error && items.length === 0 && cursor >= PRIORITY_SEED_REQUESTS.length;
}

export function seedRequestForCursor(cursor: number): ShikimoriRequest | null {
  if (cursor < 0) return null;
  if (cursor < PRIORITY_SEED_REQUESTS.length) return PRIORITY_SEED_REQUESTS[cursor]!;
  return {
    page: cursor - PRIORITY_SEED_REQUESTS.length + 11,
    limit: 50,
    order: "ranked",
  };
}

function makeCatalogProgress(
  status: CatalogResult["progress"]["status"],
  imported: number,
  retryAfterMs?: number,
) {
  return {
    status,
    imported,
    target: null,
    ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
  };
}

type CatalogCacheEntry = { expiresAt: number; result: CatalogResult };
let catalogCache: CatalogCacheEntry | null = null;
let fallbackCursor = 0;
let fallbackResumeAt = 0;
const fallbackItems = new Map<string, Anime>();

/**
 * Non-D1 fallback for local previews: also fetches one page per invocation.
 * The Cloudflare production path uses D1 as the durable source of progress.
 */
async function buildShikimoriCatalog(forceRefresh: boolean): Promise<CatalogResult> {
  const now = Date.now();
  if (!forceRefresh && catalogCache && catalogCache.expiresAt > now) {
    return catalogCache.result;
  }

  const existingItems = Array.from(fallbackItems.values());
  if (fallbackResumeAt > now) {
    return {
      items: existingItems,
      error: null,
      progress: makeCatalogProgress("cooldown", existingItems.length, fallbackResumeAt - now),
    };
  }

  const request = seedRequestForCursor(fallbackCursor);
  if (!request) {
    const result: CatalogResult = {
      items: existingItems,
      error: null,
      progress: makeCatalogProgress("ready", existingItems.length),
    };
    catalogCache = { expiresAt: now + CATALOG_CACHE_TTL_MS, result };
    return result;
  }

  const page = await fetchShikimoriAnimes(request);
  if (page.error) {
    const retryAfterMs = page.retryAfterMs ?? 5000;
    fallbackResumeAt = Date.now() + retryAfterMs;
    return {
      items: existingItems,
      error: null,
      progress: makeCatalogProgress("cooldown", existingItems.length, retryAfterMs),
    };
  }

  for (const anime of page.items) {
    if (!fallbackItems.has(anime.id)) fallbackItems.set(anime.id, anime);
  }
  if (isSuccessfulEmptySeedPage(page.items, page.error, fallbackCursor)) {
    const result: CatalogResult = {
      items: existingItems,
      error: null,
      progress: makeCatalogProgress("ready", existingItems.length),
    };
    catalogCache = { expiresAt: Date.now() + CATALOG_CACHE_TTL_MS, result };
    return result;
  }

  fallbackCursor += 1;
  fallbackResumeAt = Date.now() + SEED_REQUEST_DELAY_MS;

  const items = Array.from(fallbackItems.values());
  const status = "seeding";
  const error = null;
  const result: CatalogResult = {
    items,
    error,
    progress: makeCatalogProgress(status, items.length, status === "seeding" ? SEED_REQUEST_DELAY_MS : undefined),
  };
  if (status === "ready") catalogCache = { expiresAt: Date.now() + CATALOG_CACHE_TTL_MS, result };
  return result;
}

export const getShikimoriCatalog = createServerFn({ method: "GET" })
  .validator((input: { forceRefresh?: boolean; progressOnly?: boolean }) => ({
    forceRefresh: input.forceRefresh === true,
    progressOnly: input.progressOnly === true,
  }))
  .handler(async ({ data }) => {
    const persistent = await getPersistentCatalog(
      async (cursor): Promise<CatalogSeedPageResult> => {
        const request = seedRequestForCursor(cursor);
        if (!request) return { items: [], error: null, done: true };
        // Trailer metadata is imported with catalog rows as part of the admin-only seed.
        const page = await fetchShikimoriAnimes({ ...request, includeVideos: true });
        return isSuccessfulEmptySeedPage(page.items, page.error, cursor)
          ? { ...page, done: true }
          : page;
      },
      { progressOnly: data.progressOnly },
    );
    if (persistent) return filterCatalogForCurrentRequest(persistent);
    // With no D1 binding, fail closed instead of making user requests fall back
    // to a live Shikimori catalog query. Imports must use an admin-only process.
    return {
      items: [],
      error: "Каталог недоступен: база данных D1 не подключена.",
      progress: makeCatalogProgress("partial", 0),
    };
  });


/**
 * Loads stable identity from D1, then resolves changing metadata from Shikimori
 * for the selected title. D1 remains the fallback when the provider is unavailable.
 */
export const getShikimoriAnimeDetails = createServerFn({ method: "GET" })
  .validator((input: { animeId?: unknown }) => ({
    animeId: typeof input?.animeId === "string" && /^\d{1,12}$/.test(input.animeId)
      ? input.animeId
      : "",
  }))
  .handler(async ({ data }) => {
    const empty = { anime: null, relatedAnime: [] as Anime[], apiError: null as string | null };
    if (!data.animeId) return empty;

    let details: Awaited<ReturnType<typeof getPersistentAnimeDetails>>;
    try {
      details = await getPersistentAnimeDetails(data.animeId);
    } catch (error) {
      console.error("[YUME] Failed to load anime details from D1:", error);
      return { ...empty, apiError: "Каталог временно недоступен." };
    }
    if (!details) {
      return { ...empty, apiError: "Каталог недоступен: база данных D1 не подключена." };
    }
    if (!details.anime) return { anime: null, relatedAnime: [], apiError: null };

    let anime: Anime | null = details.anime;
    let apiError: string | null = null;
    try {
      const liveResult = await fetchShikimoriAnimes(validateRequest({
        ids: data.animeId,
        includeVideos: true,
      }));
      const liveAnime = liveResult.items.find((item) => item.id === data.animeId);
      if (liveAnime && !liveResult.error) {
        anime = mergeLiveAnimeDetails(details.anime, liveAnime);
        try {
          await refreshPersistentAnimeIdentity({
            id: anime.id,
            rating: liveAnime.rating,
            posterUrl: liveAnime.posterUrl,
          });
        } catch (error) {
          // A transient D1 write failure must not discard the fresh provider response.
          console.error("[YUME] Failed to persist refreshed anime identity:", error);
        }
      } else {
        apiError = liveResult.error ?? "Не удалось обновить данные из Shikimori.";
        anime = {
          ...details.anime,
          nextEpisodeAt: isUpcomingEpisodeDate(details.anime.nextEpisodeAt)
            ? details.anime.nextEpisodeAt
            : undefined,
        };
      }
    } catch (error) {
      console.error("[YUME] Failed to refresh selected anime from Shikimori:", error);
      apiError = "Не удалось обновить данные из Shikimori.";
      anime = {
        ...details.anime,
        nextEpisodeAt: isUpcomingEpisodeDate(details.anime.nextEpisodeAt)
          ? details.anime.nextEpisodeAt
          : undefined,
      };
    }

    if (!anime) return { anime: null, relatedAnime: [], apiError };

    const filtered = filterCatalogForCurrentRequest({
      items: [anime, ...details.relatedAnime],
    }).items;
    const visibleById = new Map(filtered.map((item) => [item.id, item]));
    anime = visibleById.get(details.anime.id) ?? null;
    return {
      anime,
      relatedAnime: details.relatedAnime
        .map((item) => visibleById.get(item.id))
        .filter((item): item is Anime => Boolean(item)),
      apiError,
    };
  });

/**
 * Prefer persistent screenshot URLs in D1; populate lazily from Shikimori when absent.
 */
export const getShikimoriAnimeScreenshots = createServerFn({ method: "GET" })
  .validator((input: { animeId?: unknown }) => ({
    animeId: typeof input?.animeId === "string" && /^\d{1,12}$/.test(input.animeId) ? input.animeId : "",
  }))
  .handler(async ({ data }) => {
    if (!data.animeId) return { items: [] as ShikimoriScreenshot[] };
    try {
      const persisted = await getPersistentAnimeScreenshots(data.animeId);
      if (persisted?.length) return { items: persisted };
      const cached = screenshotCache.get(data.animeId);
      if (cached && cached.expiresAt > Date.now() && cached.items.length) return { items: cached.items };
      const sharedScreenshots = await readShikimoriSharedCache<ShikimoriScreenshot[]>("screenshots:" + data.animeId);
      if (sharedScreenshots?.length) {
        screenshotCache.set(data.animeId, { expiresAt: Date.now() + SCREENSHOT_CACHE_TTL_MS, items: sharedScreenshots });
        return { items: sharedScreenshots };
      }
      const details = await getPersistentAnimeDetails(data.animeId);
      const airedOn = details?.anime?.airedOn;
      const futureRelease = typeof airedOn === "string" && /^\\d{4}-\\d{2}-\\d{2}/.test(airedOn)
        && airedOn.slice(0, 10) > new Date().toISOString().slice(0, 10);
      if (details?.anime?.status === "Анонс" || futureRelease) return { items: [] as ShikimoriScreenshot[] };
      const response = await fetch(SCREENSHOT_API_URL + encodeURIComponent(data.animeId) + "/screenshots", {
        headers: { Accept: "application/json", "User-Agent": "YUME/0.2.0" },
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) return { items: cached?.items ?? [] as ShikimoriScreenshot[] };
      const items = normalizeShikimoriScreenshots(await response.json());
      if (items.length) {
        screenshotCache.set(data.animeId, { expiresAt: Date.now() + SCREENSHOT_CACHE_TTL_MS, items });
        await Promise.all([
          savePersistentAnimeScreenshots(data.animeId, items),
          writeShikimoriSharedCache("screenshots:" + data.animeId, items, SCREENSHOT_CACHE_TTL_MS),
        ]);
      }
      return { items };
    } catch (error) {
      console.warn("[YUME] Could not load or persist anime screenshots:", error);
      return { items: screenshotCache.get(data.animeId)?.items ?? [] as ShikimoriScreenshot[] };
    }
  });
