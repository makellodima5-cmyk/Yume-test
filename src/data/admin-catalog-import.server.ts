import { env as cloudflareEnv } from "cloudflare:workers";
import { getPersistentCatalog, invalidatePersistentCatalogCache, type CatalogSeedPageResult } from "@/data/catalog-d1.server";
import type { Anime } from "@/data/anime";
import { retryAfterMilliseconds } from "@/data/retry-after";

type RuntimeGlobal = typeof globalThis & { __YUME_RUNTIME_ENV__?: unknown };
type Environment = Record<string, unknown> & { TELEGRAM_ADMIN_ID?: string; YUME_AUTH_SESSION_SECRET?: string; YUME_DB?: unknown };
type Statement = {
  bind(...values: unknown[]): Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta?: { changes?: number } }>;
};
type Database = { prepare(sql: string): Statement; batch(statements: Statement[]): Promise<unknown[]> };
type ShikimoriAnime = {
  id: string; name?: string | null; russian?: string | null; english?: string | string[] | null;
  kind?: string | null; score?: string | number | null; status?: string | null;
  episodes?: number | null; episodesAired?: number | null;
  airedOn?: { date?: string | null; year?: number | null } | null;
  releasedOn?: { date?: string | null; year?: number | null } | null;
  description?: string | null; poster?: { mainUrl?: string | null; previewUrl?: string | null; originalUrl?: string | null } | null;
  opengraphImageUrl?: string | null; genres?: { name?: string; russian?: string; kind?: string }[] | null;
  rating?: string | null; studios?: { name?: string }[] | null; nextEpisodeAt?: string | null;
  videos?: { url?: string | null; playerUrl?: string | null; name?: string | null; kind?: string | null }[] | null;
  screenshots?: { originalUrl?: string | null; x332Url?: string | null; x166Url?: string | null }[] | null;
};
type Payload = { data?: { animes?: ShikimoriAnime[] | null }; errors?: { message?: string }[] };
const API_URL = "https://shikimori.io/api/graphql";
const SESSION_COOKIE = "__Host-yume-session";
const PAGE_SIZE = 50;
const REQUEST_DELAY_MS = 1500;
const METADATA_REFRESH_BATCH_SIZE = 100;
const METADATA_LOOKUP_BATCH_SIZE = 40;
const SCREENSHOT_RETRY_LIMIT = 3;
const SCREENSHOT_REFRESH_BATCH_SIZE = 40;
const FIELDS = "id name english russian kind score status episodes episodesAired airedOn { date year } releasedOn { date year } description poster { mainUrl previewUrl originalUrl } opengraphImageUrl genres { id name russian kind } nextEpisodeAt rating studios { name } videos { url playerUrl name kind }";
const IMPORT_FIELDS = FIELDS + " screenshots { originalUrl x332Url x166Url }";

export function isValidAdminImportTarget(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}

export function normalizeAdminCatalogIds(value: unknown): string[] {
  const rawIds = Array.isArray(value) ? value : [];
  return Array.from(new Set(rawIds.filter((id): id is string => typeof id === "string" && /^\d{1,20}$/.test(id)))).slice(0, 100);
}

export function chunkAdminCatalogIds(value: unknown, size = METADATA_LOOKUP_BATCH_SIZE): string[][] {
  const ids = normalizeAdminCatalogIds(value);
  const chunkSize = Number.isInteger(size) && size > 0 ? Math.min(size, METADATA_LOOKUP_BATCH_SIZE) : METADATA_LOOKUP_BATCH_SIZE;
  const chunks: string[][] = [];
  for (let offset = 0; offset < ids.length; offset += chunkSize) chunks.push(ids.slice(offset, offset + chunkSize));
  return chunks;
}

function environment(): Environment {
  try {
    const native = cloudflareEnv as unknown as Environment;
    if (native && typeof native === "object") return native;
  } catch {
    // Tests may inject a runtime environment.
  }
  const injected = (globalThis as RuntimeGlobal).__YUME_RUNTIME_ENV__;
  return injected && typeof injected === "object" ? injected as Environment : {};
}
function database(env: Environment): Database | null {
  return env.YUME_DB && typeof env.YUME_DB === "object" ? env.YUME_DB as Database : null;
}
function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: {
    "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
  }});
}
function cookieValue(request: Request): string | null {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const index = part.indexOf("=");
    if (index >= 0 && part.slice(0, index).trim() === SESSION_COOKIE) return part.slice(index + 1).trim() || null;
  }
  return null;
}
async function sessionTokenHash(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
  return Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
}
function sameOrigin(request: Request): boolean {
  const expected = new URL(request.url).origin;
  const origin = request.headers.get("origin");
  if (origin) { try { return new URL(origin).origin === expected; } catch { return false; } }
  const referer = request.headers.get("referer");
  if (referer) { try { return new URL(referer).origin === expected; } catch { return false; } }
  return request.headers.get("sec-fetch-site") === "same-origin";
}
async function authorize(request: Request, env: Environment, db: Database): Promise<boolean> {
  const adminId = typeof env.TELEGRAM_ADMIN_ID === "string" ? env.TELEGRAM_ADMIN_ID.trim() : "";
  if (!/^\d{1,20}$/.test(adminId)) return false;
  const token = cookieValue(request);
  if (!token) return false;
  const secret = typeof env.YUME_AUTH_SESSION_SECRET === "string" && env.YUME_AUTH_SESSION_SECRET.trim().length >= 32
    ? env.YUME_AUTH_SESSION_SECRET
    : "";
  if (!secret) return false;
  const session = await db.prepare("SELECT u.telegram_user_id, s.expires_at FROM yume_sessions s JOIN yume_users u ON u.id = s.user_id WHERE s.token_hash = ? AND u.provider = 'telegram'")
    .bind(await sessionTokenHash(token, secret)).first<{ telegram_user_id: string | null; expires_at: number }>();
  return Boolean(session && session.expires_at > Date.now() && session.telegram_user_id === adminId);
}
async function getMeta(db: Database, key: string): Promise<string | null> {
  const row = await db.prepare("SELECT value FROM anime_catalog_meta WHERE key = ?").bind(key).first<{value:string}>();
  return row?.value ?? null;
}
function setMeta(db: Database, key: string, value: string): Statement {
  return db.prepare("INSERT OR REPLACE INTO anime_catalog_meta (key, value) VALUES (?, ?)").bind(key, value);
}
function clean(value: string | null | undefined): string { return (value ?? "").replace(/\s+/g, " ").trim(); }
function safeImage(value: string | null | undefined): string | null {
  if (!value) return null;
  try { const u = new URL(value); if (!["http:", "https:"].includes(u.protocol)) return null; u.protocol = "https:"; return u.toString(); } catch { return null; }
}
function youtubeVideoId(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    let id = "";
    if (host === "youtu.be") id = url.pathname.split("/").filter(Boolean)[0] ?? "";
    else if (["youtube.com", "m.youtube.com", "music.youtube.com", "youtube-nocookie.com"].includes(host)) {
      if (url.pathname === "/watch") id = url.searchParams.get("v") ?? "";
      else id = /^\/(?:embed|shorts|live|v)\/([^/?#]+)/.exec(url.pathname)?.[1] ?? "";
    }
    return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
  } catch { return null; }
}
function mapTrailer(item: ShikimoriAnime): string | null {
  const videos = (item.videos ?? []).map(video => {
    const id = youtubeVideoId(video.playerUrl) ?? youtubeVideoId(video.url);
    if (!id) return null;
    const kind = (video.kind ?? "").toLowerCase(), name = (video.name ?? "").toLowerCase();
    return { id, trailer: kind === "pv" || kind === "character_trailer" || /trailer|preview|\bpv\b|промо|трейлер|тизер|予告/i.test(name) };
  }).filter((video): video is { id: string; trailer: boolean } => video !== null);
  return videos.find(video => video.trailer)?.id ?? videos[0]?.id ?? null;
}

function mapItem(item: ShikimoriAnime) {
  const original = clean(item.name) || "Без названия";
  const english = Array.isArray(item.english) ? clean(item.english[0]) : clean(item.english);
  const title = clean(item.russian) || english || original;
  const yearValue = Number(item.airedOn?.year ?? item.releasedOn?.year ?? 0);
  const year = Number.isInteger(yearValue) && yearValue > 0 ? yearValue : 0;
  const score = item.score == null || item.score === "" ? null : Number(item.score);
  const rating = score !== null && Number.isFinite(score) && score > 0 && score <= 10 ? score : null;
  const status = item.status === "ongoing" ? "Онгоинг" : item.status === "released" ? "Вышел" : item.status === "anons" ? "Анонс" : "Неизвестно";
  const poster = safeImage(item.poster?.mainUrl) ?? safeImage(item.poster?.previewUrl) ?? safeImage(item.poster?.originalUrl);
  const banner = safeImage(item.opengraphImageUrl) ?? safeImage(item.poster?.originalUrl) ?? poster;
  const genres = Array.from(new Set((item.genres ?? []).filter(g => g.kind === "genre").map(g => clean(g.russian) || clean(g.name)).filter(Boolean)));
  const studios = Array.from(new Set((item.studios ?? []).map(s => clean(s.name)).filter(Boolean)));
  const kind = ({tv:"TV", movie:"Фильм", ova:"OVA", ona:"ONA", special:"Спешл", music:"Музыкальное"} as Record<string,string>)[item.kind ?? ""] ?? item.kind ?? null;
  const age = ({g:"Без ограничений",pg:"Без ограничений",pg_13:"12+",r:"16+",r_plus:"16+",rx:"18+"} as Record<string,string>)[item.rating ?? ""] ?? null;
  const description = (item.description ?? "").replace(/\[(?:character|anime|manga|person)=[^\]]+\]/gi,"").replace(/\[\/(?:character|anime|manga|person)\]/gi,"").replace(/<[^>]*>/g,"").trim();
  const airedOn = item.airedOn?.date || item.releasedOn?.date || null;
  const idNumber = Number(item.id);
  return {
    id: String(item.id), title, english_title: english || original, original_title: original, year,
    episodes: Math.max(0, Math.floor(Number(item.episodes ?? 0) || 0)), rating,
    genres_json: JSON.stringify(genres), status, description,
    hue: Number.isFinite(idNumber) ? Math.abs(idNumber * 37) % 360 : 280,
    glyph: Array.from(original)[0] || "Y", is_new: status === "Онгоинг" ? 1 : 0,
    popular: rating !== null && rating >= 8.5 ? 1 : 0, poster_url: poster, banner_url: banner,
    kind, age_rating: age, next_episode_at: item.nextEpisodeAt || null,
    episodes_aired: Math.max(0, Math.floor(Number(item.episodesAired ?? 0) || 0)),
    aired_on: airedOn, studios_json: JSON.stringify(studios), youtube_trailer_id: mapTrailer(item),
  };
}
function incomplete(item: ReturnType<typeof mapItem>): boolean {
  return item.year === 0 || !item.poster_url || !item.description || !item.title || !item.original_title;
}

