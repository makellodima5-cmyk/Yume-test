import { useCallback, useEffect, useState, type ReactNode } from "react";
import { getTelegramWebApp } from "@/lib/telegram-mini-app";

const CHANNEL_URL = "https://t.me/yumeanime_news";

type CheckResult = "loading" | "subscribed" | "not_subscribed" | "error";

export function TelegramSubscriptionGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<CheckResult>("loading");
  const [checking, setChecking] = useState(false);
  const webApp = getTelegramWebApp();
  const initData = webApp?.initData ?? "";
  // Telegram injects the WebApp bridge script on ordinary pages too. An empty initData
  // plus an unknown/missing platform is a regular browser, not an authenticated Mini App.
  const isTelegramMiniApp = Boolean(webApp && (initData || (webApp.platform && webApp.platform !== "unknown")));

  const checkSubscription = useCallback(async () => {
    if (!initData) {
      setStatus("error");
      return;
    }
    setChecking(true);
    setStatus((current) => current === "subscribed" ? "subscribed" : "loading");
    try {
      const response = await fetch("/api/telegram/subscription", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ initData }),
      });
      const payload: unknown = await response.json();
      if (!response.ok || !payload || typeof payload !== "object" || !("subscribed" in payload) || typeof payload.subscribed !== "boolean") {
        setStatus("error");
      } else {
        setStatus(payload.subscribed ? "subscribed" : "not_subscribed");
      }
    } catch {
      setStatus("error");
    } finally {
      setChecking(false);
    }
  }, [initData]);

  useEffect(() => {
    if (!isTelegramMiniApp) {
      setStatus("subscribed");
      return;
    }
    if (!initData) {
      setStatus("error");
      return;
    }
    void checkSubscription();
  }, [isTelegramMiniApp, initData, checkSubscription]);

  if (!isTelegramMiniApp || status === "subscribed") return <>{children}</>;

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-5 py-10 text-foreground">
      <section className="w-full max-w-md rounded-3xl border border-border bg-card p-6 text-center shadow-xl sm:p-8">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-3xl" aria-hidden="true">👀</div>
        <div className="space-y-4 text-sm leading-6 text-muted-foreground">
          <p className="text-base font-semibold leading-7 text-foreground">Опа, кажется, ты немного поторопился с выходом из нашего канала!</p>
          <p>Без подписки доступ к YUME закрывается 😢 Но не переживай, никто не отбирает у тебя любимое аниме навсегда.</p>
          <p>Возвращайся в канал, подписывайся, и мы снова откроем тебе двери! 💜</p>
          <p className="font-medium text-foreground">А то как же мы без тебя? 😏</p>
        </div>
        <div className="mt-7 grid gap-3">
          <button
            type="button"
            onClick={() => {
              if (webApp?.openTelegramLink) webApp.openTelegramLink(CHANNEL_URL);
              else window.open(CHANNEL_URL, "_blank", "noopener,noreferrer");
            }}
            className="inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
          >
            😂 Я больше не уйду
          </button>
          <button
            type="button"
            onClick={() => void checkSubscription()}
            disabled={checking}
            className="inline-flex min-h-12 w-full items-center justify-center rounded-xl border border-border bg-background px-4 py-3 text-sm font-semibold text-foreground transition-colors hover:bg-accent disabled:cursor-wait disabled:opacity-60"
          >
            {checking ? "Проверяем подписку…" : "🔎 Проверить подписку"}
          </button>
          {status === "error" && (
            <p role="alert" className="text-sm text-destructive">
              Не удалось проверить подписку. Проверь подключение и попробуй ещё раз.
            </p>
          )}
        </div>
      </section>
    </main>
  );
}
