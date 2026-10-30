import { env as cloudflareEnv } from "cloudflare:workers";
import { invalidatePersistentCatalogCache } from "@/data/catalog-d1.server";
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
type QueueRow = { anime_id: string };
type Video = { url?: string | null; playerUrl?: string | null; name?: string | null; kind?: string | null };
type ShikimoriAnime = { id: string; videos?: Video[] | null };
type GraphQLResponse = { data?: { animes?: ShikimoriAnime[] | null }; errors?: { message?: string }[] };

const SESSION_COOKIE = "__Host-yume-session";
const BATCH_SIZE = 40;
const REQUEST_DELAY_MS = 2000;
const API_URL = "https://shikimori.io/api/graphql";

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
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
}

function cookieValue(request: Request, name: string): string | null {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const index = part.indexOf("=");
    if (index >= 0 && part.slice(0, index).trim() === name) return part.slice(index + 1).trim() || null;
  }
  return null;
}

async function sessionTokenHash(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function sameOrigin(request: Request): boolean {
  const expected = new URL(request.url).origin;
  const origin = request.headers.get("origin");
  if (origin) {
    try { return new URL(origin).origin === expected; } catch { return false; }
  }
  const referer = request.headers.get("referer");
  if (referer) {
    try { return new URL(referer).origin === expected; } catch { return false; }
  }
  return request.headers.get("sec-fetch-site") === "same-origin";
}

async function authorize(request: Request, env: Environment, db: Database): Promise<boolean> {
  const adminId = typeof env.TELEGRAM_ADMIN_ID === "string" ? env.TELEGRAM_ADMIN_ID.trim() : "";
  if (!/^\d{1,20}$/.test(adminId)) {
    console.error("[YUME][ADMIN_AUTH] Configuration invalid: TELEGRAM_ADMIN_ID must contain only digits.");
    return false;
  }
  const token = cookieValue(request, SESSION_COOKIE);
  if (!token) {
    console.warn("[YUME][ADMIN_AUTH] Denied: session cookie missing.", { path: new URL(request.url).pathname });
    return false;
  }
  const secret = typeof env.YUME_AUTH_SESSION_SECRET === "string" && env.YUME_AUTH_SESSION_SECRET.trim().length >= 32
    ? env.YUME_AUTH_SESSION_SECRET
    : "";
  if (!secret) {
    console.error("[YUME][ADMIN_AUTH] Configuration invalid: YUME_AUTH_SESSION_SECRET is missing or too short.");
    return false;
  }
  const session = await db.prepare(
    "SELECT u.telegram_user_id, s.expires_at FROM yume_sessions s JOIN yume_users u ON u.id = s.user_id WHERE s.token_hash = ? AND u.provider = 'telegram'",
  ).bind(await sessionTokenHash(token, secret)).first<{ telegram_user_id: string | null; expires_at: number }>();
  if (!session) {
    console.warn("[YUME][ADMIN_AUTH] Denied: session hash not found or user is not a Telegram account.", { path: new URL(request.url).pathname });
    return false;
  }
  if (session.expires_at <= Date.now()) {
    console.warn("[YUME][ADMIN_AUTH] Denied: session expired.");
    return false;
  }
  if (session.telegram_user_id !== adminId) {
    console.warn("[YUME][ADMIN_AUTH] Denied: Telegram account ID does not match configured administrator. ID values omitted.");
    return false;
  }
  console.info("[YUME][ADMIN_AUTH] Authorized administrator session.", { path: new URL(request.url).pathname });
  return true;
}

async function queueCounts(db: Database): Promise<{ total: number; pending: number; checked: number; found: number }> {
  const row = await db.prepare(
    "SELECT COUNT(*) AS total, SUM(CASE WHEN q.status = 'pending' THEN 1 ELSE 0 END) AS pending, SUM(CASE WHEN q.status = 'checked' THEN 1 ELSE 0 END) AS checked, SUM(CASE WHEN q.trailer_found = 1 THEN 1 ELSE 0 END) AS found FROM anime_trailer_update_queue q INNER JOIN anime_catalog a ON a.id = q.anime_id",
  ).first<{ total: number; pending: number; checked: number; found: number }>();
  return { total: Number(row?.total ?? 0), pending: Number(row?.pending ?? 0), checked: Number(row?.checked ?? 0), found: Number(row?.found ?? 0) };
}

const trailerSchemaPromises = new WeakMap<object, Promise<void>>();

function ensureQueue(db: Database): Promise<void> {
  const key = db as object;
  const existing = trailerSchemaPromises.get(key);
  if (existing) return existing;
  const pending = db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS anime_trailer_update_queue (anime_id TEXT PRIMARY KEY NOT NULL, status TEXT NOT NULL DEFAULT 'pending', trailer_found INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_anime_trailer_queue_status ON anime_trailer_update_queue(status, anime_id)"),
    db.prepare("CREATE TABLE IF NOT EXISTS yume_admin_audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT NOT NULL, status TEXT NOT NULL, details TEXT NOT NULL DEFAULT '{}', actor_telegram_id TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"),
    db.prepare("CREATE TABLE IF NOT EXISTS yume_trailer_auto_state (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)"),
  ]).then(() => undefined).catch((error) => {
    trailerSchemaPromises.delete(key);
    throw error;
  });
  trailerSchemaPromises.set(key, pending);
  return pending;
}

