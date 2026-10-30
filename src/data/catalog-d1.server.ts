import { env as cloudflareEnv } from "cloudflare:workers";
import type { Anime } from "@/data/anime";
import { isNewRelease } from "@/data/anime-sections";
import { selectRelatedAnime } from "@/data/catalog-details";

// Prefer Cloudflare's request-scoped env binding; the injected value remains a
// fallback for local adapters and tests.
type RuntimeGlobal = typeof globalThis & { __YUME_RUNTIME_ENV__?: unknown };

export function setCatalogRuntimeEnvironment(env: unknown): void {
  (globalThis as RuntimeGlobal).__YUME_RUNTIME_ENV__ = env;
}

export type CatalogProgress = {
  status: "seeding" | "cooldown" | "ready" | "partial";
  imported: number;
  target: number | null;
  retryAfterMs?: number;
};

export type CatalogResult = {
  items: Anime[];
  error: string | null;
  progress: CatalogProgress;
};

export type CatalogSeedPageResult = {
  items: Anime[];
  error: string | null;
  retryAfterMs?: number;
  done?: boolean;
};

type RunResult = { meta?: { changes?: number } };
type AnimeRow = {
  id: string;
  title: string;
  english_title: string | null;
  original_title: string;
  year: number;
  episodes: number;
  rating: number | null;
  genres_json: string;
  status: string;
  description: string;
  hue: number;
  glyph: string;
  is_new: number;
  popular: number;
  poster_url: string | null;
  banner_url: string | null;
  kind: string | null;
  age_rating: string | null;
  next_episode_at: string | null;
  episodes_aired: number;
  aired_on: string | null;
  studios_json: string;
  youtube_trailer_id: string | null;
};

interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<RunResult>;
}

interface D1Database {
  prepare(query: string): D1Statement;
  batch(statements: D1Statement[]): Promise<unknown[]>;
  exec(query: string): Promise<unknown>;
}

const LOCK_TTL_MS = 30 * 1000;
const DEFAULT_RETRY_MS = 5 * 1000;
const SEED_REQUEST_DELAY_MS = 1250;
const NEUTRAL_ERROR = "Каталог временно недоступен.";
let missingBindingWarningLogged = false;
const CATALOG_READ_CACHE_TTL_MS = 300_000;
const CATALOG_EDGE_CACHE_KEY = "https://yume-catalog-cache.internal/v1/snapshot";
type WorkerCacheLike = {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
  delete(request: Request): Promise<boolean>;
};
type CacheGlobals = typeof globalThis & { caches?: { default?: WorkerCacheLike } };
let catalogReadCache: { db: D1Database; expiresAt: number; result: CatalogResult } | null = null;

function catalogEdgeCache(): WorkerCacheLike | null {
  try {
    return (globalThis as CacheGlobals).caches?.default ?? null;
  } catch {
    return null;
  }
}

async function readCachedCatalog(db: D1Database): Promise<CatalogResult | null> {
  if (catalogReadCache?.db === db && catalogReadCache.expiresAt > Date.now()) {
    return catalogReadCache.result;
  }
  catalogReadCache = null;
  const edge = catalogEdgeCache();
  if (!edge) return null;
  try {
    const response = await edge.match(new Request(CATALOG_EDGE_CACHE_KEY));
    if (!response?.ok) return null;
    const payload = await response.json() as { cachedAt?: number; result?: CatalogResult };
    const cachedAt = Number(payload.cachedAt);
    const result = payload.result;
    if (!Number.isFinite(cachedAt) || Date.now() - cachedAt >= CATALOG_READ_CACHE_TTL_MS ||
        !result || !Array.isArray(result.items) || !result.progress || typeof result.progress.status !== "string") return null;
    catalogReadCache = { db, expiresAt: cachedAt + CATALOG_READ_CACHE_TTL_MS, result };
    return result;
  } catch {
    return null;
  }
}

async function writeCachedCatalog(db: D1Database, result: CatalogResult): Promise<void> {
  const cachedAt = Date.now();
  catalogReadCache = { db, expiresAt: cachedAt + CATALOG_READ_CACHE_TTL_MS, result };
  const edge = catalogEdgeCache();
  if (!edge) return;
  try {
    await edge.put(new Request(CATALOG_EDGE_CACHE_KEY), new Response(JSON.stringify({ cachedAt, result }), {
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=300" },
    }));
  } catch {
    // Cache is an optimization only; D1 remains the source of truth.
  }
}

