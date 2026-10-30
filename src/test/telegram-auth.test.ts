import { describe, expect, it } from "vitest";
import { env as cloudflareEnv } from "cloudflare:workers";
import { handleTelegramBrowserAuth, handleTelegramSession } from "@/data/telegram-auth.server";
import { validateTelegramInitData } from "@/data/telegram-init-data";

const BOT_TOKEN = "test-bot-token-for-signature-tests";

async function signInitData(fields: Record<string, string>, token = BOT_TOKEN): Promise<string> {
  const checkString = Object.entries(fields)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, value]) => key + "=" + value)
    .join("\n");
  const encoder = new TextEncoder();
  const secretKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode("WebAppData"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const secret = await crypto.subtle.sign("HMAC", secretKey, encoder.encode(token));
  const signingKey = await crypto.subtle.importKey(
    "raw",
    secret,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", signingKey, encoder.encode(checkString));
  const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return new URLSearchParams({ ...fields, hash }).toString();
}

type TestUserRow = {
  id: string;
  telegram_user_id: string;
  telegram_first_name: string;
  telegram_last_name: string | null;
  telegram_username: string | null;
  telegram_language_code: string | null;
};

class FakeTelegramStatement {
  private values: unknown[] = [];

  constructor(private readonly db: FakeTelegramDb, private readonly sql: string) {}

  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    if (this.sql.includes("FROM sqlite_master")) {
      return { sql: "CREATE TABLE yume_users (telegram_user_id TEXT UNIQUE)" } as T;
    }
    if (this.sql.includes("FROM yume_users WHERE telegram_user_id = ?")) {
      return this.db.user as T;
    }
    return null;
  }

  async run(): Promise<{ meta: { changes: number } }> {
    const expected = (this.sql.match(/\?/g) ?? []).length;
    if (expected !== this.values.length) {
      throw new Error(`D1 binding mismatch: SQL expects ${expected}, received ${this.values.length}`);
    }
    this.db.executed.push({ sql: this.sql, values: this.values });
    return { meta: { changes: 1 } };
  }

  async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
    return { results: [] };
  }
}

class FakeTelegramDb {
  readonly user: TestUserRow = {
    id: "yume-user-test",
    telegram_user_id: "12345",
    telegram_first_name: "Old name",
    telegram_last_name: null,
    telegram_username: "yume_test",
    telegram_language_code: "ru",
  };
  readonly executed: Array<{ sql: string; values: unknown[] }> = [];

  prepare(sql: string) {
    return new FakeTelegramStatement(this, sql);
  }

  async batch(_statements: unknown[]): Promise<unknown[]> {
    return [];
  }
}

