import { env as cloudflareEnv } from "cloudflare:workers";
import { validateTelegramInitData, type TelegramValidatedUser } from "@/data/telegram-init-data";
import { MAX_SAVED_ANIME_IDS, normalizeSavedAnimeIds } from "@/data/telegram-library.shared";

type TelegramEnvironment = Record<string, unknown> & {
  TELEGRAM_BOT_TOKEN?: string;
  YUME_AUTH_SESSION_SECRET?: string;
  YUME_DB?: unknown;
};
type DbStatement = {
  bind(...values: unknown[]): DbStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<{ meta?: { changes?: number } }>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
};
type TelegramDatabase = { prepare(sql: string): DbStatement; batch(statements: DbStatement[]): Promise<unknown[]> };
type UserRow = {
  id: string;
  telegram_user_id: string;
  telegram_first_name: string;
  telegram_last_name: string | null;
  telegram_username: string | null;
  telegram_language_code: string | null;
};
type SessionRow = UserRow & { expires_at: number };

const SESSION_COOKIE = "__Host-yume-session";
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
const PRIVACY_POLICY_VERSION = "2026-10-24";
const TERMS_VERSION = "2026-10-24";
const encoder = new TextEncoder();
type RuntimeGlobal = typeof globalThis & { __YUME_RUNTIME_ENV__?: unknown };

function environment(): TelegramEnvironment {
  try {
    const native = cloudflareEnv as unknown as TelegramEnvironment;
    if (native && typeof native === "object") return native;
  } catch {
    // Allows endpoint tests to provide an isolated runtime environment.
  }
  const injected = (globalThis as RuntimeGlobal).__YUME_RUNTIME_ENV__;
  return injected && typeof injected === "object" ? injected as TelegramEnvironment : {};
}

function database(env: TelegramEnvironment): TelegramDatabase | null {
  return env.YUME_DB && typeof env.YUME_DB === "object" ? env.YUME_DB as TelegramDatabase : null;
}

function sessionSecret(env: TelegramEnvironment): string | null {
  const value = env.YUME_AUTH_SESSION_SECRET;
  return typeof value === "string" && value.trim().length >= 32 ? value : null;
}

async function sessionTokenHash(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function randomToken(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function readCookie(request: Request, name: string): string | null {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const index = part.indexOf("=");
    if (index >= 0 && part.slice(0, index).trim() === name) return part.slice(index + 1).trim() || null;
  }
  return null;
}

function sessionCookie(token: string): string {
  return SESSION_COOKIE + "=" + token + "; Path=/; Max-Age=" + SESSION_TTL_SECONDS + "; HttpOnly; Secure; SameSite=Lax";
}

function clearSessionCookie(): string {
  return SESSION_COOKIE + "=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax";
}

function jsonResponse(payload: unknown, status = 200, cookies: string[] = []): Response {
  const headers = new Headers({
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  });
  for (const value of cookies) headers.append("Set-Cookie", value);
  return new Response(JSON.stringify(payload), { status, headers });
}

const telegramSchemaPromises = new WeakMap<object, Promise<void>>();

function ensureSchema(db: TelegramDatabase): Promise<void> {
  const key = db as object;
  const cached = telegramSchemaPromises.get(key);
  if (cached) return cached;
  // Terms-consent columns are retained as a compatibility bridge for databases
  // created before the versioned schema migration was introduced.
  const pending = ensureTermsConsentColumns(db).catch((error) => {
    telegramSchemaPromises.delete(key);
    throw error;
  });
  telegramSchemaPromises.set(key, pending);
  return pending;
}

async function ensureTermsConsentColumns(db: TelegramDatabase): Promise<void> {
  const result = await db.prepare("PRAGMA table_info(yume_users)").all<{ name: string }>();
  const columns = new Set(result.results.map((column) => column.name));
  if (!columns.has("terms_agreed_at")) {
    await db.prepare("ALTER TABLE yume_users ADD COLUMN terms_agreed_at TEXT").run();
  }
  if (!columns.has("terms_version")) {
    await db.prepare("ALTER TABLE yume_users ADD COLUMN terms_version TEXT").run();
  }
}


async function createSession(db: TelegramDatabase, userId: string, secret: string): Promise<string> {
  const token = randomToken();
  const expiresAt = Date.now() + SESSION_TTL_SECONDS * 1000;
  await db.prepare("DELETE FROM yume_sessions WHERE expires_at <= ?").bind(Date.now()).run();
  await db.prepare("INSERT INTO yume_sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)").bind(await sessionTokenHash(token, secret), userId, expiresAt).run();
  return sessionCookie(token);
}

function userPayload(user: UserRow) {
  return {
    id: user.id,
    telegramId: user.telegram_user_id,
    firstName: user.telegram_first_name,
    ...(user.telegram_last_name ? { lastName: user.telegram_last_name } : {}),
    ...(user.telegram_username ? { username: user.telegram_username } : {}),
    ...(user.telegram_language_code ? { languageCode: user.telegram_language_code } : {}),
  };
}

async function findTelegramUser(db: TelegramDatabase, telegramId: number): Promise<UserRow | null> {
  return db.prepare("SELECT id, telegram_user_id, telegram_first_name, telegram_last_name, telegram_username, telegram_language_code FROM yume_users WHERE telegram_user_id = ?").bind(String(telegramId)).first<UserRow>();
}

async function upsertTelegramUser(
  db: TelegramDatabase,
  user: TelegramValidatedUser,
  consents: { privacyConsent: boolean; termsAccepted: boolean },
): Promise<UserRow | null> {
  if (!consents.privacyConsent || !consents.termsAccepted) {
    throw new Error("EXPLICIT_REGISTRATION_CONSENTS_REQUIRED");
  }
  const telegramId = String(user.id);
  const current = await findTelegramUser(db, user.id);
  if (!current) {
    const acceptedAt = new Date().toISOString();
    await db.prepare("INSERT OR IGNORE INTO yume_users (id, provider, provider_user_id, telegram_user_id, telegram_first_name, telegram_last_name, telegram_username, telegram_language_code, privacy_consent_at, privacy_policy_version, terms_agreed_at, terms_version) VALUES (?, 'telegram', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), telegramId, telegramId, user.firstName, user.lastName ?? null, user.username ?? null, user.languageCode ?? null, acceptedAt, PRIVACY_POLICY_VERSION, acceptedAt, TERMS_VERSION).run();
  } else {
    await db.prepare("UPDATE yume_users SET telegram_first_name = ?, telegram_last_name = ?, telegram_username = ?, telegram_language_code = ? WHERE telegram_user_id = ?")
      .bind(user.firstName, user.lastName ?? null, user.username ?? null, user.languageCode ?? null, telegramId).run();
  }
  return findTelegramUser(db, user.id);
}


const MAX_LIBRARY_BODY_CHARS = 64_000;


type SavedListType = "favorite" | "watchlist";

type SavedAnimeRow = { anime_id: string };
type AuthenticatedSessionRow = { user_id: string; expires_at: number };

function isSameOriginRequest(request: Request): boolean {
  const expectedOrigin = new URL(request.url).origin;
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      return new URL(origin).origin === expectedOrigin;
    } catch {
      return false;
    }
  }

  const referer = request.headers.get("referer");
  if (referer) {
    try {
      return new URL(referer).origin === expectedOrigin;
    } catch {
      return false;
    }
  }

  return request.headers.get("sec-fetch-site") === "same-origin";
}

