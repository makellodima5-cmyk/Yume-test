import { env as cloudflareEnv } from "cloudflare:workers";
import { validateTelegramInitData, type TelegramValidatedUser } from "@/data/telegram-init-data";

type Environment = Record<string, unknown> & {
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_OIDC_CLIENT_ID?: string;
  TELEGRAM_OIDC_CLIENT_SECRET?: string;
  YUME_AUTH_SESSION_SECRET?: string;
  YUME_DB?: unknown;
};
type Statement = {
  bind(...values: unknown[]): Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<{ meta?: { changes?: number } }>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
};
type Database = { prepare(sql: string): Statement; batch(statements: Statement[]): Promise<unknown[]> };
type StateRow = { state_hash: string; nonce: string; verifier: string; flow: "login" | "register"; privacy_consent: number; terms_consent: number; expires_at: number };
type Claims = { iss?: unknown; aud?: unknown; azp?: unknown; exp?: unknown; iat?: unknown; nonce?: unknown; sub?: unknown; id?: unknown; name?: unknown; given_name?: unknown; family_name?: unknown; preferred_username?: unknown; picture?: unknown };
type Jwk = JsonWebKey & { kid?: string; alg?: string; use?: string };
const COOKIE = "__Host-yume-session";
const OIDC_STATE_COOKIE = "__Host-yume-oidc-state";
const TTL = 30 * 24 * 60 * 60;
const encoder = new TextEncoder();
type Runtime = typeof globalThis & { __YUME_RUNTIME_ENV__?: unknown };

