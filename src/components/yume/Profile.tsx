import { useEffect, useMemo, useState } from "react";
import appPackage from "../../../package.json";
import {
  ArrowLeft,
  Bookmark,
  ChevronRight,
  ChevronDown,
  Copyright,
  FileText,
  Heart,
  Info,
  LifeBuoy,
  LibraryBig,
  Mail,
  ShieldCheck,
  UserRound,
  UsersRound,
  Headset,
  Send,
  LogIn,
  UserPlus,
  LogOut,
  Trash2,
  X,
  LoaderCircle,
} from "lucide-react";
import type { Anime } from "@/data/anime";
import { getShikimoriAnimes } from "@/data/shikimori";
import { displayAnimeTitle, useYumePreferences } from "@/data/preferences";
import { PosterArt } from "./Poster";
import { getTelegramWebApp, telegramHapticImpact } from "@/lib/telegram-mini-app";
import { Grid } from "./Sections";
import { SITE_RULES, SITE_RULES_LAST_UPDATED } from "@/data/site-rules";
import {
  FAVORITES_STORAGE_KEY,
  PROFILE_UPDATED_EVENT,
  readSavedAnimeIds,
  WATCHLIST_STORAGE_KEY,
  setProfileStorageAuthenticated,
  toggleSavedAnimeId,
} from "@/data/profile-storage";

type ProfilePanel =
  | "overview"
  | "favorites"
  | "watchlist"
  | "documents"
  | "privacy"
  | "rules"
  | "rights"
  | "about"
  | "support";

type Props = {
  animeList: Anime[];
  onSelect: (anime: Anime) => void;
  onCatalog: () => void;
  initialPanel?: ProfilePanel;
};

