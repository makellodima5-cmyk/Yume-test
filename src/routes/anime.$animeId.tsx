import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import {
  Bookmark,
  Bell,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  ChevronRight,
  Heart,
  Play,
  Star,
  X,
} from "lucide-react";
import { getShikimoriAnimeDetails, getShikimoriAnimeScreenshots, type ShikimoriScreenshot } from "@/data/shikimori";
import { Header, type View } from "@/components/yume/Header";
import { Footer } from "@/components/yume/Footer";
import { AnimeCard, PosterArt } from "@/components/yume/Poster";
import { useYumePreferences, displayAnimeTitle, displayAnimeStatus, displayGenre, displayAnimeKind } from "@/data/preferences";
import {
  FAVORITES_STORAGE_KEY,
  PROFILE_AUTH_REQUIRED_EVENT,
  PROFILE_SYNC_ERROR_EVENT,
  PROFILE_UPDATED_EVENT,
  readSavedAnimeIds,
  setProfileStorageAuthenticated,
  syncTelegramLibrary,
  toggleSavedAnimeId,
  WATCHLIST_STORAGE_KEY,
} from "@/data/profile-storage";
import { absoluteImageUrl, canonicalUrl, sanitizeMetaDescription } from "@/data/seo";
import { toSameOriginShikimoriScreenshot } from "@/lib/shikimori-image-proxy";

function formatAnimeDate(value: string | undefined, language: "ru" | "en", includeTime = false): string | null {
  if (!value) return null;
  let date: Date;
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (dateOnly) {
    date = new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]));
  } else {
    date = new Date(value);
  }
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat(language === "en" ? "en-GB" : "ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    ...(includeTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  }).format(date);
}

export const Route = createFileRoute("/anime/$animeId")({
  loader: async ({ params }) => {
    // Read the current title and a bounded related-title set directly from D1.
    return getShikimoriAnimeDetails({ data: { animeId: params.animeId } });
  },
  head: ({ loaderData }) => {
    const anime = loaderData?.anime;
    const title = anime ? `${anime.title} — смотреть аниме | YUME` : "Аниме не найдено | YUME";
    const description = sanitizeMetaDescription(
      anime?.description,
      anime ? `Смотри ${anime.title} на YUME — информация, рейтинг, жанры и трейлер аниме.` : "Это аниме не найдено. Открой каталог YUME, чтобы найти другие тайтлы.",
    );
    const image = absoluteImageUrl(anime?.bannerUrl ?? anime?.posterUrl);
    const canonical = anime ? canonicalUrl(`/anime/${encodeURIComponent(anime.id)}`) : canonicalUrl("/");
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:type", content: "video.tv_show" },
        { property: "og:url", content: canonical },
        ...(image ? [{ property: "og:image", content: image }, { name: "twitter:image", content: image }] : []),
        { name: "twitter:card", content: image ? "summary_large_image" : "summary" },
        { name: "robots", content: anime ? "index,follow" : "noindex,follow" },
      ],
      links: [{ rel: "canonical", href: canonical }],
    };
  },
  component: AnimeDetailPage,
});