type CatalogMetadataCompleteness = {
  title: string | null;
  english_title: string | null;
  original_title: string | null;
  year: number;
  episodes: number;
  rating: number | null;
  genres_json: string | null;
  status: string | null;
  description: string | null;
  poster_url: string | null;
  banner_url: string | null;
  kind: string | null;
  age_rating: string | null;
  aired_on: string | null;
  studios_json: string | null;
  youtube_trailer_id: string | null;
};

/** True only when a YUME-supported metadata field is absent and could be enriched. */
export function isCatalogMetadataIncomplete(row: CatalogMetadataCompleteness): boolean {
  const blank = (value: string | null | undefined) => !value?.trim();
  const announced = row.status === "Анонс";
  return blank(row.title) || row.title === "Без названия" ||
    blank(row.english_title) || blank(row.original_title) || row.original_title === "Без названия" ||
    (!announced && Number(row.year) <= 0) ||
    (!announced && Number(row.episodes) <= 0) ||
    row.rating == null ||
    blank(row.genres_json) || row.genres_json === "[]" ||
    blank(row.status) || row.status === "Неизвестно" ||
    blank(row.description) || blank(row.poster_url) || blank(row.banner_url) ||
    blank(row.kind) || blank(row.age_rating) ||
    (!announced && blank(row.aired_on)) ||
    blank(row.studios_json) ||
    blank(row.youtube_trailer_id);
}
const BULK_IMPORT_EXCLUDED_GENRES = new Set(["hentai", "хентай", "yaoi", "яой", "яои", "yuri", "юри"]);
function hasBulkExcludedGenre(item: ShikimoriAnime): boolean {
  return (item.genres ?? []).some(genre => [genre.name, genre.russian].some(name =>
    BULK_IMPORT_EXCLUDED_GENRES.has(clean(name).normalize("NFKC").toLocaleLowerCase("en"))));
}
function isBlockedFromBulkImport(item: ShikimoriAnime, block18Plus: boolean): boolean {
  return hasBulkExcludedGenre(item) || (block18Plus && clean(item.rating).toLocaleLowerCase("en") === "rx");
}
async function fetchPage(page: number, statusFilter: string | null = null, includeScreenshots = true): Promise<ShikimoriAnime[]> {
  const statusArgument = statusFilter ? ', status: "' + statusFilter + '"' : "";
  const query = "query { animes(page: " + page + ", limit: " + PAGE_SIZE + ", order: popularity" + statusArgument + ") { " + (includeScreenshots ? IMPORT_FIELDS : FIELDS) + " } }";
  const response = await fetch(API_URL, { method:"POST", headers:{"Content-Type":"application/json",Accept:"application/json","User-Agent":"YUME/1.0"}, body:JSON.stringify({query}), signal:AbortSignal.timeout(12000) });
  if (response.status === 429) {
    const retryAfterMs = retryAfterMilliseconds(response.headers.get("Retry-After")) ?? 60000;
    const error = new Error("Shikimori ограничил частоту запросов.");
    (error as Error & {retryAfterMs?:number}).retryAfterMs = retryAfterMs;
    throw error;
  }
  if (!response.ok) throw new Error("Shikimori вернул HTTP " + response.status);
  const payload = await response.json() as Payload;
  if (payload.errors?.length) throw new Error(payload.errors.map(e=>e.message).filter(Boolean).join("; ") || "GraphQL error");
  return payload.data?.animes ?? [];
}
async function fetchByTitle(title: string): Promise<ShikimoriAnime[]> {
  const normalized = clean(title).slice(0, 120);
  if (normalized.length < 2) return [];
  const query = "query { animes(search: " + JSON.stringify(normalized) + ", page: 1, limit: 10, order: popularity) { id name english russian kind score status rating airedOn { year } poster { mainUrl previewUrl originalUrl } genres { name russian kind } } }";
  const response = await fetch(API_URL, { method:"POST", headers:{"Content-Type":"application/json",Accept:"application/json","User-Agent":"YUME/1.0"}, body:JSON.stringify({query}), signal:AbortSignal.timeout(12000) });
  if (response.status === 429) {
    const retryAfterMs = retryAfterMilliseconds(response.headers.get("Retry-After")) ?? 60000;
    const error = new Error("Shikimori ограничил частоту запросов.");
    (error as Error & {retryAfterMs?:number}).retryAfterMs = retryAfterMs;
    throw error;
  }
  if (!response.ok) throw new Error("Shikimori вернул HTTP " + response.status);
  const payload = await response.json() as Payload;
  if (payload.errors?.length) throw new Error(payload.errors.map(e=>e.message).filter(Boolean).join("; ") || "GraphQL error");
  return payload.data?.animes ?? [];
}
async function fetchByIds(ids: string[], includeScreenshots = false): Promise<ShikimoriAnime[]> {
  const safeIds = normalizeAdminCatalogIds(ids);
  if (!safeIds.length) return [];

  // Shikimori may silently return only part of a large ID query (and large
  // requests have timed out in production). Keep each query below its practical
  // result cap, while respecting the upstream request rate limit.
  const resultById = new Map<string, ShikimoriAnime>();
  const batches = chunkAdminCatalogIds(safeIds);
  for (let index = 0; index < batches.length; index++) {
    if (index > 0) await new Promise(resolve => setTimeout(resolve, REQUEST_DELAY_MS));
    const batchIds = batches[index]!;
    const queryFields = includeScreenshots ? IMPORT_FIELDS : FIELDS;
    const query = "query { animes(ids: " + JSON.stringify(batchIds.join(",")) + ", limit: 50) { " + queryFields + " } }";
    const response = await fetch(API_URL, { method:"POST", headers:{"Content-Type":"application/json",Accept:"application/json","User-Agent":"YUME/1.0"}, body:JSON.stringify({query}), signal:AbortSignal.timeout(12000) });
    if (response.status === 429) {
      const retryAfterMs = retryAfterMilliseconds(response.headers.get("Retry-After")) ?? 60000;
      const error = new Error("Shikimori ограничил частоту запросов.");
      (error as Error & {retryAfterMs?:number}).retryAfterMs = retryAfterMs;
      throw error;
    }
    if (!response.ok) throw new Error("Shikimori вернул HTTP " + response.status);
    const payload = await response.json() as Payload;
    if (payload.errors?.length) throw new Error(payload.errors.map(e=>e.message).filter(Boolean).join("; ") || "GraphQL error");
    for (const item of payload.data?.animes ?? []) resultById.set(String(item.id), item);
  }

  return Array.from(resultById.values());
}