async function authenticatedTelegramUserId(request: Request, db: TelegramDatabase, secret: string): Promise<string | null> {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return null;
  const tokenHash = await sessionTokenHash(token, secret);
  const session = await db.prepare(
    "SELECT s.user_id, s.expires_at FROM yume_sessions s JOIN yume_users u ON u.id = s.user_id WHERE s.token_hash = ? AND u.provider = 'telegram'",
  ).bind(tokenHash).first<AuthenticatedSessionRow>();
  if (!session || session.expires_at <= Date.now()) {
    if (session) await db.prepare("DELETE FROM yume_sessions WHERE token_hash = ?").bind(tokenHash).run();
    return null;
  }
  return session.user_id;
}

async function readSavedLibrary(db: TelegramDatabase, userId: string): Promise<{ favoriteIds: string[]; watchlistIds: string[] }> {
  const rows = await db.prepare("SELECT list_type, anime_id FROM yume_saved_anime WHERE user_id = ? AND list_type IN ('favorite','watchlist') ORDER BY list_type, created_at, id")
    .bind(userId).all<SavedAnimeRow & { list_type: SavedListType }>();
  const favoriteIds: string[] = [];
  const watchlistIds: string[] = [];
  for (const row of rows.results) {
    (row.list_type === "favorite" ? favoriteIds : watchlistIds).push(row.anime_id);
  }
  return { favoriteIds, watchlistIds };
}

async function mergeSavedIds(db: TelegramDatabase, userId: string, listType: SavedListType, ids: string[]): Promise<void> {
  for (let start = 0; start < ids.length; start += 100) {
    const statements = ids.slice(start, start + 100).map((animeId) =>
      db.prepare("INSERT OR IGNORE INTO yume_saved_anime (user_id, list_type, anime_id) VALUES (?, ?, ?)")
        .bind(userId, listType, animeId),
    );
    if (statements.length > 0) await db.batch(statements);
  }
}

