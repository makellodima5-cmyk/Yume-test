import { useEffect, useState } from "react";
import { Home, LayoutGrid, Library, User, Menu, X, Bell, Moon, Sun, ShieldCheck, Heart, Clock3, Star, Languages, Bookmark, Megaphone, Radio, Sparkles } from "lucide-react"
import { Logo } from "./Logo";
import { useYumePreferences } from "@/data/preferences";
import { getTelegramWebApp, telegramHapticImpact } from "@/lib/telegram-mini-app";

export type View = "home" | "admin" | "catalog" | "collections" | "profile" | "login" | "register" | "popular" | "new-releases" | "announcements" | "airing" | "favorites" | "watchlist" | "history" | "privacy" | "privacy-policy" | "rules" | "rights" | "notifications";

export const NAV: { id: View; label: string; icon: typeof Home }[] = [
  { id: "home", label: "Главная", icon: Home },
  { id: "catalog", label: "Каталог", icon: LayoutGrid },
  { id: "collections", label: "Подборки", icon: Library },
];

type Props = {
  view: View;
  setView: (v: View) => void;
  onProfile: () => void;
  isAdmin?: boolean;
  unreadNotificationCount?: number;
};

export function Header({ view, setView, onProfile, isAdmin = false, unreadNotificationCount = 0 }: Props) {
  const { t, theme, setTheme, language, setLanguage } = useYumePreferences();
  const [menuOpen, setMenuOpen] = useState(false);
  const [telegramPhotoUrl, setTelegramPhotoUrl] = useState<string | null>(null);
  const [telegramPhotoFailed, setTelegramPhotoFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/telegram/init-data", { credentials: "same-origin", cache: "no-store" })
      .then(async (response) => {
        const result = await response.json().catch(() => ({})) as { authenticated?: boolean };
        if (cancelled) return;
        if (response.ok && result.authenticated === true) {
          const webApp = getTelegramWebApp();
          const user = webApp?.initData ? webApp.initDataUnsafe?.user : undefined;
          setTelegramPhotoUrl(user?.photo_url ?? null);
        } else {
          setTelegramPhotoUrl(null);
        }
      })
      .catch(() => { if (!cancelled) setTelegramPhotoUrl(null); });
    return () => { cancelled = true; };
  }, []);
  // Keep primary navigation labels directly tied to the active language.
  // This prevents translation-key identifiers from ever appearing in the drawer.
  const navigationText = language === "ru"
    ? {
        menuTitle: "Навигация",
        adminPanel: "Панель администратора",
        main: "Основная навигация",
        home: "Главная",
        catalog: "Каталог",
        collections: "Подборки",
        popular: "Популярное",
        newReleases: "Новинки",
        announcements: "Анонсы",
        airing: "Сейчас выходит",
        favorites: "Избранное",
        watchlist: "Смотреть позже",
        history: "История просмотров",
        legal: "Правовая информация",
        theme: "Тема оформления",
        language: "Язык",
      }
    : {
        menuTitle: "Navigation",
        adminPanel: "Admin panel",
        main: "Main navigation",
        home: "Home",
        catalog: "Catalog",
        collections: "Collections",
        popular: "Popular",
        newReleases: "New releases",
        announcements: "Announcements",
        airing: "Currently airing",
        favorites: "Favorites",
        watchlist: "Watch later",
        history: "Watch history",
        legal: "Legal information",
        theme: "Theme",
        language: "Language",
      };
  const navLabels: Record<"home" | "catalog" | "collections", string> = {
    home: navigationText.home,
    catalog: navigationText.catalog,
    collections: navigationText.collections,
  };

  useEffect(() => {
    if (!menuOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuOpen]);

  const goToView = (next: View) => {
    setView(next);
    setMenuOpen(false);
  };

  const navButtonClass = (active: boolean) =>
    `flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-medium transition-colors duration-200 ${active ? "bg-primary/15 text-primary" : "text-foreground/80 hover:bg-primary/8 hover:text-foreground"}`;

  return (
    <>
      <header className="fixed inset-x-0 top-0 z-40 w-full border-b border-border bg-background shadow-sm">
        <div className="flex h-16 items-center gap-3 px-4 md:px-6 lg:px-8">
          <button
            type="button"
            onClick={() => { telegramHapticImpact("light"); setMenuOpen((open) => !open); }}
            aria-label={menuOpen ? t("nav.closeMenu") : t("nav.openMenu")}
            aria-expanded={menuOpen}
            aria-controls="yume-navigation-drawer"
            className="yume-tactile-control mt-5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-foreground transition hover:bg-primary/10"
          >
            {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
          <button type="button" onClick={() => { telegramHapticImpact("light"); goToView("home"); }} aria-label={t("nav.home")} className="yume-tactile-control mt-5 shrink-0">
            <Logo />
          </button>
          <div className="hidden min-w-0 flex-1 md:block" />
          <div className="ml-auto mt-5 flex items-center gap-1 sm:gap-2">
            <button
              type="button"
              onClick={() => { telegramHapticImpact("light"); setView("notifications"); }}
              aria-label={language === "ru"
                ? `Уведомления${unreadNotificationCount > 0 ? `, непрочитанных: ${unreadNotificationCount}` : ""}`
                : `Notifications${unreadNotificationCount > 0 ? `, unread: ${unreadNotificationCount}` : ""}`}
              aria-current={view === "notifications" ? "page" : undefined}
              title={language === "ru" ? "Уведомления" : "Notifications"}
              className={`yume-tactile-control relative flex h-10 w-10 items-center justify-center rounded-full text-foreground/80 transition hover:bg-primary/10 ${view === "notifications" ? "bg-primary/10 text-primary" : ""}`}
            >
              <Bell className="h-5 w-5" />
              {unreadNotificationCount > 0 && <span aria-hidden="true" className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full bg-red-500 ring-2 ring-background" />}
              {unreadNotificationCount > 0 && <span className="sr-only">{language === "ru" ? `${unreadNotificationCount} непрочитанных уведомлений` : `${unreadNotificationCount} unread notifications`}</span>}
            </button>
            <button
              type="button"
              onClick={() => { telegramHapticImpact("light"); onProfile(); }}
              aria-label={t("nav.profileButton")}
              className="yume-tactile-control flex h-10 w-10 items-center justify-center rounded-full border border-primary/20 bg-primary/10 text-foreground transition hover:bg-primary/20"
            >
              {telegramPhotoUrl && !telegramPhotoFailed ? (
                <img
                  src={telegramPhotoUrl}
                  alt=""
                  aria-hidden="true"
                  referrerPolicy="no-referrer"
                  decoding="async"
                  onError={() => setTelegramPhotoFailed(true)}
                  className="h-full w-full rounded-full object-cover"
                />
              ) : (
                <User className="h-5 w-5" />
              )}
            </button>
          </div>
        </div>
      </header>

      {menuOpen && (
        <>
          <button
            type="button"
            aria-label={t("nav.closeMenu")}
            onClick={() => { telegramHapticImpact("light"); setMenuOpen(false); }}
            className="fixed inset-0 z-40 cursor-default bg-black/45"
          />
          <aside
            id="yume-navigation-drawer"
            role="dialog"
            aria-modal="true"
            aria-label={navigationText.main}
            className="fixed inset-y-0 left-0 z-50 flex min-h-0 w-1/2 min-w-0 max-w-[320px] flex-col overflow-y-auto overscroll-contain rounded-r-[2rem] border-r border-border bg-background p-3 pb-[calc(env(safe-area-inset-bottom)+1rem)] shadow-2xl md:w-[290px] md:min-w-0 md:max-w-none md:p-4"
          >
            <div className="mb-4 flex items-center justify-between gap-2 px-1">
              <span className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{navigationText.menuTitle}</span>
              <button
                type="button"
                onClick={() => setMenuOpen(false)}
                aria-label={t("nav.closeMenu")}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-foreground transition hover:bg-primary/10"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <nav className="flex flex-col gap-1">
              {NAV.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => { telegramHapticImpact("light"); goToView(item.id); }}
                    aria-current={view === item.id ? "page" : undefined}
                    className={navButtonClass(view === item.id)}
                  >
                    <Icon className="h-5 w-5 shrink-0" />
                    <span>{navLabels[item.id as keyof typeof navLabels]}</span>
                  </button>
                );
              })}
              {isAdmin && <button type="button" onClick={() => { telegramHapticImpact("light"); goToView("admin"); }} aria-current={view === "admin" ? "page" : undefined} className={navButtonClass(view === "admin")}><ShieldCheck className="h-5 w-5 shrink-0" /><span>{navigationText.adminPanel}</span></button>}
              <button type="button" onClick={() => { telegramHapticImpact("light"); goToView("popular"); }} className={navButtonClass(view === "popular")}>
                <Star className="h-5 w-5 shrink-0" /><span>{navigationText.popular}</span>
              </button>
              <button type="button" onClick={() => { telegramHapticImpact("light"); goToView("new-releases"); }} className={navButtonClass(view === "new-releases")}>
                <Sparkles className="h-5 w-5 shrink-0" /><span>{navigationText.newReleases}</span>
              </button>
              <button type="button" onClick={() => { telegramHapticImpact("light"); goToView("announcements"); }} className={navButtonClass(view === "announcements")}>
                <Megaphone className="h-5 w-5 shrink-0" /><span>{navigationText.announcements}</span>
              </button>
              <button type="button" onClick={() => { telegramHapticImpact("light"); goToView("airing"); }} className={navButtonClass(view === "airing")}>
                <Radio className="h-5 w-5 shrink-0" /><span>{navigationText.airing}</span>
              </button>
              <button type="button" onClick={() => { telegramHapticImpact("light"); goToView("favorites"); }} className={navButtonClass(view === "favorites")}>
                <Heart className="h-5 w-5 shrink-0" /><span>{navigationText.favorites}</span>
              </button>
              <button type="button" onClick={() => { telegramHapticImpact("light"); goToView("watchlist"); }} className={navButtonClass(view === "watchlist")}>
                <Bookmark className="h-5 w-5 shrink-0" /><span>{navigationText.watchlist}</span>
              </button>
              <button type="button" onClick={() => { telegramHapticImpact("light"); goToView("history"); }} className={navButtonClass(view === "history")}>
                <Clock3 className="h-5 w-5 shrink-0" /><span>{navigationText.history}</span>
              </button>
              <button type="button" onClick={() => { telegramHapticImpact("light"); goToView("privacy"); }} className={navButtonClass(view === "privacy")}>
                <ShieldCheck className="h-5 w-5 shrink-0" /><span>{navigationText.legal}</span>
              </button>
            </nav>

            <div className="mt-8 space-y-3 border-t border-border pt-3">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground"><Moon className="h-4 w-4" />{navigationText.theme}</span>
                <button type="button" role="switch" aria-label={t("nav.toggleTheme")} aria-checked={theme === "light"} onClick={() => { telegramHapticImpact("light"); setTheme(theme === "light" ? "dark" : "light"); }} className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${theme === "light" ? "bg-primary" : "bg-muted"}`}>
                  <span className={`absolute top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-background shadow transition-transform ${theme === "light" ? "translate-x-[22px]" : "translate-x-0.5"}`}>{theme === "light" ? <Sun className="h-3 w-3" /> : <Moon className="h-3 w-3" />}</span>
                </button>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground"><Languages className="h-4 w-4" />{navigationText.language}</span>
                <div className="flex rounded-lg border border-border bg-muted p-0.5">
                  {(["ru", "en"] as const).map((value) => <button key={value} type="button" aria-pressed={language === value} onClick={() => { telegramHapticImpact("light"); setLanguage(value); }} className={`rounded-md px-2.5 py-1 text-[11px] font-semibold uppercase transition ${language === value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>{value}</button>)}
                </div>
              </div>
            </div>
          </aside>
        </>
      )}
    </>
  );
}