function catalogMetadataUpdateStatement(db: Database, item: ReturnType<typeof mapItem>, row: CatalogMetadataCompleteness & { next_episode_at: string | null; episodes_aired: number }): Statement | null {
  const changes: Array<[string, unknown]> = [];
  const blank = (value: string | null | undefined) => !value || !value.trim();
  const fill = (column: string, missing: boolean, value: unknown) => {
    if (missing && value !== null && value !== undefined && !(typeof value === "string" && !value.trim())) changes.push([column, value]);
  };
  fill("title", blank(row.title) || row.title === "Без названия", item.title !== "Без названия" ? item.title : null);
  fill("english_title", blank(row.english_title), item.english_title);
  fill("original_title", blank(row.original_title) || row.original_title === "Без названия", item.original_title !== "Без названия" ? item.original_title : null);
  fill("year", row.year <= 0, item.year > 0 ? item.year : null);
  fill("episodes", row.episodes <= 0, item.episodes > 0 ? item.episodes : null);
  fill("rating", row.rating == null, item.rating);
  fill("genres_json", blank(row.genres_json) || row.genres_json === "[]", item.genres_json !== "[]" ? item.genres_json : null);
  fill("status", blank(row.status) || row.status === "Неизвестно", item.status !== "Неизвестно" ? item.status : null);
  fill("description", blank(row.description), item.description);
  fill("poster_url", blank(row.poster_url), item.poster_url);
  fill("banner_url", blank(row.banner_url), item.banner_url);
  fill("kind", blank(row.kind), item.kind);
  fill("age_rating", blank(row.age_rating), item.age_rating);
  fill("next_episode_at", blank(row.next_episode_at), item.next_episode_at);
  fill("episodes_aired", row.episodes_aired <= 0, item.episodes_aired > 0 ? item.episodes_aired : null);
  fill("aired_on", blank(row.aired_on), item.aired_on);
  fill("studios_json", blank(row.studios_json) || row.studios_json === "[]", item.studios_json !== "[]" ? item.studios_json : null);
  fill("youtube_trailer_id", blank(row.youtube_trailer_id), item.youtube_trailer_id);
  if (!changes.length) return null;
  const assignments = changes.map(([column]) => column + " = ?").join(", ");
  return db.prepare("UPDATE anime_catalog SET " + assignments + ", updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .bind(...changes.map(([, value]) => value), item.id);
}

export function mapAdminCatalogScreenshots(item: Pick<ShikimoriAnime, "screenshots">): Array<{ original: string; preview: string }> {
  const seen = new Set<string>();
  const screenshots: Array<{ original: string; preview: string }> = [];
  for (const shot of item.screenshots ?? []) {
    const original = safeImage(shot.originalUrl);
    const preview = safeImage(shot.x332Url) ?? safeImage(shot.x166Url) ?? original;
    if (!original || !preview || seen.has(original)) continue;
    seen.add(original);
    screenshots.push({ original, preview });
    if (screenshots.length === 5) break;
  }
  return screenshots;
}

type ScreenshotStatus = "done" | "retry" | "failed";
function screenshotStatusStatement(db: Database, animeId: string, status: ScreenshotStatus, attempts: number, error: string | null): Statement {
  return db.prepare("INSERT INTO anime_catalog_screenshot_status (anime_id,status,attempts,last_error,updated_at) VALUES (?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(anime_id) DO UPDATE SET status=excluded.status,attempts=excluded.attempts,last_error=excluded.last_error,updated_at=CURRENT_TIMESTAMP")
    .bind(animeId, status, attempts, error?.slice(0, 500) ?? null);
}

async function screenshotProgress(db: Database): Promise<{ processed: number; failed: number; retry: number; done: number }> {
  const row = await db.prepare("SELECT SUM(CASE WHEN ss.status='done' THEN 1 ELSE 0 END) AS done, SUM(CASE WHEN ss.status='failed' THEN 1 ELSE 0 END) AS failed, SUM(CASE WHEN ss.status='retry' THEN 1 ELSE 0 END) AS retry FROM anime_catalog_screenshot_status ss INNER JOIN anime_catalog a ON a.id = ss.anime_id")
    .first<{ done: number | null; failed: number | null; retry: number | null }>();
  const done = Number(row?.done ?? 0), failed = Number(row?.failed ?? 0), retry = Number(row?.retry ?? 0);
  return { processed: done + failed + retry, failed, retry, done };
}

async function catalogRefreshStats(db: Database) {
  const row = await db.prepare(`
    SELECT COUNT(*) AS total,
      SUM(CASE WHEN
        TRIM(COALESCE(title,'')) = '' OR title = 'Без названия' OR
        TRIM(COALESCE(english_title,'')) = '' OR
        TRIM(COALESCE(original_title,'')) = '' OR original_title = 'Без названия' OR
        (COALESCE(status,'') <> 'Анонс' AND COALESCE(year,0) <= 0) OR
        (COALESCE(status,'') <> 'Анонс' AND COALESCE(episodes,0) <= 0) OR rating IS NULL OR
        TRIM(COALESCE(genres_json,'')) = '' OR genres_json = '[]' OR
        TRIM(COALESCE(status,'')) = '' OR status = 'Неизвестно' OR
        TRIM(COALESCE(description,'')) = '' OR TRIM(COALESCE(poster_url,'')) = '' OR
        TRIM(COALESCE(banner_url,'')) = '' OR TRIM(COALESCE(kind,'')) = '' OR
        TRIM(COALESCE(age_rating,'')) = '' OR
        (COALESCE(status,'') <> 'Анонс' AND TRIM(COALESCE(aired_on,'')) = '') OR
        TRIM(COALESCE(studios_json,'')) = '' OR studios_json = '[]' OR
        TRIM(COALESCE(youtube_trailer_id,'')) = ''
      THEN 1 ELSE 0 END) AS incomplete,
      SUM(CASE WHEN status = 'Анонс' THEN 1 ELSE 0 END) AS announced,
      SUM(CASE WHEN youtube_trailer_id IS NULL OR TRIM(youtube_trailer_id) = '' THEN 1 ELSE 0 END) AS missingTrailer,
      SUM(CASE WHEN youtube_trailer_id IS NOT NULL AND TRIM(youtube_trailer_id) <> '' THEN 1 ELSE 0 END) AS hasTrailer
    FROM anime_catalog
  `).first<{total:number;incomplete:number|null;announced:number|null;missingTrailer:number|null;hasTrailer:number|null}>();
  const shots = await db.prepare(`
      SELECT (SELECT COUNT(*) FROM anime_catalog_screenshots s JOIN anime_catalog a ON a.id=s.anime_id) AS savedScreenshotUrls,
        SUM(CASE WHEN ss.status='done' THEN 1 ELSE 0 END) AS screenshotDone,
        SUM(CASE WHEN ss.status='retry' THEN 1 ELSE 0 END) AS screenshotRetry,
        SUM(CASE WHEN ss.status='failed' THEN 1 ELSE 0 END) AS screenshotFailed
      FROM anime_catalog_screenshot_status ss JOIN anime_catalog a ON a.id=ss.anime_id
    `).first<{savedScreenshotUrls:number|null;screenshotDone:number|null;screenshotRetry:number|null;screenshotFailed:number|null}>();
  const total = Number(row?.total ?? 0), incomplete = Number(row?.incomplete ?? 0);
  return { total, incomplete, complete: Math.max(0,total-incomplete), announced:Number(row?.announced??0),
    missingTrailer:Number(row?.missingTrailer??0), hasTrailer:Number(row?.hasTrailer??0),
    savedScreenshotUrls:Number(shots?.savedScreenshotUrls??0), screenshotDone:Number(shots?.screenshotDone??0),
    screenshotRetry:Number(shots?.screenshotRetry??0), screenshotFailed:Number(shots?.screenshotFailed??0) };
}
async function catalogQuality(db: Database, requestedOffset = 0) {
  const offset = Number.isFinite(requestedOffset) ? Math.max(0,Math.min(100000,Math.floor(requestedOffset))) : 0;
  const [rows, aggregate] = await Promise.all([
    db.prepare("SELECT id,title,year,poster_url,description FROM anime_catalog WHERE year = 0 OR poster_url IS NULL OR TRIM(COALESCE(poster_url,'')) = '' OR TRIM(COALESCE(description,'')) = '' ORDER BY position,id LIMIT 500 OFFSET ?").bind(offset).all<{id:string;title:string;year:number;poster_url:string|null;description:string|null}>(),
    db.prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN year = 0 THEN 1 ELSE 0 END) AS missingYear, SUM(CASE WHEN poster_url IS NULL OR TRIM(COALESCE(poster_url,'')) = '' THEN 1 ELSE 0 END) AS missingPoster, SUM(CASE WHEN TRIM(COALESCE(description,'')) = '' THEN 1 ELSE 0 END) AS missingDescription, SUM(CASE WHEN year = 0 OR poster_url IS NULL OR TRIM(COALESCE(poster_url,'')) = '' OR TRIM(COALESCE(description,'')) = '' THEN 1 ELSE 0 END) AS incomplete FROM anime_catalog").first<{total:number;missingYear:number|null;missingPoster:number|null;missingDescription:number|null;incomplete:number|null}>(),
  ]);
  const summary = {total:Number(aggregate?.total ?? 0), incomplete:Number(aggregate?.incomplete ?? 0), missingYear:Number(aggregate?.missingYear ?? 0), missingPoster:Number(aggregate?.missingPoster ?? 0), missingDescription:Number(aggregate?.missingDescription ?? 0)};
  return {
    items: rows.results.map(row => ({id:row.id,title:row.title,year:row.year,missingYear:!row.year,missingPoster:!row.poster_url?.trim(),missingDescription:!row.description?.trim()})),
    summary,
    limit:500,
    offset,
    hasMore:offset + rows.results.length < summary.incomplete,
  };
}
async function acquireLock(db: Database, ttlMs = 45000): Promise<string | null> {
  const token = crypto.randomUUID();
  const now = Date.now();
  const result = await db.prepare("UPDATE admin_catalog_import_lock SET token = ?, expires_at = ? WHERE id = 1 AND expires_at < ?")
    .bind(token, now + ttlMs, now).run();
  return Number(result.meta?.changes ?? 0) === 1 ? token : null;
}
async function releaseLock(db: Database, token: string): Promise<void> {
  await db.prepare("UPDATE admin_catalog_import_lock SET token = '', expires_at = 0 WHERE id = 1 AND token = ?").bind(token).run();
}
async function audit(db: Database, action: string, status: string, details: Record<string, unknown> = {}, actor?: string | null): Promise<void> {
  const safeDetails = JSON.stringify(details).slice(0, 4000);
  await db.prepare("INSERT INTO yume_admin_audit_log (action,status,details,actor_telegram_id) VALUES (?,?,?,?)")
    .bind(action,status,safeDetails,actor ?? null).run();
}
async function recentAudit(db: Database) {
  const rows = await db.prepare("SELECT id,action,status,details,created_at FROM yume_admin_audit_log ORDER BY id DESC LIMIT 30")
    .all<{id:number;action:string;status:string;details:string;created_at:string}>();
  return rows.results.map(row => {
    let details: Record<string, unknown> = {};
    try {
      details = JSON.parse(row.details) as Record<string, unknown>;
    } catch {
      // Keep the audit entry even if a legacy details payload is malformed.
    }
    return {...row,details};
  });
}
async function maintenanceCheck(db: Database) {
  const [health, count, quality] = await Promise.all([
    db.prepare("SELECT 1 AS ok").first<{ok:number}>(),
    db.prepare("SELECT COUNT(*) AS count FROM anime_catalog").first<{count:number}>(),
    catalogQuality(db),
  ]);
  return {ok:health?.ok === 1, catalogRecords:Number(count?.count ?? 0), qualitySummary:quality.summary, checkedAt:new Date().toISOString()};
}
async function snapshot(db: Database) {
  const rows = await db.prepare("SELECT key, value FROM anime_catalog_meta WHERE key IN ('admin_import_target','admin_import_cursor','admin_import_added','admin_import_skipped','admin_import_incomplete','admin_import_errors','admin_import_state','admin_import_block_18_plus','admin_import_status_filter')")
    .all<{ key: string; value: string }>();
  const values = new Map(rows.results.map((row) => [row.key, row.value]));
  return {
    target: Number(values.get("admin_import_target") ?? 0),
    cursor: Number(values.get("admin_import_cursor") ?? 1),
    added: Number(values.get("admin_import_added") ?? 0),
    skipped: Number(values.get("admin_import_skipped") ?? 0),
    incomplete: Number(values.get("admin_import_incomplete") ?? 0),
    errors: Number(values.get("admin_import_errors") ?? 0),
    state: values.get("admin_import_state") ?? "idle",
    bulkImportBlock18Plus: values.get("admin_import_block_18_plus") !== "0",
    statusFilter: values.get("admin_import_status_filter") ?? "",
    delayMs: REQUEST_DELAY_MS,
  };
}

/**
 * Process exactly one durable catalog-refresh step.
 * Both the browser-driven manual loop and the Nitro Cron hook call this
 * function so their phase transitions, retries, and progress cursors cannot drift.
 * The caller must hold the shared catalog-operation lock and have ensured the schema.
 */
