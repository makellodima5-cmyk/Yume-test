import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { YumePreferencesProvider, useYumePreferences } from "@/data/preferences";
import { DEFAULT_META_DESCRIPTION, SITE_NAME } from "@/data/seo";
import { initializeTelegramMiniApp } from "@/lib/telegram-mini-app";
import { TelegramSubscriptionGate } from "@/components/yume/TelegramSubscriptionGate";

type InterfaceLanguage = "ru" | "en";

function useStoredInterfaceLanguage(): InterfaceLanguage {
  const [language, setLanguage] = useState<InterfaceLanguage>("ru");
  useEffect(() => {
    const sync = () => {
      try {
        setLanguage(window.localStorage.getItem("yume-language") === "en" ? "en" : "ru");
      } catch {
        setLanguage("ru");
      }
    };
    sync();
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  return language;
}

function NotFoundComponent() {
  const language = useStoredInterfaceLanguage();
  return (
    <main id="main-content" className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">{language === "en" ? "Page not found" : "Страница не найдена"}</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {language === "en" ? "The page you're looking for doesn't exist or has been moved." : "Страница, которую вы ищете, не существует или была перемещена."}
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {language === "en" ? "Go home" : "На главную"}
          </Link>
        </div>
      </div>
    </main>
  );
}

function ErrorComponent({ error, reset }: ErrorComponentProps) {
  const language = useStoredInterfaceLanguage();
  const router = useRouter();
  useEffect(() => {
    const details = error instanceof Error
      ? { name: error.name, message: error.message, stack: error.stack }
      : { name: "UnknownError", message: String(error), stack: undefined };
    console.error("[YUME][PAGE_ERROR] Unhandled route/render error.", {
      ...details,
      boundary: "tanstack_root_error_component",
      path: typeof window !== "undefined" ? window.location.pathname : "server",
    });
    try {
      reportLovableError(error, { boundary: "tanstack_root_error_component" });
    } catch (reportingError) {
      console.error("[YUME][PAGE_ERROR] Error reporter itself failed.", reportingError);
    }
  }, [error]);

  return (
    <main id="main-content" className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          {language === "en" ? "This page didn't load" : "Страница не загрузилась"}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {language === "en" ? "Something went wrong on our end. You can try refreshing or head back home." : "Что-то пошло не так. Попробуйте обновить страницу или вернуться на главную."}
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {language === "en" ? "Try again" : "Повторить"}
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            {language === "en" ? "Go home" : "На главную"}
          </a>
        </div>
      </div>
    </main>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { title: "YUME — смотри аниме онлайн" },
      { name: "description", content: DEFAULT_META_DESCRIPTION },
      { name: "robots", content: "noindex,nofollow" },
      { property: "og:site_name", content: SITE_NAME },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700&family=Unbounded:wght@500;700&display=swap&subset=cyrillic" },
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="ru">
      <head>
        <script src="https://telegram.org/js/telegram-web-app.js"></script>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("yume-theme")||"dark";var r=t==="system"?(matchMedia("(prefers-color-scheme: light)").matches?"light":"dark"):t;document.documentElement.dataset.theme=r;document.documentElement.style.colorScheme=r;document.documentElement.classList.toggle("dark",r==="dark")}catch(e){document.documentElement.dataset.theme="dark";document.documentElement.classList.add("dark")}})();`,
          }}
        />
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function DocumentLanguageSync() {
  const { language } = useYumePreferences();
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);
  return null;
}

function SkipToContent() {
  const { language } = useYumePreferences();
  return (
    <a className="skip-to-content" href="#main-content">
      {language === "en" ? "Skip to main content" : "Перейти к основному содержимому"}
    </a>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  useEffect(() => initializeTelegramMiniApp(), []);

  return (
    <QueryClientProvider client={queryClient}>
      <YumePreferencesProvider>
        <DocumentLanguageSync />
        <SkipToContent />
        <TelegramSubscriptionGate><Outlet /></TelegramSubscriptionGate>
      </YumePreferencesProvider>
    </QueryClientProvider>
  );
}