export function Profile({ animeList, onSelect, onCatalog, initialPanel = "overview" }: Props) {
  const { t, language } = useYumePreferences();
  const [panel, setPanel] = useState<ProfilePanel>(initialPanel);
  const [supportLinks, setSupportLinks] = useState<{ group: string | null; personal: string | null }>({ group: null, personal: null });
  const [supportLinksLoading, setSupportLinksLoading] = useState(false);
  const [supportLinksError, setSupportLinksError] = useState(false);
  const [isTelegramMiniApp, setIsTelegramMiniApp] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [accountBusy, setAccountBusy] = useState(false);
  const [accountMessage, setAccountMessage] = useState("");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [telegramUser, setTelegramUser] = useState<{
    first_name?: string;
    last_name?: string;
    username?: string;
    photo_url?: string;
  } | null>(null);

  useEffect(() => setPanel(initialPanel), [initialPanel]);
  useEffect(() => {
    if (panel !== "support") return;

    let cancelled = false;
    setSupportLinksLoading(true);
    setSupportLinksError(false);

    const loadSupportUrl = async (path: string): Promise<string | null> => {
      try {
        const response = await fetch(`${path}?format=json`, {
          headers: { accept: "application/json" },
          cache: "no-store",
        });
        if (!response.ok) return null;
        const payload = await response.json() as { url?: unknown };
        return typeof payload.url === "string" ? payload.url : null;
      } catch {
        return null;
      }
    };

    Promise.all([
      loadSupportUrl("/api/support/group"),
      loadSupportUrl("/api/support/personal"),
    ]).then(([group, personal]) => {
      if (cancelled) return;
      setSupportLinks({ group, personal });
      setSupportLinksError(!group || !personal);
    }).finally(() => {
      if (!cancelled) setSupportLinksLoading(false);
    });

    return () => { cancelled = true; };
  }, [panel]);

  useEffect(() => {
    if (panel !== "support") return;

    // Telegram's WebView and mobile browsers can restore an old scroll offset
    // just after the panel changes. Reset all common scroll roots on two frames
    // so the support heading and both contact options are shown from the top.
    let secondFrame = 0;
    const resetScroll = () => {
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
      document.documentElement.scrollTop = 0;
      document.documentElement.scrollLeft = 0;
      document.body.scrollTop = 0;
      document.body.scrollLeft = 0;
      const main = document.getElementById("main-content");
      if (main) {
        main.scrollTop = 0;
        main.scrollLeft = 0;
      }
    };

    const firstFrame = window.requestAnimationFrame(() => {
      resetScroll();
      secondFrame = window.requestAnimationFrame(resetScroll);
    });

    return () => {
      window.cancelAnimationFrame(firstFrame);
      if (secondFrame) window.cancelAnimationFrame(secondFrame);
    };
  }, [panel]);
  useEffect(() => {
    const webApp = getTelegramWebApp();
    const unsafeUser = webApp?.initData ? webApp.initDataUnsafe?.user : undefined;
    setIsTelegramMiniApp(Boolean(webApp?.initData));
    // Telegram's client-side profile data is not displayed for guests.
    // It is attached to the UI only after the server confirms an account session.
    setTelegramUser(null);

    let cancelled = false;
    fetch("/api/telegram/init-data", { credentials: "same-origin", cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({})) as {
          authenticated?: boolean;
          user?: { id?: string; firstName?: string; lastName?: string; username?: string };
        };
        if (cancelled) return;
        const signedIn = response.ok && payload.authenticated === true && Boolean(payload.user?.id);
        setIsAuthenticated(signedIn);
        setAuthChecked(true);
        setProfileStorageAuthenticated(signedIn);
        if (signedIn && payload.user) {
          setTelegramUser({
            first_name: payload.user.firstName,
            last_name: payload.user.lastName,
            username: payload.user.username,
            photo_url: unsafeUser?.photo_url,
          });
        } else {
          setTelegramUser(null);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setIsAuthenticated(false);
        setAuthChecked(true);
        setProfileStorageAuthenticated(false);
      });
    return () => { cancelled = true; };
  }, []);

  const telegramDisplayName = [
    telegramUser?.first_name,
    telegramUser?.last_name,
  ].filter((part): part is string => Boolean(part?.trim())).join(" ")
    || (telegramUser?.username ? `@${telegramUser.username}` : t("profile.title"));
  const [favoriteIds, setFavoriteIds] = useState<string[]>([]);
  const [watchlistIds, setWatchlistIds] = useState<string[]>([]);
  const [savedAnime, setSavedAnime] = useState<Anime[]>([]);
  const [checkedSavedIds, setCheckedSavedIds] = useState<string[]>([]);
  const [savedAnimeLoading, setSavedAnimeLoading] = useState(false);
  const [savedAnimeLoadError, setSavedAnimeLoadError] = useState(false);
  useEffect(() => {
    const syncLists = () => {
      setFavoriteIds(readSavedAnimeIds(FAVORITES_STORAGE_KEY));
      setWatchlistIds(readSavedAnimeIds(WATCHLIST_STORAGE_KEY));
    };
    syncLists();
    window.addEventListener(PROFILE_UPDATED_EVENT, syncLists);
    window.addEventListener("storage", syncLists);
    return () => {
      window.removeEventListener(PROFILE_UPDATED_EVENT, syncLists);
      window.removeEventListener("storage", syncLists);
    };
  }, []);

  // Merge the visible catalog with titles fetched by saved ID so the local
  // library also works when a title is outside the currently loaded catalog page.
  const savedAnimeById = useMemo(
    () => new Map<string, Anime>([...savedAnime, ...animeList].map((anime) => [anime.id, anime] as const)),
    [animeList, savedAnime],
  );

  const missingSavedIds = useMemo(
    () => Array.from(new Set([...favoriteIds, ...watchlistIds])).filter(
      (id) => /^\d+$/.test(id) && !savedAnimeById.has(id) && !checkedSavedIds.includes(id),
    ),
    [checkedSavedIds, favoriteIds, savedAnimeById, watchlistIds],
  );

  useEffect(() => {
    if (missingSavedIds.length === 0) {
      setSavedAnimeLoading(false);
      return;
    }

    let cancelled = false;
    setSavedAnimeLoading(true);
    setSavedAnimeLoadError(false);

    const chunks: string[][] = [];
    for (let index = 0; index < missingSavedIds.length; index += 50) {
      chunks.push(missingSavedIds.slice(index, index + 50));
    }

    Promise.all(
      chunks.map((ids) => getShikimoriAnimes({
        data: { ids: ids.join(","), limit: ids.length, order: "ranked" },
      })),
    )
      .then((results) => {
        if (cancelled) return;
        const fetched = results.flatMap((result) => result.items);
        setSavedAnime((current) => {
          const byId = new Map<string, Anime>(current.map((anime) => [anime.id, anime] as const));
          fetched.forEach((anime) => byId.set(anime.id, anime));
          return Array.from(byId.values());
        });
        setSavedAnimeLoadError(results.some((result) => Boolean(result.error)));
        setCheckedSavedIds((current) => Array.from(new Set([...current, ...missingSavedIds])));
      })
      .catch(() => {
        if (cancelled) return;
        setSavedAnimeLoadError(true);
        setCheckedSavedIds((current) => Array.from(new Set([...current, ...missingSavedIds])));
      })
      .finally(() => {
        if (!cancelled) setSavedAnimeLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [missingSavedIds]);

  const favorites = useMemo(
    () => favoriteIds.map((id) => savedAnimeById.get(id)).filter((anime): anime is Anime => Boolean(anime)),
    [favoriteIds, savedAnimeById],
  );
  const watchlist = useMemo(
    () => watchlistIds.map((id) => savedAnimeById.get(id)).filter((anime): anime is Anime => Boolean(anime)),
    [savedAnimeById, watchlistIds],
  );
  const unresolvedFavoriteCount = favoriteIds.filter((id) => !savedAnimeById.has(id)).length;
  const unresolvedWatchlistCount = watchlistIds.filter((id) => !savedAnimeById.has(id)).length;

  const savedItemsNotice = (unresolvedCount: number) => {
    if (unresolvedCount === 0) return null;
    const message = savedAnimeLoading
      ? t("profile.savedItemsLoading")
      : savedAnimeLoadError
        ? t("profile.savedItemsError")
        : t("profile.savedItemsUnavailable");
    return (
      <p className="mt-3 rounded-xl border border-border bg-card/40 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
        {message}
      </p>
    );
  };

  const panelTitles: Record<ProfilePanel, string> = {
    overview: t("profile.title"),
    favorites: t("profile.favorites"),
    watchlist: t("profile.watchlist"),
    documents: t("profile.documents"),
    privacy: t("profile.privacy"),
    rules: t("profile.rules"),
    rights: t("profile.rights"),
    about: t("profile.about"),
    support: t("profile.support"),
  };
  const backPanel: ProfilePanel = panel === "privacy" || panel === "rules" || panel === "rights"
    ? "documents"
    : "overview";

  const navigatePanel = (next: ProfilePanel) => {
    setPanel(next);
    window.scrollTo({ top: 0, behavior: "auto" });
  };

  const requestAuth = (mode: "login" | "register") => {
    window.dispatchEvent(new CustomEvent("yume-open-auth", { detail: { mode } }));
  };

  const signOut = async () => {
    if (accountBusy) return;
    setAccountBusy(true);
    setAccountMessage("");
    try {
      const response = await fetch("/api/telegram/init-data", {
        method: "DELETE",
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!response.ok) throw new Error("logout_failed");
      setProfileStorageAuthenticated(false);
      setIsAuthenticated(false);
      setTelegramUser(null);
      setFavoriteIds([]);
      setWatchlistIds([]);
      setSavedAnime([]);
      setAccountMessage(language === "ru" ? "Вы вышли из аккаунта." : "You have signed out.");
    } catch {
      setAccountMessage(language === "ru" ? "Не удалось выйти. Попробуй ещё раз." : "Could not sign out. Try again.");
    } finally {
      setAccountBusy(false);
    }
  };

  const deleteAccount = async () => {
    if (accountBusy) return;
    setAccountBusy(true);
    setAccountMessage("");
    try {
      const response = await fetch("/api/telegram/account", {
        method: "DELETE",
        credentials: "same-origin",
        cache: "no-store",
      });
      const payload = await response.json().catch(() => ({})) as { deleted?: boolean };
      if (!response.ok || payload.deleted !== true) throw new Error("delete_failed");
      setProfileStorageAuthenticated(false);
      setIsAuthenticated(false);
      setTelegramUser(null);
      setFavoriteIds([]);
      setWatchlistIds([]);
      setSavedAnime([]);
      setCheckedSavedIds([]);
      try {
        window.localStorage.removeItem("yume-user-notifications-read-v1");
        window.localStorage.removeItem("yume-user-notifications-dismissed-v1");
      } catch {
        // Local notification state is optional browser-side data.
      }
      setShowDeleteConfirm(false);
      setAccountMessage(language === "ru"
        ? "Аккаунт и связанные с ним данные удалены. Можно зарегистрироваться заново."
        : "The account and its linked data have been deleted. You can register again.");
    } catch {
      setAccountMessage(language === "ru"
        ? "Не удалось удалить аккаунт. Данные не считаются удалёнными — попробуй ещё раз."
        : "Account deletion failed. Your data has not been confirmed deleted. Please try again.");
    } finally {
      setAccountBusy(false);
    }
  };

  const openSupportLink = (kind: "group" | "personal") => {
    const url = supportLinks[kind];
    if (!url) return;

    const webApp = getTelegramWebApp();
    if (webApp?.openTelegramLink) {
      // Telegram opens t.me links directly in its native UI and closes the Mini App,
      // avoiding the browser redirect flow from a normal anchor element.
      webApp.openTelegramLink(url);
      return;
    }

    window.location.assign(url);
  };

  const profileRow = (
    icon: typeof Heart,
    title: string,
    subtitle: string,
    next: ProfilePanel,
  ) => (
    <button
      key={title}
      type="button"
      onClick={() => navigatePanel(next)}
      className="flex w-full items-center gap-4 rounded-2xl border border-border bg-card p-3.5 text-left text-card-foreground shadow-sm transition hover:border-primary/35 hover:bg-accent/70 sm:p-4"
    >
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#1b1028] text-primary">
        {(() => {
          const Icon = icon;
          return <Icon className="h-6 w-6" />;
        })()}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">{title}</span>
        <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">{subtitle}</span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
    </button>
  );

  const backButton = (target: ProfilePanel = backPanel) => (
    <button
      type="button"
      onClick={() => navigatePanel(target)}
      className="mb-5 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4" />
      {target === "documents" ? t("profile.backLegal") : t("profile.back")}
    </button>
  );

  const emptyLibrary = (title: string, description: string) => (
    <div className="rounded-2xl border border-dashed border-border bg-card/40 px-5 py-10 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Bookmark className="h-5 w-5" />
      </div>
      <h2 className="mt-4 text-base font-semibold">{title}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">{description}</p>
      <button
        type="button"
        onClick={onCatalog}
        className="mt-5 rounded-full bg-neon px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-neon transition hover:brightness-110"
      >
        {t("profile.goCatalog")}
      </button>
    </div>
  );

  return (
    <main id="main-content" className={`px-4 pb-12 md:px-10 md:pb-16 ${panel === "support" ? "pt-20 md:pt-24" : "pt-28 md:pt-28"}`}>
      <div className="mx-auto max-w-6xl">
        {!authChecked && (panel === "overview" || panel === "favorites" || panel === "watchlist") ? (
          <section className="mx-auto max-w-xl rounded-3xl border border-border bg-card/60 p-6 text-center sm:p-8" aria-live="polite" aria-busy="true">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <LoaderCircle className="h-6 w-6 animate-spin" aria-hidden="true" />
            </div>
            <p className="mt-4 text-sm text-muted-foreground">
              {language === "ru" ? "Проверяем авторизацию…" : "Checking your session…"}
            </p>
          </section>
        ) : authChecked && !isAuthenticated && (panel === "overview" || panel === "favorites" || panel === "watchlist") ? (
          <section className="mx-auto max-w-xl rounded-3xl border border-border bg-card/80 p-6 text-center shadow-xl sm:p-8">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <ShieldCheck className="h-7 w-7" />
            </div>
            <h1 className="mt-4 text-2xl font-bold">{language === "ru" ? "Личный профиль" : "Your profile"}</h1>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {language === "ru"
                ? "Войди или зарегистрируйся через Telegram, чтобы пользоваться избранным, списком «Смотреть позже» и историей просмотров."
                : "Sign in or register through Telegram to use Favorites, Watch Later, and viewing history."}
            </p>
            <div className="mt-5 flex flex-col justify-center gap-2 sm:flex-row">
              <button type="button" onClick={() => requestAuth("login")} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90"><LogIn className="h-4 w-4" />{language === "ru" ? "Войти" : "Sign in"}</button>
              <button type="button" onClick={() => requestAuth("register")} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-border px-5 py-2.5 text-sm font-semibold hover:bg-accent"><UserPlus className="h-4 w-4" />{language === "ru" ? "Зарегистрироваться" : "Register"}</button>
            </div>
            <div className="mt-5 flex flex-wrap justify-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
              <button type="button" onClick={() => navigatePanel("privacy")} className="underline underline-offset-4 hover:text-foreground">{language === "ru" ? "Политика конфиденциальности" : "Privacy Policy"}</button>
            </div>
          </section>
        ) : panel === "overview" ? (
          <>
            <div className="relative isolate overflow-hidden rounded-[20px] border border-primary/20 bg-[#08050f]/95 shadow-[0_10px_34px_rgba(0,0,0,0.24)]">
              <div className="relative h-28 overflow-hidden sm:h-40">
                <img
                  src="/images/7E68AFCE-335A-41A6-826D-41E8674B7B0F.png"
                  alt=""
                  aria-hidden="true"
                  width={1536}
                  height={723}
                  fetchPriority="high"
                  decoding="async"
                  className="absolute inset-0 h-full w-full object-cover object-[center_38%]"
                />
                <div className="absolute inset-0 bg-gradient-to-b from-black/5 via-[#10071b]/5 to-[#10071b]/70" />
                <div className="absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-[#10071b]/80 to-transparent" />
              </div>

              <div className="relative -mt-6 rounded-[20px] bg-gradient-to-b from-[#1b0d2b]/42 via-[#140a20]/52 to-[#0d0916]/72 px-3 pb-3 pt-0 sm:px-5 sm:pb-5">
                <div className="flex min-w-0 items-end gap-3 sm:gap-4">
                  <div className="relative -mt-8 h-[78px] w-[78px] shrink-0 overflow-hidden rounded-full border-[2.5px] border-[#d98aff] bg-[#21102f] shadow-[0_0_20px_rgba(206,100,255,0.3)] sm:-mt-11 sm:h-28 sm:w-28">
                    {telegramUser?.photo_url ? (
                      <img
                        src={telegramUser.photo_url}
                        alt={telegramDisplayName}
                        referrerPolicy="no-referrer"
                        decoding="async"
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[#482465] to-[#150c22]">
                        <UserRound className="h-11 w-11 text-white sm:h-14 sm:w-14" aria-hidden="true" />
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1 pb-1 pt-3 sm:pb-2">
                    <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[#c16aff] sm:text-xs">
                      {t("profile.space")}
                    </p>
                    <h1 className="mt-1 break-words text-lg font-bold leading-tight text-white sm:text-2xl">
                      {telegramDisplayName}
                    </h1>
                    <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-white/65 sm:text-sm">
                      {t("profile.subtitle")}
                    </p>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-2 overflow-hidden rounded-[18px] border border-[#8d51bd]/40 bg-black/20 sm:mt-5">
                  <button
                    type="button"
                    onClick={() => navigatePanel("favorites")}
                    aria-label={`${favorites.length} — ${t("profile.favoritesCount")}`}
                    className="flex min-w-0 items-center gap-2.5 px-2.5 py-2.5 text-left transition hover:bg-white/[0.06] sm:gap-4 sm:px-5 sm:py-3.5"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#241035] text-[#e58aff] sm:h-12 sm:w-12">
                      <Heart className="h-5 w-5 sm:h-6 sm:w-6" strokeWidth={1.9} />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-lg font-bold tabular-nums text-white sm:text-xl">{favorites.length}</span>
                      <span className="mt-0.5 block text-[10px] leading-snug text-white/65 sm:text-xs">{t("profile.favoritesCount")}</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => navigatePanel("watchlist")}
                    aria-label={`${watchlist.length} — ${t("profile.watchlistCount")}`}
                    className="flex min-w-0 items-center gap-2.5 border-l border-[#8d51bd]/40 px-2.5 py-2.5 text-left transition hover:bg-white/[0.06] sm:gap-4 sm:px-5 sm:py-3.5"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#241035] text-primary sm:h-12 sm:w-12">
                      <Bookmark className="h-5 w-5 sm:h-6 sm:w-6" strokeWidth={1.9} />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-lg font-bold tabular-nums text-white sm:text-xl">{watchlist.length}</span>
                      <span className="mt-0.5 block text-[11px] leading-snug text-white/65 sm:text-sm">{t("profile.watchlistCount")}</span>
                    </span>
                  </button>
                </div>
              </div>
            </div>
            {!isTelegramMiniApp && <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{t("profile.localLibraryNotice")}</p>}

            <section className="mt-8">
              <div className="mb-3 flex items-end justify-between gap-3">
                <div>
                  <h2 className="text-xl font-bold">{t("profile.favorites")}</h2>
                </div>
                <button
                  type="button"
                  onClick={() => navigatePanel("favorites")}
                  className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-primary transition hover:text-neon"
                >
                  {t("profile.all")} <ChevronRight className="h-4 w-4" />
                </button>
              </div>
              {favorites.length ? (
                <div className="scrollbar-none flex gap-3 overflow-x-auto pb-2">
                  {favorites.slice(0, 4).map((anime) => (
                    <div key={anime.id} className="relative w-[98px] shrink-0 sm:w-[118px]">
                      <button
                        type="button"
                        aria-label={displayAnimeTitle(anime, language)}
                        onClick={() => onSelect(anime)}
                        className="group w-full overflow-hidden rounded-xl text-left transition hover:-translate-y-1"
                      >
                        <span className="block overflow-hidden rounded-xl ring-1 ring-white/10 transition group-hover:ring-primary">
                          <PosterArt anime={anime} className="aspect-[2/3] w-full transition duration-300 group-hover:scale-[1.02]" />
                        </span>
                        <span className="mt-2 block line-clamp-2 min-h-8 px-0.5 text-[11px] leading-snug text-foreground/90 sm:text-xs">
                          {displayAnimeTitle(anime, language)}
                        </span>
                      </button>
                      <button
                        type="button"
                        aria-label={language === "ru" ? "Убрать из избранного" : "Remove from favorites"}
                        title={language === "ru" ? "Убрать из избранного" : "Remove from favorites"}
                        onClick={(event) => { event.preventDefault(); event.stopPropagation(); toggleSavedAnimeId(FAVORITES_STORAGE_KEY, anime.id); }}
                        className="absolute right-1.5 top-1.5 z-20 flex h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-red-600 text-white shadow-[0_0_0_2px_rgba(0,0,0,0.7),0_4px_12px_rgba(0,0,0,0.65)] transition hover:scale-105 hover:bg-red-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-red-300"
                      >
                        <X className="h-5 w-5" strokeWidth={3} aria-hidden="true" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex items-center gap-3 rounded-2xl border border-dashed border-border px-4 py-4">
                  <Heart className="h-5 w-5 shrink-0 text-primary" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{t("profile.empty")}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{t("profile.emptyFavorites")}</p>
                  </div>
                  <button type="button" onClick={onCatalog} className="shrink-0 text-sm font-semibold text-primary hover:text-neon">{t("profile.catalog")}</button>
                </div>
              )}
            </section>

            <section className="mt-7 grid gap-2.5">
              {profileRow(Bookmark, t("profile.watchlist"), t("profile.watchlistDescription"), "watchlist")}
              {profileRow(ShieldCheck, t("profile.legal"), t("profile.legalDescription"), "documents")}
              {profileRow(Info, t("profile.about"), t("profile.aboutDescription"), "about")}
              {profileRow(LifeBuoy, t("profile.support"), t("profile.supportDescription"), "support")}
            </section>
            <section className="mt-6 rounded-2xl border border-border bg-card/50 p-4">
              <h2 className="text-base font-semibold">{language === "ru" ? "Аккаунт Telegram" : "Telegram account"}</h2>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {language === "ru" ? "Выход завершит текущий сеанс. Удаление аккаунта необратимо удалит избранное, список и историю просмотров." : "Signing out ends this session. Account deletion permanently removes favorites, your list, and viewing history."}
              </p>
              <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                <button type="button" disabled={accountBusy} onClick={() => void signOut()} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-border px-4 py-2 text-sm font-semibold hover:bg-accent disabled:opacity-50">
                  {accountBusy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
                  {language === "ru" ? "Выйти" : "Sign out"}
                </button>
                <button type="button" disabled={accountBusy} onClick={() => setShowDeleteConfirm(true)} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-destructive/40 px-4 py-2 text-sm font-semibold text-destructive hover:bg-destructive/10 disabled:opacity-50">
                  <Trash2 className="h-4 w-4" /> {language === "ru" ? "Удалить аккаунт" : "Delete account"}
                </button>
              </div>
              {accountMessage && <p className="mt-3 text-xs leading-relaxed text-muted-foreground" role="status">{accountMessage}</p>}
              {showDeleteConfirm && (
                <div className="mt-4 rounded-xl border border-destructive/30 bg-destructive/5 p-4" role="alertdialog" aria-labelledby="delete-account-title" aria-describedby="delete-account-description">
                  <h3 id="delete-account-title" className="font-semibold text-destructive">{language === "ru" ? "Удалить аккаунт без возможности восстановления?" : "Permanently delete your account?"}</h3>
                  <p id="delete-account-description" className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {language === "ru" ? "Будут удалены аккаунт YUME, все сеансы, избранное, «Смотреть позже», история просмотров и связанные данные. Telegram-аккаунт не удаляется. Восстановить данные нельзя." : "Your YUME account, sessions, favorites, Watch Later, viewing history, and linked data will be deleted. Your Telegram account will not be deleted. This cannot be undone."}
                  </p>
                  <div className="mt-4 flex flex-wrap justify-end gap-2">
                    <button type="button" disabled={accountBusy} onClick={() => setShowDeleteConfirm(false)} className="rounded-lg border border-border px-3 py-2 text-sm font-semibold hover:bg-accent">{language === "ru" ? "Отмена" : "Cancel"}</button>
                    <button type="button" disabled={accountBusy} onClick={() => void deleteAccount()} className="rounded-lg bg-destructive px-3 py-2 text-sm font-semibold text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50">{accountBusy ? (language === "ru" ? "Удаляем…" : "Deleting…") : (language === "ru" ? "Удалить навсегда" : "Delete permanently")}</button>
                  </div>
                </div>
              )}
            </section>
          </>
        ) : (
          <>
            {backButton()}
            <div className={panel === "support" ? "mb-3" : "mb-6"}>
              <h1 id={panel === "support" ? "support-title" : undefined} className="text-2xl font-bold sm:text-3xl">{panelTitles[panel]}</h1>
              {panel === "watchlist" && <p className="mt-1 text-sm text-muted-foreground">{t("profile.watchlistSubtitle")}</p>}
            </div>

            {panel === "favorites" && (
              <>
                {favorites.length
                  ? <Grid items={favorites} onSelect={onSelect} empty={t("profile.emptyFavoritesTitle")} onRemove={(anime) => toggleSavedAnimeId(FAVORITES_STORAGE_KEY, anime.id)} removeLabel={language === "ru" ? "Убрать из избранного" : "Remove from favorites"} />
                  : favoriteIds.length > 0
                    ? <div className="rounded-2xl border border-dashed border-border bg-card/40 px-5 py-8 text-center">
                        <p className="text-sm leading-relaxed text-muted-foreground">
                          {savedAnimeLoading ? t("profile.savedItemsLoading") : savedAnimeLoadError ? t("profile.savedItemsError") : t("profile.savedItemsUnavailable")}
                        </p>
                        <button type="button" onClick={onCatalog} className="mt-4 rounded-full bg-neon px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-neon transition hover:brightness-110">
                          {t("profile.goCatalog")}
                        </button>
                      </div>
                    : emptyLibrary(t("profile.emptyFavoritesTitle"), t("profile.emptyFavoritesDescription"))}
                {savedItemsNotice(unresolvedFavoriteCount)}
              </>
            )}

            {panel === "watchlist" && (
              <>
                {watchlist.length
                  ? <Grid items={watchlist} onSelect={onSelect} empty={t("profile.emptyWatchlistTitle")} onRemove={(anime) => toggleSavedAnimeId(WATCHLIST_STORAGE_KEY, anime.id)} removeLabel={language === "ru" ? "Убрать из списка «Смотреть позже»" : "Remove from Watch Later"} />
                  : watchlistIds.length > 0
                    ? <div className="rounded-2xl border border-dashed border-border bg-card/40 px-5 py-8 text-center">
                        <p className="text-sm leading-relaxed text-muted-foreground">
                          {savedAnimeLoading ? t("profile.savedItemsLoading") : savedAnimeLoadError ? t("profile.savedItemsError") : t("profile.savedItemsUnavailable")}
                        </p>
                        <button type="button" onClick={onCatalog} className="mt-4 rounded-full bg-neon px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-neon transition hover:brightness-110">
                          {t("profile.goCatalog")}
                        </button>
                      </div>
                    : emptyLibrary(t("profile.emptyWatchlistTitle"), t("profile.emptyWatchlistDescription"))}
                {savedItemsNotice(unresolvedWatchlistCount)}
              </>
            )}

            {panel === "documents" && (
              <div className="grid gap-3 sm:grid-cols-2">
                {profileRow(ShieldCheck, t("profile.privacy"), t("profile.privacyDescription"), "privacy")}
                {profileRow(FileText, t("profile.rules"), t("profile.rulesDescription"), "rules")}
                {profileRow(Copyright, t("profile.rights"), t("profile.rightsDescription"), "rights")}
              </div>
            )}

            {panel === "rights" ? (
              <article className="max-w-3xl space-y-2.5">
                <section className="rounded-2xl border border-border bg-card/60 p-4 sm:p-5">
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {language === "ru"
                      ? "Сбор информации в сети и формирование каталога на сайте YUME осуществляются в автоматическом режиме."
                      : "Information collection across the web and catalog creation on the YUME website are carried out automatically."}
                  </p>
                </section>

                <section className="rounded-2xl border border-border bg-card/60 p-4 sm:p-5">
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {language === "ru"
                      ? "На сайте YUME представлены сведения о произведениях, а также материалы для бесплатного домашнего ознакомительного просмотра, включая фрагменты материалов, любительские переводы и озвучку. Видеофайлы не хранятся на серверах YUME. На страницах сайта могут использоваться встроенные плееры сторонних сервисов."
                      : "YUME provides information about works and materials for free, at-home viewing for familiarization, including excerpts, fan translations and voice-overs. Video files are not stored on YUME servers. Pages may use embedded players from third-party services."}
                  </p>
                </section>

                <section className="rounded-2xl border border-border bg-card/60 p-4 sm:p-5">
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {language === "ru"
                      ? "YUME не продаёт представленные на сайте материалы. Контент предназначен исключительно для бесплатного домашнего ознакомительного просмотра."
                      : "YUME does not sell materials presented on the website. Content is intended exclusively for free, at-home viewing for familiarization."}
                  </p>
                </section>

                <section className="rounded-2xl border border-border bg-card/60 p-4 sm:p-5">
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {language === "ru"
                      ? "Администрация YUME открыта к сотрудничеству с правообладателями и их уполномоченными представителями."
                      : "YUME administration welcomes cooperation with copyright holders and their authorized representatives."}
                  </p>
                </section>

                <section className="rounded-2xl border border-border bg-card/60 p-4 sm:p-5">
                  <h3 className="text-sm font-semibold text-primary">
                    {language === "ru" ? "Связаться с администрацией" : "Contact the administration"}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {language === "ru"
                      ? "Если вы обнаружили на сайте материал, который, по вашему мнению, нарушает авторские права или иные законные интересы либо содержит недостоверную или искажённую информацию о правообладателе, просим связаться с администрацией YUME по адресу:"
                      : "If you find material on the website that you believe infringes copyright or other lawful interests, or contains inaccurate or misleading information about a rights holder, please contact YUME administration at:"}
                  </p>
                  <a
                    href="mailto:yumesupport833@gmail.com"
                    className="mt-3 inline-flex max-w-full items-center gap-2 rounded-xl bg-secondary/70 px-3 py-2.5 text-sm font-semibold text-primary underline-offset-4 transition hover:bg-secondary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    <Mail className="h-5 w-5 shrink-0" aria-hidden="true" />
                    <span className="break-all">yumesupport833@gmail.com</span>
                  </a>
                </section>

                <section className="rounded-2xl border border-border bg-card/60 p-4 sm:p-5">
                  <h3 className="text-sm font-semibold text-foreground">
                    {language === "ru" ? "Что указать в обращении" : "What to include in your request"}
                  </h3>
                  <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm leading-relaxed text-muted-foreground">
                    <li>{language === "ru" ? "Контактные данные заявителя и реквизиты организации, если обращение направляется от имени организации." : "The applicant’s contact details and organization details, if the request is submitted on behalf of an organization."}</li>
                    <li>{language === "ru" ? "Прямую ссылку на страницу или материал, в отношении которого подаётся обращение." : "A direct link to the page or material concerned."}</li>
                    <li>{language === "ru" ? "Сведения о произведении и описание предполагаемого нарушения." : "Information about the work and a description of the alleged infringement."}</li>
                    <li>{language === "ru" ? "Документы или иные сведения, подтверждающие права заявителя на соответствующий материал и полномочия действовать от имени правообладателя, если это применимо." : "Documents or other information confirming the applicant’s rights to the material and authority to act on behalf of the rights holder, where applicable."}</li>
                  </ol>
                </section>

                <section className="rounded-2xl border border-border bg-card/60 p-4 sm:p-5">
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {language === "ru"
                      ? "Администрация YUME рассматривает обращения правообладателей и их уполномоченных представителей и принимает предусмотренные законодательством меры в установленные законом сроки. Для проверки обращения администрация вправе запросить дополнительные сведения и документы. Порядок рассмотрения официальных заявлений определяется применимым законодательством."
                      : "YUME administration reviews requests from rights holders and their authorized representatives and takes measures provided by law within the applicable legal time limits. Additional information and documents may be requested to review a request. Official claims are handled in accordance with applicable law."}
                  </p>
                </section>

                <section className="rounded-2xl border border-border bg-card/60 p-4 sm:p-5">
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {language === "ru"
                      ? "Для предложений о сотрудничестве, лицензировании и других официальных обращений правообладателей используйте тот же контакт с пометкой «Сотрудничество»."
                      : "For cooperation, licensing and other official rights-holder inquiries, use the same contact and include “Cooperation” in the subject line."}
                  </p>
                </section>

                <section className="rounded-2xl border border-border bg-card/60 p-4 sm:p-5">
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {language === "ru"
                      ? "YUME не взимает плату за просмотр материалов на сайте."
                      : "YUME does not charge users to view materials on the website."}
                  </p>
                </section>
              </article>
            ) : panel === "rules" ? (
              <article className="max-w-3xl space-y-3">
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {language === "ru"
                    ? `Настоящие Правила использования сайта YUME. Дата последнего обновления: ${SITE_RULES_LAST_UPDATED}.`
                    : `YUME website terms of use. Last updated: ${SITE_RULES_LAST_UPDATED}.`}
                </p>
                <div className="space-y-3">
                  {SITE_RULES.map((section, index) => (
                    <details
                      key={section.title}
                      className="group overflow-hidden rounded-2xl border border-primary/25 bg-card/55 shadow-sm transition-colors open:border-primary/55 open:bg-card/75"
                    >
                      <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-4 text-left marker:hidden transition-colors hover:bg-primary/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary sm:px-5 [&::-webkit-details-marker]:hidden">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-primary/20 bg-primary/10 text-sm font-bold text-primary">
                          {index + 1}
                        </span>
                        <span className="min-w-0 flex-1 text-sm font-semibold leading-snug text-foreground sm:text-base">
                          {section.title}
                        </span>
                        <ChevronDown className="h-4 w-4 shrink-0 text-primary transition-transform duration-200 group-open:rotate-180" aria-hidden="true" />
                      </summary>
                      <div className="border-t border-border/70 px-4 pb-5 pt-4 sm:px-5 sm:pb-6">
                        <ol className="space-y-4">
                          {section.clauses.map((clause) => {
                            const match = clause.match(/^(\d+\.\d+\.)\s*(.*)$/s);
                            return (
                              <li key={clause} className="text-sm leading-7 text-foreground/85 sm:text-[15px]">
                                {match ? (
                                  <>
                                    <span className="mr-1 font-semibold text-foreground">{match[1]}</span>
                                    <span>{match[2]}</span>
                                  </>
                                ) : clause}
                              </li>
                            );
                          })}
                        </ol>
                      </div>
                    </details>
                  ))}
                </div>
                <p className="pt-2 text-xs leading-relaxed text-muted-foreground">
                  {language === "ru"
                    ? "По вопросам, связанным с использованием Сайта, можно обратиться по адресу yumesupport833@gmail.com."
                    : "For questions about using the Site, contact yumesupport833@gmail.com."}
                </p>
              </article>
            ) : panel === "privacy" ? (
              <article className="max-w-3xl space-y-3">
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {language === "ru"
                    ? "Настоящая Политика конфиденциальности описывает, как Администрация сайта YUME обрабатывает информацию пользователей при использовании сайта и его функций."
                    : "This Privacy Policy describes how YUME site administration processes user information when the site and its features are used."}
                </p>
                <div className="space-y-3">
                  {[
                    {
                      title: language === "ru" ? "Общие положения" : "General provisions",
                      clauses: language === "ru" ? [
                        "Настоящая Политика конфиденциальности (далее — «Политика») объясняет, какие сведения могут обрабатываться при использовании YUME, для каких целей это делается и как пользователь может обратиться по вопросам конфиденциальности.",
                        "Администрация сайта YUME (далее — «Администрация») стремится обрабатывать данные прозрачно, в объёме, необходимом для работы сайта, обеспечения безопасности и предоставления доступных функций.",
                        "Политика применяется к информации, получаемой при посещении сайта, использовании учётной записи и взаимодействии с функциями YUME. Сторонние сервисы могут обрабатывать данные по собственным правилам и политикам.",
                        "Настоящая Политика не является универсальным согласием на любую обработку данных. Если для определённой обработки требуется отдельное согласие, оно запрашивается отдельно в предусмотренном порядке.",
                        "Действующая редакция Политики доступна по адресу: https://yume-website.yumesupport833.workers.dev/?section=privacy-policy."
                      ] : [
                        "This Privacy Policy explains what information may be processed when using YUME, why it is processed, and how users can contact the administration about privacy.",
                        "YUME site administration seeks to process information transparently and only as needed to operate the site, provide available features, and maintain security.",
                        "This Policy applies to information collected while visiting the site, using an account, and interacting with YUME features. Third-party services may process information under their own policies.",
                        "This Policy is not blanket consent to any processing. Where separate consent is required for a particular activity, it is requested separately as appropriate.",
                        "The current version of this Policy is available at https://yume-website.yumesupport833.workers.dev/?section=privacy-policy."
                      ]
                    },
                    {
                      title: language === "ru" ? "Цели и основания обработки" : "Purposes and legal bases for processing",
                      clauses: language === "ru" ? [
                        "Информация может обрабатываться для обеспечения работы сайта и учётной записи, предоставления доступных функций, сохранения пользовательских настроек, обеспечения безопасности, предотвращения злоупотреблений, диагностики ошибок и ответа на обращения пользователей.",
                        "В зависимости от используемых функций могут обрабатываться сведения, переданные при авторизации через Telegram, данные профиля, настройки и действия внутри сервиса, а также технические сведения о запросах и сбоях.",
                        "Обработка осуществляется в объёме, необходимом для указанных целей, на соответствующем основании, включая предоставление запрошенной функции, выполнение применимых требований и согласие пользователя в тех случаях, когда оно необходимо.",
                        "Для оформления интерфейса браузер загружает шрифты Manrope и Unbounded через Google Fonts; для интеграции с Telegram загружается официальный скрипт Telegram Web Apps с telegram.org. При загрузке этих ресурсов соответствующие поставщики получают сетевые данные запроса, например IP-адрес и сведения о браузере, согласно собственным условиям и политикам.",
                        "Администрация не должна использовать данные для несовместимых с указанными целями задач без надлежащего основания и информирования пользователя, когда это требуется."
                      ] : [
                        "Information may be processed to operate the site and account, provide available features, save preferences, maintain security, prevent abuse, diagnose errors, and respond to user requests.",
                        "Depending on the features used, this may include information provided through Telegram authentication, profile details, settings and activity within the service, and technical request or error information.",
                        "Processing is limited to what is necessary for these purposes and relies on an appropriate basis, including providing a requested feature, meeting applicable requirements, or user consent where required.",
                        "For interface styling, the browser loads the Manrope and Unbounded fonts through Google Fonts; Telegram integration loads the official Telegram Web Apps script from telegram.org. When these resources are requested, the respective providers receive request-level network data such as the IP address and browser information under their own terms and policies.",
                        "Information should not be used for purposes incompatible with those described without an appropriate basis and user notice where required."
                      ]
                    },
                    {
                      title: language === "ru" ? "Cookie-файлы и аналогичные технологии" : "Cookies and similar technologies",
                      clauses: language === "ru" ? [
                        "Сайт может использовать cookie-файлы, локальное хранилище браузера и аналогичные технологии для поддержки основных функций, сохранения настроек и обеспечения безопасности.",
                        "Строго необходимые технологии могут использоваться для работы запрошенных пользователем функций. Аналитические, рекламные и иные необязательные технологии применяются только при наличии соответствующих инструментов и с учётом выбора пользователя и применимых требований.",
                        "Пользователь может ограничить или удалить cookie-файлы в настройках браузера. Это может повлиять на доступность отдельных функций или сохранение настроек.",
                        "Для каталожных постеров YUME использует ограниченный прокси на собственном домене, чтобы браузер не обращался к домену изображений напрямую. При иных прямых запросах к ресурсам Shikimori её защитная инфраструктура может устанавливать собственные технические cookie; их назначение, сроки действия и условия обработки контролируются сторонним поставщиком, а не YUME. Подробности следует уточнять в политиках Shikimori/DDoS-Guard."
                      ] : [
                        "The site may use cookies, browser local storage, and similar technologies to support core features, save preferences, and maintain security.",
                        "Strictly necessary technologies may be used to provide features requested by the user. Analytics, advertising, and other optional technologies are used only if actually implemented and in line with user choices and applicable requirements.",
                        "Users can restrict or delete cookies in browser settings. This may affect some features or saved preferences.",
                        "YUME uses a restricted same-origin proxy for catalog posters so the browser does not contact the image host directly. Other direct requests to Shikimori resources, if any, may cause its protection infrastructure to set technical cookies; their purpose, lifetime and processing terms are controlled by the third-party provider, not YUME. Consult Shikimori/DDoS-Guard policies for details."
                      ]
                    },
                    {
                      title: language === "ru" ? "Хранение и защита данных" : "Data storage and security",
                      clauses: language === "ru" ? [
                        "Администрация применяет разумные технические и организационные меры для защиты информации от неправомерного доступа, утраты, изменения или раскрытия.",
                        "Данные хранятся не дольше, чем это необходимо для целей обработки, обеспечения безопасности, разрешения обращений и выполнения применимых требований. Конкретный срок зависит от вида данных и цели их использования.",
                        "Доступ к данным ограничивается случаями, когда он необходим для работы и поддержки сервиса. Информация может обрабатываться поставщиками инфраструктуры и технических услуг в объёме, необходимом для функционирования YUME.",
                        "Передача информации также возможна в случаях, предусмотренных применимым законодательством, либо для защиты прав, безопасности пользователей и работоспособности сервиса в допустимых пределах.",
                        "Ни один способ передачи или хранения данных не может гарантировать абсолютную безопасность, однако Администрация принимает разумные меры для снижения соответствующих рисков."
                      ] : [
                        "The administration applies reasonable technical and organizational safeguards to protect information against unauthorized access, loss, alteration, or disclosure.",
                        "Information is retained no longer than necessary for the processing purposes, security, handling requests, and applicable requirements. The period depends on the type of information and its use.",
                        "Access is limited to what is needed to operate and support the service. Infrastructure and technical service providers may process information as necessary for YUME to function.",
                        "Information may also be disclosed where required by applicable law or, where permitted, to protect rights, user safety, and service reliability.",
                        "No method of transmission or storage can guarantee absolute security, but reasonable measures are taken to reduce risks."
                      ]
                    },
                    {
                      title: language === "ru" ? "Права пользователей" : "User rights",
                      clauses: language === "ru" ? [
                        "Пользователь может обратиться за информацией об обработке своих данных, запросить исправление неточных сведений или удаление данных, когда это применимо, а также отозвать согласие, если обработка основана на согласии и отзыв допускается.",
                        "Для рассмотрения запроса Администрация может попросить предоставить сведения, необходимые для подтверждения того, что запрос относится к соответствующей учётной записи или данным.",
                        "Некоторые данные могут сохраняться после запроса на удаление, если их дальнейшее хранение необходимо для безопасности, разрешения споров или выполнения требований применимого законодательства.",
                        "Запросы по вопросам конфиденциальности можно направлять на yumesupport833@gmail.com. Администрация рассматривает их в установленном порядке."
                      ] : [
                        "Users may ask about the processing of their information, request correction of inaccurate details or deletion where applicable, and withdraw consent where processing is based on consent and withdrawal is available.",
                        "The administration may request information needed to verify that a request relates to the relevant account or data.",
                        "Some information may be retained after a deletion request when necessary for security, dispute resolution, or applicable legal requirements.",
                        "Privacy requests can be sent to yumesupport833@gmail.com and will be handled through the appropriate process."
                      ]
                    },
                    {
                      title: language === "ru" ? "Изменение политики" : "Changes to this Policy",
                      clauses: language === "ru" ? [
                        "Администрация может периодически обновлять Политику при изменении функций сайта, способов обработки информации или применимых требований.",
                        "Актуальная редакция публикуется на этой странице: https://yume-website.yumesupport833.workers.dev/?section=privacy-policy.",
                        "При существенных изменениях Администрация может дополнительно разместить уведомление в интерфейсе сайта. Дата обновления при необходимости указывается в опубликованной редакции."
                      ] : [
                        "The administration may update this Policy as site features, processing practices, or applicable requirements change.",
                        "The current version is published on this page: https://yume-website.yumesupport833.workers.dev/?section=privacy-policy.",
                        "For material changes, an additional notice may be displayed in the site interface. An update date may be included in the published version."
                      ]
                    },
                    {
                      title: language === "ru" ? "Контакты" : "Contact",
                      clauses: language === "ru" ? [
                        "По вопросам обработки персональных данных, конфиденциальности и реализации прав пользователя можно связаться с Администрацией сайта YUME по электронной почте: yumesupport833@gmail.com.",
                        "В обращении рекомендуется описать вопрос и, если необходимо, указать ссылку на соответствующую страницу или сведения, позволяющие найти нужные данные. Не отправляйте пароли, коды подтверждения и другие секретные данные."
                      ] : [
                        "For questions about personal information, privacy, or user rights, contact YUME site administration at yumesupport833@gmail.com.",
                        "Please describe your question and, where helpful, include the relevant page link or details needed to locate the information. Do not send passwords, verification codes, or other secrets."
                      ]
                    }
                  ].map((section, index) => (
                    <details
                      key={section.title}
                      className="group overflow-hidden rounded-2xl border border-primary/25 bg-card/55 shadow-sm transition-colors open:border-primary/55 open:bg-card/75"
                    >
                      <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-4 text-left marker:hidden transition-colors hover:bg-primary/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary sm:px-5 [&::-webkit-details-marker]:hidden">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-primary/20 bg-primary/10 text-sm font-bold text-primary">{index + 1}</span>
                        <span className="min-w-0 flex-1 text-sm font-semibold leading-snug text-foreground sm:text-base">{section.title}</span>
                        <ChevronDown className="h-4 w-4 shrink-0 text-primary transition-transform duration-200 group-open:rotate-180" aria-hidden="true" />
                      </summary>
                      <div className="border-t border-border/70 px-4 pb-5 pt-4 sm:px-5 sm:pb-6">
                        <ol className="space-y-4">
                          {section.clauses.map((clause, clauseIndex) => (
                            <li key={clause} className="text-sm leading-7 text-foreground/85 sm:text-[15px]">
                              <span className="mr-1 font-semibold text-foreground">{index + 1}.{clauseIndex + 1}.</span>{clause}
                            </li>
                          ))}
                        </ol>
                      </div>
                    </details>
                  ))}
                </div>
                <p className="pt-2 text-xs leading-relaxed text-muted-foreground">
                  {language === "ru" ? "По вопросам конфиденциальности: " : "Privacy inquiries: "}
                  <a className="text-primary underline underline-offset-4" href="mailto:yumesupport833@gmail.com">yumesupport833@gmail.com</a>
                </p>
                              </article>
            ) : null}

            {panel === "about" && (
              <article className="max-w-3xl rounded-2xl border border-border bg-card/60 p-5 sm:p-7">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-primary">
                    About the project
                  </p>
                  <h2 className="mt-2 text-3xl font-bold tracking-tight text-foreground">
                    {language === "ru" ? "О YUME" : "About YUME"}
                  </h2>
                  <p className="mt-3 text-base leading-relaxed text-muted-foreground sm:text-lg">
                    {language === "ru"
                      ? "Аниме-каталог и личное пространство в одном месте."
                      : "An anime catalog and personal space in one place."}
                  </p>
                </div>

                <div className="my-6 h-px w-full bg-border" />

                <section>
                  <h3 className="text-lg font-semibold text-foreground">
                    {language === "ru" ? "Наша идея" : "Our idea"}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground sm:text-base">
                    {language === "ru"
                      ? "Сделать знакомство с аниме удобнее, а личный опыт просмотра — более индивидуальным."
                      : "Making anime discovery easier and your viewing experience more personal."}
                  </p>
                </section>

                <div className="mt-5 grid grid-cols-2 gap-3">
                  <div className="flex min-h-[132px] flex-col items-start rounded-2xl bg-secondary/70 p-4 sm:p-5">
                    <LibraryBig className="h-6 w-6 text-primary" aria-hidden="true" />
                    <h3 className="mt-4 text-base font-semibold text-foreground sm:text-lg">
                      {language === "ru" ? "Каталог" : "Catalog"}
                    </h3>
                    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                      {language === "ru" ? "Информация об аниме" : "Anime information"}
                    </p>
                  </div>
                  <div className="flex min-h-[132px] flex-col items-start rounded-2xl bg-secondary/70 p-4 sm:p-5">
                    <UserRound className="h-6 w-6 text-primary" aria-hidden="true" />
                    <h3 className="mt-4 text-base font-semibold text-foreground sm:text-lg">
                      {language === "ru" ? "Профиль" : "Profile"}
                    </h3>
                    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                      {language === "ru" ? "Личное пространство" : "Personal space"}
                    </p>
                  </div>
                </div>

                <dl className="mt-6 space-y-3 text-sm sm:text-base">
                  <div className="flex items-center justify-between gap-4">
                    <dt className="text-muted-foreground">{t("profile.animeSource")}</dt>
                    <dd className="text-right font-medium text-foreground">Shikimori</dd>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <dt className="text-muted-foreground">{t("profile.projectState")}</dt>
                    <dd>
                      <span className="inline-flex rounded-full bg-primary/15 px-3 py-1 text-xs font-semibold text-primary sm:text-sm">
                        {language === "ru" ? "В разработке" : "BETA"}
                      </span>
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <dt className="text-muted-foreground">{t("profile.version")}</dt>
                    <dd className="font-medium tabular-nums text-foreground">{appPackage.version}</dd>
                  </div>
                </dl>
              </article>
            )}

            {panel === "support" && (
              <section className="mx-auto max-w-4xl -mt-3 text-white sm:-mt-4" aria-labelledby="support-title">
                <p className="max-w-2xl text-sm leading-relaxed text-[#9CA3AF] sm:text-base">
                  {language === "ru"
                    ? "Мы всегда на связи и готовы помочь. Выберите подходящий способ связи в зависимости от вашего вопроса."
                    : "We’re here to help. Choose the right way to contact us depending on your question."}
                </p>

                <div className="mt-5 space-y-4 sm:mt-6 sm:space-y-5">
                  <article className="rounded-[22px] border border-[#33264B] bg-gradient-to-br from-[#0D0A14] to-[#08080D] p-4 shadow-[0_8px_24px_rgba(0,0,0,0.16)] sm:p-5">
                    <div className="flex items-start gap-3 sm:gap-4">
                      <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-[20px] bg-[#281747] text-[#C69BFF] sm:h-[72px] sm:w-[72px]">
                        <UsersRound className="h-8 w-8 sm:h-9 sm:w-9" aria-hidden="true" />
                      </div>
                      <div className="min-w-0 flex-1 pt-1">
                        <div className="flex items-center justify-between gap-2">
                          <h3 className="text-lg font-semibold sm:text-xl">{language === "ru" ? "Общая группа" : "Community group"}</h3>
                          
                        </div>
                        <p className="mt-1 text-sm leading-relaxed text-[#9CA3AF] sm:text-base">
                          {language === "ru" ? "Предложения, вопросы по аниме и общение с сообществом." : "Suggestions, anime questions, and community discussions."}
                        </p>
                      </div>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2 text-xs sm:text-sm">
                      {(language === "ru" ? ["Предложения", "Вопросы по аниме", "Обсуждение"] : ["Suggestions", "Anime questions", "Discussion"]).map((label) => (
                        <span key={label} className="rounded-full bg-[#21152F] px-3 py-1.5 font-medium text-[#C69BFF]">{label}</span>
                      ))}
                    </div>
                    <button type="button" onClick={() => openSupportLink("group")} disabled={supportLinksLoading || !supportLinks.group} className="mt-4 flex min-h-12 w-full items-center justify-between gap-3 rounded-[16px] bg-gradient-to-r from-[#7829F5] to-[#5015C9] px-4 py-3 text-sm font-semibold text-white shadow-[0_5px_18px_rgba(103,35,222,0.18)] transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B78AFF] disabled:cursor-not-allowed disabled:opacity-60 sm:min-h-[56px] sm:px-5 sm:text-base">
                      <span className="flex min-w-0 items-center gap-3"><Send className="h-5 w-5 shrink-0" aria-hidden="true" /><span>{language === "ru" ? "Перейти в группу" : "Join the group"}</span></span>
                      <ChevronRight className="h-5 w-5 shrink-0" aria-hidden="true" />
                    </button>
                  </article>

                  <article className="rounded-[22px] border border-[#153653] bg-gradient-to-br from-[#071019] to-[#080B10] p-4 shadow-[0_8px_24px_rgba(0,0,0,0.16)] sm:p-5">
                    <div className="flex items-start gap-3 sm:gap-4">
                      <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-[20px] bg-[#102E4D] text-[#7FB5FF] sm:h-[72px] sm:w-[72px]">
                        <Headset className="h-8 w-8 sm:h-9 sm:w-9" aria-hidden="true" />
                      </div>
                      <div className="min-w-0 flex-1 pt-1">
                        <div className="flex items-center justify-between gap-2">
                          <h3 className="text-lg font-semibold sm:text-xl">{language === "ru" ? "Личная поддержка" : "Personal support"}</h3>
                          
                        </div>
                        <p className="mt-1 text-sm leading-relaxed text-[#9CA3AF] sm:text-base">
                          {language === "ru" ? "Технические проблемы и вопросы по работе приложения." : "Technical issues and questions about how the app works."}
                        </p>
                      </div>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2 text-xs sm:text-sm">
                      {(language === "ru" ? ["Ошибки и баги", "Проблемы с аккаунтом", "Не работает"] : ["Bugs and errors", "Account issues", "Feature not working"]).map((label) => (
                        <span key={label} className="rounded-full bg-[#101D2B] px-3 py-1.5 font-medium text-[#8AB9FF]">{label}</span>
                      ))}
                    </div>
                    <button type="button" onClick={() => openSupportLink("personal")} disabled={supportLinksLoading || !supportLinks.personal} className="mt-4 flex min-h-12 w-full items-center justify-between gap-3 rounded-[16px] bg-gradient-to-r from-[#079FEA] to-[#075BC5] px-4 py-3 text-sm font-semibold text-white shadow-[0_5px_18px_rgba(0,115,224,0.16)] transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7FB5FF] disabled:cursor-not-allowed disabled:opacity-60 sm:min-h-[56px] sm:px-5 sm:text-base">
                      <span className="flex min-w-0 items-center gap-3"><Send className="h-5 w-5 shrink-0" aria-hidden="true" /><span>{language === "ru" ? "Написать в поддержку" : "Contact support"}</span></span>
                      <ChevronRight className="h-5 w-5 shrink-0" aria-hidden="true" />
                    </button>
                  </article>

                  {!supportLinksLoading && supportLinksError && (
                    <p role="status" className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs leading-relaxed text-[#D1B38A]">
                      {language === "ru"
                        ? "Не удалось загрузить одну из ссылок. Проверьте SUPPORT_GROUP_URL и SUPPORT_PERSONAL_URL в Cloudflare."
                        : "A support link could not be loaded. Check SUPPORT_GROUP_URL and SUPPORT_PERSONAL_URL in Cloudflare."}
                    </p>
                  )}

                  <aside className="flex items-start gap-3 rounded-[20px] border border-[#1D2928] bg-[#080D0D] px-4 py-3.5 sm:px-5 sm:py-4">
                    <ShieldCheck className="mt-0.5 h-7 w-7 shrink-0 text-[#35D7A0]" aria-hidden="true" />
                    <p className="text-xs leading-relaxed text-[#9CA3AF] sm:text-sm">
                      {language === "ru"
                        ? "Не отправляйте в общую группу личные данные (пароли, коды и платёжные реквизиты). Для таких вопросов используйте личную поддержку."
                        : "Do not share personal data (passwords, codes, or payment details) in the group. Contact personal support for private matters."}
                    </p>
                  </aside>
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </main>
  );
}
