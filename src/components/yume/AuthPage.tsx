import { useEffect, useState } from "react";
import { CheckCircle2, LoaderCircle, ShieldCheck, Send } from "lucide-react";
import { getTelegramWebApp } from "@/lib/telegram-mini-app";

type AuthMode = "login" | "register";
type Props = {
  mode: AuthMode;
  language: "ru" | "en";
  onModeChange: (mode: AuthMode) => void;
  onPrivacy: () => void;
  onRules: () => void;
  onComplete: () => void;
};

type BrowserStart = { requestId?: string; botUrl?: string; confirmationCode?: string; error?: string };
type PollResult = { status?: string; error?: string };

export function AuthPage({ mode, language, onModeChange, onPrivacy, onRules, onComplete }: Props) {
  const isRu = language === "ru";
  const [consentAccepted, setConsentAccepted] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [botUrl, setBotUrl] = useState("");
  const [requestId, setRequestId] = useState("");
  const [confirmationCode, setConfirmationCode] = useState("");
  const [pollingEnabled, setPollingEnabled] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const isRegister = mode === "register";

  useEffect(() => {
    if (!pollingEnabled || !requestId) return;
    let cancelled = false;
    const startedAt = Date.now();
    const poll = async () => {
      if (cancelled) return;
      if (Date.now() - startedAt > 10 * 60 * 1000) {
        setPollingEnabled(false);
        setError(isRu ? "Ссылка истекла. Начни вход заново." : "The link expired. Start sign-in again.");
        return;
      }
      try {
        const response = await fetch("/api/telegram/browser-auth?id=" + encodeURIComponent(requestId), {
          credentials: "same-origin",
          cache: "no-store",
        });
        const result = await response.json().catch(() => ({})) as PollResult;
        if (cancelled) return;
        if (response.ok && result.status === "authenticated") {
          setPollingEnabled(false);
          setMessage(isRu ? "Вход выполнен." : "You are signed in.");
          onComplete();
        } else if (result.status === "error" || result.status === "expired") {
          setPollingEnabled(false);
          const errors: Record<string, [string, string]> = {
            account_not_found: ["Аккаунт не найден. Переключись на регистрацию.", "No account found. Switch to registration."],
            already_registered: ["Этот Telegram уже зарегистрирован. Переключись на вход.", "This Telegram account is already registered. Switch to sign in."],
            consent_required: ["Для регистрации нужно принять оба документа.", "Accept both documents to register."],
          };
          const pair = errors[result.error ?? (result.status === "expired" ? "expired" : "")];
          setError(pair ? (isRu ? pair[0] : pair[1]) : (isRu ? "Ссылка истекла или не удалось завершить вход." : "The link expired or sign-in could not be completed."));
        }
      } catch {
        if (!cancelled) setError(isRu ? "Не удалось проверить вход. Проверь соединение." : "Could not check sign-in. Check your connection.");
      }
    };
    void poll();
    const interval = window.setInterval(() => { void poll(); }, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [pollingEnabled, requestId, isRu, onComplete]);

  const startAuth = async () => {
    setError("");
    setMessage("");
    if (isRegister && (!consentAccepted || !termsAccepted)) {
      setError(isRu ? "Прими Политику обработки персональных данных и Пользовательское соглашение." : "Accept the Personal Data Processing Policy and User Agreement.");
      return;
    }
    if (busy) return;
    setBusy(true);
    setBotUrl("");
    setRequestId("");
    setConfirmationCode("");
    setPollingEnabled(false);
    try {
      const webApp = getTelegramWebApp();
      if (webApp?.initData) {
        const response = await fetch("/api/telegram/init-data", {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ initData: webApp.initData, mode, privacyConsent: isRegister && consentAccepted, termsAccepted: isRegister && termsAccepted }),
        });
        const result = await response.json().catch(() => ({})) as { authenticated?: boolean; error?: string };
        if (!response.ok || result.authenticated !== true) {
          if (result.error === "consent_required") {
            throw new Error(isRu ? "Для регистрации нужно принять документы." : "Accept the documents to register.");
          }
          if (result.error === "account_not_found") {
            throw new Error(isRu ? "Аккаунт не найден. Переключись на регистрацию." : "No account found. Switch to registration.");
          }
          if (result.error === "already_registered") {
            throw new Error(isRu ? "Этот Telegram уже зарегистрирован. Переключись на вход." : "This Telegram account is already registered. Switch to sign in.");
          }
          if (result.error === "auth_data_expired") {
            throw new Error(isRu ? "Данные Telegram устарели. Закрой и заново открой Mini App." : "Telegram authorization data expired. Reopen the Mini App.");
          }
          throw new Error(isRu ? "Не удалось войти через Telegram. Попробуй ещё раз." : "Telegram sign-in failed. Try again.");
        }
        onComplete();
        return;
      }

      // Browser authentication uses Telegram's official OIDC Authorization Code + PKCE flow.
      window.location.assign("/api/telegram/oidc?flow=" + encodeURIComponent(mode) + (isRegister ? "&consent=1&terms=1" : ""));
      return;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : (isRu ? "Ошибка авторизации." : "Authentication error."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main id="main-content" className="relative isolate flex min-h-[calc(100dvh-4rem)] items-center justify-center overflow-hidden px-4 pb-10 pt-24">
      <div aria-hidden="true" className="pointer-events-none absolute -top-48 left-1/2 -z-10 h-[28rem] w-[28rem] -translate-x-1/2 rounded-full bg-primary/20 blur-[110px]" />
      <div className="w-full max-w-md">
        <section className="rounded-3xl border border-border bg-card/95 p-6 shadow-[0_24px_90px_rgba(0,0,0,0.42)] sm:p-8">
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-sky-500/10 text-sky-400">
            <Send className="h-7 w-7" />
          </div>
          <h1 className="text-center text-2xl font-bold">{isRegister ? (isRu ? "Регистрация" : "Create an account") : (isRu ? "Вход в аккаунт" : "Sign in to YUME")}</h1>
          <p className="mx-auto mt-2 max-w-sm text-center text-sm leading-relaxed text-muted-foreground">
            {isRegister
              ? (isRu ? "Создай аккаунт YUME через Telegram, чтобы сохранять личные списки и историю." : "Create your YUME account through Telegram to save your lists and history.")
              : (isRu ? "Войди через Telegram, чтобы получить доступ к своему профилю и сохранённым данным." : "Sign in through Telegram to access your profile and saved data.")}
          </p>

          {message && (
            <div className="mt-4 rounded-xl border border-primary/20 bg-primary/5 p-3 text-sm leading-relaxed text-foreground" role="status" aria-live="polite">
              <div className="flex items-start gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><span>{message}</span></div>
            </div>
          )}
          {error && <p className="mt-4 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm leading-relaxed text-foreground" role="alert">{error}</p>}

          {botUrl && confirmationCode && (
            <div className="mt-4 rounded-2xl border border-border bg-background/70 p-4 text-center">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{isRu ? "Код подтверждения" : "Confirmation code"}</p>
              <code className="mt-2 block select-all font-mono text-2xl font-bold tracking-[0.18em] text-foreground">{confirmationCode}</code>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{isRu ? "Код действует 10 минут и подходит только для этого запроса." : "This code expires in 10 minutes and is valid only for this request."}</p>
            </div>
          )}

          {botUrl ? (
            <a
              href={botUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setPollingEnabled(true)}
              className="mt-5 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-sky-500 px-4 py-3 text-sm font-bold text-white transition hover:bg-sky-400"
            >
              <Send className="h-4 w-4" /> {isRu ? "Открыть Telegram и подтвердить" : "Open Telegram and confirm"}
            </a>
          ) : (
            <button
              type="button"
              disabled={busy || (isRegister && (!consentAccepted || !termsAccepted))}
              onClick={() => { void startAuth(); }}
              className="mt-5 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-sky-500 px-4 py-3 text-sm font-bold text-white transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {busy ? (isRu ? "Подготавливаем…" : "Preparing…") : (isRu ? "Продолжить через Telegram" : "Continue with Telegram")}
            </button>
          )}

          {isRegister && (
            <div className="mt-5 space-y-3 rounded-2xl border border-border bg-background/50 p-3.5">
              <div className="flex items-start gap-3 text-sm leading-relaxed">
                <input
                  id="yume-privacy-consent"
                  type="checkbox"
                  aria-label={isRu ? "Согласие с Политикой обработки персональных данных" : "Accept the Personal Data Processing Policy"}
                  checked={consentAccepted}
                  onChange={(event) => setConsentAccepted(event.target.checked)}
                  className="mt-1 h-4 w-4 shrink-0 accent-primary"
                />
                <div className="min-w-0 flex-1 text-left">
                  <label htmlFor="yume-privacy-consent" className="cursor-pointer">{isRu ? "Я принимаю " : "I accept the "}</label>
                  <button type="button" onClick={onPrivacy} className="inline break-words text-left font-semibold text-primary underline underline-offset-4">
                    {isRu ? "Политику обработки персональных данных" : "Personal Data Processing Policy"}
                  </button>
                </div>
              </div>
              <div className="flex items-start gap-3 text-sm leading-relaxed">
                <input
                  id="yume-terms-consent"
                  type="checkbox"
                  aria-label={isRu ? "Согласие с Пользовательским соглашением" : "Accept the User Agreement"}
                  checked={termsAccepted}
                  onChange={(event) => setTermsAccepted(event.target.checked)}
                  className="mt-1 h-4 w-4 shrink-0 accent-primary"
                />
                <div className="min-w-0 flex-1 text-left">
                  <label htmlFor="yume-terms-consent" className="cursor-pointer">{isRu ? "Я принимаю " : "I accept the "}</label>
                  <button type="button" onClick={onRules} className="inline break-words text-left font-semibold text-primary underline underline-offset-4">
                    {isRu ? "Пользовательское соглашение" : "User Agreement"}
                  </button>
                </div>
              </div>
            </div>
          )}

          <p className="mt-4 text-center text-xs leading-relaxed text-muted-foreground">
            <ShieldCheck className="mr-1 inline h-3.5 w-3.5" />
            {isRu ? "Авторизация подтверждается сервером Telegram. Мы не просим пароль от Telegram." : "Telegram authentication is verified server-side. We never ask for your Telegram password."}
          </p>
          <div className="mt-6 border-t border-border pt-5 text-center text-sm text-muted-foreground">
            {isRegister ? (isRu ? "Уже есть аккаунт? " : "Already registered? ") : (isRu ? "Нет аккаунта? " : "Don't have an account? ")}
            <button type="button" onClick={() => { setError(""); setMessage(""); setBotUrl(""); setRequestId(""); setConfirmationCode(""); setPollingEnabled(false); setConsentAccepted(false); setTermsAccepted(false); onModeChange(isRegister ? "login" : "register"); }} className="font-semibold text-primary hover:text-neon">
              {isRegister ? (isRu ? "Войти" : "Sign in") : (isRu ? "Зарегистрироваться" : "Create an account")}
            </button>
          </div>
          <button type="button" onClick={onPrivacy} className="mt-4 flex w-full justify-center text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground">
            {isRu ? "Политика конфиденциальности" : "Privacy Policy"}
          </button>
        </section>
      </div>
    </main>
  );
}