async function audit(db: Database, action: string, status: string, details: Record<string, unknown> = {}): Promise<void> {
  await db.prepare("INSERT INTO yume_admin_audit_log (action,status,details) VALUES (?,?,?)")
    .bind(action,status,JSON.stringify(details).slice(0,4000)).run();
}

function youtubeId(value: string | null | undefined): string | null {
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

function trailerId(videos: Video[] | null | undefined): string | null {
  const candidates = (videos ?? []).map((video) => {
    const id = youtubeId(video.playerUrl) ?? youtubeId(video.url);
    if (!id) return null;
    const kind = (video.kind ?? "").toLowerCase();
    const name = (video.name ?? "").toLowerCase();
    const trailer = kind === "pv" || kind === "character_trailer" || /trailer|preview|\bpv\b|промо|трейлер|тизер|予告/i.test(name);
    return { id, trailer };
  }).filter((value): value is { id: string; trailer: boolean } => value !== null);
  return candidates.find((item) => item.trailer)?.id ?? candidates[0]?.id ?? null;
}

async function fetchBatch(ids: string[]): Promise<{ items: ShikimoriAnime[]; retryAfterMs?: number }> {
  const query = "query { animes(ids: " + JSON.stringify(ids.join(",")) + ") { id videos { url name kind playerUrl } } }";
  const response = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": "YUME/1.0" },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(12000),
  });
  if (response.status === 429) {
    const retryAfterMs = retryAfterMilliseconds(response.headers.get("Retry-After")) ?? 60000;
    throw Object.assign(new Error("Shikimori ограничил частоту запросов."), { retryAfterMs });
  }
  if (!response.ok) throw new Error("Shikimori вернул HTTP " + response.status);
  const payload = await response.json() as GraphQLResponse;
  if (payload.errors?.length) throw new Error(payload.errors.map((item) => item.message).filter(Boolean).join("; "));
  return { items: payload.data?.animes ?? [] };
}