async function runCatalogMetadataRefreshStep(db: Database): Promise<Response> {
    let state = await getMeta(db, "metadata_refresh_state") ?? "metadata";
    if (state === "done") {
      await db.batch([
        setMeta(db, "metadata_refresh_state", "metadata"),
        setMeta(db, "metadata_refresh_cursor", "0"),
        setMeta(db, "metadata_refresh_screenshot_cursor", "0"),
        db.prepare("UPDATE anime_catalog_screenshot_status SET status='retry',attempts=0,last_error=NULL,updated_at=CURRENT_TIMESTAMP WHERE status='failed'"),
      ]);
      state = "metadata";
    } else if (state === "idle" || state === "running") {
      state = "metadata";
      await setMeta(db, "metadata_refresh_state", state);
    }

    const totalRow = await db.prepare("SELECT COUNT(*) AS total FROM anime_catalog").first<{ total: number }>();
    const total = Number(totalRow?.total ?? 0);

    if (state === "metadata") {
      const cursor = Math.max(0, Number(await getMeta(db, "metadata_refresh_cursor") ?? "0") || 0);
      if (cursor >= total) {
        const nextState = total > 0 ? "screenshots" : "done";
        await db.batch([
          setMeta(db, "metadata_refresh_state", nextState),
          setMeta(db, "metadata_refresh_screenshot_cursor", "0"),
        ]);
        const shots = await screenshotProgress(db);
        return json({ isAdmin: true, phase: nextState, phaseChanged: true, processed: 0, offset: total, nextOffset: total, metadataOffset: total, screenshotOffset: 0, total, updated: 0, screenshotsSaved: 0, screenshotFailures: shots.failed, screenshotRetries: shots.retry, done: nextState === "done" });
      }
      const catalogPage = await db.prepare("SELECT id,title,english_title,original_title,year,episodes,rating,genres_json,status,description,poster_url,banner_url,kind,age_rating,next_episode_at,episodes_aired,aired_on,studios_json,youtube_trailer_id FROM anime_catalog ORDER BY position ASC,id ASC LIMIT ? OFFSET ?")
        .bind(METADATA_REFRESH_BATCH_SIZE, cursor).all<{
          id: string; title: string; english_title: string | null; original_title: string; year: number; episodes: number;
          rating: number | null; genres_json: string | null; status: string | null; description: string | null;
          poster_url: string | null; banner_url: string | null; kind: string | null; age_rating: string | null;
          next_episode_at: string | null; episodes_aired: number; aired_on: string | null; studios_json: string | null;
          youtube_trailer_id: string | null;
        }>();
      const pageIds = normalizeAdminCatalogIds(catalogPage.results.map(row => row.id)).slice(0, METADATA_REFRESH_BATCH_SIZE);
      if (!pageIds.length) {
        await db.batch([
          setMeta(db, "metadata_refresh_state", "screenshots"),
          setMeta(db, "metadata_refresh_screenshot_cursor", "0"),
        ]);
        const shots = await screenshotProgress(db);
        return json({ isAdmin: true, phase: "screenshots", phaseChanged: true, processed: 0, offset: total, nextOffset: total, metadataOffset: total, screenshotOffset: 0, total, updated: 0, screenshotsSaved: 0, screenshotFailures: shots.failed, screenshotRetries: shots.retry, done: false });
      }

      const ids = catalogPage.results.filter(isCatalogMetadataIncomplete).map(row => row.id);
      const source = ids.length ? await fetchByIds(ids) : [];
      const sourceById = new Map(source.map(item => [String(item.id), item]));

      // Shikimori remains authoritative for metadata other than banner_url.
      // Fully populated rows are deliberately skipped by the metadata backfill.
      let updated = 0;
      const missingSourceIds: string[] = ids.filter(id => !sourceById.has(id));
      if (ids.length) {
        const existingById = new Map(catalogPage.results.map(row => [row.id, row]));
        const metadataUpdates: Statement[] = [];
        for (const id of ids) {
          const sourceItem = sourceById.get(id);
          const existingRow = existingById.get(id);
          if (!sourceItem || !existingRow) continue;
          const statement = catalogMetadataUpdateStatement(db, mapItem(sourceItem), existingRow);
          if (statement) { metadataUpdates.push(statement); updated++; }
        }
        if (metadataUpdates.length) await db.batch(metadataUpdates);
        if (missingSourceIds.length) {
          console.warn("[YUME][CATALOG_METADATA_REFRESH] Shikimori omitted catalog IDs; continuing past this page.", {
            offset: cursor,
            missingCount: missingSourceIds.length,
            missingIds: missingSourceIds.slice(0, 100),
          });
        }
      }
      const nextOffset = cursor + pageIds.length;
      const nextState = nextOffset >= total ? "screenshots" : "metadata";
      await db.batch([
        setMeta(db, "metadata_refresh_cursor", String(nextOffset)),
        setMeta(db, "metadata_refresh_state", nextState),
        ...(nextState === "screenshots" ? [setMeta(db, "metadata_refresh_screenshot_cursor", "0")] : []),
      ]);
      if (updated > 0) await invalidatePersistentCatalogCache();
      await audit(db, "catalog.metadata.backfill", missingSourceIds.length ? "partial" : "success", {
        phase: "metadata", offset: cursor, processed: ids.length, titlesChanged: updated,
        total,
        missingSourceIds: missingSourceIds.slice(0, 100),
      });
      const shots = await screenshotProgress(db);
      return json({ isAdmin: true, phase: nextState, phaseChanged: nextState !== "metadata", processed: pageIds.length, offset: nextOffset, nextOffset, metadataOffset: nextOffset, screenshotOffset: 0, total, updated,

        screenshotsSaved: 0, screenshotFailures: shots.failed, screenshotRetries: shots.retry, done: false });
    }

    if (state === "screenshots") {
      const cursor = Math.max(0, Number(await getMeta(db, "metadata_refresh_screenshot_cursor") ?? "0") || 0);
      if (cursor >= total) {
        const retryRow = await db.prepare("SELECT COUNT(*) AS count FROM anime_catalog_screenshot_status WHERE status='retry' AND attempts < ?").bind(SCREENSHOT_RETRY_LIMIT).first<{ count: number }>();
        const nextState = Number(retryRow?.count ?? 0) > 0 ? "screenshots_retry" : "done";
        await setMeta(db, "metadata_refresh_state", nextState);
        const shots = await screenshotProgress(db);
        return json({ isAdmin: true, phase: nextState, phaseChanged: true, processed: 0, offset: total, nextOffset: total, metadataOffset: total, screenshotOffset: total, total, updated: 0, screenshotsSaved: 0, screenshotFailures: shots.failed, screenshotRetries: shots.retry, done: nextState === "done" });
      }
      const page = await db.prepare("SELECT a.id,a.status,a.aired_on,ss.status AS screenshot_status,ss.attempts,ss.last_error,ss.updated_at,EXISTS (SELECT 1 FROM anime_catalog_screenshots s WHERE s.anime_id=a.id AND s.original_url NOT LIKE '%example.com%' AND s.preview_url NOT LIKE '%example.com%') AS has_screenshots FROM anime_catalog a LEFT JOIN anime_catalog_screenshot_status ss ON ss.anime_id=a.id ORDER BY a.position ASC,a.id ASC LIMIT ? OFFSET ?")
        .bind(SCREENSHOT_REFRESH_BATCH_SIZE, cursor).all<{id:string;status:string|null;aired_on:string|null;screenshot_status:ScreenshotStatus|null;attempts:number|null;last_error:string|null;updated_at:string|null;has_screenshots:number}>();
      if (!page.results.length) {
        await setMeta(db, "metadata_refresh_screenshot_cursor", String(total));
        return json({ isAdmin: true, phase: "screenshots", phaseChanged: true, processed: 0, offset: total, nextOffset: total, metadataOffset: total, screenshotOffset: total, total, updated: 0, screenshotsSaved: 0, done: false });
      }
      const toFetch: string[] = [];
      const statements: Statement[] = [];
      const now = Date.now();
      for (const row of page.results) {
        const unreleased = row.status === "Анонс" || Boolean(row.aired_on && /^\d{4}-\d{2}-\d{2}/.test(row.aired_on) && row.aired_on.slice(0, 10) > new Date().toISOString().slice(0, 10));
        const recentEmpty = row.screenshot_status === "done" && row.last_error === "Источник не вернул кадров" && Number.isFinite(Date.parse(row.updated_at ?? "")) && Date.parse(row.updated_at ?? "") > now - 30 * 24 * 60 * 60 * 1000;
        if (unreleased) {
          if (row.screenshot_status !== "done") statements.push(screenshotStatusStatement(db, row.id, "done", 0, "Пропущено: аниме ещё не вышло; запрос кадров не выполнялся"));
        } else if (row.has_screenshots) {
          if (row.screenshot_status !== "done") statements.push(screenshotStatusStatement(db, row.id, "done", 0, null));
        } else if (row.screenshot_status === "failed") {
          continue;
        } else if (row.screenshot_status === "retry" && Number(row.attempts ?? 0) >= SCREENSHOT_RETRY_LIMIT) {
          statements.push(screenshotStatusStatement(db, row.id, "failed", Number(row.attempts ?? 0), row.last_error ?? "Превышен лимит повторных попыток"));
        } else if (!recentEmpty) {
          toFetch.push(row.id);
        }
      }
      let screenshotsSaved = 0;
      if (toFetch.length) {
        const source = await fetchByIds(toFetch, true);
        const sourceById = new Map(source.map(item => [String(item.id), item]));
        for (const animeId of toFetch) {
          const item = sourceById.get(animeId);
          if (!item) {
            statements.push(screenshotStatusStatement(db, animeId, "done", 0, "Shikimori не вернул аниме для получения кадров"));
            continue;
          }
          const screenshots = mapAdminCatalogScreenshots(item);
          for (const [index, shot] of screenshots.entries()) {
            statements.push(db.prepare("INSERT OR IGNORE INTO anime_catalog_screenshots (anime_id,original_url,preview_url,position,updated_at) VALUES (?,?,?,?,CURRENT_TIMESTAMP)").bind(animeId, shot.original, shot.preview, index));
          }
          screenshotsSaved += screenshots.length;
          statements.push(screenshotStatusStatement(db, animeId, "done", 0, screenshots.length ? null : "Источник не вернул кадров"));
        }
      }
      const nextCursor = cursor + page.results.length;
      statements.push(setMeta(db, "metadata_refresh_screenshot_cursor", String(nextCursor)));
      await db.batch(statements);
      if (screenshotsSaved > 0) await invalidatePersistentCatalogCache();
      const shots = await screenshotProgress(db);
      return json({ isAdmin: true, phase: "screenshots", phaseChanged: false, processed: page.results.length, offset: nextCursor, nextOffset: nextCursor, metadataOffset: total, screenshotOffset: nextCursor, total, updated: 0, screenshotsSaved, screenshotFailures: shots.failed, screenshotRetries: shots.retry, done: false });
    }

    if (state === "screenshots_retry") {
      const retryRows = await db.prepare("SELECT ss.anime_id,ss.attempts FROM anime_catalog_screenshot_status ss WHERE ss.status='retry' AND ss.attempts < ? AND EXISTS (SELECT 1 FROM anime_catalog a WHERE a.id=ss.anime_id) ORDER BY ss.attempts ASC,ss.updated_at ASC,ss.anime_id ASC LIMIT ?")
        .bind(SCREENSHOT_RETRY_LIMIT, SCREENSHOT_REFRESH_BATCH_SIZE).all<{anime_id:string;attempts:number}>();
      if (!retryRows.results.length) {
        await setMeta(db, "metadata_refresh_state", "done");
        const shots = await screenshotProgress(db);
        return json({ isAdmin: true, phase: "done", phaseChanged: true, processed: 0, offset: shots.processed, nextOffset: shots.processed, metadataOffset: total, screenshotOffset: shots.processed, total, updated: 0, screenshotsSaved: 0, screenshotFailures: shots.failed, screenshotRetries: 0, done: true });
      }
      const ids = retryRows.results.map(row => row.anime_id);
      const source = await fetchByIds(ids, true);
      const sourceById = new Map(source.map(item => [String(item.id), item]));
      const attemptsById = new Map(retryRows.results.map(row => [row.anime_id, Number(row.attempts ?? 0)]));
      const statements: Statement[] = [];
      let screenshotsSaved = 0;
      for (const animeId of ids) {
        const item = sourceById.get(animeId);
        if (!item) {
          statements.push(screenshotStatusStatement(db, animeId, "failed", (attemptsById.get(animeId) ?? 0) + 1, "Shikimori не вернул аниме для получения кадров"));
          continue;
        }
        const screenshots = mapAdminCatalogScreenshots(item);
        for (const [index, shot] of screenshots.entries()) {
          statements.push(db.prepare("INSERT OR IGNORE INTO anime_catalog_screenshots (anime_id,original_url,preview_url,position,updated_at) VALUES (?,?,?,?,CURRENT_TIMESTAMP)").bind(animeId, shot.original, shot.preview, index));
        }
        screenshotsSaved += screenshots.length;
        statements.push(screenshotStatusStatement(db, animeId, "done", 0, screenshots.length ? null : "Источник не вернул кадров"));
      }
      await db.batch(statements);
      if (screenshotsSaved > 0) await invalidatePersistentCatalogCache();
      const remaining = await db.prepare("SELECT COUNT(*) AS count FROM anime_catalog_screenshot_status WHERE status='retry' AND attempts < ?").bind(SCREENSHOT_RETRY_LIMIT).first<{count:number}>();
      const done = Number(remaining?.count ?? 0) === 0;
      if (done) await setMeta(db, "metadata_refresh_state", "done");
      const shots = await screenshotProgress(db);
      return json({ isAdmin: true, phase: done ? "done" : "screenshots_retry", phaseChanged: done, processed: ids.length, offset: shots.processed, nextOffset: shots.processed, metadataOffset: total, screenshotOffset: shots.processed, total, updated: 0, screenshotsSaved, screenshotFailures: shots.failed, screenshotRetries: Number(remaining?.count ?? 0), done });
    }

    await setMeta(db, "metadata_refresh_state", "metadata");
    return json({ isAdmin: true, phase: "metadata", phaseChanged: true, processed: 0, offset: 0, nextOffset: 0, metadataOffset: 0, screenshotOffset: 0, total, updated: 0, screenshotsSaved: 0, done: false });
}

