import { env as cloudflareEnv } from "cloudflare:workers";
import { completeTelegramBrowserAuth, confirmTelegramBrowserAuth } from "@/data/telegram-auth.server";

type TelegramEnvironment = Record<string, unknown> & {
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  TELEGRAM_CHANNEL_ID?: string;
  YUME_DB?: unknown;
};
type TelegramUser = {
  id?: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
};
type TelegramUpdate = {
  message?: { text?: string; chat?: { id?: number }; from?: TelegramUser };
  chat_member?: { chat?: { id?: number }; from?: TelegramUser; old_chat_member?: { status?: string }; new_chat_member?: { status?: string; user?: TelegramUser } };
  callback_query?: {
    id?: string;
    data?: string;
    from?: TelegramUser;
    message?: { message_id?: number; chat?: { id?: number } };
  };
};
type RuntimeGlobal = typeof globalThis & { __YUME_RUNTIME_ENV__?: unknown };

const SITE_URL = "https://yume-website.yumesupport833.workers.dev";
const PLAYER_HELP_CALLBACK = "yume_player_help";
const CHECK_SUBSCRIPTION_CALLBACK = "yume_check_subscription";
const CHANNEL_URL = "https://t.me/yumeanime_news";
const FIRST_GATE_MESSAGE = "👀 Кажется, ты на шаг от входа в YUME!\n\nОсталось только подписаться на наш канал. Не переживай, это не квест на 100 серий 😏 Зато будешь в курсе новостей и обновлений проекта.\n\nПодписывайся и заходи! 💜";
const RETURN_GATE_MESSAGE = "👀 Опа, кажется, ты немного поторопился с выходом из нашего канала!\n\nБез подписки доступ к YUME закрывается 😢 Но не переживай, никто не отбирает у тебя любимое аниме навсегда.\n\nВозвращайся в канал, подписывайся, и мы снова откроем тебе двери! 💜\n\nА то как же мы без тебя? 😏";
const RESTORED_MESSAGE = "👀 О, явился! Решил, что без YUME жизнь слишком скучная?\n\n🔓 Доступ восстановлен! Возвращайся к аниме, пока мы не добавили тебе арку возвращения 🍿💜";

function originalWelcomeMessage(firstName?: string): string {
  const safeFirstName = (firstName?.trim() || "друг")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  return [
    `<b>🌙 Привет, ${safeFirstName}! Добро пожаловать в YUME.</b>`,
    "",
    "Знаешь, иногда одна история может изменить всё.",
    "",
    "<i>Включаешь аниме просто на вечер — и вдруг ловишь себя на том, что переживаешь за героев, не замечаешь, как наступает рассвет, и ещё долго не можешь отпустить эту историю после финальных титров…</i>",
    "",
    "💜 <b>Именно для таких моментов и существует YUME.</b>",
    "",
    "Я хочу, чтобы здесь ты находил не просто аниме, а истории, которые попадают прямо в сердце.",
    "",
    "✨ Открывай новые миры.",
    "🌸 Находи аниме под своё настроение.",
    "🎬 Возвращайся к историям, которые запали в душу.",
    "",
    "И знаешь что? Тебе совсем не обязательно заранее знать, что искать. Просто следуй за своим интересом. Возможно, совсем скоро ты найдёшь здесь своё новое любимое аниме.",
    "",
    "━━━━━━━━━━━━━━",
    "",
    `🌌 <b>Ну что, ${safeFirstName}, готов найти свою следующую историю?</b>`,
    "",
    "Нажимай на кнопку ниже — и давай начнём ✨",
    "",
    "<b>🔗 Не работает плеер?</b>"
  ].join("\n");
}
const PLAYER_HELP_MESSAGE = `<b>🛠 Не работает плеер?</b>

Если у тебя не открывается плеер или мини-приложение, попробуй следующие шаги:

<b>1. Открой YUME в браузере</b>
Иногда доступ через Telegram может быть ограничен. Попробуй открыть сайт в обычном браузере.

<b>2. Попробуй отключить VPN</b>
Некоторые VPN могут мешать загрузке сайта или видеоплеера. Временно отключи VPN и обнови страницу.

<b>3. Обнови страницу</b>
Если сайт или плеер не загрузился, обнови страницу или открой её заново.

<b>4. Попробуй другой браузер</b>
Если проблема осталась, проверь сайт в Safari, Chrome или Firefox.

💡 Если после этого плеер всё ещё не работает, доступ к сайту или плееру может быть ограничен в твоей сети или регионе.`;