/** Account-owned saved lists, protected by the Telegram session cookie. */
export async function handleTelegramLibrary(request: Request): Promise<Response> {
  if (request.method !== "GET" && request.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }
  if (request.method === "POST" && !isSameOriginRequest(request)) {
    return jsonResponse({ error: "cross_origin_request" }, 403);
  }

  let input: Record<string, unknown> | null = null;
  if (request.method === "POST") {
    try {
      const raw = await request.text();
      if (raw.length > MAX_LIBRARY_BODY_CHARS) return jsonResponse({ error: "request_too_large" }, 413);
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return jsonResponse({ error: "invalid_request" }, 400);
      }
      input = parsed as Record<string, unknown>;
    } catch {
      return jsonResponse({ error: "invalid_request" }, 400);
    }
  }

  const env = environment();
  const db = database(env);
  if (!db) return jsonResponse({ error: "library_database_unavailable" }, 503);

  try {
    await ensureSchema(db);
    const secret = sessionSecret(env);
    if (!secret) return jsonResponse({ error: "telegram_auth_not_configured" }, 503);
    const userId = await authenticatedTelegramUserId(request, db, secret);
    if (!userId) return jsonResponse({ authenticated: false, error: "authentication_required" }, 401);

    if (request.method === "GET") {
      return jsonResponse({ authenticated: true, ...(await readSavedLibrary(db, userId)) });
    }

    if (input?.mode === "merge") {
      const favoriteIds = normalizeSavedAnimeIds(input.favoriteIds);
      const watchlistIds = normalizeSavedAnimeIds(input.watchlistIds);
      if (!favoriteIds || !watchlistIds) return jsonResponse({ error: "invalid_library" }, 400);
      const currentLibrary = await readSavedLibrary(db, userId);
      if (new Set([...currentLibrary.favoriteIds, ...favoriteIds]).size > MAX_SAVED_ANIME_IDS ||
          new Set([...currentLibrary.watchlistIds, ...watchlistIds]).size > MAX_SAVED_ANIME_IDS) {
        return jsonResponse({ error: "library_limit_reached", limit: MAX_SAVED_ANIME_IDS }, 409);
      }
      await mergeSavedIds(db, userId, "favorite", favoriteIds);
      await mergeSavedIds(db, userId, "watchlist", watchlistIds);
      return jsonResponse({ authenticated: true, ...(await readSavedLibrary(db, userId)) });
    }

    const listType = input?.list;
    const animeId = input?.animeId;
    const saved = input?.saved;
    if ((listType !== "favorite" && listType !== "watchlist") ||
        typeof animeId !== "string" || !/^\d{1,12}$/.test(animeId) ||
        typeof saved !== "boolean") {
      return jsonResponse({ error: "invalid_library_item" }, 400);
    }

    if (saved) {
      // Enforce the per-list cap inside the INSERT statement. This removes the
      // separate existence/count reads and avoids a check-then-insert race when
      // two requests try to fill the final slot concurrently.
      const result = await db.prepare(
        "INSERT OR IGNORE INTO yume_saved_anime (user_id, list_type, anime_id) SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM yume_saved_anime WHERE user_id = ? AND list_type = ? AND anime_id = ?) OR (SELECT COUNT(*) FROM yume_saved_anime WHERE user_id = ? AND list_type = ?) < ?",
      ).bind(userId, listType, animeId, userId, listType, animeId, userId, listType, MAX_SAVED_ANIME_IDS).run();
      if (Number(result.meta?.changes ?? 0) === 0) {
        const existing = await db.prepare("SELECT 1 AS found FROM yume_saved_anime WHERE user_id = ? AND list_type = ? AND anime_id = ?")
          .bind(userId, listType, animeId).first<{ found: number }>();
        if (!existing) {
          return jsonResponse({ error: "library_limit_reached", limit: MAX_SAVED_ANIME_IDS }, 409);
        }
      }
    } else {
      await db.prepare("DELETE FROM yume_saved_anime WHERE user_id = ? AND list_type = ? AND anime_id = ?")
        .bind(userId, listType, animeId).run();
    }
    return jsonResponse({ authenticated: true, ...(await readSavedLibrary(db, userId)) });
  } catch (error) {
    console.error("[YUME] Telegram library request failed:", error);
    return jsonResponse({ error: "library_unavailable" }, 503);
  }
}



type BrowserAuthRow = {
  token_hash: string;
  flow: "login" | "register";
  privacy_consent: number;
  terms_consent: number;
  confirmation_code_hash: string | null;
  telegram_user_id: string | null;
  status: "pending" | "ready" | "consuming" | "consumed" | "error";
  user_id: string | null;
  error_code: string | null;
  expires_at: number;
};

const browserAuthSchemaPromises = new WeakMap<object, Promise<void>>();