export async function handleAdminTrailers(request: Request): Promise<Response> {
  if (request.method !== "GET" && request.method !== "POST") {
    console.warn("[YUME][ADMIN_API] Rejected unsupported method.", { method: request.method });
    return json({ error: "method_not_allowed" }, 405);
  }
  if (request.method === "POST" && !sameOrigin(request)) {
    console.warn("[YUME][ADMIN_API] Rejected cross-origin mutation.");
    return json({ error: "cross_origin_request" }, 403);
  }
  const env = environment();
  const db = database(env);
  if (!db) {
    console.error("[YUME][ADMIN_API] Database binding YUME_DB unavailable.");
    return json({ error: "database_unavailable" }, 503);
  }
  console.info("[YUME][ADMIN_API] Request received.", { method: request.method, path: new URL(request.url).pathname });
  try {
    if (!await authorize(request, env, db)) return json({ isAdmin: false, error: "admin_required" }, 403);
    await ensureQueue(db);
    console.info("[YUME][ADMIN_API] Queue schema ready.");

    if (request.method === "GET") {
      const [counts, missing, catalogTotal, catalogWithTrailer] = await Promise.all([
        queueCounts(db),
        db.prepare("SELECT COUNT(*) AS count FROM anime_catalog WHERE youtube_trailer_id IS NULL OR youtube_trailer_id = ''").first<{ count: number }>(),
        db.prepare("SELECT COUNT(*) AS count FROM anime_catalog").first<{ count: number }>(),
        db.prepare("SELECT COUNT(*) AS count FROM anime_catalog WHERE youtube_trailer_id IS NOT NULL AND youtube_trailer_id <> ''").first<{ count: number }>(),
      ]);
      const auto = await readAutoState(db);
      return json({
        isAdmin: true,
        ...counts,
        missing: Number(missing?.count ?? 0),
        catalogTotal: Number(catalogTotal?.count ?? 0),
        catalogWithTrailer: Number(catalogWithTrailer?.count ?? 0),
        batchSize: BATCH_SIZE,
        delayMs: REQUEST_DELAY_MS,
        auto,
      });
    }

    let body: { action?: unknown };
    try { body = await request.json() as { action?: unknown }; } catch { return json({ error: "invalid_request" }, 400); }
    if (body.action === "auto-enable" || body.action === "auto-disable") {
      const enabled = body.action === "auto-enable";
      const now = Date.now();
      await db.batch([
        db.prepare("INSERT OR REPLACE INTO yume_trailer_auto_state (key,value) VALUES ('enabled',?)").bind(enabled ? "1" : "0"),
        ...(enabled ? [
          db.prepare("INSERT OR REPLACE INTO yume_trailer_auto_state (key,value) VALUES ('next_run_at',?)").bind(String(now)),
          db.prepare("INSERT OR REPLACE INTO yume_trailer_auto_state (key,value) VALUES ('last_error','')"),
        ] : []),
      ]);
      await audit(db, enabled ? "trailers.auto.enable" : "trailers.auto.disable", "success");
      return json({ isAdmin: true, auto: await readAutoState(db) });
    }
    if (body.action === "start") {
      const counts = await queueCounts(db);

      // Re-queue every catalogue item that still lacks a trailer. INSERT OR IGNORE
      // alone leaves previously checked rows stuck in "checked" forever.
      await db.batch([
        db.prepare("INSERT OR IGNORE INTO anime_trailer_update_queue (anime_id, status, trailer_found) SELECT id, 'pending', 0 FROM anime_catalog WHERE youtube_trailer_id IS NULL OR youtube_trailer_id = ''"),
        db.prepare("UPDATE anime_trailer_update_queue SET status = 'pending', trailer_found = 0, updated_at = CURRENT_TIMESTAMP WHERE (status <> 'pending' OR trailer_found <> 0) AND anime_id IN (SELECT id FROM anime_catalog WHERE youtube_trailer_id IS NULL OR youtube_trailer_id = '')"),
      ]);
      const refreshed = await queueCounts(db);
      console.info("[YUME][TRAILER_SCAN] Queue prepared.", { total: refreshed.total, pending: refreshed.pending, checked: refreshed.checked, found: refreshed.found });
      await audit(db,"trailers.scan.start","success",{total:refreshed.total,pending:refreshed.pending,checked:refreshed.checked,found:refreshed.found});
      if (refreshed.pending === 0) await audit(db,"trailers.scan.finish","success",refreshed);
      return json({
        isAdmin: true,
        ...refreshed,
        message: counts.pending > 0
          ? "Продолжаем обработку очереди; аниме без трейлеров будут проверены повторно."
          : "Очередь обновления создана; ранее не найденные трейлеры будут проверены повторно.",
      });
    }
    if (body.action !== "step") return json({ error: "invalid_action" }, 400);

    const pending = await db.prepare("SELECT q.anime_id FROM anime_trailer_update_queue q INNER JOIN anime_catalog a ON a.id = q.anime_id WHERE q.status = 'pending' ORDER BY q.anime_id LIMIT ?")
      .bind(BATCH_SIZE).all<QueueRow>();
    if (!pending.results.length) { const counts = await queueCounts(db); await audit(db,"trailers.scan.finish","success",counts); return json({ isAdmin: true, ...counts, done: true }); }

    const ids = pending.results.map((row) => row.anime_id);
    let fetched: { items: ShikimoriAnime[]; retryAfterMs?: number };
    try {
      fetched = await fetchBatch(ids);
    } catch (error) {
      const retryAfterMs = typeof error === "object" && error !== null && "retryAfterMs" in error
        ? Number((error as { retryAfterMs: number }).retryAfterMs) : 5000;
      await audit(db,"trailers.scan.source-error","warning",{batchSize:ids.length,retryAfterMs});
      return json({ isAdmin: true, ...(await queueCounts(db)), retryAfterMs, error: error instanceof Error ? error.message : "Не удалось запросить Shikimori." }, 503);
    }

    const returnedIds = new Set(fetched.items.map((item) => String(item.id)));
    const byId = new Map(fetched.items.map((item) => [String(item.id), trailerId(item.videos)]));
    let sourceMissing = 0;
    let noVideo = 0;
    let unusableVideo = 0;
    let trailersFoundInBatch = 0;
    const statements: Statement[] = [];
    for (const id of ids) {
      const item = fetched.items.find((candidate) => String(candidate.id) === id);
      const found = byId.get(id) ?? null;
      if (!returnedIds.has(id)) sourceMissing += 1;
      else if (!item?.videos?.length) noVideo += 1;
      else if (!found) unusableVideo += 1;
      if (found) trailersFoundInBatch += 1;
      if (found) {
        statements.push(db.prepare("UPDATE anime_catalog SET youtube_trailer_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND (youtube_trailer_id IS NULL OR youtube_trailer_id = '')").bind(found, id));
      }
      statements.push(db.prepare("UPDATE anime_trailer_update_queue SET status = 'checked', trailer_found = ?, updated_at = CURRENT_TIMESTAMP WHERE anime_id = ?").bind(found ? 1 : 0, id));
    }
    await db.batch(statements);
    if (trailersFoundInBatch > 0) await invalidatePersistentCatalogCache();
    const counts = await queueCounts(db);
    await audit(db,"trailers.scan.batch","success",{requested:ids.length,sourceMissing,noVideo,unusableVideo,trailersFoundInBatch,queuePending:counts.pending,queueChecked:counts.checked,queueFound:counts.found});
    if (counts.pending === 0) await audit(db,"trailers.scan.finish","success",counts);
    console.info("[YUME][TRAILER_SCAN] Batch processed.", {
      requested: ids.length,
      returnedFromSource: fetched.items.length,
      sourceMissing,
      noVideo,
      unusableVideo,
      trailersFoundInBatch,
      queuePending: counts.pending,
      queueChecked: counts.checked,
      queueFound: counts.found,
    });
    return json({
      isAdmin: true, ...counts, processed: ids.length, batchSize: BATCH_SIZE, delayMs: REQUEST_DELAY_MS,
      diagnostics: { requested: ids.length, returnedFromSource: fetched.items.length, sourceMissing, noVideo, unusableVideo },
      done: counts.pending === 0,
    });
  } catch (error) {
    console.error("[YUME][ADMIN_API] Admin trailer operation failed.", {
      method: request.method,
      path: new URL(request.url).pathname,
      name: error instanceof Error ? error.name : "UnknownError",
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return json({ error: "admin_operation_failed" }, 503);
  }
}


type AutoState = { enabled: boolean; running: boolean; nextRunAt: number | null; lastRunAt: number | null; retryAt: number | null; lastError: string; };
async function setAutoValues(db: Database, values: Record<string,string>): Promise<void> {
  await db.batch(Object.entries(values).map(([key,value]) =>
    db.prepare("INSERT OR REPLACE INTO yume_trailer_auto_state (key,value) VALUES (?,?)").bind(key,value)));
}
async function readAutoState(db: Database): Promise<AutoState> {
  const rows = await db.prepare("SELECT key, value FROM yume_trailer_auto_state WHERE key IN ('enabled','running','next_run_at','last_run_at','retry_at','last_error')")
    .all<{key:string;value:string}>();
  const values = new Map(rows.results.map((row) => [row.key, row.value]));
  const nextRunAt = values.get("next_run_at");
  const lastRunAt = values.get("last_run_at");
  const retryAt = values.get("retry_at");
  return {
    enabled: values.get("enabled") === "1",
    running: values.get("running") === "1",
    nextRunAt: nextRunAt ? Number(nextRunAt) : null,
    lastRunAt: lastRunAt ? Number(lastRunAt) : null,
    retryAt: retryAt ? Number(retryAt) : null,
    lastError: values.get("last_error") ?? "",
  };
}

/** Cloudflare Cron handler. Advances one durable queue batch per tick; it never depends on an open admin UI. */
export async function runScheduledTrailerUpdate(envInput: unknown): Promise<void> {
  const env = (envInput && typeof envInput === "object" ? envInput : {}) as Environment;
  const db = database(env);
  if (!db) { console.error("[YUME][TRAILER_AUTO] D1 binding unavailable."); return; }
  try {
    await ensureQueue(db);
    const state = await readAutoState(db);
    if (!state.enabled) return;
    const now = Date.now();
    if (state.retryAt && state.retryAt > now) return;
    if (state.nextRunAt && state.nextRunAt > now && !state.running) return;

    // Atomic lock prevents overlap with another scheduled invocation.
    const lock = await db.prepare(
      "INSERT INTO yume_trailer_auto_state (key,value) SELECT 'lock_until',? WHERE NOT EXISTS (SELECT 1 FROM yume_trailer_auto_state WHERE key='lock_until' AND CAST(value AS INTEGER)>?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE CAST(yume_trailer_auto_state.value AS INTEGER)<=?"
    ).bind(String(now + 55000),now,now).run();
    if ((lock.meta?.changes ?? 0) !== 1) return;

    try {
      if (!state.running) {
        await db.batch([
          db.prepare("INSERT OR IGNORE INTO anime_trailer_update_queue (anime_id,status,trailer_found) SELECT id,'pending',0 FROM anime_catalog WHERE youtube_trailer_id IS NULL OR youtube_trailer_id=''"),
          db.prepare("UPDATE anime_trailer_update_queue SET status='pending',trailer_found=0,updated_at=CURRENT_TIMESTAMP WHERE (status <> 'pending' OR trailer_found <> 0) AND anime_id IN (SELECT id FROM anime_catalog WHERE youtube_trailer_id IS NULL OR youtube_trailer_id='')"),
          db.prepare("INSERT OR REPLACE INTO yume_trailer_auto_state (key,value) VALUES ('running','1')"),
          db.prepare("INSERT OR REPLACE INTO yume_trailer_auto_state (key,value) VALUES ('last_error','')"),
          db.prepare("INSERT OR REPLACE INTO yume_trailer_auto_state (key,value) VALUES ('retry_at','')"),
        ]);
      }
      const pending = await db.prepare("SELECT anime_id FROM anime_trailer_update_queue WHERE status='pending' ORDER BY anime_id LIMIT ?").bind(BATCH_SIZE).all<QueueRow>();
      if (!pending.results.length) {
        const finishedAt = Date.now();
        await setAutoValues(db,{running:"0",last_run_at:String(finishedAt),next_run_at:String(finishedAt + 86400000),retry_at:"",last_error:"",lock_until:"0"});
        await audit(db,"trailers.auto.finish","success",await queueCounts(db));
        return;
      }
      const ids = pending.results.map(row=>row.anime_id);
      let fetched: {items:ShikimoriAnime[]};
      try { fetched = await fetchBatch(ids); }
      catch (error) {
        const retryAfterMs = typeof error === "object" && error !== null && "retryAfterMs" in error
          ? Math.max(60000,Number((error as {retryAfterMs:number}).retryAfterMs)) : 60000;
        const message = error instanceof Error ? error.message : "Не удалось запросить Shikimori.";
        await setAutoValues(db,{retry_at:String(Date.now()+retryAfterMs),last_error:message,lock_until:"0"});
        await audit(db,"trailers.auto.retry","warning",{retryAfterMs,message});
        return;
      }
      const returned = new Set(fetched.items.map(item=>String(item.id)));
      const byId = new Map(fetched.items.map(item=>[String(item.id),trailerId(item.videos)]));
      const statements: Statement[] = [];
      for (const id of ids) {
        const found = byId.get(id) ?? null;
        if (found) statements.push(db.prepare("UPDATE anime_catalog SET youtube_trailer_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND (youtube_trailer_id IS NULL OR youtube_trailer_id='')").bind(found,id));
        statements.push(db.prepare("UPDATE anime_trailer_update_queue SET status='checked',trailer_found=?,updated_at=CURRENT_TIMESTAMP WHERE anime_id=?").bind(found ? 1 : 0,id));
      }
      await db.batch(statements);
      if (ids.some((id) => Boolean(byId.get(id)))) await invalidatePersistentCatalogCache();
      const counts = await queueCounts(db);
      await setAutoValues(db,{retry_at:"",last_error:"",lock_until:"0"});
      await audit(db,"trailers.auto.batch","success",{requested:ids.length,returned:fetched.items.length,pending:counts.pending,found:counts.found});
      if (counts.pending === 0) {
        const finishedAt = Date.now();
        await setAutoValues(db,{running:"0",last_run_at:String(finishedAt),next_run_at:String(finishedAt+86400000)});
        await audit(db,"trailers.auto.finish","success",counts);
      }
    } finally {
      await setAutoValues(db,{lock_until:"0"});
    }
  } catch(error) {
    const message = error instanceof Error ? error.message : String(error);
    try {
      await setAutoValues(db, { retry_at: String(Date.now() + 60000), last_error: message, lock_until: "0" });
    } catch {
      // Preserve the original scheduled-update failure even if retry state cannot be persisted.
    }
    console.error("[YUME][TRAILER_AUTO] Scheduled tick failed.",error);
  }
}