function environment(): TelegramEnvironment {
  try {
    const native = cloudflareEnv as unknown as TelegramEnvironment;
    if (native && typeof native === "object") return native;
  } catch {
    // Tests may inject an isolated runtime environment.
  }
  const injected = (globalThis as RuntimeGlobal).__YUME_RUNTIME_ENV__;
  return injected && typeof injected === "object" ? injected as TelegramEnvironment : {};
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

async function answerCallback(token: string, callbackId: string, text?: string): Promise<void> {
  const payload: Record<string, unknown> = { callback_query_id: callbackId };
  if (text) payload.text = text;
  const response = await telegramApi(token, "answerCallbackQuery", payload);
  if (!response.ok) {
    const responseText = (await response.text()).slice(0, 500);
    console.warn("[YUME][TELEGRAM_BOT] Telegram answerCallbackQuery failed; continuing webhook processing.", {
      status: response.status, response: responseText,
    });
  }
}

async function telegramApi(token: string, method: string, payload: Record<string, unknown>): Promise<Response> {
  return fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(5_000),
    body: JSON.stringify(payload),
  });
}

type SubscriptionState = { telegram_user_id: string; chat_id: string; message_id: number | null; had_access: number; awaiting_resubscribe: number };
type TelegramDb = { prepare(sql: string): { bind(...values: unknown[]): { first<T = Record<string, unknown>>(): Promise<T | null>; run(): Promise<unknown> } } };

function subscriptionDb(env: TelegramEnvironment): TelegramDb | null {
  return env.YUME_DB && typeof env.YUME_DB === "object" ? env.YUME_DB as TelegramDb : null;
}

async function getSubscriptionState(db: TelegramDb | null, userId: number): Promise<SubscriptionState | null> {
  if (!db) return null;
  await db.prepare("CREATE TABLE IF NOT EXISTS yume_telegram_subscription_state (telegram_user_id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, message_id INTEGER, had_access INTEGER NOT NULL DEFAULT 0, awaiting_resubscribe INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)").bind().run();
  return db.prepare("SELECT telegram_user_id, chat_id, message_id, had_access, awaiting_resubscribe FROM yume_telegram_subscription_state WHERE telegram_user_id = ?").bind(String(userId)).first<SubscriptionState>();
}

async function saveSubscriptionState(db: TelegramDb | null, userId: number, chatId: number, messageId: number | null, hadAccess: boolean, awaiting: boolean): Promise<void> {
  if (!db) return;
  await db.prepare("CREATE TABLE IF NOT EXISTS yume_telegram_subscription_state (telegram_user_id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, message_id INTEGER, had_access INTEGER NOT NULL DEFAULT 0, awaiting_resubscribe INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)").bind().run();
  await db.prepare("INSERT INTO yume_telegram_subscription_state (telegram_user_id, chat_id, message_id, had_access, awaiting_resubscribe, updated_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(telegram_user_id) DO UPDATE SET chat_id = excluded.chat_id, message_id = excluded.message_id, had_access = excluded.had_access, awaiting_resubscribe = excluded.awaiting_resubscribe, updated_at = CURRENT_TIMESTAMP")
    .bind(String(userId), String(chatId), messageId, hadAccess ? 1 : 0, awaiting ? 1 : 0).run();
}

async function isChannelMember(token: string, env: TelegramEnvironment, userId: number): Promise<boolean | null> {
  const channelId = typeof env.TELEGRAM_CHANNEL_ID === "string" && env.TELEGRAM_CHANNEL_ID.trim() ? env.TELEGRAM_CHANNEL_ID.trim() : "@yumeanime_news";
  try {
    const response = await telegramApi(token, "getChatMember", { chat_id: channelId, user_id: userId });
    const payload = await response.json() as { ok?: boolean; result?: { status?: string; is_member?: boolean } };
    if (!response.ok || payload.ok !== true || !payload.result?.status) return null;
    return ["creator", "administrator", "member"].includes(payload.result.status) ||
      (payload.result.status === "restricted" && payload.result.is_member === true);
  } catch {
    return null;
  }
}