/** Clear the isolate-local public snapshot and this data center's edge snapshot after a catalog mutation. */
export async function invalidatePersistentCatalogCache(): Promise<void> {
  catalogReadCache = null;
  const edge = catalogEdgeCache();
  if (edge) {
    try { await edge.delete(new Request(CATALOG_EDGE_CACHE_KEY)); } catch { /* Best effort; the public cache also expires quickly. */ }
  }
  catalogReadCache = null;
}

function database(): D1Database | null {
  let nativeBinding: unknown;
  try {
    nativeBinding = (cloudflareEnv as unknown as Record<string, unknown>).YUME_DB;
  } catch {
    nativeBinding = undefined;
  }

  const injectedEnv = (globalThis as RuntimeGlobal).__YUME_RUNTIME_ENV__;
  const injectedBinding =
    injectedEnv && typeof injectedEnv === "object"
      ? (injectedEnv as Record<string, unknown>).YUME_DB
      : undefined;
  const binding = nativeBinding ?? injectedBinding;
  return binding && typeof binding === "object" ? (binding as D1Database) : null;
}

function parseJsonArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function rowToAnime(row: AnimeRow): Anime {
  const allowedStatuses: Anime["status"][] = ["Онгоинг", "Вышел", "Анонс", "Неизвестно"];
  const status = allowedStatuses.includes(row.status as Anime["status"])
    ? (row.status as Anime["status"])
    : "Неизвестно";

  const rawYear = Number(row.year);
  const year = Number.isInteger(rawYear) && rawYear > 0 ? rawYear : 0;
  const episodes = Math.max(0, Math.floor(Number(row.episodes) || 0));
  const rawRating = row.rating == null ? null : Number(row.rating);
  const rating = rawRating !== null && Number.isFinite(rawRating) && rawRating > 0 && rawRating <= 10
    ? rawRating
    : null;
  const anime: Anime = {
    id: String(row.id),
    title: row.title,
    original: row.original_title,
    year,
    episodes,
    rating,
    genres: parseJsonArray(row.genres_json),
    status,
    description: row.description ?? "",
    hue: Number(row.hue) || 280,
    glyph: row.glyph || "Y",
    isNew: isNewRelease({ status, airedOn: row.aired_on || undefined }),
    popular: Boolean(row.popular),
    episodesAired: Math.max(0, Math.floor(Number(row.episodes_aired) || 0)),
    studios: parseJsonArray(row.studios_json),
  };

  if (row.english_title) anime.englishTitle = row.english_title;
  if (row.poster_url) anime.posterUrl = row.poster_url;
  if (row.banner_url) anime.bannerUrl = row.banner_url;
  if (row.kind) anime.kind = row.kind;
  if (row.age_rating) anime.ageRating = row.age_rating;
  if (row.next_episode_at) anime.nextEpisodeAt = row.next_episode_at;
  if (row.aired_on) anime.airedOn = row.aired_on;
  if (row.youtube_trailer_id) anime.youtubeTrailerId = row.youtube_trailer_id;

  return anime;
}

export async function getPersistentAnimeDetails(id: string): Promise<{ anime: Anime | null; relatedAnime: Anime[] } | null> {
  const db = database();
  if (!db) return null;
  const cached = await readCachedCatalog(db);
  if (cached) {
    const anime = cached.items.find((item) => item.id === id) ?? null;
    return {
      anime,
      relatedAnime: anime ? selectRelatedAnime(anime, cached.items, 6) : [],
    };
  }

  // Related titles require the ordered catalog snapshot anyway, so avoid a
  // separate point lookup before loading the same rows.
  const items = await readRows(db);
  const anime = items.find((item) => item.id === id) ?? null;
  if (!anime) return { anime: null, relatedAnime: [] };

  const state = await getMeta(db, "catalog_state");
  const catalogResult: CatalogResult = {
    items,
    error: state === "partial" ? "Каталог загружен частично: " + items.length + " записей." : null,
    progress: makeProgress(state === "partial" ? "partial" : "ready", items.length),
  };
  await writeCachedCatalog(db, catalogResult);

  return {
    anime,
    relatedAnime: selectRelatedAnime(anime, items, 6),
  };
}

/**
 * Refresh only the durable identity fields that should remain in D1.
 * The detail response itself is composed from the live Shikimori record.
 */