async function ensureBrowserAuthSchema(db: TelegramDatabase): Promise<void> {
  const key = db as object;
  const cached = browserAuthSchemaPromises.get(key);
  if (cached) return cached;
  const pending = (async () => {
    const columnsResult = await db.prepare("PRAGMA table_info(yume_browser_auth)").all<{ name: string }>();
    const columns = new Set(columnsResult.results.map((column) => column.name));
    if (!columns.has("terms_consent")) {
      await db.prepare("ALTER TABLE yume_browser_auth ADD COLUMN terms_consent INTEGER NOT NULL DEFAULT 0 CHECK (terms_consent IN (0,1))").run();
    }
    if (!columns.has("confirmation_code_hash")) {
      await db.prepare("ALTER TABLE yume_browser_auth ADD COLUMN confirmation_code_hash TEXT").run();
    }
    if (!columns.has("telegram_user_id")) {
      await db.prepare("ALTER TABLE yume_browser_auth ADD COLUMN telegram_user_id TEXT").run();
    }
  })().catch((error) => {
    browserAuthSchemaPromises.delete(key);
    throw error;
  });
  browserAuthSchemaPromises.set(key, pending);
  return pending;
}

/**
 * Associates a Telegram user with a short-lived browser request, but does not
 * sign them in yet. A separate confirmation code shown only in the initiating
 * browser must be sent by that same Telegram account to prevent login CSRF.
 */
export async function completeTelegramBrowserAuth(
  startParameter: string,
  telegramUser: TelegramValidatedUser,
): Promise<"awaiting_code" | "account_not_found" | "already_registered" | "consent_required" | "expired" | "unavailable"> {
  const token = startParameter.startsWith("yb_") ? startParameter.slice(3) : "";
  if (!/^[A-Za-z0-9_-]{30,60}$/.test(token)) return "expired";
  const env = environment();
  const db = database(env);
  const secret = sessionSecret(env);
  if (!db || !secret) return "unavailable";
  try {
    await ensureSchema(db);
    await ensureBrowserAuthSchema(db);
    const tokenHash = await sessionTokenHash(token, secret);
    const pending = await db.prepare("SELECT token_hash, flow, privacy_consent, terms_consent, confirmation_code_hash, telegram_user_id, status, user_id, error_code, expires_at FROM yume_browser_auth WHERE token_hash = ?")
      .bind(tokenHash).first<BrowserAuthRow>();
    if (!pending || pending.status !== "pending" || pending.expires_at <= Date.now()) return "expired";
    const telegramId = String(telegramUser.id);
    if (pending.telegram_user_id && pending.telegram_user_id !== telegramId) return "expired";

    const user = await findTelegramUser(db, telegramUser.id);
    let errorCode: string | null = null;
    if (pending.flow === "login" && !user) errorCode = "account_not_found";
    else if (pending.flow === "register" && user) errorCode = "already_registered";
    else if (pending.flow === "register" && (pending.privacy_consent !== 1 || pending.terms_consent !== 1)) errorCode = "consent_required";

    if (errorCode) {
      await db.prepare("UPDATE yume_browser_auth SET status = 'error', error_code = ? WHERE token_hash = ? AND status = 'pending'")
        .bind(errorCode, tokenHash).run();
      if (errorCode === "account_not_found") return "account_not_found";
      if (errorCode === "consent_required") return "consent_required";
      return "already_registered";
    }

    const association = await db.prepare("UPDATE yume_browser_auth SET telegram_user_id = ? WHERE token_hash = ? AND status = 'pending' AND expires_at > ? AND (telegram_user_id IS NULL OR telegram_user_id = ?)")
      .bind(telegramId, tokenHash, Date.now(), telegramId).run();
    if (Number(association.meta?.changes ?? 0) !== 1) return "expired";
    return "awaiting_code";
  } catch (error) {
    console.error("[YUME] Telegram browser auth association failed:", error);
    return "unavailable";
  }
}

