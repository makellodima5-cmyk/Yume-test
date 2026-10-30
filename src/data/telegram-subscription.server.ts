import { env as cloudflareEnv } from "cloudflare:workers";
import { validateTelegramInitData } from "@/data/telegram-init-data";

type SubscriptionEnvironment = Record<string, unknown> & {
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHANNEL_ID?: string;
};
type RuntimeGlobal = typeof globalThis & { __YUME_RUNTIME_ENV__?: unknown };

function environment(): SubscriptionEnvironment {
  try {
    const native = cloudflareEnv as unknown as SubscriptionEnvironment;
    if (native && typeof native === "object") return native;
  } catch {
    // Tests may inject an isolated runtime environment.
  }
  const injected = (globalThis as RuntimeGlobal).__YUME_RUNTIME_ENV__;
  return injected && typeof injected === "object" ? injected as SubscriptionEnvironment : {};
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function handleTelegramSubscriptionCheck(request: Request): Promise<Response> {
  if (request.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  const env = environment();
  const token = typeof env.TELEGRAM_BOT_TOKEN === "string" ? env.TELEGRAM_BOT_TOKEN.trim() : "";
  const channelId = typeof env.TELEGRAM_CHANNEL_ID === "string" && env.TELEGRAM_CHANNEL_ID.trim()
    ? env.TELEGRAM_CHANNEL_ID.trim()
    : "@yumeanime_news";
  if (!token) return json({ ok: false, error: "Subscription check is not configured" }, 503);

  let body: unknown;
  try {
    const raw = await request.text();
    if (raw.length > 20_000) return json({ ok: false, error: "Request too large" }, 413);
    body = JSON.parse(raw);
  } catch {
    return json({ ok: false, error: "Invalid JSON" }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body) || typeof (body as Record<string, unknown>).initData !== "string") {
    return json({ ok: false, error: "Missing Telegram initData" }, 400);
  }

  const validated = await validateTelegramInitData((body as { initData: string }).initData, token);
  if (!validated.ok) return json({ ok: false, error: "Invalid Telegram initData" }, 401);

  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/getChatMember`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(5_000),
      body: JSON.stringify({ chat_id: channelId, user_id: validated.user.id }),
    });
    const result: unknown = await response.json();
    if (!response.ok || !result || typeof result !== "object" || !("ok" in result) || (result as { ok?: unknown }).ok !== true || !("result" in result)) {
      console.error("[YUME][TELEGRAM_SUBSCRIPTION] getChatMember failed.", { status: response.status });
      return json({ ok: false, error: "Could not verify channel membership" }, 502);
    }
    const member = (result as { result?: unknown }).result;
    if (!member || typeof member !== "object" || !("status" in member)) {
      return json({ ok: false, error: "Invalid membership response" }, 502);
    }
    const status = (member as { status: unknown }).status;
    const isMember = status === "creator" || status === "administrator" || status === "member" ||
      (status === "restricted" && "is_member" in member && (member as { is_member?: unknown }).is_member === true);
    return json({ ok: true, subscribed: isMember });
  } catch (error) {
    console.error("[YUME][TELEGRAM_SUBSCRIPTION] Membership check failed.", {
      message: error instanceof Error ? error.message : String(error),
    });
    return json({ ok: false, error: "Telegram API request failed" }, 502);
  }
}