export async function refreshPersistentAnimeIdentity(anime: Pick<Anime, "id" | "rating" | "posterUrl">): Promise<void> {
  const db = database();
  if (!db) return;
  const rating = anime.rating ?? null;
  const posterUrl = anime.posterUrl ?? null;
  const result = await db.prepare(`
    UPDATE anime_catalog
    SET
      rating = COALESCE(?, rating),
      popular = CASE WHEN ? IS NULL THEN popular WHEN ? >= 8.5 THEN 1 ELSE 0 END,
      poster_url = CASE WHEN poster_url IS NULL OR TRIM(poster_url) = '' THEN COALESCE(?, poster_url) ELSE poster_url END,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
      AND (
        (? IS NOT NULL AND rating IS NOT ?)
        OR (? IS NOT NULL AND popular <> CASE WHEN ? >= 8.5 THEN 1 ELSE 0 END)
        OR (? IS NOT NULL AND (poster_url IS NULL OR TRIM(poster_url) = ''))
      )
  `).bind(
    rating, rating, rating, posterUrl, anime.id,
    rating, rating,
    rating, rating,
    posterUrl,
  ).run();

  // A detail-page refresh should not evict the whole catalog snapshot unless
  // one of the durable identity fields actually changed in D1.
  if ((result.meta?.changes ?? 0) > 0) {
    await invalidatePersistentCatalogCache();
  }
}

function rowValues(item: Anime, position: number): unknown[] {
  return [
    item.id,
    item.title,
    item.englishTitle ?? null,
    item.original,
    item.year,
    item.episodes,
    item.rating,
    JSON.stringify(item.genres ?? []),
    item.status,
    item.description ?? "",
    item.hue ?? 280,
    item.glyph ?? "Y",
    item.isNew ? 1 : 0,
    item.popular ? 1 : 0,
    item.posterUrl ?? null,
    item.bannerUrl ?? null,
    item.kind ?? null,
    item.ageRating ?? null,
    item.nextEpisodeAt ?? null,
    item.episodesAired ?? 0,
    item.airedOn ?? null,
    JSON.stringify(item.studios ?? []),
    item.youtubeTrailerId ?? null,
    position,
  ];
}

const INSERT_ANIME = [
  "INSERT OR IGNORE INTO anime_catalog (",
  "  id, title, english_title, original_title, year, episodes, rating,",
  "  genres_json, status, description, hue, glyph, is_new, popular,",
  "  poster_url, banner_url, kind, age_rating, next_episode_at, episodes_aired,",
  "  aired_on, studios_json, youtube_trailer_id, position, updated_at",
  ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)",
].join("\n");

async function getMeta(db: D1Database, key: string): Promise<string | null> {
  const row = await db.prepare("SELECT value FROM anime_catalog_meta WHERE key = ?")
    .bind(key)
    .first<{ value: string }>();
  return row?.value ?? null;
}

function putMeta(db: D1Database, key: string, value: string): D1Statement {
  return db.prepare("INSERT OR REPLACE INTO anime_catalog_meta (key, value) VALUES (?, ?)")
    .bind(key, value);
}

async function readRows(db: D1Database): Promise<Anime[]> {
  const result = await db.prepare("SELECT a.* FROM anime_catalog a ORDER BY a.position ASC, a.id ASC").all<AnimeRow>();
  return result.results.map(rowToAnime);
}

async function countRows(db: D1Database): Promise<number> {
  const result = await db.prepare("SELECT COUNT(*) AS count FROM anime_catalog")
    .first<{ count: number }>();
  return Number(result?.count ?? 0);
}

function makeProgress(
  status: CatalogProgress["status"],
  imported: number,
  retryAfterMs?: number,
): CatalogProgress {
  return {
    status,
    imported,
    target: null,
    ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
  };
}

/**
 * Returns the persistent catalog and advances its seed by at most one upstream
 * page per invocation. The cursor and every imported page are saved in D1, so a
 * timeout, deploy, or Shikimori 429 never forces the importer to start over.
 */