/** Validates a browser-only code sent by the same Telegram account that opened the deep link. */
export async function confirmTelegramBrowserAuth(
  confirmationCode: string,
  telegramUser: TelegramValidatedUser,
): Promise<"ready" | "account_not_found" | "already_registered" | "consent_required" | "expired" | "unavailable"> {
  const code = confirmationCode.trim();
  if (!/^[A-Za-z0-9_-]{8}$/.test(code)) return "expired";
  const env = environment();
  const db = database(env);
  const secret = sessionSecret(env);
  if (!db || !secret) return "unavailable";
  try {
    await ensureSchema(db);
    await ensureBrowserAuthSchema(db);
    const codeHash = await sessionTokenHash(code, secret);
    const telegramId = String(telegramUser.id);
    const pending = await db.prepare("SELECT token_hash, flow, privacy_consent, terms_consent, confirmation_code_hash, telegram_user_id, status, user_id, error_code, expires_at FROM yume_browser_auth WHERE confirmation_code_hash = ? AND telegram_user_id = ? ORDER BY expires_at DESC LIMIT 1")
      .bind(codeHash, telegramId).first<BrowserAuthRow>();
    if (!pending || pending.status !== "pending" || pending.expires_at <= Date.now()) return "expired";

    let user = await findTelegramUser(db, telegramUser.id);
    let errorCode: string | null = null;
    if (pending.flow === "login" && !user) errorCode = "account_not_found";
    else if (pending.flow === "register" && user) errorCode = "already_registered";
    else if (pending.flow === "register" && (pending.privacy_consent !== 1 || pending.terms_consent !== 1)) errorCode = "consent_required";

    if (errorCode) {
      await db.prepare("UPDATE yume_browser_auth SET status = 'error', error_code = ? WHERE token_hash = ? AND status = 'pending'")
        .bind(errorCode, pending.token_hash).run();
      if (errorCode === "account_not_found") return "account_not_found";
      if (errorCode === "consent_required") return "consent_required";
      return "already_registered";
    }

    if (!user) {
      user = await upsertTelegramUser(db, telegramUser, {
        privacyConsent: pending.privacy_consent === 1,
        termsAccepted: pending.terms_consent === 1,
      });
    } else {
      await db.prepare("UPDATE yume_users SET telegram_first_name = ?, telegram_last_name = ?, telegram_username = ?, telegram_language_code = ? WHERE telegram_user_id = ?")
        .bind(telegramUser.firstName, telegramUser.lastName ?? null, telegramUser.username ?? null, telegramUser.languageCode ?? null, telegramId).run();
    }
    if (!user) throw new Error("TELEGRAM_BROWSER_USER_MISSING");

    const ready = await db.prepare("UPDATE yume_browser_auth SET status = 'ready', user_id = ? WHERE token_hash = ? AND status = 'pending' AND telegram_user_id = ? AND expires_at > ?")
      .bind(user.id, pending.token_hash, telegramId, Date.now()).run();
    if (Number(ready.meta?.changes ?? 0) !== 1) return "expired";
    return "ready";
  } catch (error) {
    console.error("[YUME] Telegram browser auth confirmation failed:", error);
    return "unavailable";
  }
}

/** Browser login/register handshake using an expiring, one-time Telegram deep link. */
export async function handleTelegramBrowserAuth(request: Request): Promise<Response> {
  if (request.method !== "POST" && request.method !== "GET") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  // The polling token is a bearer credential. Without same-origin validation,
  // an attacker could finish their own login flow and link a victim to this GET
  // URL, forcing the victim's browser to receive a session for the attacker's
  // account (login CSRF). Browser polling is same-origin; fail closed otherwise.
  if (!isSameOriginRequest(request)) {
    return jsonResponse({ error: "cross_origin_request" }, 403);
  }

  const env = environment();
  const db = database(env);
  const secret = sessionSecret(env);
  const botToken = typeof env.TELEGRAM_BOT_TOKEN === "string" ? env.TELEGRAM_BOT_TOKEN.trim() : "";
  if (!db || !secret || !botToken) return jsonResponse({ error: "telegram_auth_not_configured" }, 503);

  try {
    await ensureSchema(db);
    await ensureBrowserAuthSchema(db);

    if (request.method === "POST") {
      if (!isSameOriginRequest(request)) return jsonResponse({ error: "cross_origin_request" }, 403);
      let input: Record<string, unknown>;
      try {
        const raw = await request.text();
        if (raw.length > 4_096) return jsonResponse({ error: "request_too_large" }, 413);
        const parsed: unknown = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return jsonResponse({ error: "invalid_request" }, 400);
        input = parsed as Record<string, unknown>;
      } catch {
        return jsonResponse({ error: "invalid_request" }, 400);
      }
      const flow = input.flow;
      const consent = flow === "register" && input.privacyConsent === true;
      const termsConsent = flow === "register" && input.termsAccepted === true;
      if ((flow !== "login" && flow !== "register") || (flow === "register" && (!consent || !termsConsent))) {
        return jsonResponse({ error: flow === "register" ? "consent_required" : "invalid_request" }, 400);
      }

      const meResponse = await fetch("https://api.telegram.org/bot" + botToken + "/getMe", { method: "GET", cache: "no-store", signal: AbortSignal.timeout(5_000) });
      if (!meResponse.ok) return jsonResponse({ error: "telegram_bot_unavailable" }, 503);
      const me = await meResponse.json() as { ok?: boolean; result?: { username?: unknown } };
      const username = me.ok === true && typeof me.result?.username === "string" ? me.result.username : "";
      if (!/^[A-Za-z0-9_]{5,32}$/.test(username)) return jsonResponse({ error: "telegram_bot_unavailable" }, 503);

      const token = randomToken();
      const confirmationCode = randomToken(6);
      const tokenHash = await sessionTokenHash(token, secret);
      const confirmationCodeHash = await sessionTokenHash(confirmationCode, secret);
      const now = Date.now();
      await db.prepare("DELETE FROM yume_browser_auth WHERE expires_at <= ? OR status IN ('consumed','error')")
        .bind(now).run();
      await db.prepare("INSERT INTO yume_browser_auth (token_hash, flow, privacy_consent, terms_consent, confirmation_code_hash, status, expires_at) VALUES (?, ?, ?, ?, ?, 'pending', ?)")
        .bind(tokenHash, flow, consent ? 1 : 0, termsConsent ? 1 : 0, confirmationCodeHash, now + 10 * 60 * 1000).run();
      return jsonResponse({
        requestId: token,
        confirmationCode,
        expiresInSeconds: 600,
        botUrl: "https://t.me/" + username + "?start=yb_" + token,
      });
    }

    const url = new URL(request.url);
    const token = url.searchParams.get("id") ?? "";
    if (!/^[A-Za-z0-9_-]{30,60}$/.test(token)) return jsonResponse({ error: "invalid_request" }, 400);
    const tokenHash = await sessionTokenHash(token, secret);
    const row = await db.prepare("SELECT token_hash, flow, privacy_consent, terms_consent, confirmation_code_hash, telegram_user_id, status, user_id, error_code, expires_at FROM yume_browser_auth WHERE token_hash = ?")
      .bind(tokenHash).first<BrowserAuthRow>();
    if (!row || row.expires_at <= Date.now()) return jsonResponse({ status: "expired" });
    if (row.status === "error") return jsonResponse({ status: "error", error: row.error_code ?? "auth_failed" });
    if (row.status !== "ready" || !row.user_id) return jsonResponse({ status: row.status === "consumed" ? "expired" : "pending" });
    const claim = await db.prepare("UPDATE yume_browser_auth SET status = 'consuming' WHERE token_hash = ? AND status = 'ready' AND expires_at > ?")
      .bind(tokenHash, Date.now()).run();
    if (Number(claim.meta?.changes ?? 0) !== 1) return jsonResponse({ status: "pending" });
    const userExists = await db.prepare("SELECT id FROM yume_users WHERE id = ? AND provider = 'telegram'").bind(row.user_id).first<{ id: string }>();
    if (!userExists) {
      await db.prepare("DELETE FROM yume_browser_auth WHERE token_hash = ?").bind(tokenHash).run();
      return jsonResponse({ status: "error", error: "account_not_found" });
    }
    const cookie = await createSession(db, row.user_id, secret);
    await db.prepare("DELETE FROM yume_browser_auth WHERE token_hash = ?").bind(tokenHash).run();
    return jsonResponse({ status: "authenticated" }, 200, [cookie]);
  } catch (error) {
    console.error("[YUME] Telegram browser auth request failed:", error);
    return jsonResponse({ error: "browser_auth_unavailable" }, 503);
  }
}