/**
 * One durable cron tick. All progress lives in D1, so the browser is only a
 * control panel and may be closed without interrupting the refresh.
 */
/**
 * Process one bounded Cron slice by repeatedly calling the same step used by
 * the manual mode. The loop stops before the invocation gets close to the
 * shared lock's expiry or Cloudflare's Cron wall-time limit.
 */
export async function runScheduledCatalogMetadataRefresh(env: unknown): Promise<void> {
  const db = database(env as Environment);
  if (!db) {
    console.error("[YUME][CATALOG_AUTO_REFRESH] Cron hook has no D1 binding.");
    return;
  }

  try {
    if (await getMeta(db, "metadata_refresh_auto_enabled") !== "1") return;

    // A separate TTL lets the Cron slice safely perform several shared steps.
    const lockToken = await acquireLock(db, 75_000);
    if (!lockToken) {
      console.info("[YUME][CATALOG_AUTO_REFRESH] Cron slice skipped; another catalog operation holds the lock.");
      return;
    }

    const startedAt = Date.now();
    const startedIso = new Date(startedAt).toISOString();
    let steps = 0;
    let phase = await getMeta(db, "metadata_refresh_state") ?? "metadata";
    let completed = false;
    let stopped = false;

    await setMeta(db, "metadata_refresh_last_tick_at", startedIso).run();
    try {
      console.info("[YUME][CATALOG_AUTO_REFRESH] Cron slice started.", { phase, budgetMs: 28_000 });

      // Each step makes at most one upstream request (metadata is one batched GraphQL request).
      // A short pause between requests keeps YUME below Shikimori's published 5 RPS / 90 RPM limits.
      while (steps < 35 && Date.now() - startedAt < 28_000) {
        if (await getMeta(db, "metadata_refresh_auto_enabled") !== "1") {
          stopped = true;
          break;
        }

        const stepResponse = await runCatalogMetadataRefreshStep(db);
        const stepResult = await stepResponse.json().catch(() => ({})) as {
          isAdmin?: boolean;
          error?: string;
          message?: string;
          phase?: string;
          processed?: number;
          updated?: number;
          screenshotsSaved?: number;
          done?: boolean;
          offset?: number;
          total?: number;
          screenshotFailures?: number;
          screenshotRetries?: number;
          screenshotWarning?: string | null;
        };
        if (!stepResponse.ok || stepResult.isAdmin !== true) {
          throw new Error(stepResult.message ?? stepResult.error ?? "The shared catalog refresh step failed.");
        }

        steps++;
        phase = stepResult.phase ?? phase;

        if (stepResult.screenshotWarning) {
          console.warn("[YUME][CATALOG_AUTO_REFRESH] Screenshot will be retried.", {
            phase, offset: stepResult.offset, warning: stepResult.screenshotWarning,
          });
        }

        if (stepResult.done === true || phase === "done") {
          completed = true;
          await setMeta(db, "metadata_refresh_auto_enabled", "0").run();
          break;
        }

        // Successful/failed provider attempts are reflected in D1 by the shared step.
        // Delay after any step that actually made an upstream request.
        if (Number(stepResult.processed ?? 0) > 0) {
          await new Promise(resolve => setTimeout(resolve, REQUEST_DELAY_MS));
        }
      }

      const finishedAt = Date.now();
      const durationMs = finishedAt - startedAt;
      await db.batch([
        setMeta(db, "metadata_refresh_last_tick_at", new Date(finishedAt).toISOString()),
        setMeta(db, "metadata_refresh_last_error", ""),
        setMeta(db, "metadata_refresh_last_phase", phase),
        setMeta(db, "metadata_refresh_last_steps", String(steps)),
        setMeta(db, "metadata_refresh_last_duration_ms", String(durationMs)),
        ...(steps > 0 ? [setMeta(db, "metadata_refresh_last_success_at", new Date(finishedAt).toISOString())] : []),
      ]);
      await audit(db, "catalog.metadata.auto_tick", completed ? "success" : stopped ? "paused" : "success", {
        phase, steps, durationMs, completed, stopped,
      });
      console.info("[YUME][CATALOG_AUTO_REFRESH] Cron slice finished.", {
        phase, steps, durationMs, completed, stopped,
      });
    } catch (error) {
      const finishedAt = Date.now();
      const message = error instanceof Error ? error.message : "Unknown scheduled refresh error";
      await db.batch([
        setMeta(db, "metadata_refresh_last_tick_at", new Date(finishedAt).toISOString()),
        setMeta(db, "metadata_refresh_last_error", message.slice(0, 1000)),
        setMeta(db, "metadata_refresh_last_phase", phase),
        setMeta(db, "metadata_refresh_last_steps", String(steps)),
        setMeta(db, "metadata_refresh_last_duration_ms", String(finishedAt - startedAt)),
      ]);
      await audit(db, "catalog.metadata.auto_tick", "warning", {
        phase, steps, durationMs: finishedAt - startedAt, message,
      });
      console.error("[YUME][CATALOG_AUTO_REFRESH] Cron slice failed; progress is preserved.", {
        phase, steps, message,
      });
    } finally {
      await releaseLock(db, lockToken);
    }
  } catch (error) {
    console.error("[YUME][CATALOG_AUTO_REFRESH] Cron setup failed.", error);
  }
}

function toStagingAnime(item: ReturnType<typeof mapItem>): Anime {
  const parseStrings = (value: string): string[] => {
    try {
      const parsed: unknown = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : [];
    } catch {
      return [];
    }
  };
  return {
    id: item.id,
    title: item.title,
    englishTitle: item.english_title ?? undefined,
    original: item.original_title,
    year: item.year,
    episodes: item.episodes,
    rating: item.rating,
    genres: parseStrings(item.genres_json),
    status: item.status as Anime["status"],
    description: item.description,
    hue: item.hue,
    glyph: item.glyph,
    isNew: item.is_new === 1,
    popular: item.popular === 1,
    ...(item.poster_url ? { posterUrl: item.poster_url } : {}),
    ...(item.banner_url ? { bannerUrl: item.banner_url } : {}),
    ...(item.kind ? { kind: item.kind } : {}),
    ...(item.age_rating ? { ageRating: item.age_rating } : {}),
    ...(item.next_episode_at ? { nextEpisodeAt: item.next_episode_at } : {}),
    episodesAired: item.episodes_aired,
    ...(item.aired_on ? { airedOn: item.aired_on } : {}),
    studios: parseStrings(item.studios_json),
    ...(item.youtube_trailer_id ? { youtubeTrailerId: item.youtube_trailer_id } : {}),
  };
}

/**
 * Imports one Shikimori page per staging Cron tick. The production catalog
 * remains read-only on normal page requests; this runner is only enabled by
 * the isolated staging Queue Worker configuration.
 */
export async function runStagingCatalogSeedStep(target = 300) {
  const safeTarget = Number.isSafeInteger(target) && target >= 50 && target <= 1000 ? target : 300;
  return getPersistentCatalog(
    async (cursor): Promise<CatalogSeedPageResult> => {
      const sourceItems = await fetchPage(cursor + 1, null, false);
      if (sourceItems.length === 0) return { items: [], error: null, done: true };
      const items = sourceItems
        .filter((item) => !isBlockedFromBulkImport(item, true))
        .map((item) => toStagingAnime(mapItem(item)));
      return { items, error: null };
    },
    { progressOnly: true, allowImport: true, maxItems: safeTarget },
  );
}