export async function getPersistentCatalog(
  fetchSeedPage: (cursor: number) => Promise<CatalogSeedPageResult>,
  options: { progressOnly?: boolean; allowImport?: boolean; maxItems?: number } = {},
): Promise<CatalogResult | null> {
  const maxItems = Number.isSafeInteger(options.maxItems) && Number(options.maxItems) > 0
    ? Math.floor(Number(options.maxItems))
    : null;
  const db = database();
  if (!db) {
    if (!missingBindingWarningLogged) {
      missingBindingWarningLogged = true;
      console.error("[YUME] D1 binding YUME_DB is unavailable in the Worker runtime.");
    }
    return null;
  }

  if (!options.allowImport) {
    const cached = await readCachedCatalog(db);
    if (cached) return { ...cached, items: options.progressOnly ? [] : cached.items };
  }

  try {

    const state = await getMeta(db, "catalog_state");

    if (state === "ready" || state === "partial") {
      const items = await readRows(db);
      const imported = items.length;
      const result: CatalogResult = {
        items,
        error: state === "partial"
          ? "Каталог загружен частично: " + imported + " записей."
          : null,
        progress: makeProgress(state, imported),
      };
      if (!options.allowImport) await writeCachedCatalog(db, result);
      return { ...result, items: options.progressOnly ? [] : result.items };
    }

    // A ready catalog's row count comes from readRows above. Only query COUNT(*)
    // while seeding or recovering legacy rows, when the count is needed separately.
    let imported = await countRows(db);
    if (maxItems !== null && imported >= maxItems) {
      await db.batch([putMeta(db, "catalog_state", "ready")]);
      const items = await readRows(db);
      const result: CatalogResult = { items, error: null, progress: makeProgress("ready", imported) };
      if (!options.allowImport) await writeCachedCatalog(db, result);
      return { ...result, items: options.progressOnly ? [] : items };
    }

    // Preserve manually inserted catalog rows from earlier deployments.
    if (!state && imported > 0) {
      await db.batch([putMeta(db, "catalog_state", "ready")]);
      const result: CatalogResult = { items: await readRows(db), error: null, progress: makeProgress("ready", imported) };
      if (!options.allowImport) await writeCachedCatalog(db, result);
      return { ...result, items: options.progressOnly ? [] : result.items };
    }

    // User-facing requests never initialize or advance the upstream import.
    // With existing rows and no explicit allowImport flag, stay strictly read-only.
    if ((!state || imported === 0) && !options.allowImport) {
      return {
        items: [],
        error: "Каталог ещё не загружен. Импорт должен быть запущен администратором.",
        progress: makeProgress("partial", imported),
      };
    }

    if (!options.allowImport) {
      const result: CatalogResult = {
        items: await readRows(db),
        error: null,
        progress: makeProgress("ready", imported),
      };
      await writeCachedCatalog(db, result);
      return { ...result, items: options.progressOnly ? [] : result.items };
    }

    const now = Date.now();
    const resumeAt = Number(await getMeta(db, "catalog_resume_at") ?? "0");
    if (Number.isFinite(resumeAt) && resumeAt > now) {
      return {
        items: options.progressOnly ? [] : await readRows(db),
        error: null,
        progress: makeProgress("cooldown", imported, resumeAt - now),
      };
    }

    // Atomic D1 lock: concurrent page requests may read the catalog, but only one
    // of them is allowed to contact Shikimori and advance the cursor at a time.
    const lockUntil = now + LOCK_TTL_MS;
    const lockResult = await db.prepare([
      "INSERT OR REPLACE INTO anime_catalog_meta (key, value)",
      "SELECT ?, ?",
      "WHERE NOT EXISTS (",
      "  SELECT 1 FROM anime_catalog_meta",
      "  WHERE key = ? AND CAST(value AS INTEGER) > ?",
      ")",
    ].join("\n")).bind("catalog_lock", String(lockUntil), "catalog_lock", now).run();

    if ((lockResult.meta?.changes ?? 0) !== 1) {
      const existingLockUntil = Number(await getMeta(db, "catalog_lock") ?? String(now + 1000));
      return {
        items: options.progressOnly ? [] : await readRows(db),
        error: null,
        progress: makeProgress("cooldown", imported, Math.max(1000, existingLockUntil - now)),
      };
    }

    try {
      const cursor = Math.max(0, Math.floor(Number(await getMeta(db, "catalog_cursor") ?? "0")));
      let page: CatalogSeedPageResult;
      try {
        page = await fetchSeedPage(cursor);
      } catch (error) {
        console.error("[YUME] Catalog seed page failed:", error);
        page = { items: [], error: "Temporary catalog source error." };
      }

      if (page.done) {
        await db.batch([putMeta(db, "catalog_state", "ready")]);
        imported = await countRows(db);
        const result: CatalogResult = {
          items: await readRows(db),
          error: null,
          progress: makeProgress("ready", imported),
        };
        if (!options.allowImport) await writeCachedCatalog(db, result);
        return { ...result, items: options.progressOnly ? [] : result.items };
      }

      if (page.error) {
        const failures = Math.max(0, Number(await getMeta(db, "catalog_failures") ?? "0")) + 1;
        const exponentialBackoff = DEFAULT_RETRY_MS * (2 ** Math.min(failures - 1, 6));
        // Do not shorten an upstream Retry-After value: it is a minimum wait imposed by Shikimori.
        const retryAfterMs = page.retryAfterMs !== undefined
          ? Math.max(1000, page.retryAfterMs)
          : Math.min(exponentialBackoff, 10 * 60 * 1000);
        await db.batch([
          putMeta(db, "catalog_failures", String(failures)),
          putMeta(db, "catalog_resume_at", String(Date.now() + retryAfterMs)),
        ]);
        imported = await countRows(db);
        console.warn("[YUME] Catalog seed paused; retry in", retryAfterMs, "ms.");
        return {
          items: options.progressOnly ? [] : await readRows(db),
          error: null,
          progress: makeProgress("cooldown", imported, retryAfterMs),
        };
      }

      // Every Shikimori response is capped at 50. INSERT OR IGNORE makes replaying
      // a page idempotent if the Worker stops between inserting rows and saving cursor.
      const pageLimit = maxItems === null ? 50 : Math.max(0, Math.min(50, maxItems - imported));
      const statements: D1Statement[] = page.items.slice(0, pageLimit).map((item, index) =>
        db.prepare(INSERT_ANIME).bind(...rowValues(item, cursor * 50 + index)),
      );
      if (statements.length) {
        const insertResults = await db.batch(statements);
        if (insertResults.some((result) => (result.meta?.changes ?? 0) > 0)) {
          await invalidatePersistentCatalogCache();
        }
      }

      imported = await countRows(db);
      const nextCursor = cursor + 1;
      const nextState = maxItems !== null && imported >= maxItems ? "ready" : "seeding";

      await db.batch([
        putMeta(db, "catalog_cursor", String(nextCursor)),
        putMeta(db, "catalog_failures", "0"),
        putMeta(
          db,
          "catalog_resume_at",
          nextState === "seeding" ? String(Date.now() + SEED_REQUEST_DELAY_MS) : "0",
        ),
        putMeta(db, "catalog_state", nextState),
      ]);

      const allItems = nextState === "seeding" && options.progressOnly
        ? null
        : await readRows(db);
      const items = allItems ?? page.items.slice(0, 50);
      const error = null;
      return {
        items,
        error,
        progress: makeProgress(
          nextState,
          imported,
          nextState === "seeding" ? SEED_REQUEST_DELAY_MS : undefined,
        ),
      };
    } finally {
      await db.prepare("DELETE FROM anime_catalog_meta WHERE key = ? AND value = ?")
        .bind("catalog_lock", String(lockUntil))
        .run();
    }
  } catch (error) {
    schemaReady = false;
    console.error("[YUME] D1 catalog access failed:", error);
    return {
      items: [],
      error: NEUTRAL_ERROR,
      progress: makeProgress("cooldown", 0, DEFAULT_RETRY_MS),
    };
  }
}