function gateKeyboard(): Record<string, unknown> {
  return { inline_keyboard: [
    [{ text: "😏 Ладно, подписываюсь", url: CHANNEL_URL }],
    [{ text: "🔎 Проверить подписку", callback_data: CHECK_SUBSCRIPTION_CALLBACK }],
  ] };
}

function returnGateKeyboard(): Record<string, unknown> {
  return { inline_keyboard: [
    [{ text: "😏 Подписаться на канал", url: CHANNEL_URL }],
    [{ text: "🔎 Проверить подписку", callback_data: CHECK_SUBSCRIPTION_CALLBACK }],
  ] };
}

function welcomeKeyboard(): Record<string, unknown> {
  return { inline_keyboard: [
    [{ text: "🎬 Открыть YUME", web_app: { url: SITE_URL } }],
    [{ text: "🛠 Не работает плеер?", callback_data: PLAYER_HELP_CALLBACK }],
  ] };
}

export async function handleTelegramWebhook(request: Request): Promise<Response> {
  if (request.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  const env = environment();
  const token = typeof env.TELEGRAM_BOT_TOKEN === "string" ? env.TELEGRAM_BOT_TOKEN.trim() : "";
  const secret = typeof env.TELEGRAM_WEBHOOK_SECRET === "string" ? env.TELEGRAM_WEBHOOK_SECRET.trim() : "";
  if (!token || !secret) {
    console.error("[YUME][TELEGRAM_BOT] Missing TELEGRAM_BOT_TOKEN or TELEGRAM_WEBHOOK_SECRET.");
    return json({ ok: false, error: "Webhook is not configured" }, 503);
  }
  if (request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== secret) {
    console.warn("[YUME][TELEGRAM_BOT] Rejected webhook request: secret token mismatch.");
    return json({ ok: false, error: "Unauthorized" }, 401);
  }

  let update: TelegramUpdate;
  try {
    const raw = await request.text();
    if (raw.length > 65_536) return json({ ok: false, error: "Request too large" }, 413);
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return json({ ok: false, error: "Invalid update" }, 400);
    update = parsed as TelegramUpdate;
  } catch {
    return json({ ok: false, error: "Invalid JSON" }, 400);
  }

  const callback = update.callback_query;
  if (callback) {
    if ((callback.data !== PLAYER_HELP_CALLBACK && callback.data !== CHECK_SUBSCRIPTION_CALLBACK) || typeof callback.id !== "string" ||
      typeof callback.message?.message_id !== "number" || !Number.isSafeInteger(callback.message.message_id) ||
      typeof callback.message.chat?.id !== "number" || !Number.isSafeInteger(callback.message.chat.id)) {
      return json({ ok: true, ignored: true });
    }
    try {
      const callbackUserId = callback.from?.id;
      if (typeof callbackUserId !== "number" || !Number.isSafeInteger(callbackUserId)) return json({ ok: true, ignored: true });
      const db = subscriptionDb(env);
      const state = await getSubscriptionState(db, callbackUserId);
      const subscribed = await isChannelMember(token, env, callbackUserId);
      if (subscribed === null) {
        await answerCallback(token, callback.id, "Не удалось проверить подписку. Попробуй ещё раз чуть позже.");
        return json({ ok: true, action: "subscription_check_failed" });
      }
      if (!subscribed) {
        await answerCallback(token, callback.id, "Ты ещё не подписан на канал YUME. Подпишись, затем нажми «Проверить подписку».");
        const gateText = state?.had_access ? RETURN_GATE_MESSAGE : FIRST_GATE_MESSAGE;
        const gateResponse = await telegramApi(token, "editMessageText", {
          chat_id: callback.message.chat.id, message_id: callback.message.message_id,
          text: gateText, reply_markup: state?.had_access ? returnGateKeyboard() : gateKeyboard(),
        });
        if (!gateResponse.ok) {
          const responseText = (await gateResponse.text()).slice(0, 500);
          if (!responseText.toLowerCase().includes("message is not modified")) {
            console.error("[YUME][TELEGRAM_BOT] Telegram subscription gate edit failed.", {
              status: gateResponse.status, response: responseText,
            });
            return json({ ok: false, error: "Could not update subscription gate" }, gateResponse.status >= 500 ? 502 : 200);
          }
        }
        await saveSubscriptionState(db, callbackUserId, callback.message.chat.id, callback.message.message_id, Boolean(state?.had_access), Boolean(state?.had_access));
        return json({ ok: true, action: "subscription_required" });
      }
      await answerCallback(token, callback.id);
      if (callback.data === CHECK_SUBSCRIPTION_CALLBACK) {
        if (state?.awaiting_resubscribe) {
          const restoredResponse = await telegramApi(token, "sendMessage", {
            chat_id: callback.message.chat.id,
            text: RESTORED_MESSAGE,
            reply_markup: welcomeKeyboard(),
          });
          if (!restoredResponse.ok) {
            const responseText = (await restoredResponse.text()).slice(0, 500);
            console.error("[YUME][TELEGRAM_BOT] Telegram manual restored-access message send failed.", {
              status: restoredResponse.status, response: responseText,
            });
            return json({ ok: false, error: "Could not send restored access message" }, restoredResponse.status >= 500 ? 502 : 200);
          }
          const sent = await restoredResponse.json() as { result?: { message_id?: number } };
          const restoredMessageId = sent.result?.message_id;
          if (typeof restoredMessageId !== "number" || !Number.isSafeInteger(restoredMessageId)) {
            console.error("[YUME][TELEGRAM_BOT] Telegram manual restored-access response had no message_id.");
            return json({ ok: false, error: "Restored access message ID missing" }, 502);
          }
          const deleteResponse = await telegramApi(token, "deleteMessage", {
            chat_id: callback.message.chat.id, message_id: callback.message.message_id,
          });
          if (!deleteResponse.ok) {
            console.warn("[YUME][TELEGRAM_BOT] Could not delete the previous subscription gate after manual check.", {
              status: deleteResponse.status, response: (await deleteResponse.text()).slice(0, 500),
            });
          }
          await saveSubscriptionState(db, callbackUserId, callback.message.chat.id, restoredMessageId, true, false);
          return json({ ok: true, action: "subscription_restored_manually" });
        }
        const response = await telegramApi(token, "editMessageText", {
          chat_id: callback.message.chat.id, message_id: callback.message.message_id,
          text: originalWelcomeMessage(callback.from?.first_name),
          parse_mode: "HTML",
          reply_markup: welcomeKeyboard(),
        });
        if (!response.ok) {
          const responseText = (await response.text()).slice(0, 500);
          if (!responseText.toLowerCase().includes("message is not modified")) {
            console.error("[YUME][TELEGRAM_BOT] Telegram welcome message edit failed.", {
              status: response.status, response: responseText,
            });
            return json({ ok: false, error: "Could not update welcome message" }, response.status >= 500 ? 502 : 200);
          }
        }
        await saveSubscriptionState(db, callbackUserId, callback.message.chat.id, callback.message.message_id, true, false);
        return json({ ok: true, action: "subscription_confirmed" });
      }
      const response = await telegramApi(token, "editMessageText", {
        chat_id: callback.message.chat.id,
        message_id: callback.message.message_id,
        text: PLAYER_HELP_MESSAGE,
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: [[{ text: "🌐 Открыть YUME в браузере", url: SITE_URL }]] },
      });
      if (!response.ok) {
        const responseText = (await response.text()).slice(0, 500);
        if (!responseText.toLowerCase().includes("message is not modified")) {
          console.error("[YUME][TELEGRAM_BOT] Telegram editMessageText failed.", {
            status: response.status, response: responseText,
          });
          return json({ ok: false, error: "Could not update help message" }, response.status >= 500 ? 502 : 200);
        }
      }
      return json({ ok: true, action: "player_help_shown" });
    } catch (error) {
      console.error("[YUME][TELEGRAM_BOT] Telegram player-help action failed.", {
        message: error instanceof Error ? error.message : String(error),
      });
      return json({ ok: false, error: "Telegram API request failed" }, 502);
    }
  }


  if (update.chat_member) {
    const event = update.chat_member;
    const userId = event.new_chat_member?.user?.id;
    if (typeof userId !== "number" || !Number.isSafeInteger(userId)) return json({ ok: true, ignored: true });
    const oldStatus = event.old_chat_member?.status;
    const newStatus = event.new_chat_member?.status;
    const nowMember = ["creator", "administrator", "member"].includes(newStatus ?? "") ||
      (newStatus === "restricted" && (event.new_chat_member as { is_member?: boolean }).is_member === true);
    const wasMember = ["creator", "administrator", "member"].includes(oldStatus ?? "");
    if (nowMember === wasMember) return json({ ok: true, ignored: true });
    try {
      const db = subscriptionDb(env);
      const state = await getSubscriptionState(db, userId);
      if (!state?.message_id) return json({ ok: true, ignored: true });
      if (!nowMember) {
        if (!state.had_access) return json({ ok: true, ignored: true });
        const gateResponse = await telegramApi(token, "editMessageText", {
          chat_id: Number(state.chat_id), message_id: state.message_id,
          text: RETURN_GATE_MESSAGE, reply_markup: returnGateKeyboard(),
        });
        if (!gateResponse.ok) {
          const responseText = (await gateResponse.text()).slice(0, 500);
          if (!responseText.toLowerCase().includes("message is not modified")) {
            console.error("[YUME][TELEGRAM_BOT] Telegram return-gate edit failed.", {
              status: gateResponse.status, response: responseText,
            });
            return json({ ok: false, error: "Could not update return gate" }, gateResponse.status >= 500 ? 502 : 200);
          }
        }
        await saveSubscriptionState(db, userId, Number(state.chat_id), state.message_id, true, true);
        return json({ ok: true, action: "subscription_left" });
      }
      // Keep the return gate in place until the user explicitly presses “Проверить подписку”.
      if (!state.awaiting_resubscribe) return json({ ok: true, ignored: true });
      return json({ ok: true, action: "awaiting_manual_subscription_check" });
    } catch (error) {
      console.error("[YUME][TELEGRAM_BOT] Membership update failed.", error);
      return json({ ok: false, error: "Membership update failed" }, 502);
    }
  }

  const message = update.message;
  const text = message?.text?.trim() ?? "";
  const chatId = message?.chat?.id;
  const isStartCommand = /^\/start(?:@\w+)?(?:\s|$)/.test(text);
  const isConfirmationCode = /^[A-Za-z0-9_-]{8}$/.test(text);
  if ((!isStartCommand && !isConfirmationCode) || typeof chatId !== "number" || !Number.isSafeInteger(chatId)) {
    return json({ ok: true, ignored: true });
  }

  const firstName = message?.from?.first_name?.trim();
  const safeFirstName = (firstName || "друг").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  let greeting = `<b>🌙 Привет, ${safeFirstName}! Добро пожаловать в YUME.</b>

Знаешь, иногда одна история может изменить всё.

<i>Включаешь аниме просто на вечер — и вдруг ловишь себя на том, что переживаешь за героев, не замечаешь, как наступает рассвет, и ещё долго не можешь отпустить эту историю после финальных титров…</i>

💜 <b>Именно для таких моментов и существует YUME.</b>

Я хочу, чтобы здесь ты находил не просто аниме, а истории, которые попадают прямо в сердце.

✨ Открывай новые миры.
🌸 Находи аниме под своё настроение.
🎬 Возвращайся к историям, которые запали в душу.

И знаешь что? Тебе совсем не обязательно заранее знать, что искать. Просто следуй за своим интересом. Возможно, совсем скоро ты найдёшь здесь своё новое любимое аниме.

━━━━━━━━━━━━━━

🌌 <b>Ну что, ${safeFirstName}, готов найти свою следующую историю?</b>

Нажимай на кнопку ниже — и давай начнём ✨

<b>🔗 Не работает плеер?</b>`;
  let browserLogin = false;
  const startPayload = isStartCommand ? (text.split(/\s+/)[1] ?? "") : "";
  if (isStartCommand && startPayload.startsWith("yb_")) {
    const sender = message?.from;
    if (typeof sender?.id !== "number" || !Number.isSafeInteger(sender.id) || !sender.first_name?.trim()) return json({ ok: true, ignored: true });
    browserLogin = true;
    const result = await completeTelegramBrowserAuth(startPayload, {
      id: sender.id, firstName: sender.first_name.trim(),
      ...(sender.last_name?.trim() ? { lastName: sender.last_name.trim() } : {}),
      ...(sender.username?.trim() ? { username: sender.username.trim() } : {}),
      ...(sender.language_code?.trim() ? { languageCode: sender.language_code.trim() } : {}),
    });
    greeting = result === "awaiting_code"
      ? "🔐 Чтобы завершить вход, отправь сюда 8-символьный код, показанный на странице YUME в браузере. Не отправляй код другим людям."
      : result === "account_not_found" ? "Аккаунт YUME не найден. Открой сайт, выбери «Регистрация» и повтори попытку."
      : result === "consent_required" ? "Для регистрации нужно принять оба документа на сайте YUME. Вернись на сайт, отметь оба флажка и начни регистрацию заново."
      : result === "already_registered" ? "Этот Telegram уже зарегистрирован. Открой сайт и выбери «Вход»."
      : result === "expired" ? "Ссылка авторизации истекла или уже использована. Вернись на сайт YUME и начни вход заново."
      : "Не удалось завершить авторизацию. Вернись на сайт YUME и попробуй ещё раз.";
  } else if (isConfirmationCode) {
    const sender = message?.from;
    if (typeof sender?.id !== "number" || !Number.isSafeInteger(sender.id) || !sender.first_name?.trim()) return json({ ok: true, ignored: true });
    browserLogin = true;
    const result = await confirmTelegramBrowserAuth(text, {
      id: sender.id, firstName: sender.first_name.trim(),
      ...(sender.last_name?.trim() ? { lastName: sender.last_name.trim() } : {}),
      ...(sender.username?.trim() ? { username: sender.username.trim() } : {}),
      ...(sender.language_code?.trim() ? { languageCode: sender.language_code.trim() } : {}),
    });
    greeting = result === "ready" ? "✅ Код подтверждён! Вернись во вкладку браузера YUME — вход завершится автоматически."
      : result === "account_not_found" ? "Аккаунт YUME не найден. Открой сайт, выбери «Регистрация» и повтори попытку."
      : result === "consent_required" ? "Для регистрации нужно принять оба документа на сайте YUME. Вернись на сайт, отметь оба флажка и начни регистрацию заново."
      : result === "already_registered" ? "Этот Telegram уже зарегистрирован. Открой сайт и выбери «Вход»."
      : result === "expired" ? "Код неверный, истёк или не относится к этому Telegram. Вернись на сайт YUME и начни авторизацию заново."
      : "Не удалось завершить авторизацию. Вернись на сайт YUME и попробуй ещё раз.";
  }

  let subscriptionGate: "first" | "return" | null = null;
  let telegramUserId: number | null = null;
  let subscriptionDbInstance: TelegramDb | null = null;
  if (isStartCommand && !browserLogin && typeof message?.from?.id === "number") {
    telegramUserId = message.from.id;
    subscriptionDbInstance = subscriptionDb(env);
    const state = await getSubscriptionState(subscriptionDbInstance, telegramUserId);
    const subscribed = await isChannelMember(token, env, telegramUserId);
    if (subscribed === null) {
      subscriptionGate = "error";
      greeting = "Не удалось проверить подписку прямо сейчас. Попробуй ещё раз через минуту, отправив /start.";
    } else if (!subscribed) {
      subscriptionGate = state?.had_access ? "return" : "first";
      greeting = subscriptionGate === "return" ? RETURN_GATE_MESSAGE : FIRST_GATE_MESSAGE;
    }
  }

  try {
    const response = await telegramApi(token, "sendMessage", {
      chat_id: chatId, text: greeting, parse_mode: "HTML",
      reply_markup: browserLogin
        ? { inline_keyboard: [[{ text: "🌸 Открыть YUME", url: SITE_URL }]] }
        : subscriptionGate === "return"
          ? returnGateKeyboard()
          : subscriptionGate === "first"
            ? gateKeyboard()
            : welcomeKeyboard(),
    });
    if (!response.ok) {
      console.error("[YUME][TELEGRAM_BOT] Telegram sendMessage failed.", {
        status: response.status, response: (await response.text()).slice(0, 500),
      });
      return json({ ok: false, error: "Could not send welcome message" }, 502);
    }
    if (telegramUserId !== null && !browserLogin) {
      const payload = await response.json() as { result?: { message_id?: number } };
      const messageId = typeof payload.result?.message_id === "number" ? payload.result.message_id : null;
      const previous = await getSubscriptionState(subscriptionDbInstance, telegramUserId);
      const subscribed = subscriptionGate === null;
      await saveSubscriptionState(subscriptionDbInstance, telegramUserId, chatId, messageId, subscribed || Boolean(previous?.had_access), subscriptionGate === "return");
    }
    return json({ ok: true });
  } catch (error) {
    console.error("[YUME][TELEGRAM_BOT] Telegram API request failed.", {
      message: error instanceof Error ? error.message : String(error),
    });
    return json({ ok: false, error: "Telegram API request failed" }, 502);
  }
}