export async function handleAdminCatalogImport(request: Request): Promise<Response> {
  if (request.method !== "GET" && request.method !== "POST") return json({error:"method_not_allowed"},405);
  if (request.method === "POST" && !sameOrigin(request)) return json({error:"cross_origin_request"},403);
  const env = environment(), db = database(env);
  if (!db) return json({error:"database_unavailable"},503);
  let requestedAction: unknown = null;
  try {
    if (!await authorize(request,env,db)) return json({isAdmin:false,error:"admin_required"},403);
    if (request.method === "GET") {
      const url = new URL(request.url);
      // The admin dashboard polls every five seconds. Status polling must not
      // rescan the entire catalogue or recompute aggregate quality counters.
      if (url.searchParams.get("status") === "1") {
        const [refreshState, metadataCursor, screenshotCursor] = await Promise.all([
          getMeta(db, "metadata_refresh_state"),
          getMeta(db, "metadata_refresh_cursor"),
          getMeta(db, "metadata_refresh_screenshot_cursor"),
          ]);
        const phase = refreshState ?? "idle";
        return json({
          isAdmin: true,
          ...await snapshot(db),
          metadataRefresh: {
            autoEnabled: false,
            phase,
            metadataOffset: Math.max(0, Number(metadataCursor ?? "0") || 0),
            screenshotOffset: Math.max(0, Number(screenshotCursor ?? "0") || 0),
            done: phase === "done",
            lastTickAt: await getMeta(db, "metadata_refresh_last_tick_at"),
            lastSuccessAt: await getMeta(db, "metadata_refresh_last_success_at"),
            lastError: await getMeta(db, "metadata_refresh_last_error"),
            lastPhase: await getMeta(db, "metadata_refresh_last_phase"),
            lastSteps: Number(await getMeta(db, "metadata_refresh_last_steps") ?? "0"),
            lastDurationMs: Number(await getMeta(db, "metadata_refresh_last_duration_ms") ?? "0"),
          },
        });
      }
      const qualityOffset = Number(url.searchParams.get("qualityOffset") ?? "0");
      const quality = await catalogQuality(db, qualityOffset);
      const [refreshState, metadataCursor, screenshotCursor, totalRow, shots, refreshStats] = await Promise.all([
        getMeta(db, "metadata_refresh_state"),
        getMeta(db, "metadata_refresh_cursor"),
        getMeta(db, "metadata_refresh_screenshot_cursor"),
        db.prepare("SELECT COUNT(*) AS total FROM anime_catalog").first<{total:number}>(),
        screenshotProgress(db),
        catalogRefreshStats(db),
      ]);
      const refreshTotal = Number(totalRow?.total ?? 0);
      const phase = refreshState ?? "idle";
      const metadataOffset = phase === "done" || phase.startsWith("screenshots")
        ? refreshTotal : Math.max(0, Number(metadataCursor ?? "0") || 0);
      const screenshotOffset = phase === "metadata" ? 0 : Math.max(0, Number(screenshotCursor ?? "0") || 0);
      return json({
        isAdmin: true,
        ...await snapshot(db),
        metadataRefresh: {
          autoEnabled: false, phase, metadataOffset, screenshotOffset, total: refreshTotal,
          stats: refreshStats, screenshotFailures: shots.failed, screenshotRetries: shots.retry,
          done: phase === "done",
          lastTickAt: await getMeta(db, "metadata_refresh_last_tick_at"),
          lastSuccessAt: await getMeta(db, "metadata_refresh_last_success_at"),
          lastError: await getMeta(db, "metadata_refresh_last_error"),
          lastPhase: await getMeta(db, "metadata_refresh_last_phase"),
          lastSteps: Number(await getMeta(db, "metadata_refresh_last_steps") ?? "0"),
          lastDurationMs: Number(await getMeta(db, "metadata_refresh_last_duration_ms") ?? "0"),
        },
        quality: quality.items, qualitySummary: quality.summary, qualityLimit: quality.limit,
        qualityOffset: quality.offset, qualityHasMore: quality.hasMore, auditLog: await recentAudit(db),
      });
    }
    let body: {action?:unknown; target?:unknown; query?:unknown; animeId?:unknown; block18Plus?:unknown; ids?:unknown; statusFilter?:unknown};
    try { body = await request.json() as typeof body; } catch { return json({error:"invalid_request"},400); }
    requestedAction = body.action;
    const lockToken = await acquireLock(db);
    if (!lockToken) return json({isAdmin:true,error:"operation_in_progress",message:"Другая административная операция ещё выполняется."},409);
    try {
      if (body.action === "set_bulk_import_filter") {
        if (typeof body.block18Plus !== "boolean") return json({error:"invalid_filter_value",message:"Ожидалось логическое значение настройки 18+."},400);
        if (await getMeta(db,"admin_import_state") === "running") return json({isAdmin:true,error:"import_running",message:"Нельзя менять фильтр во время активного импорта."},409);
        await setMeta(db,"admin_import_block_18_plus",body.block18Plus ? "1" : "0").run();
        await audit(db,"catalog.import.filter","success",{block18Plus:body.block18Plus});
        return json({isAdmin:true,bulkImportBlock18Plus:body.block18Plus});
      }
      if (body.action === "search_delete_title") {
        const titleQuery = typeof body.query === "string" ? clean(body.query).slice(0,120) : "";
        if (titleQuery.length < 2) return json({error:"query_too_short",message:"Введи не менее двух символов названия."},400);
        const pattern = "%" + titleQuery + "%";
        const rows = await db.prepare("SELECT id,title,english_title,original_title,year,poster_url,genres_json,age_rating FROM anime_catalog WHERE title LIKE ? OR COALESCE(english_title,'') LIKE ? OR original_title LIKE ? ORDER BY title COLLATE NOCASE,id LIMIT 25")
          .bind(pattern,pattern,pattern)
          .all<{id:string;title:string;english_title:string|null;original_title:string;year:number;poster_url:string|null;genres_json:string;age_rating:string|null}>();
        const results = rows.results.map(row => {
          let genres: string[] = [];
          try { const parsed: unknown = JSON.parse(row.genres_json || "[]"); if (Array.isArray(parsed)) genres = parsed.filter((value): value is string => typeof value === "string").slice(0,12); }
          catch { /* Ignore malformed legacy genre JSON. */ }
          return {id:row.id,title:row.title,englishTitle:row.english_title,originalTitle:row.original_title,year:Number(row.year)||0,posterUrl:row.poster_url,genres,ageRating:row.age_rating};
        });
        return json({isAdmin:true,query:titleQuery,results});
      }
      if (body.action === "delete_title") {
        const animeId = typeof body.animeId === "string" ? body.animeId.trim() : "";
        if (!/^[0-9]{1,20}$/.test(animeId)) return json({error:"invalid_anime_id"},400);
        const existing = await db.prepare("SELECT id,title FROM anime_catalog WHERE id = ?").bind(animeId).first<{id:string;title:string}>();
        if (!existing) return json({error:"title_not_in_catalog",message:"Этот тайтл уже отсутствует в каталоге."},404);
        await db.batch([
          db.prepare("INSERT OR REPLACE INTO admin_catalog_exclusions (anime_id,title,deleted_at) SELECT id,title,CURRENT_TIMESTAMP FROM anime_catalog WHERE id = ?").bind(animeId),
          db.prepare("DELETE FROM anime_catalog_screenshots WHERE anime_id = ?").bind(animeId),
          db.prepare("DELETE FROM anime_catalog_screenshot_status WHERE anime_id = ?").bind(animeId),
          db.prepare("DELETE FROM anime_catalog WHERE id = ?").bind(animeId),
        ]);
        await invalidatePersistentCatalogCache();
        await audit(db,"catalog.delete.title","success",{animeId,title:existing.title,blockedFromBulkReimport:true});
        return json({isAdmin:true,deleted:true,anime:{id:existing.id,title:existing.title},message:"Тайтл удалён из каталога и исключён из будущего массового импорта."});
      }
      if (body.action === "search_title") {
        const titleQuery = typeof body.query === "string" ? clean(body.query).slice(0, 120) : "";
        if (titleQuery.length < 2) return json({ error:"query_too_short", message:"Введи не менее двух символов названия." },400);
        const source = await fetchByTitle(titleQuery);
        const ids = source.map(item => String(item.id)).filter(id => /^[0-9]{1,20}$/.test(id));
        const existingRows = ids.length
          ? await db.prepare("SELECT id FROM anime_catalog WHERE id IN (" + ids.map(() => "?").join(",") + ")").bind(...ids).all<{id:string}>()
          : { results: [] as {id:string}[] };
        const existingIds = new Set(existingRows.results.map(row => row.id));
        const results = source.map(item => {
          const mapped = mapItem(item);
          return {
            id: String(item.id),
            title: mapped.title,
            englishTitle: mapped.english_title,
            originalTitle: mapped.original_title,
            year: mapped.year,
            kind: mapped.kind,
            status: mapped.status,
            posterUrl: mapped.poster_url,
            genres: mapped.genres_json ? JSON.parse(mapped.genres_json) as string[] : [],
            ageRating: mapped.age_rating,
            alreadyInCatalog: existingIds.has(String(item.id)),
          };
        });
        await audit(db,"catalog.import.title.search","success",{query:titleQuery,results:results.length});
        return json({isAdmin:true,query:titleQuery,results});
      }
      if (body.action === "import_title") {
        const animeId = typeof body.animeId === "string" ? body.animeId.trim() : "";
        if (!/^[0-9]{1,20}$/.test(animeId)) return json({error:"invalid_anime_id"},400);
        const already = await db.prepare("SELECT id,title FROM anime_catalog WHERE id = ?").bind(animeId).first<{id:string;title:string}>();
        if (already) return json({isAdmin:true,alreadyInCatalog:true,anime:{id:already.id,title:already.title},message:"Этот тайтл уже находится в каталоге."},409);
        const sourceItems = await fetchByIds([animeId],true);
        const sourceItem = sourceItems[0];
        if (!sourceItem) return json({error:"anime_not_found",message:"Тайтл не найден в Shikimori. Повтори поиск."},404);
        const item = mapItem(sourceItem);
        const screenshots = mapAdminCatalogScreenshots(sourceItem);
        const currentCount = await db.prepare("SELECT COUNT(*) AS count FROM anime_catalog").first<{count:number}>();
        const statements: Statement[] = [
          db.prepare("DELETE FROM admin_catalog_exclusions WHERE anime_id = ?").bind(item.id),
          db.prepare("INSERT OR IGNORE INTO anime_catalog (id,title,english_title,original_title,year,episodes,rating,genres_json,status,description,hue,glyph,is_new,popular,poster_url,banner_url,kind,age_rating,next_episode_at,episodes_aired,aired_on,studios_json,youtube_trailer_id,position,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)")
            .bind(item.id,item.title,item.english_title,item.original_title,item.year,item.episodes,item.rating,item.genres_json,item.status,item.description,item.hue,item.glyph,item.is_new,item.popular,item.poster_url,item.banner_url,item.kind,item.age_rating,item.next_episode_at,item.episodes_aired,item.aired_on,item.studios_json,item.youtube_trailer_id,Number(currentCount?.count ?? 0)),
          ...screenshots.map((shot,index) => db.prepare("INSERT OR IGNORE INTO anime_catalog_screenshots (anime_id,original_url,preview_url,position,updated_at) VALUES (?,?,?,?,CURRENT_TIMESTAMP)")
            .bind(item.id,shot.original,shot.preview,index)),
          screenshotStatusStatement(db,item.id,"done",0,screenshots.length ? null : "Источник не вернул кадров"),
          db.prepare("INSERT OR IGNORE INTO admin_catalog_import_items (run_id,anime_id,outcome,incomplete) VALUES (?,?, 'added', ?)")
            .bind("title-" + crypto.randomUUID(),item.id,incomplete(item)?1:0),
        ];
        await db.batch(statements);
        const stored = await db.prepare("SELECT id FROM anime_catalog WHERE id = ?").bind(item.id).first<{id:string}>();
        if (!stored) throw new Error("Не удалось сохранить запись аниме.");
        await invalidatePersistentCatalogCache();
        const [catalogCount,catalogWithTrailer] = await Promise.all([
          db.prepare("SELECT COUNT(*) AS count FROM anime_catalog").first<{count:number}>(),
          db.prepare("SELECT COUNT(*) AS count FROM anime_catalog WHERE youtube_trailer_id IS NOT NULL AND youtube_trailer_id <> ''").first<{count:number}>(),
        ]);
        await audit(db,"catalog.import.title","success",{animeId:item.id,title:item.title,year:item.year,screenshots:screenshots.length,hasTrailer:Boolean(item.youtube_trailer_id),hasBanner:Boolean(item.banner_url)});
        return json({
          isAdmin:true,
          imported:true,
          anime:{id:item.id,title:item.title,year:item.year,englishTitle:item.english_title,originalTitle:item.original_title},
          screenshots:screenshots.length,
          catalogTotal:Number(catalogCount?.count ?? 0),
          catalogWithTrailer:Number(catalogWithTrailer?.count ?? 0),
          missingTrailers:Math.max(0,Number(catalogCount?.count ?? 0)-Number(catalogWithTrailer?.count ?? 0)),
          message:"Тайтл добавлен в каталог вместе с метаданными и доступными скриншотами.",
        });
      }
      if (body.action === "delete") {
        const safeIds = normalizeAdminCatalogIds((body as { ids?: unknown }).ids);
        if (!safeIds.length) return json({error:"no_valid_ids"},400);
        const result = await db.batch(safeIds.map(id => db.prepare("DELETE FROM anime_catalog WHERE id = ?").bind(id)));
        const deleted = result.reduce((sum,item) => sum + Number((item as {meta?:{changes?:number}})?.meta?.changes ?? 0),0);
        if (deleted > 0) await invalidatePersistentCatalogCache();
        const quality = await catalogQuality(db);
        await audit(db,"catalog.delete","success",{requested:safeIds.length,deleted});
        return json({isAdmin:true,deleted,quality:quality.items,qualitySummary:quality.summary});
      }
      if (body.action === "reset_metadata_refresh") {
        const totalRow = await db.prepare("SELECT COUNT(*) AS total FROM anime_catalog").first<{total:number}>();
        await db.batch([
          setMeta(db, "metadata_refresh_state", "metadata"),
          setMeta(db, "metadata_refresh_cursor", "0"),
          setMeta(db, "metadata_refresh_screenshot_cursor", "0"),
          setMeta(db, "metadata_refresh_auto_enabled", "0"),
          setMeta(db, "metadata_refresh_last_error", ""),
          db.prepare("UPDATE anime_catalog_screenshot_status SET status='retry',attempts=0,last_error=NULL,updated_at=CURRENT_TIMESTAMP WHERE anime_id IN (SELECT a.id FROM anime_catalog a WHERE NOT EXISTS (SELECT 1 FROM anime_catalog_screenshots s WHERE s.anime_id=a.id AND s.original_url NOT LIKE '%example.com%' AND s.preview_url NOT LIKE '%example.com%'))"),
          db.prepare("INSERT INTO anime_catalog_screenshot_status (anime_id,status,attempts,last_error,updated_at) SELECT a.id,'retry',0,NULL,CURRENT_TIMESTAMP FROM anime_catalog a WHERE NOT EXISTS (SELECT 1 FROM anime_catalog_screenshots s WHERE s.anime_id=a.id AND s.original_url NOT LIKE '%example.com%' AND s.preview_url NOT LIKE '%example.com%') ON CONFLICT(anime_id) DO UPDATE SET status='retry',attempts=0,last_error=NULL,updated_at=CURRENT_TIMESTAMP"),
        ]);
        await audit(db, "catalog.metadata.reset", "success", { total: Number(totalRow?.total ?? 0) });
        return json({ isAdmin: true, autoEnabled: false, phase: "metadata", offset: 0, total: Number(totalRow?.total ?? 0), stats: await catalogRefreshStats(db), message: "Прогресс обновления сброшен. Следующий запуск начнётся с начала каталога." });
      }
      if (body.action === "auto_start") {
        return json({ isAdmin: true, autoEnabled: false, error: "automatic_metadata_refresh_disabled", message: "Автоматическое обновление метаданных отключено. Используй ручной режим только при необходимости." }, 410);
      }
      if (body.action === "auto_stop") {
        await setMeta(db, "metadata_refresh_auto_enabled", "0").run();
        await audit(db, "catalog.metadata.auto_stop", "success", { phase: await getMeta(db,"metadata_refresh_state") ?? "idle" });
        return json({isAdmin:true,autoEnabled:false,phase:await getMeta(db,"metadata_refresh_state") ?? "idle",message:"Автоматическое обновление остановлено. Прогресс сохранён."});
      }
      if (body.action === "refresh_section_metadata") {
        const section = body.statusFilter === "ongoing" || body.statusFilter === "announcements" ? body.statusFilter : null;
        if (!section) return json({ error: "invalid_section", message: "Выбери раздел «Сейчас выходит» или «Анонсы»." }, 400);
        const status = section === "ongoing" ? "Онгоинг" : "Анонс";
        const rows = await db.prepare("SELECT id FROM anime_catalog WHERE status = ? ORDER BY position,id").bind(status).all<{ id: string }>();
        const ids = rows.results.map(row => row.id);
        if (!ids.length) return json({ isAdmin: true, section, total: 0, updated: 0, message: "В выбранном разделе нет тайтлов." });
        let updated = 0;
        for (let offset = 0; offset < ids.length; offset += METADATA_LOOKUP_BATCH_SIZE) {
          const batchIds = ids.slice(offset, offset + METADATA_LOOKUP_BATCH_SIZE);
          const source = await fetchByIds(batchIds);
          const sourceById = new Map(source.map(item => [String(item.id), item]));
          const statements: Statement[] = [];
          for (const id of batchIds) {
            const item = sourceById.get(id);
            if (!item || !["ongoing", "anons", "released"].includes(item.status ?? "")) continue;
            const nextStatus = item.status === "ongoing" ? "Онгоинг" : item.status === "anons" ? "Анонс" : "Вышел";
            const episodes = Math.max(0, Math.floor(Number(item.episodes ?? 0) || 0));
            const nextEpisodeAt = nextStatus === "Онгоинг" && typeof item.nextEpisodeAt === "string" && item.nextEpisodeAt.trim() ? item.nextEpisodeAt : null;
            statements.push(db.prepare("UPDATE anime_catalog SET status=?, episodes=?, next_episode_at=?, updated_at=CURRENT_TIMESTAMP WHERE id=?")
              .bind(nextStatus, episodes, nextEpisodeAt, id));
            updated++;
          }
          if (statements.length) await db.batch(statements);
          if (offset + METADATA_LOOKUP_BATCH_SIZE < ids.length) await new Promise(resolve => setTimeout(resolve, REQUEST_DELAY_MS));
        }
        await invalidatePersistentCatalogCache();
        await audit(db, "catalog.section.metadata.refresh", "success", { section, total: ids.length, updated });
        return json({ isAdmin: true, section, total: ids.length, updated, message: "Обновлены только статус, дата следующей серии и общее количество серий." });
      }
      if (body.action === "refresh_metadata") return await runCatalogMetadataRefreshStep(db);
      if (body.action === "repair") {
        const safeIds = normalizeAdminCatalogIds((body as { ids?: unknown }).ids);
        if (!safeIds.length) return json({error:"no_valid_ids"},400);
        const source = await fetchByIds(safeIds);
        let repaired = 0, stillIncomplete = 0;
        for (const sourceItem of source) {
          const item = mapItem(sourceItem);
          const result = await db.prepare("UPDATE anime_catalog SET title=COALESCE(NULLIF(?,'Без названия'),title),english_title=COALESCE(NULLIF(?,'Без названия'),english_title),original_title=COALESCE(NULLIF(?,'Без названия'),original_title),year=CASE WHEN ?>0 THEN ? ELSE year END,episodes=CASE WHEN ?>0 THEN ? ELSE episodes END,rating=COALESCE(?,rating),genres_json=CASE WHEN ?<>'[]' THEN ? ELSE genres_json END,status=CASE WHEN ?<>'Неизвестно' THEN ? ELSE status END,description=COALESCE(NULLIF(? ,''),description),hue=?,glyph=?,is_new=?,popular=?,poster_url=COALESCE(?,poster_url),banner_url=COALESCE(?,banner_url),kind=COALESCE(?,kind),age_rating=COALESCE(?,age_rating),next_episode_at=COALESCE(?,next_episode_at),episodes_aired=CASE WHEN ?>0 THEN ? ELSE episodes_aired END,aired_on=COALESCE(?,aired_on),studios_json=CASE WHEN ?<>'[]' THEN ? ELSE studios_json END,updated_at=CURRENT_TIMESTAMP WHERE id=?")
            .bind(item.title,item.english_title,item.original_title,item.year,item.year,item.episodes,item.episodes,item.rating,item.genres_json,item.genres_json,item.status,item.status,item.description,item.hue,item.glyph,item.is_new,item.popular,item.poster_url,item.banner_url,item.kind,item.age_rating,item.next_episode_at,item.episodes_aired,item.episodes_aired,item.aired_on,item.studios_json,item.studios_json,item.id).run();
          if ((result.meta?.changes ?? 0) > 0) repaired++;
          const refreshed = await db.prepare("SELECT year,poster_url,description FROM anime_catalog WHERE id = ?").bind(item.id).first<{year:number;poster_url:string|null;description:string|null}>();
          if (!refreshed || !refreshed.year || !refreshed.poster_url?.trim() || !refreshed.description?.trim()) stillIncomplete++;
        }
        if (repaired > 0) await invalidatePersistentCatalogCache();
        const quality = await catalogQuality(db);
        const notFound = Math.max(0,safeIds.length-source.length);
        await audit(db,"catalog.repair","success",{requested:safeIds.length,repaired,notFound,stillIncomplete});
        return json({isAdmin:true,repaired,notFound,stillIncomplete,quality:quality.items,qualitySummary:quality.summary});
      }
      if (body.action === "start") {
        const target = Number(body.target);
        if (!isValidAdminImportTarget(target)) return json({error:"invalid_target",message:"Укажи положительное целое число в безопасном диапазоне."},400);
        const requestedStatus = typeof body.statusFilter === "string" ? body.statusFilter : "";
        const allowedStatusFilters = new Set(["", "ongoing", "anons", "released"]);
        if (!allowedStatusFilters.has(requestedStatus)) return json({error:"invalid_status_filter",message:"Недопустимый статус для массового импорта."},400);
        const current = await getMeta(db,"admin_import_state");
        if (current === "running") return json({isAdmin:true,...await snapshot(db),message:"Импорт уже выполняется."},409);
        const runId = crypto.randomUUID();
        const block18PlusForRun = (await getMeta(db,"admin_import_block_18_plus") ?? "1") !== "0";
        await db.batch([
          db.prepare("DELETE FROM admin_catalog_import_items WHERE run_id <> ?").bind(runId),
          setMeta(db,"admin_import_run_id",runId),
          setMeta(db,"admin_import_baseline_added","0"),setMeta(db,"admin_import_baseline_skipped","0"),setMeta(db,"admin_import_baseline_incomplete","0"),
          setMeta(db,"admin_import_target",String(target)),setMeta(db,"admin_import_cursor","1"),
          setMeta(db,"admin_import_status_filter",requestedStatus),
          setMeta(db,"admin_import_run_block_18_plus",block18PlusForRun ? "1" : "0"),
          setMeta(db,"admin_import_added","0"),setMeta(db,"admin_import_skipped","0"),
          setMeta(db,"admin_import_incomplete","0"),setMeta(db,"admin_import_errors","0"),
          setMeta(db,"admin_import_state","running"),setMeta(db,"admin_import_resume_at","0"),
        ]);
        await audit(db,"catalog.import.start","success",{target,statusFilter:requestedStatus || null,block18Plus:block18PlusForRun,excludedGenres:["hentai","yaoi","yuri"]});
        return json({isAdmin:true,...await snapshot(db),message:"Импорт подготовлен."});
      }
      if (body.action === "step") {
        const state = await getMeta(db,"admin_import_state");
        if (state !== "running") return json({isAdmin:true,...await snapshot(db),message:"Нет активного импорта."},409);
        const resumeAt = Number(await getMeta(db,"admin_import_resume_at") ?? "0");
        if (resumeAt > Date.now()) return json({isAdmin:true,...await snapshot(db),retryAfterMs:resumeAt-Date.now(),error:"Источник временно на паузе. Повтори запрос позже."},503);
        const before = await snapshot(db);
        if (before.added >= before.target) {
          const finalState = before.added >= before.target ? "completed" : "partial";
          await db.batch([setMeta(db,"admin_import_state",finalState)]);
          await audit(db,"catalog.import.finish",finalState,{added:before.added,target:before.target,skipped:before.skipped,errors:before.errors});
          return json({isAdmin:true,...await snapshot(db)});
        }
        let sourcePage: ShikimoriAnime[];
        try { sourcePage = await fetchPage(before.cursor, before.statusFilter || null); }
        catch (error) {
          const retryAfterMs = Number((error as {retryAfterMs?:number})?.retryAfterMs ?? 5000);
          await db.batch([setMeta(db,"admin_import_errors",String(before.errors+1)),setMeta(db,"admin_import_resume_at",String(Date.now()+retryAfterMs))]);
          await audit(db,"catalog.import.source-error","warning",{cursor:before.cursor,message:error instanceof Error?error.message:"Ошибка источника.",retryAfterMs});
          return json({isAdmin:true,...await snapshot(db),retryAfterMs,error:error instanceof Error?error.message:"Ошибка источника."},503);
        }
        if (!sourcePage.length) {
          await db.batch([setMeta(db,"admin_import_state","partial")]);
          await audit(db,"catalog.import.partial","warning",{cursor:before.cursor,reason:"empty_source_page"});
          return json({isAdmin:true,...await snapshot(db),message:"Источник не вернул записи; импорт остановлен."});
        }
        const block18PlusForRun = (await getMeta(db,"admin_import_run_block_18_plus") ?? await getMeta(db,"admin_import_block_18_plus") ?? "1") !== "0";
        const source = sourcePage.filter(item => !isBlockedFromBulkImport(item,block18PlusForRun));
        let runId = await getMeta(db,"admin_import_run_id");
        if (!runId) {
          // Preserve statistics from an import started by the earlier implementation.
          runId = crypto.randomUUID();
          await db.batch([
            setMeta(db,"admin_import_run_id",runId),
            setMeta(db,"admin_import_baseline_added",String(before.added)),
            setMeta(db,"admin_import_baseline_skipped",String(before.skipped)),
            setMeta(db,"admin_import_baseline_incomplete",String(before.incomplete)),
          ]);
        }
        const sourceIds = Array.from(new Set(source.map(item => String(item.id)).filter(id => /^\d{1,20}$/.test(id))));
        const excludedRows = sourceIds.length
          ? await db.prepare("SELECT anime_id FROM admin_catalog_exclusions WHERE anime_id IN (" + sourceIds.map(() => "?").join(",") + ")").bind(...sourceIds).all<{anime_id:string}>()
          : {results:[] as {anime_id:string}[]};
        const excludedIds = new Set(excludedRows.results.map(row => row.anime_id));
        const importableSource = source.filter(item => !excludedIds.has(String(item.id)));
        const importableIds = Array.from(new Set(importableSource.map(item => String(item.id)).filter(id => /^\d{1,20}$/.test(id))));
        const existingRows = importableIds.length
          ? await db.prepare("SELECT id FROM anime_catalog WHERE id IN (" + importableIds.map(() => "?").join(",") + ")").bind(...importableIds).all<{id:string}>()
          : {results:[] as {id:string}[]};
        const existingIds = new Set(existingRows.results.map(row => row.id));
        const remainingTarget = Math.max(0, before.target - before.added);
        const candidateSourceItems = importableSource
          .filter(item => !existingIds.has(String(item.id)))
          .slice(0, remainingTarget);
        const seen = new Set<string>();
        const currentCount = await db.prepare("SELECT COUNT(*) AS count FROM anime_catalog").first<{count:number}>();
        let position = Number(currentCount?.count ?? 0);
        let addedCandidates = 0;
        const statements: Statement[] = [];
        for (const sourceItem of importableSource) {
          const sourceId = String(sourceItem.id);
          if (seen.has(sourceId)) continue;
          seen.add(sourceId);
          if (before.added + addedCandidates >= before.target) break;
          if (existingIds.has(sourceId)) {
            statements.push(db.prepare("INSERT OR IGNORE INTO admin_catalog_import_items (run_id,anime_id,outcome,incomplete) VALUES (?,?,'skipped',0)").bind(runId,sourceId));
            continue;
          }
          const item = mapItem(sourceItem);
          statements.push(db.prepare("INSERT OR IGNORE INTO anime_catalog (id,title,english_title,original_title,year,episodes,rating,genres_json,status,description,hue,glyph,is_new,popular,poster_url,banner_url,kind,age_rating,next_episode_at,episodes_aired,aired_on,studios_json,youtube_trailer_id,position,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)")
            .bind(item.id,item.title,item.english_title,item.original_title,item.year,item.episodes,item.rating,item.genres_json,item.status,item.description,item.hue,item.glyph,item.is_new,item.popular,item.poster_url,item.banner_url,item.kind,item.age_rating,item.next_episode_at,item.episodes_aired,item.aired_on,item.studios_json,item.youtube_trailer_id,position++));
          statements.push(db.prepare("INSERT OR IGNORE INTO admin_catalog_import_items (run_id,anime_id,outcome,incomplete) VALUES (?,?,CASE WHEN changes() > 0 THEN 'added' ELSE 'skipped' END,?)")
            .bind(runId,item.id,incomplete(item)?1:0));
          const screenshots = mapAdminCatalogScreenshots(sourceItem);
          for (const [index, shot] of screenshots.entries()) {
            statements.push(db.prepare("INSERT OR IGNORE INTO anime_catalog_screenshots (anime_id,original_url,preview_url,position,updated_at) VALUES (?,?,?,?,CURRENT_TIMESTAMP)")
              .bind(item.id, shot.original, shot.preview, index));
          }
          statements.push(screenshotStatusStatement(db, item.id, "done", 0, screenshots.length ? null : "Источник не вернул кадров"));
          addedCandidates++;
        }
        const resumeAtValue = String(Date.now()+REQUEST_DELAY_MS);
        statements.push(db.prepare("UPDATE anime_catalog_meta SET value = CAST(CAST((SELECT value FROM anime_catalog_meta WHERE key = 'admin_import_baseline_added') AS INTEGER) + (SELECT COUNT(*) FROM admin_catalog_import_items WHERE run_id = ? AND outcome = 'added') AS TEXT) WHERE key = 'admin_import_added'").bind(runId));
        statements.push(db.prepare("UPDATE anime_catalog_meta SET value = CAST(CAST((SELECT value FROM anime_catalog_meta WHERE key = 'admin_import_baseline_skipped') AS INTEGER) + (SELECT COUNT(*) FROM admin_catalog_import_items WHERE run_id = ? AND outcome = 'skipped') AS TEXT) WHERE key = 'admin_import_skipped'").bind(runId));
        statements.push(db.prepare("UPDATE anime_catalog_meta SET value = CAST(CAST((SELECT value FROM anime_catalog_meta WHERE key = 'admin_import_baseline_incomplete') AS INTEGER) + (SELECT COUNT(*) FROM admin_catalog_import_items WHERE run_id = ? AND outcome = 'added' AND incomplete = 1) AS TEXT) WHERE key = 'admin_import_incomplete'").bind(runId));
        statements.push(db.prepare("UPDATE anime_catalog_meta SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT) WHERE key = 'admin_import_cursor'"));
        statements.push(setMeta(db,"admin_import_resume_at",resumeAtValue));
        statements.push(db.prepare("UPDATE anime_catalog_meta SET value = CASE WHEN CAST((SELECT value FROM anime_catalog_meta WHERE key = 'admin_import_added') AS INTEGER) >= CAST((SELECT value FROM anime_catalog_meta WHERE key = 'admin_import_target') AS INTEGER) THEN 'completed' ELSE 'running' END WHERE key = 'admin_import_state'"));
        if (statements.length) {
          await db.batch(statements);
          await invalidatePersistentCatalogCache();
        }
        const after = await snapshot(db);
        await audit(db,"catalog.import.page","success",{page:before.cursor,statusFilter:before.statusFilter || null,added:after.added-before.added,skipped:after.skipped-before.skipped,incomplete:after.incomplete-before.incomplete,state:after.state});
        if (after.state !== "running") {
          await audit(db,"catalog.import.finish",after.state,{added:after.added,target:after.target,skipped:after.skipped,errors:after.errors});
        }
        return json({isAdmin:true,...after});
      }
      if (body.action === "stop") {
        await db.batch([setMeta(db,"admin_import_state","paused")]);
        await audit(db,"catalog.import.pause","success",await snapshot(db));
        return json({isAdmin:true,...await snapshot(db)});
      }
      if (body.action === "maintenance") {
        const report = await maintenanceCheck(db);
        const status = report.ok ? "success" : "error";
        await audit(db,"maintenance.check",status,{catalogRecords:report.catalogRecords,qualitySummary:report.qualitySummary});
        return json({isAdmin:true,maintenance:report});
      }
      return json({error:"invalid_action"},400);
    } finally {
      await releaseLock(db,lockToken);
    }
  } catch (error) {
    console.error("[YUME][ADMIN_CATALOG_IMPORT] Operation failed.",error);
    let progress: Record<string, unknown> = {};
    if (requestedAction === "refresh_metadata") {
      try {
        const [metadataCursor, screenshotCursor, stateValue, totalRow, screenshots] = await Promise.all([
          getMeta(db, "metadata_refresh_cursor"),
          getMeta(db, "metadata_refresh_screenshot_cursor"),
          getMeta(db, "metadata_refresh_state"),
          db.prepare("SELECT COUNT(*) AS total FROM anime_catalog").first<{ total: number }>(),
          screenshotProgress(db),
        ]);
        const total = Number(totalRow?.total ?? 0);
        const phase = stateValue ?? "metadata";
        progress = {
          phase,
          metadataOffset: phase === "done" || phase.startsWith("screenshots") ? total : Math.max(0, Number(metadataCursor ?? "0") || 0),
          screenshotOffset: phase === "metadata" ? 0 : Math.max(0, Number(screenshotCursor ?? "0") || 0),
          offset: phase === "metadata" ? Math.max(0, Number(metadataCursor ?? "0") || 0) : Math.max(0, Number(screenshotCursor ?? "0") || 0),
          total,
          screenshotFailures: screenshots.failed,
          screenshotRetries: screenshots.retry,
        };
      } catch (progressError) {
        console.warn("[YUME][ADMIN_CATALOG_IMPORT] Could not read refresh progress.", progressError);
      }
    }
    return json({error:"admin_operation_failed",message:error instanceof Error ? error.message : "Unknown administrative operation error.", ...progress},503);
  }
}
