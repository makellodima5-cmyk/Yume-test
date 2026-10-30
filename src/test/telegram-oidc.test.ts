import { afterEach, describe, expect, it } from "vitest";
import { env as cloudflareEnv } from "cloudflare:workers";
import { handleTelegramOidc } from "@/data/telegram-oidc.server";

const runtimeEnv = cloudflareEnv as unknown as Record<string, unknown>;

class FakeStatement {
  bind(..._values: unknown[]) { return this; }
  async run() { return { meta: { changes: 1 } }; }
  async first<T = Record<string, unknown>>(): Promise<T | null> { return null; }
  async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> { return { results: [] }; }
}
class FakeDb {
  prepare(_sql: string) { return new FakeStatement(); }
  async batch(_statements: unknown[]) { return []; }
}

afterEach(() => {
  delete runtimeEnv.YUME_DB;
  delete runtimeEnv.YUME_AUTH_SESSION_SECRET;
  delete runtimeEnv.TELEGRAM_OIDC_CLIENT_ID;
  delete runtimeEnv.TELEGRAM_OIDC_CLIENT_SECRET;
});

describe("Telegram OIDC browser binding", () => {
  it("rejects a callback without the browser-bound state cookie", async () => {
    Object.assign(runtimeEnv, {
      YUME_DB: new FakeDb(),
      YUME_AUTH_SESSION_SECRET: "test-session-secret-with-at-least-32-characters",
      TELEGRAM_OIDC_CLIENT_ID: "test-client-id",
      TELEGRAM_OIDC_CLIENT_SECRET: "test-client-secret",
    });

    const response = await handleTelegramOidc(new Request(
      "https://yume.test/api/telegram/oidc/callback?code=attacker-code&state=attacker-state",
    ));

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toContain("telegram_login_state_mismatch");
    expect(response.headers.get("set-cookie")).toContain("__Host-yume-oidc-state=;");
  });

  it("requires an explicit user-agreement choice before starting registration", async () => {
    Object.assign(runtimeEnv, {
      YUME_DB: new FakeDb(),
      YUME_AUTH_SESSION_SECRET: "test-session-secret-with-at-least-32-characters",
      TELEGRAM_OIDC_CLIENT_ID: "test-client-id",
      TELEGRAM_OIDC_CLIENT_SECRET: "test-client-secret",
    });

    const response = await handleTelegramOidc(new Request(
      "https://yume.test/api/telegram/oidc?flow=register&consent=1",
    ));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "consent_required" });
  });
});
