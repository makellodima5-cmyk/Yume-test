import { env as cloudflareEnv } from "cloudflare:workers";
import { USER_NOTIFICATIONS } from "@/data/notifications.shared";
import { cleanupFullyDismissedNotification } from "@/data/notification-cleanup.server";

type Environment = Record<string, unknown> & { YUME_DB?: unknown; YUME_AUTH_SESSION_SECRET?: string };
type Statement = {
  bind(...values: unknown[]): Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta?: { changes?: number } }>;
};
type Database = { prepare(sql: string): Statement; batch(statements: Statement[]): Promise<unknown[]> };
type RuntimeGlobal = typeof globalThis & { __YUME_RUNTIME_ENV__?: unknown };
type SessionRow = { user_id: string; expires_at: number };

const SESSION_COOKIE = "__Host-yume-session";

function environment(): Environment {
  try {
    const native = cloudflareEnv as unknown as Environment;
    if (native && typeof native === "object") return native;
  } catch {
    // Tests can inject a Worker-like environment.
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
  const origin = request.headers.get("origin");
  if (origin) {
    try { return new URL(origin).origin === new URL(request.url).origin; } catch { return false; }
  }
  const referer = request.headers.get("referer");
  if (referer) {
    try { return new URL(referer).origin === new URL(request.url).origin; } catch { return false; }
  }
  return request.headers.get("sec-fetch-site") === "same-origin";
}

async function authenticatedUserId(request: Request, db: Database, env: Environment): Promise<string | null> {
  const token = cookieValue(request, SESSION_COOKIE);
  const secret = typeof env.YUME_AUTH_SESSION_SECRET === "string" && env.YUME_AUTH_SESSION_SECRET.trim().length >= 32
    ? env.YUME_AUTH_SESSION_SECRET
    : "";
  if (!token || !secret) return null;
  const tokenHash = await sessionTokenHash(token, secret);
  const session = await db.prepare(
    "SELECT s.user_id, s.expires_at FROM yume_sessions s JOIN yume_users u ON u.id = s.user_id WHERE s.token_hash = ? AND u.provider = 'telegram'",
  ).bind(tokenHash).first<SessionRow>();
  if (!session || session.expires_at <= Date.now()) {
    if (session) await db.prepare("DELETE FROM yume_sessions WHERE token_hash = ?").bind(tokenHash).run();
    return null;
  }
  return session.user_id;
}


export async function handleNotifications(request: Request): Promise<Response> {
  if (request.method !== "GET" && request.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }
  if (request.method === "POST" && !sameOrigin(request)) {
    return json({ error: "cross_origin_request" }, 403);
  }

  const db = database(environment());
  if (!db) return json({ error: "database_unavailable" }, 503);

  try {
    const userId = await authenticatedUserId(request, db, environment());

    if (request.method === "GET") {
      if (!userId) return json({ error: "authentication_required", authenticated: false }, 401);
      const state = await readNotificationState(db, userId);
      // Schema is initialized once above; avoid repeating DDL for every notification poll.
      const dynamicRows = await db.prepare("SELECT n.id,n.title,n.body,n.target_url,n.created_at,r.read_at,r.dismissed_at FROM yume_notifications n LEFT JOIN yume_notification_reads_v2 r ON r.notification_id=n.id AND r.user_id=? WHERE n.active=1 AND (NOT EXISTS (SELECT 1 FROM yume_notification_targets t WHERE t.notification_id=n.id) OR EXISTS (SELECT 1 FROM yume_notification_targets t WHERE t.notification_id=n.id AND t.user_id=?)) ORDER BY n.created_at DESC LIMIT 100").bind(userId,userId).all<{id:string;title:string;body:string;target_url:string|null;created_at:string;read_at:string|null;dismissed_at:string|null}>();
      const dynamicNotifications = dynamicRows.results.map(n => ({ id:n.id, publishedAt:n.created_at, title:{ru:n.title,en:n.title}, description:{ru:n.body,en:n.body}, targetUrl:n.target_url, dynamic:true }));
      const dynamicReadIds = dynamicRows.results.filter(n => n.read_at).map(n => n.id);
      const dynamicDismissedIds = dynamicRows.results.filter(n => n.dismissed_at).map(n => n.id);
      return json({ notifications: [...dynamicNotifications, ...USER_NOTIFICATIONS], authenticated: true, readIds:[...state.readIds,...dynamicReadIds], dismissedIds:[...state.dismissedIds,...dynamicDismissedIds] });
    }

    if (!userId) return json({ error: "authentication_required", authenticated: false }, 401);
    let body: { action?: unknown; notificationId?: unknown };
    try {
      const raw = await request.text();
      if (raw.length > 2_048) return json({ error: "request_too_large" }, 413);
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return json({ error: "invalid_request" }, 400);
      body = parsed as { action?: unknown; notificationId?: unknown };
    } catch { return json({ error: "invalid_request" }, 400); }
    if (body.action === "read-one" || body.action === "dismiss-one") {
      const notificationId = typeof body.notificationId === "string" ? body.notificationId : "";
      const isStatic = USER_NOTIFICATIONS.some((notification) => notification.id === notificationId);
      const isDynamic = !isStatic && Boolean(await db.prepare("SELECT id FROM yume_notifications WHERE id=? AND active=1").bind(notificationId).first<{id:string}>());
      if (!isStatic && !isDynamic) return json({ error: "invalid_notification" }, 400);
      if (isDynamic) {
        if (body.action === "read-one") {
          await db.prepare("INSERT OR IGNORE INTO yume_notification_reads_v2(user_id,notification_id,read_at) VALUES(?,?,CURRENT_TIMESTAMP)").bind(userId,notificationId).run();
        } else {
          await db.prepare("INSERT INTO yume_notification_reads_v2(user_id,notification_id,read_at,dismissed_at) VALUES(?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT(user_id,notification_id) DO UPDATE SET dismissed_at=CURRENT_TIMESTAMP WHERE yume_notification_reads_v2.dismissed_at IS NULL").bind(userId,notificationId).run();
          await cleanupFullyDismissedNotification(db, notificationId);
        }
        return json({ ok:true, authenticated:true, ...(body.action === "read-one" ? {readId:notificationId} : {dismissedId:notificationId}) });
      }
      if (body.action === "read-one") {
        await db.prepare("INSERT OR IGNORE INTO yume_notification_reads (user_id, notification_id) VALUES (?, ?)").bind(userId, notificationId).run();
        return json({ ok: true, authenticated: true, readId: notificationId });
      }
      await db.prepare("INSERT OR IGNORE INTO yume_notification_dismissals (user_id, notification_id) VALUES (?, ?)").bind(userId, notificationId).run();
      return json({ ok: true, authenticated: true, dismissedId: notificationId });
    }
    if (body.action !== "read-all") return json({ error: "invalid_action" }, 400);

    if (USER_NOTIFICATIONS.length) {
      const placeholders = USER_NOTIFICATIONS.map(() => "(?, ?)").join(", ");
      const values = USER_NOTIFICATIONS.flatMap((notification) => [userId, notification.id]);
      await db.prepare("INSERT OR IGNORE INTO yume_notification_reads (user_id, notification_id) VALUES " + placeholders).bind(...values).run();
    }
    await db.prepare("INSERT OR IGNORE INTO yume_notification_reads_v2(user_id,notification_id) SELECT ?,n.id FROM yume_notifications n WHERE n.active=1 AND (NOT EXISTS (SELECT 1 FROM yume_notification_targets t WHERE t.notification_id=n.id) OR EXISTS (SELECT 1 FROM yume_notification_targets t WHERE t.notification_id=n.id AND t.user_id=?))").bind(userId,userId).run();
    const dynamicIds = await db.prepare("SELECT n.id FROM yume_notifications n WHERE n.active=1 AND (NOT EXISTS (SELECT 1 FROM yume_notification_targets t WHERE t.notification_id=n.id) OR EXISTS (SELECT 1 FROM yume_notification_targets t WHERE t.notification_id=n.id AND t.user_id=?))").bind(userId).all<{id:string}>();
    return json({ ok: true, authenticated: true, readIds: [...USER_NOTIFICATIONS.map((notification) => notification.id), ...dynamicIds.results.map(n=>n.id)] });
  } catch (error) {
    console.error("[YUME][NOTIFICATIONS] Request failed.", error);
    return json({ error: "notifications_unavailable" }, 503);
  }
}