function AnimeDetailPage() {
  const { language, t } = useYumePreferences();
  const { animeId } = Route.useParams();
  const navigate = useNavigate();
  const { anime, relatedAnime, apiError } = Route.useLoaderData();
  const trailerSectionRef = useRef<HTMLElement | null>(null);
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);
  const [inList, setInList] = useState(false);
  const [isFavorite, setIsFavorite] = useState(false);
  const [showListNote, setShowListNote] = useState(false);
  const [saveSyncError, setSaveSyncError] = useState(false);
  const [authRequired, setAuthRequired] = useState(false);
  const [episodeSubscribed, setEpisodeSubscribed] = useState(false);
  const [subscriptionBusy, setSubscriptionBusy] = useState(false);
  const [screenshots, setScreenshots] = useState<ShikimoriScreenshot[]>([]);
  const [activeScreenshotIndex, setActiveScreenshotIndex] = useState<number | null>(null);
  const displayableScreenshots = screenshots
    .map(toSameOriginShikimoriScreenshot)
    .filter((screenshot): screenshot is ShikimoriScreenshot => screenshot !== null);
  const screenshotTriggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (anime) document.title = displayAnimeTitle(anime, language) + (language === "en" ? " — watch anime | YUME" : " — смотреть аниме | YUME");
  }, [anime, language]);

  useEffect(() => {
    if (!anime || anime.status !== "Онгоинг") {
      setEpisodeSubscribed(false);
      return;
    }
    let cancelled = false;
    fetch("/api/anime-subscriptions", { credentials: "same-origin", cache: "no-store" })
      .then(async response => {
        const payload = await response.json().catch(() => ({})) as { subscriptions?: string[] };
        if (!cancelled && response.ok) setEpisodeSubscribed(Array.isArray(payload.subscriptions) && payload.subscriptions.includes(anime.id));
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [anime?.id, anime?.status]);


  useEffect(() => {
    let cancelled = false;
    setScreenshots([]);
    setActiveScreenshotIndex(null);
    if (!/^\d{1,12}$/.test(animeId)) return;
    getShikimoriAnimeScreenshots({ data: { animeId } })
      .then((result) => {
        if (!cancelled) setScreenshots(result.items ?? []);
      })
      .catch(() => {
        if (!cancelled) setScreenshots([]);
      });
    return () => { cancelled = true; };
  }, [animeId]);

  useEffect(() => {
    if (activeScreenshotIndex === null) {
      screenshotTriggerRef.current?.focus();
      return;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setActiveScreenshotIndex(null);
      } else if (event.key === "ArrowLeft" && displayableScreenshots.length > 1) {
        event.preventDefault();
        setActiveScreenshotIndex((current) => current === null ? current : (current - 1 + displayableScreenshots.length) % displayableScreenshots.length);
      } else if (event.key === "ArrowRight" && displayableScreenshots.length > 1) {
        event.preventDefault();
        setActiveScreenshotIndex((current) => current === null ? current : (current + 1) % displayableScreenshots.length);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [activeScreenshotIndex, displayableScreenshots.length]);

  useEffect(() => {
    setDescriptionExpanded(false);
    setInList(readSavedAnimeIds(WATCHLIST_STORAGE_KEY).includes(animeId));
    setIsFavorite(readSavedAnimeIds(FAVORITES_STORAGE_KEY).includes(animeId));
    setShowListNote(false);
    setAuthRequired(false);
    window.scrollTo({ top: 0, behavior: "auto" });

    let cancelled = false;
    // Direct links to an anime page need to restore account state before enabling saves.
    fetch("/api/telegram/init-data", { credentials: "same-origin", cache: "no-store" })
      .then(async (response) => {
        const result = await response.json().catch(() => ({})) as { authenticated?: boolean; user?: { id?: string } };
        if (cancelled) return;
        const authenticated = response.ok && result.authenticated === true && Boolean(result.user?.id);
        setProfileStorageAuthenticated(authenticated);
        if (authenticated && result.user?.id) {
          try {
            await syncTelegramLibrary(result.user.id);
          } catch {
            setProfileStorageAuthenticated(false);
          }
        }
      })
      .catch(() => { if (!cancelled) setProfileStorageAuthenticated(false); });

    return () => { cancelled = true; };
  }, [animeId]);

  useEffect(() => {
    const syncSavedButtons = () => {
      setInList(readSavedAnimeIds(WATCHLIST_STORAGE_KEY).includes(animeId));
      setIsFavorite(readSavedAnimeIds(FAVORITES_STORAGE_KEY).includes(animeId));
    };
    const onSyncError = () => {
      setSaveSyncError(true);
      setShowListNote(true);
    };
    const onAuthRequired = () => {
      setAuthRequired(true);
      setShowListNote(true);
    };
    window.addEventListener(PROFILE_UPDATED_EVENT, syncSavedButtons);
    window.addEventListener(PROFILE_SYNC_ERROR_EVENT, onSyncError);
    window.addEventListener(PROFILE_AUTH_REQUIRED_EVENT, onAuthRequired);
    return () => {
      window.removeEventListener(PROFILE_UPDATED_EVENT, syncSavedButtons);
      window.removeEventListener(PROFILE_SYNC_ERROR_EVENT, onSyncError);
      window.removeEventListener(PROFILE_AUTH_REQUIRED_EVENT, onAuthRequired);
    };
  }, [animeId]);

  const navigateToSection = (view: View) => {
    if (view === "login" || view === "register") {
      try { window.sessionStorage.setItem("yume-auth-intent-v1", view); } catch { /* Root may still open auth through its event handler. */ }
      void navigate({ to: "/", search: { section: "home" } });
      return;
    }
    navigate({ to: "/", search: { section: view } });
  };

  const requestAuth = (mode: "login" | "register" = "login") => {
    try { window.sessionStorage.setItem("yume-auth-intent-v1", mode); } catch { /* Best effort; root route reads the intent on mount. */ }
    void navigate({ to: "/", search: { section: "home" } });
  };

  const navigateToProfile = () => {
    void fetch("/api/telegram/init-data", { credentials: "same-origin", cache: "no-store" })
      .then(async (response) => {
        const result = await response.json().catch(() => ({})) as { authenticated?: boolean };
        navigateToSection(response.ok && result.authenticated === true ? "profile" : "login");
      })
      .catch(() => navigateToSection("login"));
  };

  const scrollToTrailer = () => {
    trailerSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  if (!anime) {
    return (
      <div className="min-h-screen pb-24 md:pb-12">
        <Header
          view="catalog"
          setView={navigateToSection}
          onProfile={navigateToProfile}
        />
        <main id="main-content" className="px-4 pt-28 md:px-10 md:pt-32">
          <div className="mx-auto max-w-3xl rounded-3xl border border-border bg-card p-8 text-center">
            <h1 className="text-2xl font-bold">{t("anime.notFound")}</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {apiError ? t("anime.notFoundApi") : t("anime.notFoundInfo")}
            </p>
            <button
              type="button"
              onClick={() => navigateToSection("catalog")}
              className="mt-6 rounded-full bg-neon px-5 py-2.5 text-sm font-semibold text-primary-foreground"
            >
              {t("anime.openCatalog")}
            </button>
          </div>
        </main>
      </div>
    );
  }

  const needsDescriptionToggle = anime.description.trim().length > 76;
  const descriptionPreview =
    anime.description.trim().length > 76
      ? anime.description.trim().slice(0, 76).trimEnd() + "…"
      : anime.description;
  const descriptionControl = (id: string) => (
    <button
      type="button"
      onClick={() => setDescriptionExpanded((expanded) => !expanded)}
      aria-expanded={descriptionExpanded}
      aria-controls={id}
      className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-primary transition hover:text-neon"
    >
      {descriptionExpanded ? (
        <>
          {t("anime.collapseDescription")} <ChevronUp className="h-4 w-4" />
        </>
      ) : (
        <>
          {t("anime.expandDescription")} <ChevronDown className="h-4 w-4" />
        </>
      )}
    </button>
  );

  const descriptionText = (id: string) => (
    <>
      <p id={id} className="whitespace-pre-line text-sm leading-relaxed text-foreground/85">
        {descriptionExpanded || !needsDescriptionToggle ? anime.description : descriptionPreview}
      </p>
      {needsDescriptionToggle && descriptionControl(id)}
    </>
  );

  const watchButton = (
    <button
      type="button"
      onClick={scrollToTrailer}
      className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-neon px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-neon transition hover:brightness-110 md:w-auto"
    >
      <Play className="h-4 w-4 fill-current" />
      {language === "en" ? "Trailer" : "Трейлер"}
    </button>
  );

  const favoriteButton = (
    <button
      type="button"
      onClick={() => {
        setSaveSyncError(false);
        setIsFavorite(toggleSavedAnimeId(FAVORITES_STORAGE_KEY, anime.id));
        setShowListNote(true);
      }}
      className="inline-flex w-full min-w-0 flex-col items-center justify-center gap-1 rounded-full bg-secondary px-2 py-2.5 text-center text-[11px] font-semibold leading-tight ring-1 ring-border transition hover:bg-accent md:w-auto md:flex-row md:gap-2 md:px-4 md:py-2.5 md:text-sm md:leading-normal"
      aria-pressed={isFavorite}
    >
      <Heart className={`h-4 w-4 ${isFavorite ? "fill-current text-primary" : ""}`} />
      {isFavorite ? t("anime.inFavorites") : t("anime.addFavorite")}
    </button>
  );

  const episodeSubscriptionButton = anime.status === "Онгоинг" ? (
    <button
      type="button"
      disabled={subscriptionBusy}
      onClick={async () => {
        setSubscriptionBusy(true);
        try {
          const response = await fetch("/api/anime-subscriptions", {
            method: episodeSubscribed ? "DELETE" : "POST",
            credentials: "same-origin",
            cache: "no-store",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ animeId: anime.id }),
          });
          const payload = await response.json().catch(() => ({})) as { error?: string; subscribed?: boolean };
          if (response.status === 401) {
            navigateToSection("login");
            return;
          }
          if (!response.ok) throw new Error(payload.error ?? "subscription_failed");
          setEpisodeSubscribed(payload.subscribed === true);
        } catch {
          setSaveSyncError(true);
        } finally {
          setSubscriptionBusy(false);
        }
      }}
      aria-pressed={episodeSubscribed}
      className="inline-flex w-full min-w-0 flex-col items-center justify-center gap-1 rounded-full bg-secondary px-2 py-2.5 text-center text-[11px] font-semibold leading-tight ring-1 ring-border transition hover:bg-accent disabled:opacity-50 md:w-auto md:flex-row md:gap-2 md:px-4 md:py-2.5 md:text-sm md:leading-normal"
    >
      <Bell className={`h-4 w-4 ${episodeSubscribed ? "fill-current text-primary" : ""}`} />
      {language === "en" ? "Follow new episodes" : "Следить за новыми сериями"}
    </button>
  ) : null;

  const listButton = (
    <button
      type="button"
      onClick={() => {
        setSaveSyncError(false);
        setInList(toggleSavedAnimeId(WATCHLIST_STORAGE_KEY, anime.id));
        setShowListNote(true);
      }}
      className="inline-flex w-full min-w-0 flex-col items-center justify-center gap-1 rounded-full bg-secondary px-2 py-2.5 text-center text-[11px] font-semibold leading-tight ring-1 ring-border transition hover:bg-accent md:w-auto md:flex-row md:gap-2 md:px-4 md:py-2.5 md:text-sm md:leading-normal"
      aria-pressed={inList}
    >
      {inList ? <Check className="h-4 w-4" /> : <Bookmark className="h-4 w-4" />}
      {inList ? t("anime.inWatchlist") : t("anime.addWatchlist")}
    </button>
  );

  return (
    <div className="min-h-screen pb-28 md:pb-12">
      <Header
        view="catalog"
        setView={navigateToSection}
        onProfile={() => navigateToSection("profile")}
      />

      <main id="main-content" className="px-4 pt-24 md:px-10 md:pt-28">
        {apiError && (
          <p role="status" className="mx-auto mb-4 max-w-7xl rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-muted-foreground">
            {language === "en"
              ? "Shikimori is temporarily unavailable. Saved information is shown, and the episode schedule is hidden unless its date is still upcoming."
              : "Shikimori временно недоступен. Показана сохранённая информация; дата серии скрыта, если она уже прошла."}
          </p>
        )}
        <div className="mx-auto max-w-screen-2xl">
          <section className="relative isolate" aria-label={displayAnimeTitle(anime, language) + " — " + t("anime.sectionLabel")}>
            {anime.bannerUrl?.startsWith("https://s4.anilist.co/") && (
              <div className="pointer-events-none absolute inset-x-[-1rem] top-0 z-0 h-[680px] overflow-hidden md:inset-x-[-2.5rem] md:h-[620px]" aria-hidden="true">
                <img src={anime.bannerUrl} alt="" loading="eager" decoding="async" className="h-full w-full scale-105 object-cover object-[center_30%] opacity-65 blur-[0.5px]" />
                <div className="absolute inset-0 bg-gradient-to-b from-background/15 via-background/45 to-background" />
                <div className="absolute inset-0 bg-gradient-to-r from-background/20 via-transparent to-background/35" />
              </div>
            )}
            <button
              type="button"
              onClick={() => navigateToSection("catalog")}
              className="relative z-10 mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground transition hover:text-foreground"
            >
              <ChevronLeft className="h-4 w-4" />
              {t("anime.backCatalog")}
            </button>
            <div className="relative z-10 hidden items-start gap-6 p-5 md:grid md:grid-cols-[minmax(220px,280px)_minmax(0,1fr)] lg:gap-8 lg:p-8">
              <div className="mx-auto w-full max-w-[280px]">
                <PosterArt
                  anime={anime}
                  className="aspect-[2/3] w-full rounded-2xl ring-1 ring-white/10 shadow-[0_12px_36px_rgba(0,0,0,0.3)]"
                />
              </div>

              <div className="min-w-0 py-1 lg:py-3">
                <div className="mb-3 flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  <span>{displayAnimeStatus(anime.status, language)}</span>
                  <span className="h-1 w-1 rounded-full bg-primary" />
                  <span>{anime.year || t("anime.yearUnknown")}</span>
                </div>
                <h1 id="anime-title-desktop" className="max-w-4xl break-words text-3xl font-bold leading-tight lg:text-5xl">
                  {displayAnimeTitle(anime, language)}
                </h1>
                <p className="mt-2 text-sm text-muted-foreground lg:text-base">{anime.original}</p>

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  {anime.rating !== null && (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background/70 px-3 py-1.5 text-sm font-semibold">
                      <Star className="h-4 w-4 fill-gold text-gold" />
                      {anime.rating.toFixed(1)}
                    </span>
                  )}
                  <span className="rounded-full border border-border bg-background/70 px-3 py-1.5 text-sm">
                    {anime.episodes > 0 ? anime.episodes + " " + t("anime.series") : t("anime.episodesUnknown")}
                  </span>
                  {anime.kind && (
                    <span className="rounded-full border border-border bg-background/70 px-3 py-1.5 text-sm">
                      {displayAnimeKind(anime.kind, language)}
                    </span>
                  )}
                  {anime.ageRating && (
                    <span className="rounded-full border border-border bg-background/70 px-3 py-1.5 text-sm">
                      {anime.ageRating}
                    </span>
                  )}
                  {anime.genres.map((genre) => (
                    <span key={genre} className="rounded-full border border-border bg-background/70 px-3 py-1.5 text-sm">
                      {displayGenre(genre, language)}
                    </span>
                  ))}
                </div>

                {(formatAnimeDate(anime.airedOn, language) || formatAnimeDate(anime.nextEpisodeAt, language, true)) && (
                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    {formatAnimeDate(anime.airedOn, language) && (
                      <span>{t("anime.releaseDate")}: {formatAnimeDate(anime.airedOn, language)}</span>
                    )}
                    {formatAnimeDate(anime.nextEpisodeAt, language, true) && (
                      <span>{t("anime.nextEpisodeDate")}: {formatAnimeDate(anime.nextEpisodeAt, language, true)}</span>
                    )}
                  </div>
                )}

                {(anime.studios?.length || (anime.episodesAired ?? 0) > 0) && (
                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    {anime.studios?.length ? <span>{language === "en" ? "Studio" : "Студия"}: {anime.studios.join(", ")}</span> : null}
                    {(anime.episodesAired ?? 0) > 0 ? <span>{language === "en" ? "Episodes aired" : "Серии"}: {anime.episodesAired ?? 0}{anime.episodes > 0 ? (language === "en" ? " of " : " из ") + anime.episodes : ""}</span> : null}
                  </div>
                )}
                <div className="mt-5 max-w-3xl">
                  {descriptionText("anime-description-desktop")}
                </div>
                <div className="mt-6 flex flex-wrap gap-3">
                  {watchButton}
                  {favoriteButton}
                  {listButton}
                  {episodeSubscriptionButton}
                </div>
                {showListNote && (
                  <p className="mt-3 text-xs text-muted-foreground" aria-live="polite">
                    {authRequired
                      ? (language === "ru"
                        ? "Избранное и «Смотреть позже» доступны после входа в аккаунт."
                        : "Favorites and Watch Later are available after signing in.")
                      : saveSyncError
                        ? (language === "ru"
                          ? "Не удалось синхронизировать список с аккаунтом. Проверь соединение и повтори действие."
                          : "Could not sync this list to your account. Check your connection and try again.")
                        : (language === "ru" ? "Сохранено в аккаунте YUME." : "Saved to your YUME account.")}
                    {authRequired && (
                      <span className="mt-2 flex flex-wrap gap-2">
                        <button type="button" onClick={() => requestAuth("login")} className="font-semibold text-primary underline underline-offset-4">{language === "ru" ? "Войти через Telegram" : "Sign in with Telegram"}</button>
                        <button type="button" onClick={() => requestAuth("register")} className="font-semibold text-primary underline underline-offset-4">{language === "ru" ? "Регистрация" : "Register"}</button>
                      </span>
                    )}
                  </p>
                )}
              </div>
            </div>

            <div className="relative z-10 md:hidden">
              <div className="flex items-start gap-4">
                <div className="w-[38%] max-w-[190px] shrink-0">
                  <PosterArt anime={anime} className="aspect-[2/3] w-full rounded-2xl ring-1 ring-white/10 shadow-[0_12px_36px_rgba(0,0,0,0.3)]" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-primary">
                    {displayAnimeStatus(anime.status, language)} · {anime.year || t("anime.yearUnknown")}
                  </div>
                  <h1 id="anime-title-mobile" className="break-words text-2xl font-bold leading-tight">
                    {displayAnimeTitle(anime, language)}
                  </h1>
                  <p className="mt-1 break-words text-xs text-muted-foreground">{anime.original}</p>
                  <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs">
                    {anime.rating !== null && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-1 font-semibold">
                        <Star className="h-3 w-3 fill-gold text-gold" />
                        {anime.rating.toFixed(1)}
                      </span>
                    )}
                    <span className="rounded-full bg-secondary px-2 py-1">{anime.episodes > 0 ? anime.episodes + " " + t("anime.series") : t("anime.episodesUnknown")}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {anime.genres.map((genre) => (
                      <span key={genre} className="rounded-full border border-border px-2 py-1 text-[11px] text-muted-foreground">
                        {displayGenre(genre, language)}
                      </span>
                    ))}
                    {anime.kind && <span className="rounded-full border border-border px-2 py-1 text-[11px] text-muted-foreground">{anime.kind}</span>}
                    {anime.ageRating && <span className="rounded-full border border-border px-2 py-1 text-[11px] text-muted-foreground">{anime.ageRating}</span>}
                  </div>
                  {(anime.studios?.length || (anime.episodesAired ?? 0) > 0) && (
                    <div className="mt-2 space-y-1 text-[11px] leading-relaxed text-muted-foreground">
                      {anime.studios?.length ? <p>{language === "en" ? "Studio" : "Студия"}: {anime.studios.join(", ")}</p> : null}
                      {(anime.episodesAired ?? 0) > 0 ? <p>{language === "en" ? "Episodes aired" : "Серии"}: {anime.episodesAired ?? 0}{anime.episodes > 0 ? (language === "en" ? " of " : " из ") + anime.episodes : ""}</p> : null}
                    </div>
                  )}
                  {(formatAnimeDate(anime.airedOn, language) || formatAnimeDate(anime.nextEpisodeAt, language, true)) && (
                    <div className="mt-3 space-y-1 text-xs text-muted-foreground">
                      {formatAnimeDate(anime.airedOn, language) && (
                        <p>{t("anime.releaseDate")}: {formatAnimeDate(anime.airedOn, language)}</p>
                      )}
                      {formatAnimeDate(anime.nextEpisodeAt, language, true) && (
                        <p>{t("anime.nextEpisodeDate")}: {formatAnimeDate(anime.nextEpisodeAt, language, true)}</p>
                      )}
                    </div>
                  )}

                </div>
              </div>
              <div className="mt-4 grid gap-2">
                {watchButton}
                <div className={"grid gap-2 " + (episodeSubscriptionButton ? "grid-cols-3" : "grid-cols-2")}>
                  {favoriteButton}
                  {listButton}
                  {episodeSubscriptionButton}
                </div>
              </div>
              {showListNote && (
                <p className="mt-3 text-xs text-muted-foreground" aria-live="polite">
                  {authRequired
                    ? (language === "ru"
                      ? "Избранное и «Смотреть позже» доступны после входа в аккаунт."
                      : "Favorites and Watch Later are available after signing in.")
                    : saveSyncError
                      ? (language === "ru"
                        ? "Не удалось синхронизировать список с аккаунтом. Проверь соединение и повтори действие."
                        : "Could not sync this list to your account. Check your connection and try again.")
                      : t("anime.savedLocally")}
                  {authRequired && (
                    <span className="mt-2 flex flex-wrap gap-2">
                      <button type="button" onClick={() => requestAuth("login")} className="font-semibold text-primary underline underline-offset-4">{language === "ru" ? "Войти через Telegram" : "Sign in with Telegram"}</button>
                      <button type="button" onClick={() => requestAuth("register")} className="font-semibold text-primary underline underline-offset-4">{language === "ru" ? "Регистрация" : "Register"}</button>
                    </span>
                  )}
                </p>
              )}
              <div className="mt-5 rounded-2xl border border-white/10 bg-card/70 p-4">
                <h2 className="mb-2 text-sm font-semibold">{t("anime.description")}</h2>
                {descriptionText("anime-description-mobile")}
              </div>
            </div>
          </section>

          {displayableScreenshots.length > 0 && (
            <section aria-labelledby="anime-screenshots-title" className="relative z-10 mt-5 md:mt-6">
              <h2 id="anime-screenshots-title" className="mb-3 text-xl font-bold md:text-2xl">
                {language === "en" ? "Screenshots" : "Кадры"}
              </h2>
              <div className="scrollbar-none flex snap-x snap-mandatory gap-2 overflow-x-auto overscroll-x-contain px-0.5 pb-2">
                {displayableScreenshots.map((screenshot, index) => (
                  <button
                    key={screenshot.originalUrl}
                    type="button"
                    onClick={(event) => {
                      screenshotTriggerRef.current = event.currentTarget;
                      setActiveScreenshotIndex(index);
                    }}
                    aria-label={language === "en" ? "Open screenshot " + (index + 1) : "Открыть кадр " + (index + 1)}
                    className="group relative aspect-video w-[68vw] max-w-[280px] shrink-0 snap-start overflow-hidden rounded-xl border border-white/10 bg-card shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    <img
                      src={screenshot.previewUrl}
                      alt={language === "en" ? "Anime screenshot " + (index + 1) : "Кадр из аниме " + (index + 1)}
                      loading="lazy"
                      decoding="async"
                      className="h-full w-full object-cover transition duration-200 group-hover:scale-[1.03]"
                    />
                  </button>
                ))}
              </div>
            </section>
          )}

          <section ref={trailerSectionRef} id="trailer" aria-labelledby="trailer-title" className="mt-10 scroll-mt-24 md:mt-12">
            <div className="mb-4"><h2 id="trailer-title" className="text-2xl font-bold md:text-3xl">{t("anime.trailerTitle")}</h2></div>
            <div className="mx-auto w-full max-w-6xl min-w-0">
              {anime.youtubeTrailerId ? (
                <div className="relative mx-auto aspect-video w-full min-w-0 overflow-hidden rounded-2xl border border-white/10 bg-[#080710] shadow-2xl">
                  <iframe title={displayAnimeTitle(anime, language) + " — " + t("anime.trailerTitle")} src={"https://www.youtube-nocookie.com/embed/" + anime.youtubeTrailerId + "?rel=0"} className="absolute inset-0 h-full w-full" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerPolicy="strict-origin-when-cross-origin" allowFullScreen />
                </div>
              ) : (
                <div className="relative mx-auto flex aspect-video w-full min-w-0 flex-col items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-[#080710] p-5 text-center sm:min-h-[300px] lg:min-h-[420px]" style={{ background: "radial-gradient(ellipse at 50% 40%, oklch(0.19 0.08 " + anime.hue + ") 0%, #080710 63%)" }}>
                  <div aria-hidden="true" className="mb-4 flex h-16 w-16 items-center justify-center rounded-full border border-rose-500/40 bg-rose-500/10 text-rose-400"><X className="h-8 w-8" /></div>
                  <h3 className="text-lg font-semibold text-rose-300">{language === "en" ? "Trailer not found" : "Трейлер не найден"}</h3>
                  <p className="mt-2 max-w-md text-sm leading-relaxed text-rose-100/75">{language === "en" ? "There is no available trailer for this anime yet." : "Для этого аниме пока нет доступного трейлера."}</p>
                </div>
              )}
            </div>
          </section>

          <section className="mt-8">
            <div className="mb-4 flex items-end justify-between">
              <div>
                <h2 className="text-xl font-bold md:text-2xl">{t("anime.similar")}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{t("anime.similarSubtitle")}</p>
              </div>
            </div>
            <div className="scrollbar-none flex gap-4 overflow-x-auto pb-3">
              {relatedAnime.map((item) => (
                <AnimeCard
                  key={item.id}
                  anime={item}
                  onSelect={(nextAnime) =>
                    navigate({ to: "/anime/$animeId", params: { animeId: nextAnime.id } })
                  }
                />
              ))}
            </div>
          </section>
        </div>
      </main>

      {activeScreenshotIndex !== null && displayableScreenshots[activeScreenshotIndex] && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/90 p-3 backdrop-blur-sm sm:p-6"
          role="presentation"
          onClick={() => setActiveScreenshotIndex(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={language === "en" ? "Anime screenshot viewer" : "Просмотр кадра из аниме"}
            className="relative flex max-h-[94dvh] max-w-[96vw] items-center justify-center"
            onClick={(event) => event.stopPropagation()}
          >
            <button type="button" onClick={() => setActiveScreenshotIndex(null)} aria-label={language === "en" ? "Close screenshot" : "Закрыть кадр"} className="absolute -right-1 -top-1 z-10 rounded-full border border-white/20 bg-black/70 p-2 text-white shadow-lg sm:right-2 sm:top-2">
              <X className="h-5 w-5" />
            </button>
            {screenshots.length > 1 && (
              <button type="button" onClick={() => setActiveScreenshotIndex((current) => current === null ? current : (current - 1 + screenshots.length) % screenshots.length)} aria-label={language === "en" ? "Previous screenshot" : "Предыдущий кадр"} className="absolute left-1 top-1/2 z-10 -translate-y-1/2 rounded-full border border-white/20 bg-black/70 p-2 text-white shadow-lg sm:left-3">
                <ChevronLeft className="h-5 w-5" />
              </button>
            )}
            <img src={displayableScreenshots[activeScreenshotIndex].originalUrl} alt={language === "en" ? "Anime screenshot " + (activeScreenshotIndex + 1) : "Кадр из аниме " + (activeScreenshotIndex + 1)} className="max-h-[86dvh] max-w-[94vw] select-none object-contain" decoding="async" />
            {screenshots.length > 1 && (
              <button type="button" onClick={() => setActiveScreenshotIndex((current) => current === null ? current : (current + 1) % screenshots.length)} aria-label={language === "en" ? "Next screenshot" : "Следующий кадр"} className="absolute right-1 top-1/2 z-10 -translate-y-1/2 rounded-full border border-white/20 bg-black/70 p-2 text-white shadow-lg sm:right-3">
                <ChevronRight className="h-5 w-5" />
              </button>
            )}
          </div>
        </div>
      )}

      <Footer onNavigate={navigateToSection} />

    </div>
  );
}