export type PersistentAnimeScreenshot = { originalUrl: string; previewUrl: string };

export async function getPersistentAnimeScreenshots(animeId: string): Promise<PersistentAnimeScreenshot[] | null> {
  const db = database();
  if (!db) return null;
  const result = await db.prepare("SELECT original_url, preview_url FROM anime_catalog_screenshots WHERE anime_id = ? AND original_url NOT LIKE '%example.com%' AND preview_url NOT LIKE '%example.com%' ORDER BY position ASC, original_url ASC LIMIT 24").bind(animeId).all<{ original_url: string; preview_url: string }>();
  return result.results.map((row) => ({ originalUrl: row.original_url, previewUrl: row.preview_url }));
}

export async function savePersistentAnimeScreenshots(animeId: string, items: PersistentAnimeScreenshot[]): Promise<void> {
  const db = database();
  if (!db || !items.length) return;
  const validItems = items.filter((item) => {
    try {
      const original = new URL(item.originalUrl), preview = new URL(item.previewUrl);
      return [original, preview].every((url) => (url.protocol === "https:" || url.protocol === "http:") && url.hostname !== "example.com" && !url.hostname.endsWith(".example.com"));
    } catch { return false; }
  }).slice(0, 24);
  if (!validItems.length) return;
  // Enrichment is additive: never delete screenshots already saved for this anime.
  const statements: D1Statement[] = validItems.map((item, index) => db.prepare("INSERT OR IGNORE INTO anime_catalog_screenshots (anime_id, original_url, preview_url, position, updated_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)").bind(animeId, item.originalUrl, item.previewUrl, index));
  await db.batch(statements);
}