describe("Telegram Mini App initData validation", () => {
  it("accepts correctly signed, recent initData and returns parsed user data", async () => {
    const now = Date.now();
    const initData = await signInitData({
      auth_date: String(Math.floor(now / 1000)),
      query_id: "AAE-test-query",
      user: JSON.stringify({ id: 12345, first_name: "Yume", username: "yume_test" }),
    });

    const result = await validateTelegramInitData(initData, BOT_TOKEN, now);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.user.id).toBe(12345);
      expect(result.user.firstName).toBe("Yume");
      expect(result.user.username).toBe("yume_test");
    }
  });

  it("rejects tampered initData", async () => {
    const now = Date.now();
    const initData = await signInitData({
      auth_date: String(Math.floor(now / 1000)),
      user: JSON.stringify({ id: 12345, first_name: "Yume" }),
    });
    const tampered = initData.replace("Yume", "Attacker");

    const result = await validateTelegramInitData(tampered, BOT_TOKEN, now);

    expect(result).toEqual({ ok: false, error: "invalid_signature" });
  });

  it("rejects stale initData", async () => {
    const now = Date.now();
    const initData = await signInitData({
      auth_date: String(Math.floor(now / 1000) - 600),
      user: JSON.stringify({ id: 12345, first_name: "Yume" }),
    });

    const result = await validateTelegramInitData(initData, BOT_TOKEN, now);

    expect(result).toEqual({ ok: false, error: "auth_data_expired" });
  });

  it("allows an existing Telegram account to sign in with the protected session token", async () => {
    const db = new FakeTelegramDb();
    const now = Date.now();
    const initData = await signInitData({
      auth_date: String(Math.floor(now / 1000)),
      user: JSON.stringify({ id: 12345, first_name: "Yume", username: "yume_test", language_code: "ru" }),
    });
    const sessionSecret = "test-session-secret-with-at-least-32-characters";
    Object.assign(cloudflareEnv, {
      YUME_DB: db,
      TELEGRAM_BOT_TOKEN: BOT_TOKEN,
      YUME_AUTH_SESSION_SECRET: sessionSecret,
    });

    try {
      const response = await handleTelegramSession(new Request("https://yume.test/api/telegram/init-data", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "https://yume.test" },
        body: JSON.stringify({ initData, mode: "login", privacyConsent: false }),
      }));
      const payload = await response.json() as { authenticated?: boolean; user?: { id?: string } };

      expect(response.status).toBe(200);
      expect(payload.authenticated).toBe(true);
      expect(payload.user?.id).toBe("yume-user-test");
      expect(response.headers.get("set-cookie")).toContain("__Host-yume-session=");
      expect(db.executed.some((statement) =>
        statement.sql.includes("UPDATE yume_users") && statement.values.length === 9,
      )).toBe(true);
    } finally {
      delete cloudflareEnv.YUME_DB;
      delete cloudflareEnv.TELEGRAM_BOT_TOKEN;
      delete cloudflareEnv.YUME_AUTH_SESSION_SECRET;
    }
  });

  it("rejects cross-origin session creation before parsing initData", async () => {
    const response = await handleTelegramSession(new Request("https://yume.test/api/telegram/init-data", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://attacker.test" },
      body: "{not-json",
    }));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "cross_origin_request" });
  });

  it("rejects session creation when browser origin signals are absent", async () => {
    const response = await handleTelegramSession(new Request("https://yume.test/api/telegram/init-data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not-json",
    }));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "cross_origin_request" });
  });

  it("rejects missing or malformed user identity", async () => {
    const now = Date.now();
    const initData = await signInitData({
      auth_date: String(Math.floor(now / 1000)),
      user: JSON.stringify({ first_name: "No numeric id" }),
    });

    const result = await validateTelegramInitData(initData, BOT_TOKEN, now);

    expect(result).toEqual({ ok: false, error: "invalid_user" });
  });
});


describe("Telegram browser-auth polling CSRF protection", () => {
  it("rejects a cross-site polling URL before touching auth state", async () => {
    const response = await handleTelegramBrowserAuth(new Request(
      "https://yume.test/api/telegram/browser-auth?id=" + "A".repeat(40),
      {
        method: "GET",
        headers: {
          "Referer": "https://attacker.test/",
          "Sec-Fetch-Site": "cross-site",
        },
      },
    ));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "cross_origin_request" });
  });

  it("rejects browser-auth polling when browser origin signals are absent", async () => {
    const response = await handleTelegramBrowserAuth(new Request(
      "https://yume.test/api/telegram/browser-auth?id=" + "A".repeat(40),
      { method: "GET" },
    ));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "cross_origin_request" });
  });
});

describe("Telegram session logout CSRF protection", () => {
  it("rejects cross-origin logout requests", async () => {
    const response = await handleTelegramSession(new Request("https://yume.test/api/telegram/init-data", {
      method: "DELETE",
      headers: { Origin: "https://attacker.test" },
    }));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "cross_origin_request" });
  });
});

describe("registration consent integrity", () => {
  it("rejects browser registration unless both policy and user-agreement consent are explicit", async () => {
    const db = new FakeTelegramDb();
    const sessionSecret = "test-session-secret-with-at-least-32-characters";
    Object.assign(cloudflareEnv, {
      YUME_DB: db,
      TELEGRAM_BOT_TOKEN: BOT_TOKEN,
      YUME_AUTH_SESSION_SECRET: sessionSecret,
    });

    try {
      const response = await handleTelegramBrowserAuth(new Request("https://yume.test/api/telegram/browser-auth", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://yume.test",
          "Sec-Fetch-Site": "same-origin",
        },
        body: JSON.stringify({ flow: "register", privacyConsent: true }),
      }));

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "consent_required" });
      expect(db.executed.some((statement) => statement.sql.includes("INSERT INTO yume_browser_auth"))).toBe(false);
    } finally {
      delete cloudflareEnv.YUME_DB;
      delete cloudflareEnv.TELEGRAM_BOT_TOKEN;
      delete cloudflareEnv.YUME_AUTH_SESSION_SECRET;
    }
  });
});