/** Saves recently opened anime only for a verified, signed-in Telegram account. */
export async function handleTelegramHistory(request: Request): Promise<Response> {
  if (request.method !== "GET" && request.method !== "POST" && request.method !== "DELETE") return jsonResponse({ error: "method_not_allowed" }, 405);
  if ((request.method === "POST" || request.method === "DELETE") && !isSameOriginRequest(request)) return jsonResponse({ error: "cross_origin_request" }, 403);
  const env = environment();
  const db = database(env);
  const secret = sessionSecret(env);
  if (!db || !secret) return jsonResponse({ error: "telegram_auth_not_configured" }, 503);

  try {
    await ensureSchema(db);
    const userId = await authenticatedTelegramUserId(request, db, secret);
    if (!userId) return jsonResponse({ error: "authentication_required" }, 401);
    if (request.method === "GET") {
      const rows = await db.prepare("SELECT anime_id AS animeId, viewed_at AS viewedAt, view_count AS viewCount FROM yume_view_history WHERE user_id = ? ORDER BY viewed_at DESC LIMIT 100")
        .bind(userId).all<{ animeId: string; viewedAt: string; viewCount: number }>();
      return jsonResponse({ authenticated: true, items: rows.results });
    }

    let input: Record<string, unknown>;
    try {
      const raw = await request.text();
      if (raw.length > 2_048) return jsonResponse({ error: "request_too_large" }, 413);
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return jsonResponse({ error: "invalid_request" }, 400);
      input = parsed as Record<string, unknown>;
    } catch {
      return jsonResponse({ error: "invalid_request" }, 400);
    }
    const animeId = input.animeId;
    if (typeof animeId !== "string" || !/^\d{1,12}$/.test(animeId)) return jsonResponse({ error: "invalid_anime_id" }, 400);
    if (request.method === "DELETE") {
      await db.prepare("DELETE FROM yume_view_history WHERE user_id = ? AND anime_id = ?").bind(userId, animeId).run();
      return jsonResponse({ deleted: true });
    }
    const watchedSeconds = input.watchedSeconds;
    if (typeof watchedSeconds !== "number" || !Number.isFinite(watchedSeconds) || watchedSeconds < 30 || watchedSeconds > 24 * 60 * 60) {
      return jsonResponse({ error: "playback_not_confirmed" }, 400);
    }
    await db.prepare("INSERT INTO yume_view_history (user_id, anime_id, viewed_at, view_count) VALUES (?, ?, ?, 1) ON CONFLICT(user_id, anime_id) DO UPDATE SET viewed_at = excluded.viewed_at, view_count = yume_view_history.view_count + 1")
      .bind(userId, animeId, new Date().toISOString()).run();
    await db.prepare("DELETE FROM yume_view_history WHERE user_id = ? AND anime_id NOT IN (SELECT anime_id FROM yume_view_history WHERE user_id = ? ORDER BY viewed_at DESC LIMIT 100)")
      .bind(userId, userId).run();
    return jsonResponse({ saved: true });
  } catch (error) {
    console.error("[YUME] Viewing history request failed:", error);
    return jsonResponse({ error: "history_unavailable" }, 503);
  }
}