function env(): Environment {
  try { const value = cloudflareEnv as unknown as Environment; if (value && typeof value === "object") return value; } catch { /* Local adapters and tests may not expose Cloudflare bindings. */ }
  const value = (globalThis as Runtime).__YUME_RUNTIME_ENV__;
  return value && typeof value === "object" ? value as Environment : {};
}
function dbFor(value: Environment): Database | null { return value.YUME_DB && typeof value.YUME_DB === "object" ? value.YUME_DB as Database : null; }
function secretFor(value: Environment): string | null { const s = value.YUME_AUTH_SESSION_SECRET; return typeof s === "string" && s.trim().length >= 32 ? s : null; }
function randomToken(size = 32): string {
  const bytes = new Uint8Array(size); crypto.getRandomValues(bytes);
  let binary = ""; for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function b64url(bytes: Uint8Array): string {
  let binary = ""; for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
async function digest(value: string): Promise<Uint8Array> { return new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))); }
async function keyedHash(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return Array.from(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value))), b => b.toString(16).padStart(2, "0")).join("");
}
function response(payload: unknown, status = 200, cookies: string[] = []): Response {
  const headers = new Headers({ "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" });
  cookies.forEach(value => headers.append("Set-Cookie", value));
  return new Response(JSON.stringify(payload), { status, headers });
}
function sessionCookie(token: string): string { return COOKIE + "=" + token + "; Path=/; Max-Age=" + TTL + "; HttpOnly; Secure; SameSite=Lax"; }
function oidcStateCookie(state: string): string { return OIDC_STATE_COOKIE + "=" + state + "; Path=/; Max-Age=600; HttpOnly; Secure; SameSite=Lax"; }
function clearOidcStateCookie(): string { return OIDC_STATE_COOKIE + "=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax"; }
function readCookie(request: Request, name: string): string | null {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const index = part.indexOf("=");
    if (index >= 0 && part.slice(0, index).trim() === name) return part.slice(index + 1).trim() || null;
  }
  return null;
}
async function createSession(db: Database, userId: string, secret: string): Promise<string> {
  const token = randomToken();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const hash = Array.from(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(token))), b => b.toString(16).padStart(2, "0")).join("");
  await db.prepare("DELETE FROM yume_sessions WHERE expires_at <= ?").bind(Date.now()).run();
  await db.prepare("INSERT INTO yume_sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)").bind(hash, userId, Date.now() + TTL * 1000).run();
  return sessionCookie(token);
}
async function ensureOidcStateTable(db: Database): Promise<void> {
  await db.prepare("CREATE TABLE IF NOT EXISTS yume_telegram_oidc_states (state_hash TEXT PRIMARY KEY NOT NULL, nonce TEXT NOT NULL, verifier TEXT NOT NULL, flow TEXT NOT NULL CHECK (flow IN ('login','register')), privacy_consent INTEGER NOT NULL CHECK (privacy_consent IN (0,1)), terms_consent INTEGER NOT NULL DEFAULT 0 CHECK (terms_consent IN (0,1)), expires_at INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)").run();
  const result = await db.prepare("PRAGMA table_info(yume_telegram_oidc_states)").all<{ name: string }>();
  if (!result.results.some((column) => column.name === "terms_consent")) {
    await db.prepare("ALTER TABLE yume_telegram_oidc_states ADD COLUMN terms_consent INTEGER NOT NULL DEFAULT 0 CHECK (terms_consent IN (0,1))").run();
  }
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_yume_telegram_oidc_states_expiry ON yume_telegram_oidc_states(expires_at)").run();
}
function redirect(url: URL, cookies: string[] = []): Response {
  const headers = new Headers({ Location: url.toString(), "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
  cookies.forEach(value => headers.append("Set-Cookie", value));
  return new Response(null, { status: 302, headers });
}
function errorRedirect(origin: string, code: string): Response {
  const url = new URL("/", origin); url.searchParams.set("section", "register"); url.searchParams.set("auth_error", code);
  return redirect(url, [clearOidcStateCookie()]);
}
async function verifyIdToken(token: string, clientId: string, nonce: string): Promise<Claims | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  let header: { alg?: string; kid?: string }; let claims: Claims;
  try {
    header = JSON.parse(atob(parts[0]!.replace(/-/g, "+").replace(/_/g, "/"))) as { alg?: string; kid?: string };
    claims = JSON.parse(atob(parts[1]!.replace(/-/g, "+").replace(/_/g, "/"))) as Claims;
  } catch { return null; }
  if (header.alg !== "RS256" || !header.kid) return null;
  const jwksResponse = await fetch("https://oauth.telegram.org/.well-known/jwks.json", { cache: "no-store", signal: AbortSignal.timeout(5_000) });
  if (!jwksResponse.ok) return null;
  const jwks = await jwksResponse.json() as { keys?: Jwk[] };
  const jwk = jwks.keys?.find(key => key.kid === header.kid && key.kty === "RSA" && (key.alg === undefined || key.alg === "RS256") && (key.use === undefined || key.use === "sig"));
  if (!jwk) return null;
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const signature = Uint8Array.from(atob(parts[2]!.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
  const validSignature = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signature, encoder.encode(parts[0] + "." + parts[1]));
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  const now = Math.floor(Date.now() / 1000);
  const multipleAudiences = aud.length > 1;
  if (!validSignature || claims.iss !== "https://oauth.telegram.org" || !aud.includes(clientId) ||
      (multipleAudiences && claims.azp !== clientId) || claims.nonce !== nonce ||
      typeof claims.exp !== "number" || claims.exp <= now ||
      typeof claims.iat !== "number" || claims.iat > now + 60 || now - claims.iat > 600) return null;
  return claims;
}

/** Official Telegram OpenID Connect authorization-code flow with PKCE. */
export async function handleTelegramOidc(request: Request): Promise<Response> {
  if (request.method !== "GET") return response({ error: "method_not_allowed" }, 405);
  const url = new URL(request.url);
  const origin = url.origin;
  const callback = url.pathname.endsWith("/callback");
  const environment = env();
  const db = dbFor(environment);
  const secret = secretFor(environment);
  const clientId = typeof environment.TELEGRAM_OIDC_CLIENT_ID === "string" ? environment.TELEGRAM_OIDC_CLIENT_ID.trim() : "";
  const clientSecret = typeof environment.TELEGRAM_OIDC_CLIENT_SECRET === "string" ? environment.TELEGRAM_OIDC_CLIENT_SECRET.trim() : "";
  if (!db || !secret || !clientId || !clientSecret) return callback ? errorRedirect(origin, "telegram_login_not_configured") : response({ error: "telegram_login_not_configured" }, 503);
  const redirectUri = origin + "/api/telegram/oidc/callback";
  try {
    await db.prepare("CREATE TABLE IF NOT EXISTS yume_users (id TEXT PRIMARY KEY NOT NULL, provider TEXT NOT NULL CHECK (provider = 'telegram'), provider_user_id TEXT NOT NULL, telegram_user_id TEXT UNIQUE, telegram_first_name TEXT, telegram_last_name TEXT, telegram_username TEXT, telegram_language_code TEXT, privacy_consent_at TEXT NOT NULL, privacy_policy_version TEXT NOT NULL, terms_agreed_at TEXT, terms_version TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE (provider, provider_user_id))").run();
    await db.prepare("CREATE TABLE IF NOT EXISTS yume_sessions (token_hash TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL REFERENCES yume_users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)").run();
    await ensureOidcStateTable(db);
    if (!callback) {
      const flow = url.searchParams.get("flow");
      const consent = url.searchParams.get("consent") === "1";
      const termsConsent = url.searchParams.get("terms") === "1";
      if ((flow !== "login" && flow !== "register") || (flow === "register" && (!consent || !termsConsent))) return response({ error: flow === "register" ? "consent_required" : "invalid_request" }, 400);
      await db.prepare("DELETE FROM yume_telegram_oidc_states WHERE expires_at <= ?").bind(Date.now()).run();
      const state = randomToken(); const nonce = randomToken(); const verifier = randomToken(48);
      const stateHash = await keyedHash(state, secret);
      await db.prepare("INSERT INTO yume_telegram_oidc_states (state_hash, nonce, verifier, flow, privacy_consent, terms_consent, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .bind(stateHash, nonce, verifier, flow, consent ? 1 : 0, termsConsent ? 1 : 0, Date.now() + 10 * 60 * 1000).run();
      const challenge = b64url(await digest(verifier));
      const auth = new URL("https://oauth.telegram.org/auth");
      auth.searchParams.set("client_id", clientId);
      auth.searchParams.set("redirect_uri", redirectUri);
      auth.searchParams.set("response_type", "code");
      auth.searchParams.set("scope", "openid profile");
      auth.searchParams.set("state", state);
      auth.searchParams.set("nonce", nonce);
      auth.searchParams.set("code_challenge", challenge);
      auth.searchParams.set("code_challenge_method", "S256");
      return redirect(auth, [oidcStateCookie(state)]);
    }
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (!code || !state || code.length > 4096 || state.length > 256) return errorRedirect(origin, "telegram_login_cancelled");
    if (readCookie(request, OIDC_STATE_COOKIE) !== state) return errorRedirect(origin, "telegram_login_state_mismatch");
    const stateHash = await keyedHash(state, secret);
    const pending = await db.prepare("SELECT state_hash, nonce, verifier, flow, privacy_consent, terms_consent, expires_at FROM yume_telegram_oidc_states WHERE state_hash = ?")
      .bind(stateHash).first<StateRow>();
    if (!pending || pending.expires_at <= Date.now()) return errorRedirect(origin, "telegram_login_expired");
    await db.prepare("DELETE FROM yume_telegram_oidc_states WHERE state_hash = ?").bind(stateHash).run();
    const tokenResponse = await fetch("https://oauth.telegram.org/token", {
      method: "POST", cache: "no-store",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: "Basic " + btoa(clientId + ":" + clientSecret) },
      body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri, client_id: clientId, code_verifier: pending.verifier }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!tokenResponse.ok) return errorRedirect(origin, "telegram_login_failed");
    const tokenPayload = await tokenResponse.json() as { id_token?: unknown };
    if (typeof tokenPayload.id_token !== "string") return errorRedirect(origin, "telegram_login_failed");
    const claims = await verifyIdToken(tokenPayload.id_token, clientId, pending.nonce);
    if (!claims) return errorRedirect(origin, "telegram_token_invalid");
    const rawId = claims.id ?? claims.sub;
    const telegramId = typeof rawId === "number" && Number.isSafeInteger(rawId) ? String(rawId) : typeof rawId === "string" && /^\d{1,24}$/.test(rawId) ? rawId : "";
    if (!telegramId) return errorRedirect(origin, "telegram_profile_missing");
    const existing = await db.prepare("SELECT id FROM yume_users WHERE telegram_user_id = ?").bind(telegramId).first<{ id: string }>();
    if (pending.flow === "login" && !existing) return errorRedirect(origin, "account_not_found");
    if (pending.flow === "register" && existing) return errorRedirect(origin, "already_registered");
    if (pending.flow === "register" && (pending.privacy_consent !== 1 || pending.terms_consent !== 1)) return errorRedirect(origin, "consent_required");
    const fullName = typeof claims.name === "string" ? claims.name.trim() : "";
    const firstName = typeof claims.given_name === "string" ? claims.given_name.trim() : fullName.split(/\s+/)[0] || "Telegram user";
    const lastName = typeof claims.family_name === "string" ? claims.family_name.trim() : fullName.split(/\s+/).slice(1).join(" ") || null;
    const username = typeof claims.preferred_username === "string" ? claims.preferred_username.replace(/^@/, "").slice(0, 64) || null : null;
    const now = new Date().toISOString();
    let userId = existing?.id;
    if (!userId) {
      userId = crypto.randomUUID();
      await db.prepare("INSERT INTO yume_users (id, provider, provider_user_id, telegram_user_id, telegram_first_name, telegram_last_name, telegram_username, telegram_language_code, privacy_consent_at, privacy_policy_version, terms_agreed_at, terms_version) VALUES (?, 'telegram', ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)")
        .bind(userId, telegramId, telegramId, firstName, lastName, username, now, "2026-10-24", now, "2026-10-24").run();
    } else {
      await db.prepare("UPDATE yume_users SET telegram_first_name = ?, telegram_last_name = ?, telegram_username = ? WHERE id = ?")
        .bind(firstName, lastName, username, userId).run();
    }
    const cookie = await createSession(db, userId, secret);
    const success = new URL("/", origin);
    success.searchParams.set("section", "profile");
    success.searchParams.set("auth", "success");
    return redirect(success, [cookie, clearOidcStateCookie()]);
  } catch (error) {
    console.error("[YUME][TELEGRAM_OIDC] Authentication failed:", error);
    return errorRedirect(origin, "telegram_login_failed");
  }
}