/** Permanently removes the current account and all account-linked records. */
export async function handleTelegramAccountDelete(request: Request): Promise<Response> {
  if (request.method !== "DELETE") return jsonResponse({ error: "method_not_allowed" }, 405);
  if (!isSameOriginRequest(request)) return jsonResponse({ error: "cross_origin_request" }, 403);
  const env = environment();
  const db = database(env);
  const secret = sessionSecret(env);
  const token = readCookie(request, SESSION_COOKIE);
  if (!db || !secret) return jsonResponse({ error: "telegram_auth_not_configured" }, 503);
  if (!token) return jsonResponse({ error: "authentication_required" }, 401);
  try {
    await ensureSchema(db);
    await ensureBrowserAuthSchema(db);
    const tokenHash = await sessionTokenHash(token, secret);
    const session = await db.prepare("SELECT user_id, expires_at FROM yume_sessions WHERE token_hash = ?")
      .bind(tokenHash).first<AuthenticatedSessionRow>();
    if (!session || session.expires_at <= Date.now()) {
      await db.prepare("DELETE FROM yume_sessions WHERE token_hash = ?").bind(tokenHash).run();
      return jsonResponse({ error: "authentication_required" }, 401, [clearSessionCookie()]);
    }
    const userId = session.user_id;
    // Delete known account-owned tables explicitly as well as relying on FK cascades.
    await db.batch([
      db.prepare("DELETE FROM yume_notification_reads WHERE user_id = ?").bind(userId),
      db.prepare("DELETE FROM yume_notification_dismissals WHERE user_id = ?").bind(userId),
      db.prepare("DELETE FROM yume_view_history WHERE user_id = ?").bind(userId),
      db.prepare("DELETE FROM yume_saved_anime WHERE user_id = ?").bind(userId),
      db.prepare("DELETE FROM yume_sessions WHERE user_id = ?").bind(userId),
      db.prepare("DELETE FROM yume_users WHERE id = ?").bind(userId),
    ]);
    return jsonResponse({ deleted: true }, 200, [clearSessionCookie()]);
  } catch (error) {
    // A missing future table should not block account deletion; retry without history-table access.
    try {
      const tokenHash = await sessionTokenHash(token, secret);
      const session = await db.prepare("SELECT user_id, expires_at FROM yume_sessions WHERE token_hash = ?")
        .bind(tokenHash).first<AuthenticatedSessionRow>();
      if (!session || session.expires_at <= Date.now()) return jsonResponse({ error: "authentication_required" }, 401, [clearSessionCookie()]);
      await db.batch([
        db.prepare("DELETE FROM yume_notification_reads WHERE user_id = ?").bind(session.user_id),
        db.prepare("DELETE FROM yume_notification_dismissals WHERE user_id = ?").bind(session.user_id),
        db.prepare("DELETE FROM yume_saved_anime WHERE user_id = ?").bind(session.user_id),
        db.prepare("DELETE FROM yume_sessions WHERE user_id = ?").bind(session.user_id),
        db.prepare("DELETE FROM yume_users WHERE id = ?").bind(session.user_id),
      ]);
      return jsonResponse({ deleted: true }, 200, [clearSessionCookie()]);
    } catch (retryError) {
      console.error("[YUME] Account deletion failed:", retryError, error);
      return jsonResponse({ error: "account_deletion_failed" }, 503);
    }
  }
}

export async function handleTelegramSession(request: Request): Promise<Response> {
  if (request.method === "DELETE") {
    if (!isSameOriginRequest(request)) {
      return jsonResponse({ error: "cross_origin_request" }, 403);
    }
    const env = environment();
    const db = database(env);
    const token = readCookie(request, SESSION_COOKIE);
    const secret = sessionSecret(env);
    if (db && token && secret) {
      try {
        await db.prepare("DELETE FROM yume_sessions WHERE token_hash = ?").bind(await sessionTokenHash(token, secret)).run();
      } catch {
        return jsonResponse({ error: "session_unavailable" }, 503, [clearSessionCookie()]);
      }
    }
    return jsonResponse({ authenticated: false }, 200, [clearSessionCookie()]);
  }

  if (request.method === "GET") {
    const env = environment();
    const db = database(env);
    const token = readCookie(request, SESSION_COOKIE);
    const secret = sessionSecret(env);
    if (!db || !token) return jsonResponse({ authenticated: false }, 200);
    if (!secret) return jsonResponse({ error: "telegram_auth_not_configured" }, 503);
    try {
      await ensureSchema(db);
      const row = await db.prepare("SELECT u.id, u.telegram_user_id, u.telegram_first_name, u.telegram_last_name, u.telegram_username, u.telegram_language_code, s.expires_at FROM yume_sessions s JOIN yume_users u ON u.id = s.user_id WHERE s.token_hash = ?")
        .bind(await sessionTokenHash(token, secret)).first<SessionRow>();
      if (!row || row.expires_at <= Date.now()) {
        if (row) await db.prepare("DELETE FROM yume_sessions WHERE token_hash = ?").bind(await sessionTokenHash(token, secret)).run();
        return jsonResponse({ authenticated: false }, 200, [clearSessionCookie()]);
      }
      return jsonResponse({ authenticated: true, user: userPayload(row) });
    } catch {
      return jsonResponse({ error: "session_unavailable" }, 503);
    }
  }

  if (request.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);
  if (!isSameOriginRequest(request)) return jsonResponse({ error: "cross_origin_request" }, 403);
  let body: unknown;
  try {
    const raw = await request.text();
    if (raw.length > 20_480) return jsonResponse({ error: "request_too_large" }, 413);
    body = JSON.parse(raw);
  } catch {
    return jsonResponse({ error: "invalid_request" }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body) || typeof (body as Record<string, unknown>).initData !== "string") {
    return jsonResponse({ error: "invalid_request" }, 400);
  }

  const input = body as Record<string, unknown>;
  const authMode = input.mode;
  if (authMode !== "login" && authMode !== "register") {
    return jsonResponse({ error: "invalid_request" }, 400);
  }
  const env = environment();
  const botToken = typeof env.TELEGRAM_BOT_TOKEN === "string" ? env.TELEGRAM_BOT_TOKEN.trim() : "";
  const secret = sessionSecret(env);
  if (!botToken || !secret) return jsonResponse({ error: "telegram_auth_not_configured" }, 503);
  const validated = await validateTelegramInitData(input.initData as string, botToken);
  if (!validated.ok) return jsonResponse({ error: validated.error }, validated.error === "invalid_request" ? 400 : 401);

  const db = database(env);
  if (!db) return jsonResponse({ error: "auth_database_unavailable" }, 503);
  try {
    await ensureSchema(db);
    let user = await findTelegramUser(db, validated.user.id);
    if (authMode === "login" && !user) {
      return jsonResponse({ error: "account_not_found" }, 404);
    }
    if (authMode === "register" && user) {
      return jsonResponse({ error: "already_registered" }, 409);
    }
    if (authMode === "register" && input.privacyConsent !== true) {
      return jsonResponse({ error: "consent_required", user: { firstName: validated.user.firstName } }, 428);
    }
    if (authMode === "register" && input.termsAccepted !== true) {
      return jsonResponse({ error: "consent_required", user: { firstName: validated.user.firstName } }, 428);
    }
    if (!user) {
      user = await upsertTelegramUser(db, validated.user, {
        privacyConsent: authMode === "register" && input.privacyConsent === true,
        termsAccepted: authMode === "register" && input.termsAccepted === true,
      });
    } else {
      const profileValues = [
        validated.user.firstName,
        validated.user.lastName ?? null,
        validated.user.username ?? null,
        validated.user.languageCode ?? null,
      ] as const;
      await db.prepare("UPDATE yume_users SET telegram_first_name = ?, telegram_last_name = ?, telegram_username = ?, telegram_language_code = ? WHERE telegram_user_id = ? AND (telegram_first_name IS NOT ? OR telegram_last_name IS NOT ? OR telegram_username IS NOT ? OR telegram_language_code IS NOT ?)")
        .bind(...profileValues, String(validated.user.id), ...profileValues).run();
      // The existing row was already selected above; reuse the updated payload instead of issuing the same SELECT again.
      user = {
        ...user,
        telegram_first_name: validated.user.firstName,
        telegram_last_name: validated.user.lastName ?? null,
        telegram_username: validated.user.username ?? null,
        telegram_language_code: validated.user.languageCode ?? null,
      };
    }
    if (!user) throw new Error("TELEGRAM_USER_UPSERT_FAILED");
    const cookie = await createSession(db, user.id, secret);
    return jsonResponse({ authenticated: true, user: userPayload(user) }, 200, [cookie]);
  } catch (error) {
    console.error("[YUME] Telegram sign-in failed:", error);
    return jsonResponse({ error: "telegram_auth_failed" }, 500);
  }
}
