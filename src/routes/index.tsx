import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDownWideNarrow, ChevronDown, ChevronRight, Search, SlidersHorizontal, X, UserRound, Globe, Sun, Moon, Monitor, ShieldCheck, Play, ListChecks, CircleCheck, Clock3, Download, Database, Settings, History, Bell, CheckCheck, Sparkles } from "lucide-react";
import { COLLECTIONS, type Anime } from "@/data/anime";
import { getShikimoriCatalog } from "@/data/shikimori";
import { getExactReleaseDate, isNewRelease, isUpcomingAnnouncement } from "@/data/anime-sections";
import { Header, type View } from "@/components/yume/Header";
import { AuthPage } from "@/components/yume/AuthPage";
import { AnimeCard } from "@/components/yume/Poster";
import { CollectionsGrid, Grid, Hero, Row } from "@/components/yume/Sections";
import { CatalogFilters, EMPTY_CATALOG_FILTERS, type CatalogFiltersValue } from "@/components/yume/CatalogFilters";
import { Profile } from "@/components/yume/Profile";
import { Footer } from "@/components/yume/Footer";
import { HomeDepthAtmosphere } from "@/components/yume/HomeDepthAtmosphere";
import "../home-depth.css";
import { useYumePreferences, displayGenre, type TranslationKey } from "@/data/preferences";
import { filterAndSortCatalog, getCatalogPageCount, paginateCatalog } from "@/data/catalog-utils";
import { validateCatalogSearch } from "@/data/catalog-search";
import homeSocialImage from "@/assets/yume-desktop.webp";
import { absoluteImageUrl, canonicalUrl } from "@/data/seo";
import { getTelegramWebApp, telegramHapticImpact } from "@/lib/telegram-mini-app";
import { setProfileStorageAuthenticated, syncTelegramLibrary } from "@/data/profile-storage";
import { USER_NOTIFICATIONS } from "@/data/notifications.shared";
import { runAdminTrailerUpdate, type AdminTrailerStats } from "@/data/admin-trailer-update";

const NOTIFICATION_STORAGE_KEY = "yume-user-notifications-read-v1";
const NOTIFICATION_DISMISSED_STORAGE_KEY = "yume-user-notifications-dismissed-v1";

function readLocalNotificationIds(): string[] {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(NOTIFICATION_STORAGE_KEY) ?? "[]");
    return Array.isArray(value) ? value.filter((id): id is string =>
      typeof id === "string" && USER_NOTIFICATIONS.some((item) => item.id === id),
    ) : [];
  } catch {
    return [];
  }
}

function readLocalDismissedNotificationIds(): string[] {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(NOTIFICATION_DISMISSED_STORAGE_KEY) ?? "[]");
    return Array.isArray(value) ? value.filter((id): id is string =>
      typeof id === "string" && USER_NOTIFICATIONS.some((item) => item.id === id),
    ) : [];
  } catch {
    return [];
  }
}

function saveLocalDismissedNotificationIds(ids: string[]): boolean {
  try {
    window.localStorage.setItem(NOTIFICATION_DISMISSED_STORAGE_KEY, JSON.stringify(ids));
    return true;
  } catch {
    return false;
  }
}

function saveLocalNotificationIds(ids: string[]): boolean {
  try {
    window.localStorage.setItem(NOTIFICATION_STORAGE_KEY, JSON.stringify(ids));
    return true;
  } catch {
    return false;
  }
}

type MetadataCatalogStats = { total:number; incomplete:number; complete:number; announced:number; missingTrailer:number; hasTrailer:number; savedScreenshotUrls:number; screenshotDone:number; screenshotRetry:number; screenshotFailed:number };

export const Route = createFileRoute("/")({
  head: () => {
    const image = absoluteImageUrl(homeSocialImage);
    return {
      meta: [
        { title: "YUME — смотри аниме онлайн" },
        {
          name: "description",
          content: "YUME — каталог аниме с рейтингами, новинками и тематическими подборками.",
        },
        { property: "og:title", content: "YUME — больше чем аниме" },
        {
          property: "og:description",
          content: "Открой свой мир в YUME: популярное, новинки и подборки.",
        },
        { property: "og:type", content: "website" },
        { property: "og:url", content: canonicalUrl("/") },
        ...(image ? [{ property: "og:image", content: image }, { name: "twitter:image", content: image }] : []),
        { name: "twitter:card", content: "summary_large_image" },
      ],
      links: [{ rel: "canonical", href: canonicalUrl("/") }],
    };
  },
  validateSearch: validateCatalogSearch,
  loaderDeps: ({ search }) => ({
    section: search.section, q: search.q, page: search.page, sort: search.sort,
    genres: search.genres, status: search.status, from: search.from, to: search.to,
    rating: search.rating, kind: search.kind, age: search.age, lang: search.lang,
  }),
  loader: async ({ deps }) => {
    const catalog = await getShikimoriCatalog({ data: {} });
    if (deps.section === "catalog") {
      const allItems = catalog.items;
      const filters: CatalogFiltersValue = {
        ...EMPTY_CATALOG_FILTERS,
        genres: (deps.genres ?? "").split(",").filter(Boolean).slice(0, 20),
        status: deps.status ?? EMPTY_CATALOG_FILTERS.status,
        yearFrom: deps.from === undefined ? "" : String(deps.from),
        yearTo: deps.to === undefined ? "" : String(deps.to),
        minRating: deps.rating ?? 0,
        type: deps.kind ?? EMPTY_CATALOG_FILTERS.type,
        ageRating: deps.age ?? EMPTY_CATALOG_FILTERS.ageRating,
      };
      const sort = (deps.sort ?? "rating") as "rating" | "newest" | "oldest" | "title";
      const results = filterAndSortCatalog(allItems, deps.q ?? "", filters, sort, deps.lang ?? "ru", displayGenre);
      const pageSize = 20, pageCount = getCatalogPageCount(results.length, pageSize);
      const page = Math.min(Math.max(1, deps.page ?? 1), pageCount);
      const years = allItems.map(a => a.year).filter(y => Number.isFinite(y) && y > 0);
      return {
        catalogMode: "paged",
        anime: paginateCatalog(results, page, pageSize), popular: [],
        sectionFeeds: { airing: [], newReleases: [], announcements: [] }, catalogIds: [],
        catalogTotal: results.length, catalogPage: page,
        catalogFacets: {
          genres: Array.from(new Set(allItems.flatMap(a => a.genres))).sort((a,b)=>a.localeCompare(b,"ru")),
          statuses: ["Онгоинг","Анонс","Вышел","Неизвестно"],
          types: Array.from(new Set(allItems.map(a=>a.kind?.trim() || (a.episodes===1 ? "Фильм" : "TV")))).filter(Boolean).sort((a,b)=>a.localeCompare(b,"ru")),
          ageRatings: Array.from(new Set(allItems.map(a=>a.ageRating).filter((v):v is string=>Boolean(v)))),
          yearMin: years.length ? Math.min(...years) : 1900,
          yearMax: years.length ? Math.max(...years) : new Date().getFullYear(),
        },
        apiError: catalog.error, catalogProgress: catalog.progress,
      };
    }
    const refreshedItems = catalog.items;
    const popular = refreshedItems.filter((anime) => (anime.rating ?? 0) >= 8).sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1));
    const sectionFeeds = {
      airing: refreshedItems.filter((anime) => anime.status === "Онгоинг").sort((a, b) => (b.airedOn ?? "").localeCompare(a.airedOn ?? "") || b.year - a.year),
      newReleases: refreshedItems.filter((anime) => isNewRelease(anime)).sort((a, b) => (b.airedOn ?? "").localeCompare(a.airedOn ?? "") || (b.rating ?? -1) - (a.rating ?? -1)),
      announcements: refreshedItems.filter((anime) => anime.status === "Анонс").sort((a, b) => {
        const aDate = getExactReleaseDate(a.airedOn), bDate = getExactReleaseDate(b.airedOn);
        if (aDate && bDate) return aDate.localeCompare(bDate);
        if (aDate) return -1;
        if (bDate) return 1;
        return a.year - b.year || (b.rating ?? -1) - (a.rating ?? -1);
      }),
    };

    return {
      anime: refreshedItems,
      popular,
      sectionFeeds,
      catalogIds: refreshedItems.map((anime) => anime.id),
      apiError: catalog.error,
      catalogProgress: catalog.progress,
      catalogMode: "full", catalogTotal: refreshedItems.length, catalogPage: 1, catalogFacets: null,
    };
  },
  component: Index,
});

function SeeAll({ onClick }: { onClick: () => void }) {
  const { t } = useYumePreferences();
  return (
    <button onClick={onClick} className="flex items-center text-sm text-muted-foreground hover:text-primary">
      {t("footer.seeAll")} <ChevronRight className="h-4 w-4" />
    </button>
  );
}

function CatalogSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div
      aria-hidden="true"
      className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5"
    >
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="animate-pulse">
          <div className="aspect-[2/3] rounded-xl bg-white/5" />
          <div className="mt-3 h-3 w-3/4 rounded bg-white/5" />
          <div className="mt-2 h-3 w-1/2 rounded bg-white/5" />
        </div>
      ))}
    </div>
  );
}

function PageNavigation({
  page,
  totalPages,
  onPageChange,
  ariaLabel,
  previousLabel,
  nextLabel,
}: {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  ariaLabel: string;
  previousLabel: string;
  nextLabel: string;
}) {
  if (totalPages <= 1) return null;

  const changePage = (nextPage: number) => {
    onPageChange(nextPage);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const visiblePages = Array.from({ length: totalPages }, (_, index) => index + 1)
    .filter((candidate) => candidate === 1 || candidate === totalPages || Math.abs(candidate - page) <= 1)
    .reduce<(number | "ellipsis")[]>((pages, candidate, index, visible) => {
      if (index > 0 && candidate - visible[index - 1]! > 1) pages.push("ellipsis");
      pages.push(candidate);
      return pages;
    }, []);

  return (
    <nav aria-label={ariaLabel} className="mt-8 flex flex-wrap items-center justify-center gap-1.5">
      <button type="button" disabled={page === 1} onClick={() => changePage(Math.max(1, page - 1))} className="h-9 rounded-lg border border-border px-3 text-sm transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-35">{previousLabel}</button>
      {visiblePages.map((candidate, index) => candidate === "ellipsis"
        ? <span key={"ellipsis-" + index} className="px-1 text-muted-foreground">…</span>
        : <button key={candidate} type="button" aria-current={page === candidate ? "page" : undefined} onClick={() => changePage(candidate)} className={"h-9 min-w-9 rounded-lg border px-3 text-sm transition " + (page === candidate ? "border-primary/70 bg-primary/20 text-foreground" : "border-border hover:bg-accent")}>{candidate}</button>)}
      <button type="button" disabled={page === totalPages} onClick={() => changePage(Math.min(totalPages, page + 1))} className="h-9 rounded-lg border border-border px-3 text-sm transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-35">{nextLabel}</button>
    </nav>
  );
}
function HomeQuickControls({ onProfile }: { onProfile: () => void }) {
  const { t, language, setLanguage, theme, setTheme } = useYumePreferences();
  const [openMenu, setOpenMenu] = useState<"language" | "theme" | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!openMenu) return;
    const closeOnOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpenMenu(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenMenu(null);
    };
    document.addEventListener("pointerdown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [openMenu]);

  const languageOptions = [
    { value: "ru" as const, label: "Русский", flag: "🇷🇺" },
    { value: "en" as const, label: "English", flag: "🇬🇧" },
  ];
  const themeOptions = [
    { value: "light" as const, label: t("settings.light"), icon: Sun },
    { value: "dark" as const, label: t("settings.dark"), icon: Moon },
    { value: "system" as const, label: t("settings.system"), icon: Monitor },
  ];

  return (
    <div ref={rootRef} className="relative z-30 mx-4 my-3 grid grid-cols-3 items-start gap-2 md:mx-10 md:gap-3">
      <button
        type="button"
        onClick={onProfile}
        className="flex min-h-12 w-full items-center justify-center gap-2 whitespace-nowrap rounded-full border border-primary/35 bg-card/80 px-2 text-sm font-medium text-foreground shadow-[0_4px_18px_rgba(156,92,255,0.08)] transition hover:border-primary/70 hover:bg-accent/70 sm:text-base"
      >
        <UserRound className="h-4 w-4 shrink-0 sm:h-5 sm:w-5" />
        <span>{t("nav.profileButton")}</span>
      </button>

      <div className="relative min-w-0">
        <button
          type="button"
          aria-haspopup="listbox"
          aria-expanded={openMenu === "language"}
          onClick={() => setOpenMenu((current) => current === "language" ? null : "language")}
          className={`flex min-h-12 w-full items-center justify-center gap-1.5 whitespace-nowrap rounded-full border px-2 text-sm font-medium transition sm:gap-2 sm:text-base ${openMenu === "language" ? "border-primary bg-accent/70 shadow-neon" : "border-primary/35 bg-card/80 hover:border-primary/70 hover:bg-accent/70"}`}
        >
          <Globe className="h-4 w-4 shrink-0 sm:h-5 sm:w-5" />
          <span className="whitespace-nowrap">{language === "ru" ? "Язык" : "Language"}</span>
          <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${openMenu === "language" ? "rotate-180" : ""}`} />
        </button>
        {openMenu === "language" && (
          <div role="listbox" aria-label={t("settings.language")} className="absolute left-0 top-[calc(100%+0.5rem)] z-50 min-w-[9.5rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-border bg-popover p-1.5 text-popover-foreground shadow-2xl backdrop-blur-xl">
            {languageOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={language === option.value}
                onClick={() => { setLanguage(option.value); setOpenMenu(null); }}
                className={`flex w-full items-center gap-2 whitespace-nowrap rounded-xl px-2 py-2.5 text-left text-xs transition sm:text-sm ${language === option.value ? "bg-primary/20 text-popover-foreground" : "text-popover-foreground/85 hover:bg-accent/70"}`}
              >
                <span aria-hidden="true">{option.flag}</span>
                <span className="min-w-0 flex-1 whitespace-nowrap">{option.label}</span>
                <span className={`h-3.5 w-3.5 shrink-0 rounded-full border ${language === option.value ? "border-primary bg-primary shadow-[inset_0_0_0_3px_#171020]" : "border-muted-foreground/60"}`} />
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="relative min-w-0">
        <button
          type="button"
          aria-haspopup="listbox"
          aria-expanded={openMenu === "theme"}
          onClick={() => setOpenMenu((current) => current === "theme" ? null : "theme")}
          className={`flex min-h-12 w-full items-center justify-center gap-1.5 whitespace-nowrap rounded-full border px-2 text-sm font-medium transition sm:gap-2 sm:text-base ${openMenu === "theme" ? "border-primary bg-accent/70 shadow-neon" : "border-primary/35 bg-card/80 hover:border-primary/70 hover:bg-accent/70"}`}
        >
          {theme === "light" ? <Sun className="h-4 w-4 shrink-0 sm:h-5 sm:w-5" /> : theme === "system" ? <Monitor className="h-4 w-4 shrink-0 sm:h-5 sm:w-5" /> : <Moon className="h-4 w-4 shrink-0 sm:h-5 sm:w-5" />}
          <span className="whitespace-nowrap">{language === "ru" ? "Тема" : "Theme"}</span>
          <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${openMenu === "theme" ? "rotate-180" : ""}`} />
        </button>
        {openMenu === "theme" && (
          <div role="listbox" aria-label={t("settings.theme")} className="absolute right-0 top-[calc(100%+0.5rem)] z-50 min-w-[13rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-border bg-popover p-1.5 text-popover-foreground shadow-2xl backdrop-blur-xl">
            {themeOptions.map((option) => {
              const Icon = option.icon;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={theme === option.value}
                  onClick={() => { setTheme(option.value); setOpenMenu(null); }}
                  className={`flex w-full items-center gap-2 whitespace-nowrap rounded-xl px-2 py-2.5 text-left text-xs transition sm:text-sm ${theme === option.value ? "bg-primary/20 text-popover-foreground" : "text-popover-foreground/85 hover:bg-accent/70"}`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="min-w-0 flex-1">{option.label}</span>
                  <span className={`h-3.5 w-3.5 shrink-0 rounded-full border ${theme === option.value ? "border-primary bg-primary shadow-[inset_0_0_0_3px_#171020]" : "border-muted-foreground/60"}`} />
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function Index() {
  const { t, language } = useYumePreferences();
  const navigate = useNavigate();
  useEffect(() => {
    const metadata = language === "en"
      ? {
          title: "YUME — watch anime online",
          description: "YUME — an anime catalog with themed collections and top-rated titles.",
          ogTitle: "YUME — more than anime",
          ogDescription: "Discover your world in YUME: popular anime, new releases and collections.",
        }
      : {
          title: "YUME — смотри аниме онлайн",
          description: "YUME — каталог аниме, тематические подборки и рейтинг лучших тайтлов.",
          ogTitle: "YUME — больше чем аниме",
          ogDescription: "Открой свой мир в YUME: популярное, новинки и подборки.",
        };
    document.title = metadata.title;
    document.querySelector('meta[name="description"]')?.setAttribute("content", metadata.description);
    document.querySelector('meta[property="og:title"]')?.setAttribute("content", metadata.ogTitle);
    document.querySelector('meta[property="og:description"]')?.setAttribute("content", metadata.ogDescription);
  }, [language]);
  const { section, q: urlQuery, page: urlPage, sort: urlSort, genres: urlGenres, status: urlStatus, from: urlFrom, to: urlTo, rating: urlRating, kind: urlKind, age: urlAge, lang: urlLang } = Route.useSearch();
  const {
    anime: loadedAnime,
    popular: initialPopularAnime,
    sectionFeeds: initialSectionFeeds,
    catalogIds,
    apiError,
    catalogProgress: initialCatalogProgress, catalogMode, catalogTotal: initialCatalogTotal, catalogPage: loadedCatalogPage, catalogFacets,
  } = Route.useLoaderData();
  const [catalogAnime, setCatalogAnime] = useState<Anime[]>(loadedAnime);
  const [popularAnime, setPopularAnime] = useState<Anime[]>(initialPopularAnime);
  const [catalogProgress, setCatalogProgress] = useState(initialCatalogProgress);
  const [sectionFeeds, setSectionFeeds] = useState(initialSectionFeeds);
  const allowedCatalogIds = useMemo(() => new Set(catalogIds), [catalogIds]);
  const catalogAnimeRef = useRef(catalogAnime);
  const ANIME = catalogAnime;
  // Initialize view before effects that read it during server-side rendering.
  const [view, setViewRaw] = useState<View>(section ?? "home");


  useEffect(() => {
    if (catalogMode === "full" || view === "catalog") {
      setCatalogAnime(loadedAnime);
      catalogAnimeRef.current = loadedAnime;
    }
    if (catalogMode === "full") {
      setPopularAnime(initialPopularAnime);
      setSectionFeeds(initialSectionFeeds);
      setCatalogProgress(initialCatalogProgress);
    }
  }, [loadedAnime, initialPopularAnime, initialSectionFeeds, initialCatalogProgress, view, catalogMode]);
  useEffect(() => { catalogAnimeRef.current = catalogAnime; }, [catalogAnime]);

  const [catalogLoadState, setCatalogLoadState] = useState<"idle" | "loading" | "loaded" | "error">("idle");
  const [catalogLoadError, setCatalogLoadError] = useState<string | null>(null);
  const catalogLoadStarted = useRef(false);
  const [catalogLoadAttempt, setCatalogLoadAttempt] = useState(0);
  const [isTelegramMiniApp, setIsTelegramMiniApp] = useState(false);
  const [telegramDetectionComplete, setTelegramDetectionComplete] = useState(false);
  const [telegramConsentRequired, setTelegramConsentRequired] = useState(false);
  const [telegramConsentPending, setTelegramConsentPending] = useState(false);
  const [telegramConsentSubmitting, setTelegramConsentSubmitting] = useState(false);
  const [telegramAuthError, setTelegramAuthError] = useState("");
  const [telegramAuthReady, setTelegramAuthReady] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminCheckComplete, setAdminCheckComplete] = useState(false);
  const [adminStats, setAdminStats] = useState<AdminTrailerStats | null>(null);
  const [adminRunning, setAdminRunning] = useState(false);
  const [adminMessage, setAdminMessage] = useState("");
  const [notificationDraftTitle, setNotificationDraftTitle] = useState("");
  const [notificationDraftBody, setNotificationDraftBody] = useState("");
  const [notificationDraftTarget, setNotificationDraftTarget] = useState("");
  const [notificationPublishBusy, setNotificationPublishBusy] = useState(false);
  const [notificationItems, setNotificationItems] = useState<Array<{id:string;publishedAt:string;title:{ru:string;en:string};description:{ru:string;en:string};targetUrl?:string|null;dynamic?:boolean}>>([...USER_NOTIFICATIONS]);
  const [notificationReadIds, setNotificationReadIds] = useState<string[]>([]);
  const [notificationDismissedIds, setNotificationDismissedIds] = useState<string[]>([]);
  const notificationPointerStart = useRef<{ id: string; x: number; y: number; pointerId: number; startOffset: number } | null>(null);
  const [notificationSwipe, setNotificationSwipe] = useState<{ id: string; offset: number; dragging: boolean } | null>(null);
  const [expandedNotificationIds, setExpandedNotificationIds] = useState<string[]>([]);
  const [notificationStateLoaded, setNotificationStateLoaded] = useState(false);
  const [notificationRemoteAccount, setNotificationRemoteAccount] = useState(false);
  const [notificationActionBusy, setNotificationActionBusy] = useState(false);
  const [notificationActionMessage, setNotificationActionMessage] = useState("");
  const [trailerAuto, setTrailerAuto] = useState<{enabled:boolean;running:boolean;nextRunAt:number|null;lastRunAt:number|null;retryAt:number|null;lastError:string}>({enabled:false,running:false,nextRunAt:null,lastRunAt:null,retryAt:null,lastError:""});
  const [trailerAutoBusy, setTrailerAutoBusy] = useState(false);
  const [adminImportTarget, setAdminImportTarget] = useState("50");
  const [adminImportStatusFilter, setAdminImportStatusFilter] = useState("");
  const [adminBulkBlock18Plus, setAdminBulkBlock18Plus] = useState(true);
  const [adminBulkFilterBusy, setAdminBulkFilterBusy] = useState(false);
  const [adminDeleteQuery, setAdminDeleteQuery] = useState("");
  const [adminDeleteResults, setAdminDeleteResults] = useState<Array<{id:string;title:string;englishTitle:string|null;originalTitle:string;year:number;posterUrl:string|null;genres:string[];ageRating:string|null}>>([]);
  const [adminDeleteSearchBusy, setAdminDeleteSearchBusy] = useState(false);
  const [adminDeleteBusy, setAdminDeleteBusy] = useState<string|null>(null);
  const [adminDeleteMessage, setAdminDeleteMessage] = useState("");
  const [adminImportRunning, setAdminImportRunning] = useState(false);
  const [adminImport, setAdminImport] = useState<{target:number;cursor:number;added:number;skipped:number;incomplete:number;errors:number;state:string;delayMs?:number;statusFilter?:string}>({target:0,cursor:1,added:0,skipped:0,incomplete:0,errors:0,state:"idle",statusFilter:""});
  const [adminImportMessage, setAdminImportMessage] = useState("");
  const [adminImportTitleQuery, setAdminImportTitleQuery] = useState("");
  const [adminTitleSearchResults, setAdminTitleSearchResults] = useState<Array<{id:string;title:string;englishTitle:string;originalTitle:string;year:number;kind:string|null;status:string;posterUrl:string|null;genres:string[];ageRating:string|null;alreadyInCatalog:boolean}>>([]);
  const [adminTitleSearchBusy, setAdminTitleSearchBusy] = useState(false);
  const [adminTitleImportBusy, setAdminTitleImportBusy] = useState<string | null>(null);
  const [adminTitleSearchMessage, setAdminTitleSearchMessage] = useState("");
  const [metadataRefreshRunning, setMetadataRefreshRunning] = useState(false);
  const [sectionMetadataTarget, setSectionMetadataTarget] = useState<"ongoing" | "announcements">("ongoing");
  const [sectionMetadataBusy, setSectionMetadataBusy] = useState(false);
  const [metadataAutoBusy, setMetadataAutoBusy] = useState(false);
  const manualMetadataStopRef = useRef(false);
  const [metadataRefreshProgress, setMetadataRefreshProgress] = useState({ offset: 0, total: 0, updated: 0, screenshotsSaved: 0, bannersFound: 0, bannersMatched: 0, bannersSaved: 0, bannersAdded: 0, bannerErrors: 0, bannersStored: 0, phase: "metadata", metadataOffset: 0, screenshotOffset: 0, screenshotFailures: 0, screenshotRetries: 0 });
  const [metadataRefreshMessage, setMetadataRefreshMessage] = useState("");
  const [metadataCatalogStats, setMetadataCatalogStats] = useState<MetadataCatalogStats | null>(null);
  const [catalogQuality, setCatalogQuality] = useState<{id:string;title:string;year:number;missingYear:boolean;missingPoster:boolean;missingDescription:boolean}[]>([]);
  const [catalogQualityOffset, setCatalogQualityOffset] = useState(0);
  const [catalogQualityHasMore, setCatalogQualityHasMore] = useState(false);
  const [catalogQualitySummary, setCatalogQualitySummary] = useState({total:0,incomplete:0,missingYear:0,missingPoster:0,missingDescription:0});
  const [catalogFilter, setCatalogFilter] = useState<"all"|"year"|"poster"|"description">("all");
  const [catalogSelected, setCatalogSelected] = useState<string[]>([]);
  const [catalogQualityBusy, setCatalogQualityBusy] = useState(false);
  const [adminAuditLog, setAdminAuditLog] = useState<{id:number;action:string;status:string;details:Record<string,unknown>;created_at:string}[]>([]);
  const [maintenanceBusy, setMaintenanceBusy] = useState(false);
  const [maintenanceMessage, setMaintenanceMessage] = useState("");
  const [expandedAdminSections, setExpandedAdminSections] = useState({import:false,deletion:false,metadata:false,quality:false,maintenance:false,audit:false,trailers:false,notifications:false});
  const [historyItems, setHistoryItems] = useState<{ animeId: string; viewedAt: string; viewCount: number }[]>([]);
  const [historyDeletingIds, setHistoryDeletingIds] = useState<string[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyAuthenticated, setHistoryAuthenticated] = useState(false);
  const [historyError, setHistoryError] = useState("");

  useEffect(() => {
    setIsTelegramMiniApp(Boolean(getTelegramWebApp()?.initData));
    setTelegramDetectionComplete(true);
  }, []);

  useEffect(() => {
    if (view !== "admin") return;
    setExpandedAdminSections({import:false,deletion:false,metadata:false,quality:false,maintenance:false,audit:false,trailers:false,notifications:false});
  }, [view]);

  useEffect(() => {
    if (!telegramDetectionComplete) return;
    if (isTelegramMiniApp && !telegramAuthReady && !telegramConsentRequired && !telegramAuthError) return;
    let cancelled = false;
    setNotificationStateLoaded(false);
    const loadNotificationState = async () => {
      try {
        const response = await fetch("/api/notifications", {
          credentials: "same-origin",
          cache: "no-store",
        });
        if (!response.ok) throw new Error("Notification state unavailable");
        const payload = await response.json() as { authenticated?: boolean; readIds?: unknown; dismissedIds?: unknown; notifications?: unknown };
        if (cancelled) return;
        const ids = Array.isArray(payload.readIds)
          ? payload.readIds.filter((id): id is string => typeof id === "string")
          : [];
        if (payload.authenticated === true) {
          if (Array.isArray(payload.notifications)) setNotificationItems(payload.notifications.filter((item): item is {id:string;publishedAt:string;title:{ru:string;en:string};description:{ru:string;en:string};targetUrl?:string|null;dynamic?:boolean} => Boolean(item && typeof item === "object" && typeof (item as {id?:unknown}).id === "string" && typeof (item as {title?:unknown}).title === "object" && typeof (item as {description?:unknown}).description === "object")));
          setNotificationReadIds(ids);
          setNotificationDismissedIds(Array.isArray(payload.dismissedIds) ? payload.dismissedIds.filter((id): id is string => typeof id === "string") : []);
          setNotificationRemoteAccount(true);
        } else {
          setNotificationItems([...USER_NOTIFICATIONS]);
          setNotificationReadIds([]);
          setNotificationDismissedIds([]);
          setNotificationRemoteAccount(false);
        }
        setNotificationStateLoaded(true);
      } catch {
        if (cancelled) return;
        setNotificationItems([...USER_NOTIFICATIONS]);
        setNotificationReadIds([]);
        setNotificationDismissedIds([]);
        setNotificationRemoteAccount(false);
        setNotificationStateLoaded(true);
      }
    };
    void loadNotificationState();
    return () => { cancelled = true; };
  }, [isTelegramMiniApp, telegramAuthReady, telegramDetectionComplete, telegramConsentRequired, telegramAuthError]);

  useEffect(() => {
    if (!telegramDetectionComplete) return;
    let cancelled = false;
    // Check an existing session only. Opening the Mini App as a guest must not create an account.
    fetch("/api/telegram/init-data", { credentials: "same-origin", cache: "no-store" })
      .then(async (response) => {
        const result = await response.json().catch(() => ({})) as {
          authenticated?: boolean;
          user?: { id?: string };
        };
        if (cancelled) return;
        if (!response.ok || result.authenticated !== true || !result.user?.id) {
          setTelegramAuthReady(false);
          setProfileStorageAuthenticated(false);
          setTelegramAuthError("");
          return;
        }
        try {
          await syncTelegramLibrary(result.user.id);
        } catch {
          if (cancelled) return;
          setTelegramAuthReady(false);
          setProfileStorageAuthenticated(false);
          setTelegramAuthError(language === "ru"
            ? "Не удалось загрузить данные аккаунта. Проверь соединение и войди заново."
            : "Could not load account data. Check the connection and sign in again.");
          return;
        }
        if (cancelled) return;
        setProfileStorageAuthenticated(true);
        setTelegramAuthError("");
        setTelegramConsentPending(false);
        setTelegramConsentRequired(false);
        setTelegramAuthReady(true);
      })
      .catch(() => {
        if (!cancelled) {
          setTelegramAuthReady(false);
          setProfileStorageAuthenticated(false);
          setTelegramAuthError("");
        }
      });
    return () => { cancelled = true; };
  }, [telegramDetectionComplete, language]);

  useEffect(() => {
    if (!isTelegramMiniApp || !telegramAuthReady || telegramConsentRequired || telegramConsentPending) return;
    let cancelled = false;
    setAdminCheckComplete(false);
    setIsAdmin(false);
    setAdminStats(null);
    fetch("/api/admin/trailers", { credentials: "same-origin", cache: "no-store" })
      .then(async (response) => {
        const result = await response.json().catch(() => ({})) as {
          isAdmin?: boolean;
          total?: number;
          pending?: number;
          checked?: number;
          found?: number;
          missing?: number;
          catalogTotal?: number;
          catalogWithTrailer?: number;
          auto?: {enabled?:boolean;running?:boolean;nextRunAt?:number|null;lastRunAt?:number|null;retryAt?:number|null;lastError?:string};
        };
        if (cancelled) return;
        if (!response.ok || result.isAdmin !== true) {
          setIsAdmin(false);
          setAdminStats(null);
          setAdminCheckComplete(true);
          return;
        }
        setIsAdmin(true);
        if (result.auto) setTrailerAuto({enabled:result.auto.enabled===true,running:result.auto.running===true,nextRunAt:result.auto.nextRunAt ?? null,lastRunAt:result.auto.lastRunAt ?? null,retryAt:result.auto.retryAt ?? null,lastError:result.auto.lastError ?? ""});
        setAdminStats({
          total: Number(result.catalogTotal ?? 0),
          pending: Number(result.pending ?? 0),
          checked: Number(result.checked ?? 0),
          found: Number(result.catalogWithTrailer ?? 0),
          missing: Number(result.missing ?? 0),
        });
        setAdminCheckComplete(true);
      })
      .catch(() => {
        if (!cancelled) {
          setIsAdmin(false);
          setAdminStats(null);
          setAdminCheckComplete(true);
        }
      });
    return () => { cancelled = true; };
  }, [isTelegramMiniApp, telegramAuthReady, telegramConsentRequired, telegramConsentPending]);

  useEffect(() => {
    if (isTelegramMiniApp && telegramConsentPending && view !== "privacy-policy") {
      setTelegramConsentRequired(true);
    }
  }, [isTelegramMiniApp, telegramConsentPending, view]);

  const acceptTelegramConsent = () => {
    // Legacy consent prompt must never create an account outside the current registration form.
    setTelegramConsentRequired(false);
    setTelegramConsentPending(false);
    setView("register");
  };

  const toggleTrailerAuto = async () => {
    if (!isAdmin || trailerAutoBusy) return;
    setTrailerAutoBusy(true);
    try {
      const response = await fetch("/api/admin/trailers", {
        method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: trailerAuto.enabled ? "auto-disable" : "auto-enable" }),
      });
      const payload = await response.json().catch(() => ({})) as {isAdmin?:boolean;auto?:{enabled?:boolean;running?:boolean;nextRunAt?:number|null;lastRunAt?:number|null;retryAt?:number|null;lastError?:string};error?:string};
      if (!response.ok || payload.isAdmin !== true || !payload.auto) {
        setAdminMessage(language === "ru" ? "Не удалось изменить режим автообновления." : "Could not change automatic update mode.");
        return;
      }
      setTrailerAuto({enabled:payload.auto.enabled===true,running:payload.auto.running===true,nextRunAt:payload.auto.nextRunAt ?? null,lastRunAt:payload.auto.lastRunAt ?? null,retryAt:payload.auto.retryAt ?? null,lastError:payload.auto.lastError ?? ""});
      setAdminMessage(payload.auto.enabled
        ? (language === "ru" ? "Автообновление включено. Первый запуск начнётся в ближайшую минуту." : "Automatic updates enabled. The first run will start within a minute.")
        : (language === "ru" ? "Автообновление выключено." : "Automatic updates disabled."));
    } catch {
      setAdminMessage(language === "ru" ? "Не удалось связаться с сервером." : "Could not reach the server.");
    } finally { setTrailerAutoBusy(false); }
  };

  const dismissNotification = async (notificationId: string) => {
    if (notificationActionBusy || notificationDismissedIds.includes(notificationId)) return;
    const next = [...notificationDismissedIds, notificationId];
    setNotificationActionMessage("");
    try {
      if (notificationRemoteAccount) {
        const response = await fetch("/api/notifications", {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "dismiss-one", notificationId }),
        });
        if (response.status === 401) {
          setNotificationRemoteAccount(false);
        } else if (!response.ok) {
          throw new Error("Could not dismiss notification");
        } else {
          const payload = await response.json() as { dismissedIds?: unknown };
          const ids = Array.isArray(payload.dismissedIds)
            ? payload.dismissedIds.filter((id): id is string => typeof id === "string")
            : next;
          setNotificationDismissedIds(ids);
          setNotificationReadIds((current) => current.includes(notificationId) ? current : [...current, notificationId]);
          return;
        }
      }
      if (!saveLocalDismissedNotificationIds(next)) {
        setNotificationActionMessage(language === "ru" ? "Не удалось сохранить удаление. Попробуй ещё раз." : "Could not save this dismissal. Please try again.");
        return;
      }
      setNotificationDismissedIds(next);
      setNotificationReadIds((current) => current.includes(notificationId) ? current : [...current, notificationId]);
    } catch {
      setNotificationActionMessage(language === "ru" ? "Не удалось удалить уведомление. Попробуй ещё раз." : "Could not dismiss notification. Please try again.");
    }
  };

  const handleNotificationPointerDown = (notificationId: string, event: React.PointerEvent<HTMLElement>) => {
    if (event.pointerType === "mouse" || !event.isPrimary || notificationActionBusy) return;
    const startOffset = notificationSwipe?.id === notificationId ? notificationSwipe.offset : 0;
    notificationPointerStart.current = {
      id: notificationId,
      x: event.clientX,
      y: event.clientY,
      pointerId: event.pointerId,
      startOffset,
    };
  };

  const handleNotificationPointerMove = (notificationId: string, event: React.PointerEvent<HTMLElement>) => {
    const start = notificationPointerStart.current;
    if (!start || start.id !== notificationId || start.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - start.x;
    const deltaY = event.clientY - start.y;
    if (Math.abs(deltaX) < 5 || Math.abs(deltaX) < Math.abs(deltaY) * 1.15) return;
    const offset = Math.max(-112, Math.min(0, start.startOffset + deltaX));
    setNotificationSwipe({ id: notificationId, offset, dragging: true });
  };

  const handleNotificationPointerUp = (notificationId: string, event: React.PointerEvent<HTMLElement>) => {
    const start = notificationPointerStart.current;
    notificationPointerStart.current = null;
    if (!start || start.id !== notificationId || start.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - start.x;
    const deltaY = event.clientY - start.y;
    if (Math.abs(deltaX) > Math.abs(deltaY) * 1.15 && deltaX < -8) {
      const offset = notificationSwipe?.id === notificationId
        ? notificationSwipe.offset
        : Math.max(-112, start.startOffset + deltaX);
      setNotificationSwipe(offset <= -78 ? { id: notificationId, offset: -112, dragging: false } : null);
    } else if (start.startOffset < 0) {
      setNotificationSwipe(null);
    }
  };

  const toggleNotificationExpanded = (notificationId: string) => {
    const isExpanded = expandedNotificationIds.includes(notificationId);
    setExpandedNotificationIds((current) => current.includes(notificationId)
      ? current.filter((id) => id !== notificationId)
      : [...current, notificationId]);
    if (isExpanded || notificationReadIds.includes(notificationId)) return;

    const localIds = Array.from(new Set([...readLocalNotificationIds(), notificationId]));
    if (!notificationRemoteAccount) {
      setNotificationReadIds(localIds);
      if (!saveLocalNotificationIds(localIds)) {
        setNotificationActionMessage(language === "ru" ? "Не удалось сохранить отметку о прочтении." : "Could not save the read status.");
      }
      return;
    }

    // Mark an opened message read on the server as well, so its unread badge stays cleared after reloads.
    setNotificationReadIds((current) => current.includes(notificationId) ? current : [...current, notificationId]);
    void fetch("/api/notifications", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "read-one", notificationId }),
    }).then(async (response) => {
      const payload = await response.json().catch(() => ({})) as { authenticated?: boolean; readIds?: unknown };
      if (response.status === 401) {
        setNotificationRemoteAccount(false);
        const ids = Array.from(new Set([...readLocalNotificationIds(), notificationId]));
        saveLocalNotificationIds(ids);
        setNotificationReadIds(ids);
        return;
      }
      if (!response.ok || payload.authenticated !== true) throw new Error("Notification read status could not be saved.");
      if (Array.isArray(payload.readIds)) setNotificationReadIds(payload.readIds.filter((id): id is string => typeof id === "string"));
    }).catch(() => {
      setNotificationReadIds((current) => current.filter((id) => id !== notificationId));
      setNotificationActionMessage(language === "ru"
        ? "Не удалось сохранить прочтение уведомления. Попробуй ещё раз."
        : "Could not save the notification read status. Please try again.");
    });
  };

  const markAllNotificationsRead = async () => {
    if (notificationActionBusy) return;
    const allIds = notificationItems.map((item) => item.id);
    setNotificationActionBusy(true);
    setNotificationActionMessage("");
    try {
      if (notificationRemoteAccount) {
        const response = await fetch("/api/notifications", {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "read-all" }),
        });
        if (response.status === 401) {
          setNotificationRemoteAccount(false);
        } else if (!response.ok) {
          throw new Error("Could not update notification read state");
        } else {
          const payload = await response.json() as { authenticated?: boolean; readIds?: unknown };
          if (payload.authenticated !== true) throw new Error("Notification account session expired");
          const ids = Array.isArray(payload.readIds)
            ? payload.readIds.filter((id): id is string => typeof id === "string")
            : allIds;
          setNotificationReadIds(ids);
          setNotificationActionMessage(language === "ru" ? "Все уведомления прочитаны." : "All notifications marked as read.");
          return;
        }
      }
      if (!saveLocalNotificationIds(allIds)) {
        setNotificationActionMessage(language === "ru"
          ? "Не удалось сохранить отметку о прочтении. Проверь настройки хранения данных браузера."
          : "Could not save read status. Check your browser storage settings.");
        return;
      }
      setNotificationReadIds(allIds);
      setNotificationActionMessage(language === "ru" ? "Все уведомления прочитаны." : "All notifications marked as read.");
    } catch {
      setNotificationActionMessage(language === "ru"
        ? "Не удалось отметить уведомления как прочитанные. Попробуй ещё раз."
        : "Could not mark notifications as read. Please try again.");
    } finally {
      setNotificationActionBusy(false);
    }
  };

  const runTrailerUpdate = async () => {
    if (!isAdmin || adminRunning || adminStats?.missing === 0) return;
    setAdminRunning(true);
    setAdminMessage("");
    try {
      await runAdminTrailerUpdate({
        language,
        initialStats: adminStats ?? undefined,
        onStats: setAdminStats,
        onMessage: setAdminMessage,
      });
    } finally {
      setAdminRunning(false);
    }
  };

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    fetch("/api/admin/catalog-import", { credentials: "same-origin", cache: "no-store" })
      .then(async response => ({ response, payload: await response.json().catch(() => ({})) as {isAdmin?:boolean;target?:number;cursor?:number;added?:number;skipped?:number;incomplete?:number;errors?:number;state?:string;delayMs?:number;statusFilter?:string;bulkImportBlock18Plus?:boolean;quality?:typeof catalogQuality;qualitySummary?:typeof catalogQualitySummary;qualityOffset?:number;qualityHasMore?:boolean;auditLog?:typeof adminAuditLog} }))
      .then(({response,payload}) => {
        if (cancelled || !response.ok || payload.isAdmin !== true) return;
        setAdminImport({target:payload.target ?? 0,cursor:payload.cursor ?? 1,added:payload.added ?? 0,skipped:payload.skipped ?? 0,incomplete:payload.incomplete ?? 0,errors:payload.errors ?? 0,state:payload.state ?? "idle",delayMs:payload.delayMs,statusFilter:payload.statusFilter ?? ""});
        if (typeof payload.statusFilter === "string") setAdminImportStatusFilter(payload.statusFilter);
        if (typeof payload.bulkImportBlock18Plus === "boolean") setAdminBulkBlock18Plus(payload.bulkImportBlock18Plus);
        setCatalogQuality(payload.quality ?? []);
        setCatalogQualitySummary(payload.qualitySummary ?? {total:0,incomplete:0,missingYear:0,missingPoster:0,missingDescription:0});
        setCatalogQualityOffset(payload.qualityOffset ?? 0);
        setCatalogQualityHasMore(payload.qualityHasMore ?? false);
        setAdminAuditLog(payload.auditLog ?? []);
      }).catch(() => {});
    return () => { cancelled = true; };
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const response = await fetch("/api/admin/catalog-import?status=1", { credentials: "same-origin", cache: "no-store" });
        const payload = await response.json().catch(() => ({})) as {
          isAdmin?: boolean; target?:number; cursor?:number; added?:number; skipped?:number; incomplete?:number; errors?:number; state?:string; delayMs?:number; bulkImportBlock18Plus?:boolean;
          qualitySummary?:typeof catalogQualitySummary; quality?:typeof catalogQuality; qualityOffset?:number; qualityHasMore?:boolean;
          metadataRefresh?: { autoEnabled?: boolean; phase?: string; metadataOffset?: number; screenshotOffset?: number; total?: number; screenshotFailures?: number; screenshotRetries?: number; done?: boolean; stats?: MetadataCatalogStats; bannersFoundTotal?: number; bannersMatchedTotal?: number; bannersSavedTotal?: number; bannersAddedTotal?: number; bannerErrorsTotal?: number; bannersStored?: number };
        };
        if (cancelled || !response.ok || payload.isAdmin !== true || !payload.metadataRefresh) return;
        const status = payload.metadataRefresh;
        if (status.stats) setMetadataCatalogStats(status.stats);
        if (payload.qualitySummary) setCatalogQualitySummary(payload.qualitySummary);
        if (payload.quality) {
          setCatalogQuality(payload.quality);
          setCatalogQualityOffset(payload.qualityOffset ?? 0);
          setCatalogQualityHasMore(payload.qualityHasMore ?? false);
        }
        if (typeof payload.target === "number") setAdminImport({target:payload.target,cursor:payload.cursor??1,added:payload.added??0,skipped:payload.skipped??0,incomplete:payload.incomplete??0,errors:payload.errors??0,state:payload.state??"idle",delayMs:payload.delayMs});
        if (typeof payload.bulkImportBlock18Plus === "boolean") setAdminBulkBlock18Plus(payload.bulkImportBlock18Plus);
        const phase = status.phase ?? "idle";
        const total = status.total ?? 0;
        const offset = phase === "metadata" ? (status.metadataOffset ?? 0) : (status.screenshotOffset ?? 0);
        setMetadataRefreshProgress(current => {
          const metadataOffset = status.metadataOffset ?? current.metadataOffset;
          const screenshotOffset = status.screenshotOffset ?? current.screenshotOffset;
          return {
            ...current, phase, total: status.total ?? current.total,
            offset: phase === "metadata" ? metadataOffset : screenshotOffset,
            metadataOffset, screenshotOffset,
            screenshotFailures: status.screenshotFailures ?? current.screenshotFailures,
            screenshotRetries: status.screenshotRetries ?? current.screenshotRetries,
            bannersFound: status.bannersFoundTotal ?? current.bannersFound,
            bannersMatched: status.bannersMatchedTotal ?? current.bannersMatched,
            bannersSaved: status.bannersSavedTotal ?? current.bannersSaved,
            bannersAdded: status.bannersAddedTotal ?? current.bannersAdded,
            bannerErrors: status.bannerErrorsTotal ?? current.bannerErrors,
            bannersStored: status.bannersStored ?? current.bannersStored,
          };
        });
        const trailerResponse = await fetch("/api/admin/trailers", {credentials:"same-origin",cache:"no-store"});
        const trailerStats = await trailerResponse.json().catch(() => ({})) as {isAdmin?:boolean;total?:number;pending?:number;checked?:number;found?:number;missing?:number;catalogTotal?:number;catalogWithTrailer?:number};
        if (!cancelled && trailerResponse.ok && trailerStats.isAdmin) setAdminStats({total:trailerStats.catalogTotal??0,pending:trailerStats.pending??0,checked:trailerStats.checked??0,found:trailerStats.catalogWithTrailer??0,missing:trailerStats.missing??0});
      } catch { /* Status polling must not interrupt the server-side job. */ }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 5000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [isAdmin, language]);
  const refreshCatalogQuality = async (offset = catalogQualityOffset) => {
    const response = await fetch("/api/admin/catalog-import?qualityOffset=" + Math.max(0,offset), {credentials:"same-origin",cache:"no-store"});
    const payload = await response.json().catch(() => ({})) as {isAdmin?:boolean;error?:string;quality?:typeof catalogQuality;qualitySummary?:typeof catalogQualitySummary;qualityOffset?:number;qualityHasMore?:boolean;auditLog?:typeof adminAuditLog};
    if (!response.ok || payload.isAdmin !== true) throw new Error(payload.error ?? (language === "ru" ? "Не удалось обновить список." : "Could not refresh catalog."));
    setCatalogQuality(payload.quality ?? []);
    setCatalogQualitySummary(payload.qualitySummary ?? {total:0,incomplete:0,missingYear:0,missingPoster:0,missingDescription:0});
    setCatalogQualityOffset(payload.qualityOffset ?? offset);
    setCatalogQualityHasMore(payload.qualityHasMore ?? false);
    setAdminAuditLog(payload.auditLog ?? []);
  };

  const runCatalogQualityAction = async (action: "repair" | "delete") => {
    if (!isAdmin || catalogQualityBusy || catalogSelected.length === 0) return;
    const ids = catalogSelected.slice(0,100);
    if (action === "delete" && !window.confirm(language === "ru" ? "Удалить выбранные записи (" + ids.length + ")? Это действие нельзя отменить." : "Delete " + ids.length + " selected records? This cannot be undone.")) return;
    setCatalogQualityBusy(true);
    setAdminImportMessage("");
    try {
      const response = await fetch("/api/admin/catalog-import", {method:"POST",credentials:"same-origin",cache:"no-store",headers:{"Content-Type":"application/json"},body:JSON.stringify({action,ids})});
      const payload = await response.json().catch(() => ({})) as {isAdmin?:boolean;error?:string;message?:string;deleted?:number;repaired?:number;notFound?:number;stillIncomplete?:number};
      if (!response.ok || payload.isAdmin !== true) throw new Error(payload.message ?? payload.error ?? (language === "ru" ? "Операция не выполнена." : "Operation failed."));
      setCatalogSelected([]);
      setAdminImportMessage(action === "delete"
        ? (language === "ru" ? "Удалено записей: " + (payload.deleted ?? 0) + "." : "Records deleted: " + (payload.deleted ?? 0) + ".")
        : (language === "ru" ? "Обновлено: " + (payload.repaired ?? 0) + "; не найдено в Shikimori: " + (payload.notFound ?? 0) + "; всё ещё неполных по данным источника: " + (payload.stillIncomplete ?? 0) + "." : "Updated: " + (payload.repaired ?? 0) + "; not found on Shikimori: " + (payload.notFound ?? 0) + "; still incomplete at source: " + (payload.stillIncomplete ?? 0) + "."));
      await refreshCatalogQuality();
    } catch (error) {
      setAdminImportMessage(error instanceof Error ? error.message : (language === "ru" ? "Операция не удалась." : "Operation failed."));
    } finally {
      setCatalogQualityBusy(false);
    }
  };



  const resetMetadataRefresh = async () => {
    if (!isAdmin || metadataRefreshRunning || metadataAutoBusy || adminImportRunning || adminRunning) return;
    const confirmed = window.confirm(language === "ru"
      ? "Сбросить прогресс обновления метаданных и начать проверку с самого начала? Автообновление будет выключено. Существующие метаданные и скриншоты останутся без изменений."
      : "Reset metadata refresh progress and restart from the beginning? Automatic refresh will be disabled. Existing metadata and screenshots will be preserved.");
    if (!confirmed) return;
    setMetadataAutoBusy(true);
    setMetadataRefreshMessage(language === "ru" ? "Сбрасываю прогресс…" : "Resetting progress…");
    try {
      const response = await fetch("/api/admin/catalog-import", { method:"POST", credentials:"same-origin", cache:"no-store", headers:{"Content-Type":"application/json"}, body:JSON.stringify({action:"reset_metadata_refresh"}) });
      const payload = await response.json().catch(() => ({})) as {isAdmin?:boolean;error?:string;message?:string;total?:number;stats?:MetadataCatalogStats};
      if (!response.ok || payload.isAdmin !== true) throw new Error(payload.message ?? payload.error ?? "Could not reset metadata refresh.");
      setMetadataRefreshProgress({offset:0,total:payload.total??0,updated:0,screenshotsSaved:0,bannersFound:0,bannersMatched:0,bannersSaved:0,bannersAdded:0,bannerErrors:0,bannersStored:0,phase:"metadata",metadataOffset:0,screenshotOffset:0,screenshotFailures:payload.stats?.screenshotFailed??0,screenshotRetries:payload.stats?.screenshotRetry??0});
      setMetadataCatalogStats(payload.stats ?? null);
      setMetadataRefreshMessage(payload.message ?? (language === "ru" ? "Прогресс сброшен." : "Progress reset."));
      await refreshCatalogQuality(0);
      const trailerResponse = await fetch("/api/admin/trailers", {credentials:"same-origin",cache:"no-store"});
      const trailerStats = await trailerResponse.json().catch(() => ({})) as {isAdmin?:boolean;total?:number;pending?:number;checked?:number;found?:number;missing?:number;catalogTotal?:number;catalogWithTrailer?:number};
      if (trailerResponse.ok && trailerStats.isAdmin) setAdminStats({total:trailerStats.catalogTotal??0,pending:trailerStats.pending??0,checked:trailerStats.checked??0,found:trailerStats.catalogWithTrailer??0,missing:trailerStats.missing??0});
    } catch (error) {
      setMetadataRefreshMessage(error instanceof Error ? error.message : (language === "ru" ? "Не удалось сбросить прогресс." : "Could not reset progress."));
    } finally { setMetadataAutoBusy(false); }
  };

  const runMetadataRefresh = async () => {
    if (!isAdmin || metadataRefreshRunning || adminImportRunning || adminRunning) return;
    const confirmed = window.confirm(language === "ru"
      ? "Запустить ручное обновление каталога? Оно будет выполняться, пока эта страница открыта. Можно остановить в любой момент; прогресс сохранится."
      : "Start manual catalog refresh? It runs while this page stays open. You can stop it at any time; progress is saved.");
    if (!confirmed) return;
    manualMetadataStopRef.current = false;
    setMetadataRefreshRunning(true);
    setMetadataRefreshMessage(language === "ru" ? "Подготавливаю ручной запуск…" : "Preparing manual run…");
    try {
      const stopAuto = await fetch("/api/admin/catalog-import", { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "auto_stop" }) });
      const stopPayload = await stopAuto.json().catch(() => ({})) as { isAdmin?: boolean; error?: string };
      if (!stopAuto.ok || stopPayload.isAdmin !== true) throw new Error(stopPayload.error ?? "Could not disable automatic mode.");
      let finished = false;
      let requests = 0;
      while (!manualMetadataStopRef.current && !finished && requests < 1500) {
        requests++;
        const response = await fetch("/api/admin/catalog-import", { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "refresh_metadata" }) });
        const payload = await response.json().catch(() => ({})) as { isAdmin?: boolean; error?: string; message?: string; phase?: string; offset?: number; total?: number; metadataOffset?: number; screenshotOffset?: number; updated?: number; screenshotsSaved?: number; screenshotFailures?: number; screenshotRetries?: number; bannersFoundTotal?: number; bannersMatchedTotal?: number; bannersSavedTotal?: number; bannersAddedTotal?: number; bannerErrorsTotal?: number; bannersStored?: number; done?: boolean };
        if (response.status === 409) {
          await new Promise(resolve => window.setTimeout(resolve, 1500));
          continue;
        }
        if (payload.isAdmin !== true || !response.ok) throw new Error(payload.message ?? payload.error ?? (language === "ru" ? "Ручной шаг не выполнен." : "Manual step failed."));
        const phase = payload.phase ?? "metadata";
        const total = payload.total ?? 0;
        const offset = phase === "metadata" ? (payload.metadataOffset ?? payload.offset ?? 0) : (payload.screenshotOffset ?? payload.offset ?? 0);
        setMetadataRefreshProgress(current => ({ ...current, phase, total, offset, metadataOffset: payload.metadataOffset ?? current.metadataOffset, screenshotOffset: payload.screenshotOffset ?? current.screenshotOffset, updated: current.updated + (payload.updated ?? 0), screenshotsSaved: current.screenshotsSaved + (payload.screenshotsSaved ?? 0), bannersFound: payload.bannersFoundTotal ?? current.bannersFound, bannersMatched: payload.bannersMatchedTotal ?? current.bannersMatched, bannersSaved: payload.bannersSavedTotal ?? current.bannersSaved, bannersAdded: payload.bannersAddedTotal ?? current.bannersAdded, bannerErrors: payload.bannerErrorsTotal ?? current.bannerErrors, bannersStored: payload.bannersStored ?? current.bannersStored, screenshotFailures: payload.screenshotFailures ?? current.screenshotFailures, screenshotRetries: payload.screenshotRetries ?? current.screenshotRetries }));
        finished = payload.done === true || phase === "done";
        setMetadataRefreshMessage(language === "ru"
          ? (finished ? "Ручное обновление завершено." : manualMetadataStopRef.current ? "Ручной запуск остановлен. Прогресс сохранён." : "Ручное обновление: " + phase + ", " + offset + " / " + total + ".")
          : (finished ? "Manual refresh completed." : manualMetadataStopRef.current ? "Manual run stopped. Progress saved." : "Manual refresh: " + phase + ", " + offset + " / " + total + "."));
        if (!finished && !manualMetadataStopRef.current) await new Promise(resolve => window.setTimeout(resolve, 1250));
      }
      if (requests >= 1500 && !finished) setMetadataRefreshMessage(language === "ru" ? "Лимит шагов за запуск достигнут. Прогресс сохранён; нажми «Запустить вручную» для продолжения." : "Per-run step limit reached. Progress is saved; start manually again to continue.");
    } catch (error) {
      setMetadataRefreshMessage((error instanceof Error ? error.message : "Manual refresh failed") + (language === "ru" ? " Прогресс сохранён; можно запустить вручную ещё раз." : " Progress is saved; you can start manually again."));
    } finally {
      setMetadataRefreshRunning(false);
    }
  };

  const stopManualMetadataRefresh = () => {
    manualMetadataStopRef.current = true;
    setMetadataRefreshMessage(language === "ru" ? "Останавливаю после текущего шага…" : "Stopping after the current step…");
  };

  const runMaintenanceCheck = async () => {
    if (!isAdmin || maintenanceBusy) return;
    setMaintenanceBusy(true);
    setMaintenanceMessage("");
    try {
      const response = await fetch("/api/admin/catalog-import", {method:"POST",credentials:"same-origin",cache:"no-store",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"maintenance"})});
      const payload = await response.json().catch(() => ({})) as {isAdmin?:boolean;error?:string;maintenance?:{ok:boolean;catalogRecords:number;qualitySummary:{total:number;incomplete:number;missingYear:number;missingPoster:number;missingDescription:number};checkedAt:string}};
      if (!response.ok || payload.isAdmin !== true || !payload.maintenance) throw new Error(payload.error ?? (language === "ru" ? "Проверка не удалась." : "Maintenance check failed."));
      const report = payload.maintenance;
      setMaintenanceMessage(report.ok
        ? (language === "ru" ? "База доступна. Записей: " + report.catalogRecords + ". Записей с проблемами: " + report.qualitySummary.incomplete + ". Проверено: " + new Date(report.checkedAt).toLocaleString("ru-RU") + "." : "Database is healthy. Records: " + report.catalogRecords + ". Records with missing fields: " + report.qualitySummary.incomplete + ". Checked: " + new Date(report.checkedAt).toLocaleString() + ".")
        : (language === "ru" ? "Проверка базы не пройдена." : "Database health check failed."));
      await refreshCatalogQuality();
    } catch (error) {
      setMaintenanceMessage(error instanceof Error ? error.message : (language === "ru" ? "Проверка не удалась." : "Check failed."));
    } finally { setMaintenanceBusy(false); }
  };

  const visibleCatalogQuality = catalogQuality.filter(item =>
    catalogFilter === "year" ? item.missingYear :
    catalogFilter === "poster" ? item.missingPoster :
    catalogFilter === "description" ? item.missingDescription : true
  );

  const runCatalogImport = async () => {
    if (!isAdmin || adminImportRunning || metadataRefreshRunning) return;
    const target = Number(adminImportTarget);
    if (adminImport.state !== "running" && (!Number.isSafeInteger(target) || target < 1)) {
      setAdminImportMessage(language === "ru" ? "Укажи положительное целое число." : "Enter a positive whole number.");
      return;
    }
    setAdminImportRunning(true);
    setAdminImportMessage("");
    try {
      if (adminImport.state !== "running") {
        const start = await fetch("/api/admin/catalog-import", {method:"POST",credentials:"same-origin",cache:"no-store",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"start",target,statusFilter:adminImportStatusFilter})});
        const started = await start.json().catch(() => ({})) as typeof adminImport & {isAdmin?:boolean;error?:string;message?:string};
        if (!start.ok || started.isAdmin !== true) throw new Error(started.error ?? (language === "ru" ? "Не удалось запустить импорт." : "Could not start import."));
        setAdminImport(started);
      }
      for (let requestCount=0; requestCount<120; requestCount++) {
        const response = await fetch("/api/admin/catalog-import", {method:"POST",credentials:"same-origin",cache:"no-store",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"step"})});
        const payload = await response.json().catch(() => ({})) as typeof adminImport & {isAdmin?:boolean;error?:string;retryAfterMs?:number;message?:string};
        if (payload.isAdmin !== true) throw new Error(payload.error ?? (language === "ru" ? "Доступ к импорту отклонён." : "Import access denied."));
        setAdminImport(payload);
        if (response.status === 503) {
          setAdminImportMessage((payload.error ?? (language === "ru" ? "Shikimori временно недоступен." : "Shikimori is temporarily unavailable.")) + (language === "ru" ? " Прогресс сохранён; повтори запуск позже." : " Progress saved; resume later."));
          return;
        }
        if (!response.ok) throw new Error(payload.error ?? "Import request failed");
        if (payload.state !== "running") {
          setAdminImportMessage(payload.message ?? (language === "ru"
            ? (payload.state === "completed" ? "Импорт завершён." : "Импорт остановлен: достигнут предел доступных страниц.")
            : (payload.state === "completed" ? "Import completed." : "Import stopped: source returned no more records.")));
          return;
        }
        setAdminImportMessage(language === "ru"
          ? `Добавлено ${payload.added} из ${payload.target}; пропущено дубликатов: ${payload.skipped}. Страница источника: ${Math.max(1,(payload.cursor ?? 2)-1)}.`
          : `Added ${payload.added} of ${payload.target}; duplicates skipped: ${payload.skipped}. Source page: ${Math.max(1,(payload.cursor ?? 2)-1)}.`);
        await new Promise(resolve => setTimeout(resolve, Math.min(5000, Math.max(1000, payload.delayMs ?? 1500))));
      }
      setAdminImportMessage(language === "ru" ? "Импорт поставлен на паузу для ограничения нагрузки. Нажми «Продолжить импорт»." : "Import paused to limit load. Press Resume import.");
    } catch (error) {
      setAdminImportMessage(error instanceof Error ? error.message : (language === "ru" ? "Ошибка импорта." : "Import failed."));
    } finally {
      setAdminImportRunning(false);
    }
  };



  const saveAdminBulkImportFilter = async (enabled: boolean) => {
    if (!isAdmin || adminBulkFilterBusy || adminImportRunning || adminImport.state === "running") return;
    setAdminBulkFilterBusy(true); setAdminImportMessage("");
    try {
      const response = await fetch("/api/admin/catalog-import", {method:"POST",credentials:"same-origin",cache:"no-store",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"set_bulk_import_filter",block18Plus:enabled})});
      const payload = await response.json().catch(()=>({})) as {isAdmin?:boolean;bulkImportBlock18Plus?:boolean;error?:string;message?:string};
      if (!response.ok || payload.isAdmin !== true || typeof payload.bulkImportBlock18Plus !== "boolean") throw new Error(payload.message ?? payload.error ?? (language==="ru" ? "Не удалось сохранить фильтр 18+." : "Could not save the 18+ filter."));
      setAdminBulkBlock18Plus(payload.bulkImportBlock18Plus);
      setAdminImportMessage(language==="ru" ? (enabled ? "Фильтр 18+ сохранён: такие тайтлы будут пропускаться при новом массовом импорте." : "Фильтр 18+ отключён: рейтинг 18+ разрешён при новом массовом импорте.") : (enabled ? "18+ filter saved: these titles will be skipped by new bulk imports." : "18+ filter disabled: 18+ titles may be added by new bulk imports."));
    } catch (error) { setAdminImportMessage(error instanceof Error ? error.message : (language==="ru" ? "Не удалось сохранить настройку." : "Could not save setting.")); }
    finally { setAdminBulkFilterBusy(false); }
  };

  const searchCatalogDeletionTitle = async () => {
    if (!isAdmin || adminDeleteSearchBusy || adminDeleteBusy) return;
    const query = adminDeleteQuery.trim();
    if (query.length < 2) { setAdminDeleteMessage(language==="ru" ? "Введи не менее двух символов названия." : "Enter at least two characters."); setAdminDeleteResults([]); return; }
    setAdminDeleteSearchBusy(true); setAdminDeleteMessage(""); setAdminDeleteResults([]);
    try {
      const response = await fetch("/api/admin/catalog-import", {method:"POST",credentials:"same-origin",cache:"no-store",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"search_delete_title",query})});
      const payload = await response.json().catch(()=>({})) as {isAdmin?:boolean;error?:string;message?:string;results?:typeof adminDeleteResults};
      if (!response.ok || payload.isAdmin !== true) throw new Error(payload.message ?? payload.error ?? (language==="ru" ? "Не удалось найти тайтлы." : "Could not find titles."));
      setAdminDeleteResults(payload.results ?? []);
      setAdminDeleteMessage(payload.results?.length ? (language==="ru" ? "Выбери запись для удаления. Перед удалением будет дополнительное подтверждение." : "Choose a record to delete. You will be asked to confirm.") : (language==="ru" ? "В каталоге ничего не найдено." : "No matching titles found in the catalog."));
    } catch (error) { setAdminDeleteMessage(error instanceof Error ? error.message : (language==="ru" ? "Ошибка поиска." : "Search failed.")); }
    finally { setAdminDeleteSearchBusy(false); }
  };

  const deleteCatalogTitle = async (animeId: string) => {
    if (!isAdmin || adminDeleteBusy || adminImportRunning || metadataRefreshRunning) return;
    const selected = adminDeleteResults.find(item => item.id === animeId);
    if (!selected) return;
    const confirmed = window.confirm(language==="ru" ? "Удалить «" + selected.title + "» из каталога навсегда? Запись и скриншоты будут удалены. Массовый импорт больше не добавит её автоматически. Отменить это действие нельзя; ручной импорт по названию сможет добавить её снова." : "Permanently delete “" + selected.title + "” from the catalog? Its record and screenshots will be removed, and bulk import will not add it again. This cannot be undone here; an explicit title import can add it again.");
    if (!confirmed) return;
    setAdminDeleteBusy(animeId); setAdminDeleteMessage("");
    try {
      const response = await fetch("/api/admin/catalog-import", {method:"POST",credentials:"same-origin",cache:"no-store",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"delete_title",animeId})});
      const payload = await response.json().catch(()=>({})) as {isAdmin?:boolean;deleted?:boolean;error?:string;message?:string;anime?:{id:string;title:string}};
      if (!response.ok || payload.isAdmin !== true || payload.deleted !== true) throw new Error(payload.message ?? payload.error ?? (language==="ru" ? "Не удалось удалить тайтл." : "Could not delete title."));
      allowedCatalogIds.delete(animeId);
      catalogAnimeRef.current = catalogAnimeRef.current.filter(item => item.id !== animeId);
      setCatalogAnime(catalogAnimeRef.current);
      setPopularAnime(current => current.filter(item => item.id !== animeId));
      setSectionFeeds(current => current ? {...current,airing:current.airing.filter(item=>item.id!==animeId),announcements:current.announcements.filter(item=>item.id!==animeId)} : current);
      setAdminDeleteResults(current => current.filter(item => item.id !== animeId));
      setAdminDeleteMessage(language==="ru" ? "Удалено: " + (payload.anime?.title ?? selected.title) + ". Тайтл также исключён из массового импорта." : "Deleted: " + (payload.anime?.title ?? selected.title) + ". It is also excluded from bulk import.");
      await refreshCatalogQuality();
    } catch (error) { setAdminDeleteMessage(error instanceof Error ? error.message : (language==="ru" ? "Не удалось удалить тайтл." : "Could not delete title.")); }
    finally { setAdminDeleteBusy(null); }
  };

  const searchCatalogTitle = async () => {
    if (!isAdmin || adminTitleSearchBusy || adminTitleImportBusy || adminImportRunning || metadataRefreshRunning) return;
    const query = adminImportTitleQuery.trim();
    if (query.length < 2) {
      setAdminTitleSearchMessage(language === "ru" ? "Введи не менее двух символов названия." : "Enter at least two characters.");
      setAdminTitleSearchResults([]);
      return;
    }
    setAdminTitleSearchBusy(true);
    setAdminTitleSearchMessage("");
    setAdminTitleSearchResults([]);
    try {
      const response = await fetch("/api/admin/catalog-import", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "search_title", query }),
      });
      const payload = await response.json().catch(() => ({})) as {
        isAdmin?: boolean;
        error?: string;
        message?: string;
        results?: typeof adminTitleSearchResults;
      };
      if (!response.ok || payload.isAdmin !== true) {
        throw new Error(payload.message ?? payload.error ?? (language === "ru" ? "Не удалось найти тайтл." : "Could not search for this title."));
      }
      const results = payload.results ?? [];
      setAdminTitleSearchResults(results);
      setAdminTitleSearchMessage(results.length
        ? (language === "ru" ? "Выбери нужный тайтл из результатов." : "Choose the correct title from the results.")
        : (language === "ru" ? "Ничего не найдено. Попробуй другое название или написание." : "No results. Try a different spelling or title."));
    } catch (error) {
      setAdminTitleSearchMessage(error instanceof Error ? error.message : (language === "ru" ? "Ошибка поиска." : "Search failed."));
    } finally {
      setAdminTitleSearchBusy(false);
    }
  };

  const importCatalogTitle = async (animeId: string) => {
    if (!isAdmin || adminTitleImportBusy || adminImportRunning || metadataRefreshRunning) return;
    setAdminTitleImportBusy(animeId);
    setAdminTitleSearchMessage("");
    try {
      const response = await fetch("/api/admin/catalog-import", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "import_title", animeId }),
      });
      const payload = await response.json().catch(() => ({})) as {
        isAdmin?: boolean;
        error?: string;
        message?: string;
        alreadyInCatalog?: boolean;
        imported?: boolean;
        anime?: { id: string; title: string; year?: number; originalTitle?: string; englishTitle?: string };
        screenshots?: number;
        catalogTotal?: number;
        catalogWithTrailer?: number;
        missingTrailers?: number;
      };
      if (response.status === 409 && payload.alreadyInCatalog) {
        setAdminTitleSearchResults(current => current.map(item => item.id === animeId ? { ...item, alreadyInCatalog: true } : item));
        setAdminTitleSearchMessage(payload.message ?? (language === "ru" ? "Этот тайтл уже есть в каталоге." : "This title is already in the catalog."));
        return;
      }
      if (!response.ok || payload.isAdmin !== true || payload.imported !== true) {
        throw new Error(payload.message ?? payload.error ?? (language === "ru" ? "Не удалось импортировать тайтл." : "Could not import this title."));
      }
      setAdminTitleSearchResults(current => current.map(item => item.id === animeId ? { ...item, alreadyInCatalog: true } : item));
      setAdminTitleSearchMessage(language === "ru"
        ? `Добавлено: ${payload.anime?.title ?? animeId}. Скриншотов сохранено: ${payload.screenshots ?? 0}.`
        : `Added: ${payload.anime?.title ?? animeId}. Screenshots saved: ${payload.screenshots ?? 0}.`);
      setAdminStats(current => ({
        total: payload.catalogTotal ?? current?.total ?? 0,
        pending: current?.pending ?? 0,
        checked: current?.checked ?? 0,
        found: payload.catalogWithTrailer ?? current?.found ?? 0,
        missing: payload.missingTrailers ?? current?.missing ?? 0,
      }));
      await refreshCatalogQuality();
    } catch (error) {
      setAdminTitleSearchMessage(error instanceof Error ? error.message : (language === "ru" ? "Ошибка импорта." : "Import failed."));
    } finally {
      setAdminTitleImportBusy(null);
    }
  };

  // Keep the selected section aligned with the URL, including browser Back/Forward.
  useEffect(() => {
    setViewRaw(section ?? "home");
    const restoredQuery = urlQuery ?? "";
    setQuery(restoredQuery);
    setSubmittedQuery(restoredQuery);
    setCatalogQuery(restoredQuery);
    const restoredFilters: CatalogFiltersValue = {
      ...EMPTY_CATALOG_FILTERS,
      genres: (urlGenres ?? "").split(",").filter(Boolean).slice(0, 20),
      status: urlStatus ?? EMPTY_CATALOG_FILTERS.status,
      yearFrom: urlFrom === undefined ? "" : String(urlFrom),
      yearTo: urlTo === undefined ? "" : String(urlTo),
      minRating: urlRating ?? 0,
      type: urlKind ?? EMPTY_CATALOG_FILTERS.type,
      ageRating: urlAge ?? EMPTY_CATALOG_FILTERS.ageRating,
    };
    setDraftFilters(restoredFilters);
    setActiveFilters(restoredFilters);
    setSortBy(urlSort ?? "rating");
    setCatalogPage(urlPage ?? 1);
  }, [section, urlQuery, urlPage, urlSort, urlGenres, urlStatus, urlFrom, urlTo, urlRating, urlKind, urlAge]);

  // Catalog seeding/expansion is an explicit admin operation, not a user-page side effect.

  const [query, setQuery] = useState(urlQuery ?? "");
  const [submittedQuery, setSubmittedQuery] = useState(urlQuery ?? "");
  const [catalogQuery, setCatalogQuery] = useState(urlQuery ?? "");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filtersFromUrl: CatalogFiltersValue = {
    ...EMPTY_CATALOG_FILTERS,
    genres: (urlGenres ?? "").split(",").filter(Boolean).slice(0, 20),
    status: urlStatus ?? EMPTY_CATALOG_FILTERS.status,
    yearFrom: urlFrom === undefined ? "" : String(urlFrom),
    yearTo: urlTo === undefined ? "" : String(urlTo),
    minRating: urlRating ?? 0,
    type: urlKind ?? EMPTY_CATALOG_FILTERS.type,
    ageRating: urlAge ?? EMPTY_CATALOG_FILTERS.ageRating,
  };
  const [draftFilters, setDraftFilters] = useState<CatalogFiltersValue>(filtersFromUrl);
  const [activeFilters, setActiveFilters] = useState<CatalogFiltersValue>(filtersFromUrl);
  const [sortBy, setSortBy] = useState(urlSort ?? "rating");
  const [catalogPage, setCatalogPage] = useState(urlPage ?? 1);
  const [popularPage, setPopularPage] = useState(1);
  const [newReleasesPage, setNewReleasesPage] = useState(1);
  const [announcementsPage, setAnnouncementsPage] = useState(1);
  const [airingPage, setAiringPage] = useState(1);
  const [collection, setCollection] = useState<string | null>(null);

  useEffect(() => {
    const openAuth = (event: Event) => {
      const detail = (event as CustomEvent<{ mode?: unknown }>).detail;
      setViewRaw(detail?.mode === "register" ? "register" : "login");
    };
    window.addEventListener("yume-open-auth", openAuth);
    try {
      const intent = window.sessionStorage.getItem("yume-auth-intent-v1");
      if (intent === "login" || intent === "register") {
        window.sessionStorage.removeItem("yume-auth-intent-v1");
        setViewRaw(intent);
      }
    } catch {
      // An auth button on this page still works when sessionStorage is disabled.
    }
    return () => window.removeEventListener("yume-open-auth", openAuth);
  }, []);

  useEffect(() => {
    if (view !== "history") return;
    let cancelled = false;
    setHistoryLoading(true);
    setHistoryError("");
    fetch("/api/telegram/history", { credentials: "same-origin", cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({})) as {
          authenticated?: boolean;
          items?: unknown;
          error?: string;
        };
        if (cancelled) return;
        if (response.status === 401 || payload.authenticated !== true) {
          setHistoryAuthenticated(false);
          setHistoryItems([]);
          return;
        }
        if (!response.ok || !Array.isArray(payload.items)) throw new Error(payload.error || "history_unavailable");
        setHistoryAuthenticated(true);
        setHistoryItems(payload.items.filter((item): item is { animeId: string; viewedAt: string; viewCount: number } =>
          Boolean(item && typeof item === "object" &&
            typeof (item as { animeId?: unknown }).animeId === "string" &&
            /^\d{1,12}$/.test((item as { animeId: string }).animeId) &&
            typeof (item as { viewedAt?: unknown }).viewedAt === "string" &&
            typeof (item as { viewCount?: unknown }).viewCount === "number"),
        ));
      })
      .catch(() => {
        if (!cancelled) {
          setHistoryAuthenticated(false);
          setHistoryItems([]);
          setHistoryError(language === "ru" ? "Не удалось загрузить историю просмотров." : "Could not load viewing history.");
        }
      })
      .finally(() => { if (!cancelled) setHistoryLoading(false); });
    return () => { cancelled = true; };
  }, [view, language]);

  const removeHistoryItem = async (item: { animeId: string; viewedAt: string; viewCount: number }) => {
    if (historyDeletingIds.includes(item.animeId)) return;
    setHistoryDeletingIds((current) => current.includes(item.animeId) ? current : [...current, item.animeId]);
    setHistoryItems((current) => current.filter((entry) => entry.animeId !== item.animeId));
    setHistoryError("");

    try {
      const response = await fetch("/api/telegram/history", {
        method: "DELETE",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ animeId: item.animeId }),
      });
      const payload = await response.json().catch(() => ({})) as { deleted?: boolean; error?: string };
      if (!response.ok || payload.deleted !== true) throw new Error(payload.error || "history_delete_failed");
    } catch {
      setHistoryItems((current) => current.some((entry) => entry.animeId === item.animeId)
        ? current
        : [...current, item].sort((a, b) => b.viewedAt.localeCompare(a.viewedAt)));
      setHistoryError(language === "ru"
        ? "Не удалось удалить тайтл из истории. Попробуй ещё раз."
        : "Could not remove this title from history. Please try again.");
    } finally {
      setHistoryDeletingIds((current) => current.filter((id) => id !== item.animeId));
    }
  };

  const setView = (v: View) => {
    telegramHapticImpact("light");
    if (v === "login" || v === "register") {
      setViewRaw(v);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    // Keep the URL as the single source of truth for paged catalog data.
    // Tapping Home is also a quick way out of search results: restore the default home state.
    if (v === "home") {
      setQuery("");
      setSubmittedQuery("");
      setDraftFilters(EMPTY_CATALOG_FILTERS);
      setActiveFilters(EMPTY_CATALOG_FILTERS);
      setFiltersOpen(false);
      setCatalogPage(1);
    }
    // Re-tapping the Catalog tab clears its query and returns to the full catalog.
    if (v === "catalog") {
      setCatalogQuery("");
      setCatalogPage(1);
      setDraftFilters(EMPTY_CATALOG_FILTERS);
      setActiveFilters(EMPTY_CATALOG_FILTERS);
      setFiltersOpen(false);
    }

    setViewRaw(v);
    if (v === "popular") setPopularPage(1);
    if (v === "new-releases") setNewReleasesPage(1);
    if (v === "announcements") setAnnouncementsPage(1);
    if (v === "airing") setAiringPage(1);
    // Persist the selected section in the URL so refreshing the page keeps the same view.
    navigate({ to: "/", search: { section: v, q: undefined, page: undefined, sort: undefined, genres: undefined, status: undefined, from: undefined, to: undefined, rating: undefined, kind: undefined, age: undefined, lang: v === "catalog" ? language : undefined } });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const select = (anime: Anime) =>
    navigate({ to: "/anime/$animeId", params: { animeId: anime.id } });

  const handleAuthComplete = useCallback(async () => {
    setTelegramAuthError("");
    try {
      const response = await fetch("/api/telegram/init-data", { credentials: "same-origin", cache: "no-store" });
      const result = await response.json().catch(() => ({})) as { authenticated?: boolean; user?: { id?: string } };
      if (!response.ok || result.authenticated !== true || !result.user?.id) throw new Error("Session could not be confirmed");
      await syncTelegramLibrary(result.user.id);
      setProfileStorageAuthenticated(true);
      setTelegramAuthReady(true);
      setTelegramConsentRequired(false);
      setTelegramConsentPending(false);
      setViewRaw("profile");
      navigate({ to: "/", search: { section: "profile", q: undefined, page: undefined, sort: undefined, genres: undefined, status: undefined, from: undefined, to: undefined, rating: undefined, kind: undefined, age: undefined } });
    } catch {
      setTelegramAuthError(language === "ru"
        ? "Вход выполнен не полностью: не удалось загрузить аккаунт. Обнови страницу и попробуй снова."
        : "Sign-in did not finish: account data could not be loaded. Refresh and try again.");
    }
  }, [language, navigate]);
  const random = () => {
    const availableAnime = ANIME.filter(
      (anime) => anime.status === "Онгоинг" || anime.status === "Вышел",
    );
    if (!availableAnime.length) return;
    const anime = availableAnime[Math.floor(Math.random() * availableAnime.length)]!;
    select(anime);
  };


  const availableGenres = useMemo(() => catalogFacets?.genres ?? Array.from(new Set(ANIME.flatMap(a => a.genres))).sort((a,b)=>a.localeCompare(b,"ru")), [ANIME,catalogFacets]);
  const availableStatuses = useMemo(() => { if (catalogFacets) return catalogFacets.statuses; const found = new Set(ANIME.map(a=>a.status)); const order=["Онгоинг","Анонс","Вышел","Неизвестно"]; return Array.from(found).sort((a,b)=>order.indexOf(a)-order.indexOf(b)); }, [ANIME,catalogFacets]);
  const availableTypes = useMemo(() => catalogFacets?.types ?? Array.from(new Set(ANIME.map(a=>a.kind?.trim() || (a.episodes===1 ? "Фильм":"TV")))).filter(Boolean).sort((a,b)=>a.localeCompare(b,"ru")), [ANIME,catalogFacets]);
  const availableAgeRatings = useMemo(() => { if (catalogFacets) return catalogFacets.ageRatings; const order=["Без ограничений","12+","16+","18+"]; return Array.from(new Set(ANIME.map(a=>a.ageRating).filter((v):v is string=>Boolean(v)))).sort((a,b)=>order.indexOf(a)-order.indexOf(b)); }, [ANIME,catalogFacets]);
  const catalogYearRange = useMemo(() => { if (catalogFacets) return {min:catalogFacets.yearMin,max:catalogFacets.yearMax}; const years=ANIME.map(a=>a.year).filter(y=>Number.isFinite(y)&&y>0); return {min:years.length?Math.min(...years):1900,max:years.length?Math.max(...years):new Date().getFullYear()}; }, [ANIME,catalogFacets]);
  const searchText = view === "catalog" ? catalogQuery.trim() : view === "home" ? submittedQuery.trim() : "";
  const catalogResults = useMemo(() => view === "catalog" ? ANIME : filterAndSortCatalog(ANIME, searchText, activeFilters, sortBy, language, displayGenre), [ANIME,searchText,activeFilters,sortBy,language,view]);
  const catalogPageSize = 20;
  const totalCatalogPages = getCatalogPageCount(view === "catalog" ? initialCatalogTotal : catalogResults.length, catalogPageSize);
  const visibleCatalogResults = view === "catalog" ? ANIME : paginateCatalog(catalogResults, catalogPage, catalogPageSize);
  useEffect(() => {
    if (view !== "catalog") return;
    setCatalogPage(loadedCatalogPage);
    const routeQuery = urlQuery ?? "";
    if (catalogQuery.trim() !== routeQuery) setCatalogQuery(routeQuery);
    const routeSort = urlSort ?? "rating";
    if (sortBy !== routeSort) setSortBy(routeSort);
    const routeFilters = filtersFromUrl;
    setActiveFilters(current => JSON.stringify(current) === JSON.stringify(routeFilters) ? current : routeFilters);
    setDraftFilters(current => JSON.stringify(current) === JSON.stringify(routeFilters) ? current : routeFilters);
  }, [view, loadedCatalogPage, urlQuery, urlSort, urlGenres, urlStatus, urlFrom, urlTo, urlRating, urlKind, urlAge]);
  const activeFilterCount = activeFilters.genres.length +
    Number(activeFilters.status !== "Любой") + Number(activeFilters.yearFrom !== "") +
    Number(activeFilters.yearTo !== "") + Number(activeFilters.minRating > 0) +
    Number(activeFilters.type !== "Любой") + Number(activeFilters.ageRating !== "Любой");
  const searching = view === "home" && (submittedQuery.length > 0 || activeFilterCount > 0);
  const needsFullCatalog = ["popular", "new-releases", "announcements", "airing"].includes(view) ||
    (view === "home" && (Boolean(submittedQuery.trim()) || activeFilterCount > 0 || filtersOpen));
  // Searches and filters operate on the dataset returned from D1.
  // Do not poll Shikimori or trigger imports during normal user navigation.
  useEffect(() => {
    if (view === "catalog") {
      setCatalogLoadState(apiError ? "error" : "loaded");
      setCatalogLoadError(apiError);
      return;
    }
    setCatalogLoadState(apiError ? "error" : "loaded");
    setCatalogLoadError(apiError);
  }, [apiError, view]);

  const writeCatalogUrl = (overrides: { q?: string; page?: number; sort?: string; genres?: string; status?: string; from?: number; to?: number; rating?: number; kind?: string; age?: string } = {}) => {
    const has = (key: keyof typeof overrides) => Object.prototype.hasOwnProperty.call(overrides, key);
    const genres = has("genres") ? overrides.genres : activeFilters.genres.join(",") || undefined;
    const status = has("status") ? overrides.status : activeFilters.status !== EMPTY_CATALOG_FILTERS.status ? activeFilters.status : undefined;
    const from = has("from") ? overrides.from : activeFilters.yearFrom.trim() ? Number(activeFilters.yearFrom) : undefined;
    const to = has("to") ? overrides.to : activeFilters.yearTo.trim() ? Number(activeFilters.yearTo) : undefined;
    const rating = has("rating") ? overrides.rating : activeFilters.minRating || undefined;
    const kind = has("kind") ? overrides.kind : activeFilters.type !== EMPTY_CATALOG_FILTERS.type ? activeFilters.type : undefined;
    const age = has("age") ? overrides.age : activeFilters.ageRating !== EMPTY_CATALOG_FILTERS.ageRating ? activeFilters.ageRating : undefined;
    const q = has("q") ? overrides.q : view === "catalog" ? catalogQuery.trim() || undefined : view === "home" ? submittedQuery.trim() || undefined : undefined;
    void navigate({ to: "/", replace: true, search: {
      section: view,
      q: q || undefined,
      page: overrides.page ?? catalogPage,
      sort: has("sort") ? overrides.sort : sortBy !== "rating" ? sortBy : undefined,
      genres: genres || undefined,
      status: status || undefined,
      from: from || undefined,
      to: to || undefined,
      rating: rating || undefined,
      kind: kind || undefined,
      age: age || undefined,
      lang: view === "catalog" ? language : undefined,
    } });
  };
  useEffect(() => {
    if (view !== "catalog" || (urlLang ?? "ru") === language) return;
    void navigate({ to: "/", replace: true, search: {
      section: "catalog", q: urlQuery, page: urlPage, sort: urlSort,
      genres: urlGenres, status: urlStatus, from: urlFrom, to: urlTo,
      rating: urlRating, kind: urlKind, age: urlAge, lang: language,
    } });
  }, [view, language, urlLang, urlQuery, urlPage, urlSort, urlGenres, urlStatus, urlFrom, urlTo, urlRating, urlKind, urlAge, navigate]);
  
  const submitHomeSearch = () => {
    const nextQuery = query.trim();
    setSubmittedQuery(nextQuery);
    setCatalogPage(1);
    writeCatalogUrl({ q: nextQuery || undefined, page: 1 });
  };
  const applyCatalogFilters = () => {
    const next = { ...draftFilters, genres: [...draftFilters.genres] };
    setActiveFilters(next);
    setCatalogPage(1);
    setFiltersOpen(false);
    writeCatalogUrl({ page: 1, genres: next.genres.join(",") || undefined, status: next.status !== EMPTY_CATALOG_FILTERS.status ? next.status : undefined, from: next.yearFrom.trim() ? Number(next.yearFrom) : undefined, to: next.yearTo.trim() ? Number(next.yearTo) : undefined, rating: next.minRating || undefined, kind: next.type !== EMPTY_CATALOG_FILTERS.type ? next.type : undefined, age: next.ageRating !== EMPTY_CATALOG_FILTERS.ageRating ? next.ageRating : undefined });
  };
  const resetCatalogFilters = () => {
    setDraftFilters(EMPTY_CATALOG_FILTERS);
    setActiveFilters(EMPTY_CATALOG_FILTERS);
    setCatalogPage(1);
    writeCatalogUrl({ page: 1, genres: undefined, status: undefined, from: undefined, to: undefined, rating: undefined, kind: undefined, age: undefined });
  };
  const activeCollection = COLLECTIONS.find((c) => c.id === collection);
  const activeCollectionAnime = activeCollection
    ? ANIME.filter((anime) => activeCollection.genres.some((genre) => anime.genres.includes(genre)))
        .sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1))
    : [];
  const newReleaseAnime = (sectionFeeds?.newReleases ?? ANIME
    .filter((anime) => isNewRelease(anime)))
    .sort((a, b) => {
      const aDate = getExactReleaseDate(a.airedOn);
      const bDate = getExactReleaseDate(b.airedOn);
      if (aDate && bDate) return bDate.localeCompare(aDate);
      if (aDate) return -1;
      if (bDate) return 1;
      return (b.rating ?? -1) - (a.rating ?? -1);
    });
  const newReleaseCards = newReleaseAnime.slice(0, 12);
  const totalNewReleasesPages = Math.max(1, Math.ceil(newReleaseAnime.length / catalogPageSize));
  const visibleNewReleaseAnime = newReleaseAnime.slice((newReleasesPage - 1) * catalogPageSize, newReleasesPage * catalogPageSize);

  const sortedPopularAnime = popularAnime.filter((anime) => (anime.rating ?? 0) >= 8);
  const popularCards = sortedPopularAnime.slice(0, 12);
  const totalPopularPages = Math.max(1, Math.ceil(sortedPopularAnime.length / catalogPageSize));
  const visiblePopularAnime = sortedPopularAnime.slice((popularPage - 1) * catalogPageSize, popularPage * catalogPageSize);

  const announcementAnime = sectionFeeds
    ? sectionFeeds.announcements
    : ANIME
      .filter((anime) => isUpcomingAnnouncement(anime))
      .sort((a, b) => {
        const aDate = getExactReleaseDate(a.airedOn);
        const bDate = getExactReleaseDate(b.airedOn);
        if (aDate && bDate) return aDate.localeCompare(bDate);
        if (aDate) return -1;
        if (bDate) return 1;
        return a.year - b.year || (b.rating ?? -1) - (a.rating ?? -1);
      });
  const announcementCards = announcementAnime.slice(0, 12);
  const totalAnnouncementsPages = Math.max(1, Math.ceil(announcementAnime.length / catalogPageSize));
  const visibleAnnouncementAnime = announcementAnime.slice((announcementsPage - 1) * catalogPageSize, announcementsPage * catalogPageSize);

  const airingAnime = sectionFeeds
    ? sectionFeeds.airing
    : ANIME
      .filter((anime) => isEligibleAiringAnime(anime))
      .sort((a, b) => (b.airedOn ?? "").localeCompare(a.airedOn ?? "") || b.year - a.year);
  const airingCards = airingAnime.slice(0, 12);
  const totalAiringPages = Math.max(1, Math.ceil(airingAnime.length / catalogPageSize));
  const visibleAiringAnime = airingAnime.slice((airingPage - 1) * catalogPageSize, airingPage * catalogPageSize);
  return (
    <div className="relative isolate min-h-screen pb-8">
      {view === "home" && <HomeDepthAtmosphere />}
      <div className="relative z-10">
      <Header view={view} setView={setView} onProfile={() => setView(telegramAuthReady ? "profile" : "login")} isAdmin={isAdmin} unreadNotificationCount={notificationStateLoaded && notificationRemoteAccount ? notificationItems.filter((item) => !notificationReadIds.includes(item.id) && !notificationDismissedIds.includes(item.id)).length : 0} />
      {isTelegramMiniApp && telegramConsentRequired && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-background/85 px-4 py-6 backdrop-blur-md" role="dialog" aria-modal="true" aria-labelledby="telegram-consent-title">
          <section className="w-full max-w-md rounded-3xl border border-border bg-card p-6 shadow-2xl sm:p-8">
            <h2 id="telegram-consent-title" className="text-xl font-bold">{language === "ru" ? "Добро пожаловать в YUME" : "Welcome to YUME"}</h2>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              {language === "ru"
                ? "Чтобы создать аккаунт и сохранять твои данные, YUME будет обрабатывать Telegram ID и имя профиля в соответствии с "
                : "To create your account and save your data, YUME will process your Telegram ID and profile name under the "}
              <button type="button" onClick={() => { setTelegramConsentPending(true); setTelegramConsentRequired(false); setView("privacy-policy"); }} className="font-semibold text-primary underline underline-offset-4">
                {language === "ru" ? "Политикой конфиденциальности" : "Privacy Policy"}
              </button>.
            </p>
            {telegramAuthError && <p role="alert" className="mt-3 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs leading-relaxed text-foreground">{telegramAuthError}</p>}
            <button type="button" onClick={acceptTelegramConsent} disabled={telegramConsentSubmitting} className="mt-5 flex min-h-12 w-full items-center justify-center rounded-xl bg-primary px-4 py-3 text-sm font-bold text-primary-foreground transition hover:brightness-110 disabled:cursor-wait disabled:opacity-60">
              {telegramConsentSubmitting
                ? (language === "ru" ? "Создаём аккаунт…" : "Creating account…")
                : (language === "ru" ? "Согласен и продолжить" : "Agree and continue")}
            </button>
          </section>
        </div>
      )}
      {isTelegramMiniApp && telegramAuthError && !telegramConsentRequired && (
        <div role="alert" className="fixed inset-x-3 bottom-3 z-[70] mx-auto max-w-lg rounded-xl border border-destructive/30 bg-background/95 px-4 py-3 text-sm text-foreground shadow-xl">{telegramAuthError}</div>
      )}

      {apiError && view !== "privacy-policy" && (
        <div role="alert" className="mx-4 mt-20 rounded-xl border border-amber-400/25 bg-amber-400/10 px-4 py-3 text-sm text-amber-100 md:mx-10">
          {t("source.errorBanner")}
        </div>
      )}

      {view === "login" || view === "register" ? (
        <AuthPage
          key={view}
          mode={view}
          language={language}
          onModeChange={(mode) => setView(mode)}
          onPrivacy={() => { window.open("/?section=privacy-policy", "_blank", "noopener,noreferrer"); }}
          onRules={() => { window.open("/?section=rules", "_blank", "noopener,noreferrer"); }}
          onComplete={handleAuthComplete}
        />
      ) : searching ? (
        <main id="main-content" className="px-4 pt-36 md:px-10 md:pt-24">
          <div className="mb-6 flex items-center justify-between">
            <h1 className="text-xl font-semibold">{submittedQuery ? `${t("catalog.results")}: «${submittedQuery}»` : t("catalog.filterResults")} <span className="text-muted-foreground">· {needsFullCatalog && catalogLoadState !== "loaded" && catalogLoadState !== "error" ? "…" : catalogResults.length}</span></h1>
            <button onClick={() => { setQuery(""); setSubmittedQuery(""); setDraftFilters(EMPTY_CATALOG_FILTERS); setActiveFilters(EMPTY_CATALOG_FILTERS); setFiltersOpen(false); setCatalogPage(1); }} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><X className="h-4 w-4" />{t("catalog.reset")}</button>
          </div>
          {needsFullCatalog && catalogLoadState !== "loaded" && catalogLoadState !== "error" ? (
            <CatalogSkeleton count={8} />
          ) : (
            <>
              {catalogLoadState === "error" && (
                <div role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-400/25 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
                  <span>{t("catalog.loadError")}</span>
                  <button type="button" onClick={() => { catalogLoadStarted.current = false; setCatalogLoadState("idle"); setCatalogLoadAttempt((value) => value + 1); }} className="rounded-lg border border-amber-100/20 px-3 py-1.5 font-semibold hover:bg-amber-100/10">{t("home.retry")}</button>
                </div>
              )}
              <Grid items={visibleCatalogResults} onSelect={select} empty={t("catalog.noResultsFormal")} />
              {catalogResults.length > 0 && (
                <PageNavigation
                  page={catalogPage}
                  totalPages={totalCatalogPages}
                  onPageChange={(nextPage) => { setCatalogPage(nextPage); writeCatalogUrl({ page: nextPage }); }}
                  ariaLabel={t("catalog.pages")}
                  previousLabel={t("catalog.previous")}
                  nextLabel={t("catalog.next")}
                />
              )}
            </>
          )}
        </main>
      ) : view === "home" ? (
        <main id="main-content" className="pt-16">
          <Hero onCatalog={() => setView("catalog")} onRandom={random} query={query} setQuery={setQuery} onSubmitSearch={submitHomeSearch} filtersOpen={filtersOpen && (!needsFullCatalog || catalogLoadState === "loaded" || catalogLoadState === "error")} setFiltersOpen={setFiltersOpen} draftFilters={draftFilters} setDraftFilters={setDraftFilters} onApplyFilters={applyCatalogFilters} onResetFilters={resetCatalogFilters} activeFilterCount={activeFilterCount} genres={availableGenres} statuses={availableStatuses} types={availableTypes} ageRatings={availableAgeRatings} yearMin={catalogYearRange.min} yearMax={catalogYearRange.max} />
          <HomeQuickControls onProfile={() => setView(telegramAuthReady ? "profile" : "login")} />
          <div className="home-content-world mt-1 pb-12">
            <div className="relative z-10">
              {ANIME.length === 0 ? (
                <section className="mx-4 mt-10 rounded-2xl border border-dashed border-white/15 bg-card/60 px-6 py-10 text-center md:mx-10">
                  <p className="mx-auto max-w-xl text-muted-foreground">{t("home.dataUnavailable")}</p>
                  <button type="button" onClick={() => window.location.reload()} className="mt-5 rounded-full bg-neon px-5 py-2.5 text-sm font-semibold text-primary-foreground transition hover:brightness-110">{t("home.retry")}</button>
                </section>
              ) : (
                <>
                  {popularCards.length > 0 && <Row title={t("home.popular")} action={<SeeAll onClick={() => setView("popular")} />}>
                    {popularCards.map((a) => <AnimeCard key={a.id} anime={a} onSelect={select} />)}
                  </Row>}
                  {newReleaseCards.length > 0 && <Row title={t("home.newReleases")} action={<SeeAll onClick={() => setView("new-releases")} />}>
                    {newReleaseCards.map((a) => <AnimeCard key={a.id} anime={a} onSelect={select} />)}
                  </Row>}
                  {announcementCards.length > 0 && <Row title={t("home.announcements")} action={<SeeAll onClick={() => setView("announcements")} />}>
                    {announcementCards.map((a) => <AnimeCard key={a.id} anime={a} onSelect={select} />)}
                  </Row>}
                  {airingCards.length > 0 && <Row title={t("home.airing")} action={<SeeAll onClick={() => setView("airing")} />}>
                    {airingCards.map((a) => <AnimeCard key={a.id} anime={a} onSelect={select} />)}
                  </Row>}
                  <section className="mt-10 px-4 md:px-10">
                    <div className="mb-4 flex items-end justify-between">
                      <h2 className="text-lg font-semibold md:text-xl">{t("home.collections")}</h2>
                      <SeeAll onClick={() => setView("collections")} />
                    </div>
                    <CollectionsGrid animeList={ANIME} onOpen={(id) => { setCollection(id); setView("collections"); }} />
                  </section>
                </>
              )}
            </div>
          </div>
        </main>
      ) : view === "notifications" && notificationStateLoaded && !notificationRemoteAccount ? (
        <main id="main-content" className="px-4 pb-12 pt-24 md:px-10 md:pt-24">
          <section className="mx-auto max-w-lg rounded-3xl border border-border bg-card/70 p-6 text-center sm:p-8">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <ShieldCheck className="h-7 w-7" />
            </div>
            <h1 className="mt-4 text-2xl font-bold">{language === "ru" ? "Уведомления для зарегистрированных пользователей" : "Notifications for registered users"}</h1>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {language === "ru" ? "Войди в аккаунт или зарегистрируйся через Telegram, чтобы получать новости и уведомления YUME." : "Sign in or register through Telegram to receive YUME news and notifications."}
            </p>
            <div className="mt-5 flex flex-col justify-center gap-2 sm:flex-row">
              <button type="button" onClick={() => setView("login")} className="inline-flex min-h-11 items-center justify-center rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90">{language === "ru" ? "Войти" : "Sign in"}</button>
              <button type="button" onClick={() => setView("register")} className="inline-flex min-h-11 items-center justify-center rounded-xl border border-border px-5 py-2.5 text-sm font-semibold hover:bg-accent">{language === "ru" ? "Зарегистрироваться" : "Register"}</button>
            </div>
          </section>
        </main>
      ) : view === "notifications" && !notificationStateLoaded ? (
        <main id="main-content" className="px-4 pb-12 pt-24 md:px-10 md:pt-24" aria-busy="true">
          <div className="mx-auto max-w-lg rounded-3xl border border-border bg-card/50 p-8 text-center text-sm text-muted-foreground">{language === "ru" ? "Проверяем аккаунт…" : "Checking account…"}</div>
        </main>
      ) : view === "notifications" ? (
        <main id="main-content" className="px-4 pb-12 pt-24 md:px-10 md:pt-24">
          <section className="mx-auto max-w-3xl">
            <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="mb-2 flex items-center gap-2 text-primary"><Bell className="h-5 w-5" /><span className="text-xs font-semibold uppercase tracking-[0.16em]">{language === "ru" ? "Новости YUME" : "YUME updates"}</span></div>
                <h1 className="text-3xl font-bold tracking-tight text-foreground">{language === "ru" ? "Уведомления" : "Notifications"}</h1>
                <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">{language === "ru" ? "Здесь собраны новости о новых пользовательских возможностях и функциях YUME." : "Updates about new user-facing YUME features and capabilities appear here."}</p>
              </div>
              <button type="button" onClick={markAllNotificationsRead} disabled={notificationActionBusy || notificationItems.filter((item) => !notificationDismissedIds.includes(item.id)).every((item) => notificationReadIds.includes(item.id))} className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-xl border border-primary/30 bg-primary/10 px-3 py-2 text-sm font-semibold text-foreground transition hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-45">
                <CheckCheck className="h-4 w-4" />
                {notificationActionBusy ? (language === "ru" ? "Сохраняю…" : "Saving…") : (language === "ru" ? "Прочитать всё" : "Mark all as read")}
              </button>
            </div>

            <div className="mb-4 flex items-center justify-between rounded-xl border border-border bg-card/50 px-3 py-2.5">
              <span className="text-sm text-muted-foreground">{language === "ru" ? "Всего уведомлений" : "Total notifications"}</span>
              <span className="font-semibold tabular-nums">{notificationItems.filter((item) => !notificationDismissedIds.includes(item.id)).length}</span>
              <span className="text-sm text-muted-foreground">{language === "ru" ? "Непрочитано" : "Unread"}</span>
              <span className={`font-semibold tabular-nums ${notificationItems.some((item) => !notificationReadIds.includes(item.id)) ? "text-red-400" : "text-emerald-400"}`}>{notificationItems.filter((item) => !notificationDismissedIds.includes(item.id) && !notificationReadIds.includes(item.id)).length}</span>
            </div>

            {notificationActionMessage && <p role="status" className="mb-4 rounded-xl border border-border bg-card/60 px-3 py-2.5 text-sm text-muted-foreground">{notificationActionMessage}</p>}

            {notificationItems.every((item) => notificationDismissedIds.includes(item.id)) ? (
              <div className="rounded-2xl border border-dashed border-border bg-card/30 px-5 py-12 text-center">
                <Bell className="mx-auto h-8 w-8 text-muted-foreground" />
                <h2 className="mt-3 font-semibold">{language === "ru" ? "Пока нет уведомлений" : "No notifications yet"}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{language === "ru" ? "Когда в YUME появятся новые функции, новости о них будут здесь." : "Announcements about new YUME features will appear here."}</p>
              </div>
            ) : (
              <div className="space-y-3">
                {notificationItems.filter((item) => !notificationDismissedIds.includes(item.id)).map((item) => {
                  const unread = !notificationReadIds.includes(item.id);
                  const expanded = expandedNotificationIds.includes(item.id);
                  const swipeOffset = notificationSwipe?.id === item.id ? notificationSwipe.offset : 0;
                  const isDragging = notificationSwipe?.id === item.id && notificationSwipe.dragging;
                  return (
                    <article key={item.id} className={`relative overflow-hidden rounded-2xl border bg-card/50 ${unread ? "border-red-500/35 shadow-[0_0_18px_rgba(239,68,68,0.06)]" : "border-border"}`}>
                      <div className="absolute inset-y-0 right-0 flex w-28 items-center justify-center bg-red-600 text-white">
                        <button type="button" onClick={() => { setNotificationSwipe(null); void dismissNotification(item.id); }} aria-label={language === "ru" ? "Удалить уведомление" : "Delete notification"} className="flex h-full w-full flex-col items-center justify-center gap-1 font-semibold transition hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white">
                          <X className="h-5 w-5" />
                          <span className="text-xs">{language === "ru" ? "Удалить" : "Delete"}</span>
                        </button>
                      </div>
                      <div
                        onPointerDown={(event) => handleNotificationPointerDown(item.id, event)}
                        onPointerMove={(event) => handleNotificationPointerMove(item.id, event)}
                        onPointerUp={(event) => handleNotificationPointerUp(item.id, event)}
                        onPointerCancel={() => { notificationPointerStart.current = null; setNotificationSwipe(null); }}
                        style={{ transform: `translateX(${swipeOffset}px)`, transition: isDragging ? "none" : "transform 240ms cubic-bezier(0.22, 1, 0.36, 1)", touchAction: "pan-y" }}
                        className="relative z-10 bg-background p-4 sm:p-5"
                      >
                        <button type="button" onClick={() => toggleNotificationExpanded(item.id)} aria-expanded={expanded} className="flex w-full items-start gap-3 text-left">
                          <div className="mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-primary/20 bg-primary/10 text-primary"><Sparkles className="h-5 w-5" /></div>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <h2 className="font-semibold leading-snug text-foreground">{item.title[language]}</h2>
                              {unread && <span className="inline-flex items-center gap-1 rounded-full bg-red-500/10 px-2 py-0.5 text-[11px] font-semibold text-red-400"><span className="h-1.5 w-1.5 rounded-full bg-red-500" />{language === "ru" ? "Новое" : "New"}</span>}
                            </div>
                            <p className="mt-1 text-xs text-muted-foreground">{new Date(item.publishedAt).toLocaleDateString(language === "ru" ? "ru-RU" : "en-US", { day: "numeric", month: "long", year: "numeric" })}</p>
                            {!expanded && <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-muted-foreground">{item.description[language]}</p>}
                          </div>
                          <ChevronDown className={`mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 ${expanded ? "rotate-180" : ""}`} />
                        </button>
                        <div className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out ${expanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}>
                          <div className="overflow-hidden">
                            <p className="whitespace-pre-line pl-[52px] pt-3 text-sm leading-relaxed text-foreground/85">{item.description[language]}</p>
                            {item.targetUrl && <div className="pl-[52px] pt-3"><button type="button" onClick={() => { const target = item.targetUrl; if (target && target.startsWith("/") && !target.startsWith("//")) window.location.assign(target); }} className="inline-flex min-h-9 items-center rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90">{language === "ru" ? "Открыть" : "Open"}</button></div>}
                            <div className="flex justify-end pl-[52px] pt-3">
                              <button type="button" onClick={() => { setNotificationSwipe(null); void dismissNotification(item.id); }} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold text-muted-foreground transition hover:bg-red-500/10 hover:text-red-400">
                                <X className="h-3.5 w-3.5" />{language === "ru" ? "Удалить уведомление" : "Delete notification"}
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </main>
      ) : view === "popular" ? (
        <main id="main-content" className="px-4 pt-24 md:px-10 md:pt-24">
          <h1 className="mb-2 text-2xl font-bold md:text-3xl">{t("home.popular")}</h1>
          {needsFullCatalog && catalogLoadState !== "loaded" && catalogLoadState !== "error" ? (
            <CatalogSkeleton count={12} />
          ) : (
            <>
              <Grid items={visiblePopularAnime} onSelect={select} empty={t("catalog.noResultsFormal")} />
              <PageNavigation
                page={popularPage}
                totalPages={totalPopularPages}
                onPageChange={setPopularPage}
                ariaLabel={t("home.popular")}
                previousLabel={t("catalog.previous")}
                nextLabel={t("catalog.next")}
              />
            </>
          )}
        </main>
      ) : view === "new-releases" ? (
        <main id="main-content" className="px-4 pt-24 md:px-10 md:pt-24">
          <h1 className="mb-2 text-2xl font-bold md:text-3xl">{t("home.newReleases")}</h1>
          <p className="mb-6 text-sm text-muted-foreground">{t("home.newReleasesDescription")}</p>
          {needsFullCatalog && catalogLoadState !== "loaded" && catalogLoadState !== "error" ? (
            <CatalogSkeleton count={12} />
          ) : (
            <>
              <Grid items={visibleNewReleaseAnime} onSelect={select} empty={t("home.noNewReleases")} />
              <PageNavigation
                page={newReleasesPage}
                totalPages={totalNewReleasesPages}
                onPageChange={setNewReleasesPage}
                ariaLabel={t("home.newReleases")}
                previousLabel={t("catalog.previous")}
                nextLabel={t("catalog.next")}
              />
            </>
          )}
        </main>
      ) : view === "announcements" ? (
        <main id="main-content" className="px-4 pt-24 md:px-10 md:pt-24">
          <h1 className="mb-2 text-2xl font-bold md:text-3xl">{t("home.announcements")}</h1>
          <p className="mb-6 text-sm text-muted-foreground">{t("home.announcementsDescription")}</p>
          {needsFullCatalog && catalogLoadState !== "loaded" && catalogLoadState !== "error" ? (
            <CatalogSkeleton count={12} />
          ) : (
            <>
              <Grid items={visibleAnnouncementAnime} onSelect={select} empty={t("home.noAnnouncements")} />
              <PageNavigation
                page={announcementsPage}
                totalPages={totalAnnouncementsPages}
                onPageChange={setAnnouncementsPage}
                ariaLabel={t("home.announcements")}
                previousLabel={t("catalog.previous")}
                nextLabel={t("catalog.next")}
              />
            </>
          )}
        </main>
      ) : view === "airing" ? (
        <main id="main-content" className="px-4 pt-24 md:px-10 md:pt-24">
          <h1 className="mb-2 text-2xl font-bold md:text-3xl">{t("home.airing")}</h1>
          <p className="mb-6 text-sm text-muted-foreground">{t("home.airingDescription")}</p>
          {needsFullCatalog && catalogLoadState !== "loaded" && catalogLoadState !== "error" ? (
            <CatalogSkeleton count={12} />
          ) : (
            <>
              <Grid items={visibleAiringAnime} onSelect={select} empty={t("home.noAiring")} />
              <PageNavigation
                page={airingPage}
                totalPages={totalAiringPages}
                onPageChange={setAiringPage}
                ariaLabel={t("home.airing")}
                previousLabel={t("catalog.previous")}
                nextLabel={t("catalog.next")}
              />
            </>
          )}
        </main>
      ) : view === "catalog" ? (
        <main id="main-content" className="px-4 pt-36 md:px-10 md:pt-24">
          <h1 className="text-2xl font-bold md:text-3xl">{t("catalog.title")}</h1>
          {catalogLoadState === "error" && (
            <div role="alert" className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-400/25 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
              <span>{t("catalog.loadError")}</span>
              <button type="button" onClick={() => { catalogLoadStarted.current = false; setCatalogLoadState("idle"); setCatalogLoadAttempt((value) => value + 1); }} className="rounded-lg border border-amber-100/20 px-3 py-1.5 font-semibold hover:bg-amber-100/10">{t("home.retry")}</button>
            </div>
          )}
          <div data-filter-anchor className="relative z-30 mt-5 max-w-xl">
            <div className="flex h-11 items-center rounded-xl border border-white/10 bg-[#171127]/75 shadow-lg shadow-black/10 backdrop-blur-xl focus-within:border-primary/60">
              <Search className="ml-3 h-4 w-4 shrink-0 text-muted-foreground" />
              <input value={catalogQuery} onChange={(event) => { const value = event.target.value; setCatalogQuery(value); setCatalogPage(1); writeCatalogUrl({ q: value.trim() || undefined, page: 1 }); }} disabled={needsFullCatalog && catalogLoadState !== "loaded" && catalogLoadState !== "error"} placeholder={t("search.placeholder")} aria-label={t("catalog.search")} className="h-full min-w-0 flex-1 bg-transparent px-2.5 text-sm outline-none placeholder:text-muted-foreground" />
              {catalogQuery && <button type="button" aria-label={t("search.clear")} onClick={() => { setCatalogQuery(""); setCatalogPage(1); writeCatalogUrl({ q: undefined, page: 1 }); }} className="rounded-full p-1.5 text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>}
              <button type="button" disabled={needsFullCatalog && catalogLoadState !== "loaded" && catalogLoadState !== "error"} onClick={() => { setDraftFilters({ ...activeFilters, genres: [...activeFilters.genres] }); setFiltersOpen((open) => !open); }} aria-label={t("filters.open")} aria-expanded={filtersOpen} data-filter-trigger className={`relative mr-1.5 flex h-8 w-9 shrink-0 items-center justify-center rounded-lg transition ${filtersOpen || activeFilterCount ? "bg-primary/20 text-primary" : "text-muted-foreground hover:bg-accent hover:text-foreground"}`}>
                <SlidersHorizontal className="h-4 w-4" />
                {activeFilterCount > 0 && <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-neon px-1 text-[10px] font-bold text-primary-foreground">{activeFilterCount}</span>}
              </button>
            </div>
            <CatalogFilters open={filtersOpen && (!needsFullCatalog || catalogLoadState === "loaded" || catalogLoadState === "error")} draft={draftFilters} setDraft={setDraftFilters} onApply={applyCatalogFilters} onReset={resetCatalogFilters} onClose={() => setFiltersOpen(false)} genres={availableGenres} statuses={availableStatuses} types={availableTypes} ageRatings={availableAgeRatings} yearMin={catalogYearRange.min} yearMax={catalogYearRange.max} />
          </div>
          <div className="mb-5 mt-7 flex flex-wrap items-center justify-end gap-3">
            <label className="flex h-9 items-center gap-2 rounded-lg border border-border bg-secondary/80 px-3 text-sm">
              <ArrowDownWideNarrow className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground max-sm:hidden">{t("catalog.sort")}</span>
              <select value={sortBy} onChange={(event) => { const value = event.target.value; setSortBy(value); setCatalogPage(1); writeCatalogUrl({ sort: value === "rating" ? undefined : value, page: 1 }); }} aria-label={t("catalog.sort")} className="max-w-[145px] bg-transparent text-sm outline-none">
                <option value="rating">{t("catalog.sortRating")}</option><option value="newest">{t("catalog.sortNewest")}</option><option value="oldest">{t("catalog.sortOldest")}</option><option value="title">{t("catalog.sortTitle")}</option>
              </select>
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            </label>
          </div>
          {catalogMode !== "paged" || (needsFullCatalog && catalogLoadState !== "loaded" && catalogLoadState !== "error") ? (
            <CatalogSkeleton count={12} />
          ) : (
            <>
              {catalogLoadState === "error" && (
                <div role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-400/25 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
                  <span>{t("catalog.loadError")}</span>
                  <button type="button" onClick={() => { catalogLoadStarted.current = false; setCatalogLoadState("idle"); setCatalogLoadAttempt((value) => value + 1); }} className="rounded-lg border border-amber-100/20 px-3 py-1.5 font-semibold hover:bg-amber-100/10">{t("home.retry")}</button>
                </div>
              )}
              <Grid items={visibleCatalogResults} onSelect={select} empty={ANIME.length === 0 && (apiError || catalogLoadError) ? t("source.catalogUnavailable") : t("catalog.noResults")} />
              {catalogResults.length > 0 && <nav aria-label={t("catalog.pages")} className="mt-8 flex flex-wrap items-center justify-center gap-1.5">
                <button type="button" disabled={catalogPage === 1} onClick={() => { const next = Math.max(1, catalogPage - 1); setCatalogPage(next); writeCatalogUrl({ page: next }); window.scrollTo({ top: 0, behavior: "smooth" }); }} className="h-9 rounded-lg border border-border px-3 text-sm transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-35">{t("catalog.previous")}</button>
                {Array.from({ length: totalCatalogPages }, (_, index) => index + 1)
                  .filter((page) => page === 1 || page === totalCatalogPages || Math.abs(page - catalogPage) <= 1)
                  .reduce<(number | "ellipsis")[]>((pages, page, index, visible) => {
                    if (index > 0 && page - visible[index - 1]! > 1) pages.push("ellipsis");
                    pages.push(page);
                    return pages;
                  }, [])
                  .map((page, index) => page === "ellipsis"
                    ? <span key={`ellipsis-${index}`} className="px-1 text-muted-foreground">…</span>
                    : <button key={page} type="button" aria-current={catalogPage === page ? "page" : undefined} onClick={() => { setCatalogPage(page); writeCatalogUrl({ page }); window.scrollTo({ top: 0, behavior: "smooth" }); }} className={`h-9 min-w-9 rounded-lg border px-3 text-sm transition ${catalogPage === page ? "border-primary/70 bg-primary/20 text-foreground" : "border-border hover:bg-accent"}`}>{page}</button>)}
                <button type="button" disabled={catalogPage === totalCatalogPages} onClick={() => { const next = Math.min(totalCatalogPages, catalogPage + 1); setCatalogPage(next); writeCatalogUrl({ page: next }); window.scrollTo({ top: 0, behavior: "smooth" }); }} className="h-9 rounded-lg border border-border px-3 text-sm transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-35">{t("catalog.next")}</button>
              </nav>}
            </>
          )}
        </main>
      ) : view === "collections" ? (
        <main id="main-content" className="px-4 pt-36 md:px-10 md:pt-24">
          {activeCollection ? (
            <>
              <button onClick={() => setCollection(null)} className="mb-3 text-sm text-muted-foreground hover:text-primary">← {t("collections.all")}</button>
              <h1 className="text-2xl font-bold md:text-3xl">{t((`collection.${activeCollection.id}.title`) as TranslationKey)}</h1>
              <p className="mb-6 text-muted-foreground">{t((`collection.${activeCollection.id}.subtitle`) as TranslationKey)}</p>
              <Grid items={activeCollectionAnime} onSelect={select} empty={t("collections.empty")} />
            </>
          ) : (
            <>
              <h1 className="mb-6 text-2xl font-bold md:text-3xl">{t("collections.title")}</h1>
              <CollectionsGrid animeList={ANIME} onOpen={setCollection} />
            </>
          )}
        </main>
      ) : view === "profile" ? (
        <Profile animeList={ANIME} onSelect={select} onCatalog={() => setView("catalog")} />
      ) : view === "favorites" ? (
        <Profile key="favorites" initialPanel="favorites" animeList={ANIME} onSelect={select} onCatalog={() => setView("catalog")} />
      ) : view === "watchlist" ? (
        <Profile key="watchlist" initialPanel="watchlist" animeList={ANIME} onSelect={select} onCatalog={() => setView("catalog")} />
      ) : view === "privacy" ? (
        <Profile key="privacy" initialPanel="documents" animeList={ANIME} onSelect={select} onCatalog={() => setView("catalog")} />
      ) : view === "privacy-policy" ? (
        <Profile key="privacy-policy" initialPanel="privacy" animeList={ANIME} onSelect={select} onCatalog={() => setView("catalog")} />
      ) : view === "rules" ? (
        <Profile key="rules" initialPanel="rules" animeList={ANIME} onSelect={select} onCatalog={() => setView("catalog")} />
      ) : view === "rights" ? (
        <Profile key="rights" initialPanel="rights" animeList={ANIME} onSelect={select} onCatalog={() => setView("catalog")} />
      ) : view === "admin" ? (
        <main id="main-content" className="min-h-[70vh] bg-[#050408] px-4 pt-20 pb-8 md:px-10 md:pt-24">
          <div className="mx-auto max-w-5xl">
            <h1 className="mb-2 text-2xl font-bold md:text-3xl">{language === "ru" ? "Панель администратора" : "Admin panel"}</h1>
            <p className="mb-4 text-sm text-muted-foreground">{language === "ru" ? "Управление функциями и обслуживанием YUME." : "Manage YUME features and maintenance."}</p>
            {!telegramDetectionComplete || (isTelegramMiniApp && (
              (!telegramAuthReady && !telegramAuthError) ||
              (telegramAuthReady && !telegramConsentRequired && !telegramConsentPending && !adminCheckComplete)
            )) ? (
              <p role="status" className="rounded-xl border border-border bg-card/60 p-4 text-sm text-muted-foreground">
                {language === "ru" ? "Проверяем права администратора…" : "Checking administrator access…"}
              </p>
            ) : isAdmin ? (
              <>
              <section className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-3" aria-label={language === "ru" ? "Актуальные показатели каталога" : "Current catalog metrics"}>
                <div className="rounded-xl border border-[#382D46] bg-[#0C0C16] p-3">
                  <span className="flex items-center gap-2.5"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#271024]"><Play className="h-5 w-5 fill-[#FF3D91] text-[#FF3D91]"/></span><span className="text-xs text-[#D3C3D7]">{language==="ru"?"Без трейлера":"Missing trailer"}</span></span>
                  <span className="mt-1 block text-xl font-bold tabular-nums text-[#FF3D91]">{adminStats ? adminStats.missing.toLocaleString(language==="ru"?"ru-RU":"en-US") : "—"}</span>
                </div>
                <div className="rounded-xl border border-[#382D46] bg-[#0C0C16] p-3">
                  <span className="flex items-center gap-2.5"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#0C1F3D]"><Database className="h-5 w-5 text-[#4FC8F3]"/></span><span className="text-xs text-[#C3D3E1]">{language==="ru"?"Всего в каталоге":"Total in catalog"}</span></span>
                  <span className="mt-1 block text-xl font-bold tabular-nums text-[#B8D7FF]">{adminStats ? adminStats.total.toLocaleString(language==="ru"?"ru-RU":"en-US") : "—"}</span>
                </div>
                <div className="rounded-xl border border-[#382D46] bg-[#0C0C16] p-3">
                  <span className="flex items-center gap-2.5"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#0D2621]"><CircleCheck className="h-5 w-5 fill-[#36EBA6] text-[#36EBA6]"/></span><span className="text-xs text-[#C3D8D0]">{language==="ru"?"С трейлером":"With trailer"}</span></span>
                  <span className="mt-1 block text-xl font-bold tabular-nums text-[#36EBA6]">{adminStats ? adminStats.found.toLocaleString(language==="ru"?"ru-RU":"en-US") : "—"}</span>
                </div>
              </section>
              <section className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-card/50 px-3 py-2.5" aria-label={language === "ru" ? "Состояние операций" : "Operations status"}>
                <span className="text-sm font-medium">{language === "ru" ? "Состояние операций" : "Operations status"}</span>
                <span className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-medium ${(adminRunning || adminImportRunning || metadataRefreshRunning) ? "border-primary/40 bg-primary/10 text-primary" : (adminMessage || adminImportMessage || metadataRefreshMessage) ? "border-amber-500/40 bg-amber-500/10 text-amber-600" : "border-border bg-background/60 text-muted-foreground"}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${(adminRunning || adminImportRunning || metadataRefreshRunning) ? "animate-pulse bg-primary" : (adminMessage || adminImportMessage || metadataRefreshMessage) ? "bg-amber-500" : "bg-muted-foreground/60"}`} />
                  {(adminRunning || adminImportRunning || metadataRefreshRunning) ? (language === "ru" ? "Выполняется" : "Running") : (adminMessage || adminImportMessage || metadataRefreshMessage) ? (language === "ru" ? "Есть сообщение" : "Has message") : (language === "ru" ? "Ожидание запуска" : "Idle")}
                </span>
                {(adminMessage || adminImportMessage || metadataRefreshMessage) && <p className="w-full border-t border-border/70 pt-2 text-xs text-muted-foreground" role="status">{adminMessage || adminImportMessage || metadataRefreshMessage}</p>}
              </section>
              <details open={expandedAdminSections.notifications} onToggle={event => { const isOpen = event.currentTarget.open; setExpandedAdminSections(current => current.notifications === isOpen ? current : {...current, notifications: isOpen}); }} className="group mb-3 overflow-hidden rounded-2xl border border-[#382846] bg-[#0C0A12]" aria-label={language === "ru" ? "Уведомления пользователям" : "User notifications"}>
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4 hover:bg-card/80 [&::-webkit-details-marker]:hidden">
                  <span className="flex items-center gap-3"><Bell className="h-5 w-5 text-[#BE65FF]"/><span><span className="block font-semibold">{language === "ru" ? "Уведомления пользователям" : "Notify users"}</span><span className="mt-1 block text-xs text-muted-foreground">{language === "ru" ? "Опубликовать сообщение для всех аккаунтов" : "Publish a message for all accounts"}</span></span></span><ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180"/>
                </summary>
                <form className="grid gap-3 border-t border-border/70 p-4" onSubmit={async event => { event.preventDefault(); if (!isAdmin || notificationPublishBusy) return; setNotificationPublishBusy(true); setAdminMessage(""); try { const response = await fetch("/api/admin-notifications", { method:"POST", credentials:"same-origin", cache:"no-store", headers:{"Content-Type":"application/json"}, body:JSON.stringify({title:notificationDraftTitle,body:notificationDraftBody,targetUrl:notificationDraftTarget || null}) }); const payload = await response.json().catch(()=>({})) as {error?:string;notification?:{id:string;title:string;body:string;targetUrl:string|null}}; if (!response.ok || !payload.notification) throw new Error(payload.error || "publish_failed"); const n = payload.notification; setNotificationItems(current => [{id:n.id,publishedAt:new Date().toISOString(),title:{ru:n.title,en:n.title},description:{ru:n.body,en:n.body},targetUrl:n.targetUrl,dynamic:true},...current]); setNotificationDraftTitle(""); setNotificationDraftBody(""); setNotificationDraftTarget(""); setAdminMessage(language === "ru" ? "Уведомление опубликовано для всех пользователей." : "Notification published for all users."); } catch { setAdminMessage(language === "ru" ? "Не удалось опубликовать уведомление. Проверь подключение и права администратора." : "Could not publish notification. Check connection and admin access."); } finally { setNotificationPublishBusy(false); } }}>
                  <label className="grid gap-1 text-sm"><span>{language === "ru" ? "Заголовок" : "Title"}</span><input required maxLength={120} value={notificationDraftTitle} onChange={event=>setNotificationDraftTitle(event.target.value)} className="rounded-lg border border-border bg-background px-3 py-2" placeholder={language === "ru" ? "Например, технические работы" : "For example, scheduled maintenance"}/></label>
                  <label className="grid gap-1 text-sm"><span>{language === "ru" ? "Текст уведомления" : "Notification message"}</span><textarea required maxLength={2000} rows={4} value={notificationDraftBody} onChange={event=>setNotificationDraftBody(event.target.value)} className="resize-y rounded-lg border border-border bg-background px-3 py-2" placeholder={language === "ru" ? "Сообщение для всех пользователей" : "Message for all users"}/></label>
                  <label className="grid gap-1 text-sm"><span>{language === "ru" ? "Внутренняя ссылка (необязательно)" : "Internal link (optional)"}</span><input value={notificationDraftTarget} onChange={event=>setNotificationDraftTarget(event.target.value)} pattern="\/(?!\/).*" maxLength={500} className="rounded-lg border border-border bg-background px-3 py-2" placeholder="/"/></label>
                  <button type="submit" disabled={notificationPublishBusy || !notificationDraftTitle.trim() || !notificationDraftBody.trim()} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">{notificationPublishBusy ? (language === "ru" ? "Публикуем…" : "Publishing…") : (language === "ru" ? "Отправить всем пользователям" : "Send to all users")}</button>
                </form>
              </details>
              <details open={expandedAdminSections.import} onToggle={event => { const isOpen = event.currentTarget.open; setExpandedAdminSections(current => current.import === isOpen ? current : {...current, import: isOpen}); }} className="group mb-3 overflow-hidden rounded-2xl border border-[#8D3DD6] bg-[#0D0A13] shadow-[0_0_18px_rgba(157,64,245,0.10)]" aria-label={language === "ru" ? "Пополнение каталога" : "Catalog import"}>
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4 hover:bg-card/80 [&::-webkit-details-marker]:hidden">
                  <span className="flex min-w-0 items-center gap-2.5"><Download className="h-5 w-5 shrink-0 text-[#BE65FF]" /><span className="min-w-0"><span className="block font-semibold text-[#F8F4FF]">{language === "ru" ? "Пополнение каталога из Shikimori" : "Import catalogue from Shikimori"}</span><span className="mt-0.5 block text-xs text-muted-foreground">{language === "ru" ? "Добавлено " : "Added "}{adminImport.added} / {adminImport.target} · {language === "ru" ? "страница " : "page "}{adminImport.cursor}</span></span></span>
                  <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
                </summary>
                <div className="border-t border-border/70 p-3 sm:p-4">
                  <p className="text-xs leading-relaxed text-muted-foreground">{language === "ru" ? "Можно добавить аниме по названию или оставить импорт по количеству. Оба режима сохраняют метаданные, постер и доступные скриншоты из Shikimori." : "Add anime by title or keep using the quantity-based importer. Both modes save metadata, poster and available Shikimori screenshots."}</p>
                  <section className="mt-4 rounded-xl border border-[#3B294B] bg-[#08070D] p-3 sm:p-4" aria-label={language === "ru" ? "Импорт аниме по названию" : "Import anime by title"}>
                    <h3 className="text-sm font-semibold text-[#F8F4FF]">{language === "ru" ? "Добавить по названию" : "Import by title"}</h3>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{language === "ru" ? "Введи русское, английское или японское название. Поиск покажет варианты, чтобы ты выбрал правильный сезон или фильм." : "Search using the Russian, English or Japanese title. Choose the exact season or movie from the results."}</p>
                    <form className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]" onSubmit={event => { event.preventDefault(); void searchCatalogTitle(); }}>
                      <input
                        type="search"
                        value={adminImportTitleQuery}
                        onChange={event => { setAdminImportTitleQuery(event.target.value); setAdminTitleSearchResults([]); setAdminTitleSearchMessage(""); }}
                        maxLength={120}
                        minLength={2}
                        placeholder={language === "ru" ? "Например: Frieren, フリーレン, Фрирен" : "For example: Frieren, フリーレン"}
                        aria-label={language === "ru" ? "Название аниме для поиска" : "Anime title to search"}
                        disabled={adminTitleSearchBusy || Boolean(adminTitleImportBusy) || adminImportRunning || metadataRefreshRunning}
                        className="h-11 min-w-0 rounded-xl border border-[#453452] bg-[#050408] px-3 text-sm text-white placeholder:text-muted-foreground focus:border-[#BE65FF] focus:outline-none focus:ring-1 focus:ring-[#BE65FF] disabled:opacity-60"
                      />
                      <button
                        type="submit"
                        disabled={adminTitleSearchBusy || Boolean(adminTitleImportBusy) || adminImportRunning || metadataRefreshRunning || adminImportTitleQuery.trim().length < 2}
                        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[#7750A0] px-4 py-2 text-sm font-semibold text-[#E7CEFF] transition hover:bg-[#241431] disabled:cursor-wait disabled:opacity-50"
                      >
                        <Search className="h-4 w-4" />
                        {adminTitleSearchBusy ? (language === "ru" ? "Ищем…" : "Searching…") : (language === "ru" ? "Найти тайтл" : "Search title")}
                      </button>
                    </form>
                    {adminTitleSearchMessage && <p className="mt-3 rounded-lg border border-border bg-background/60 p-2.5 text-xs text-muted-foreground" role="status">{adminTitleSearchMessage}</p>}
                    {adminTitleSearchResults.length > 0 && (
                      <div className="mt-3 space-y-2">
                        {adminTitleSearchResults.map(item => (
                          <article key={item.id} className="flex min-w-0 items-center gap-3 rounded-xl border border-[#30263A] bg-[#0D0A13] p-2.5 sm:p-3">
                            {item.posterUrl ? (
                              <img src={item.posterUrl} alt="" loading="lazy" decoding="async" className="h-16 w-11 shrink-0 rounded-md object-cover bg-black/30" />
                            ) : (
                              <div aria-hidden="true" className="grid h-16 w-11 shrink-0 place-items-center rounded-md bg-[#251A30] text-xs font-bold text-[#CE9EFF]">Y</div>
                            )}
                            <div className="min-w-0 flex-1">
                              <h4 className="break-words text-sm font-medium text-white">{item.title}</h4>
                              <p className="mt-0.5 break-words text-xs text-muted-foreground">{[item.originalTitle !== item.title ? item.originalTitle : "", item.englishTitle !== item.originalTitle ? item.englishTitle : "", item.year > 0 ? String(item.year) : "", item.kind ?? "", item.ageRating ? (language==="ru" ? "Возраст: " : "Age: ") + item.ageRating : "", ...(item.genres ?? []).slice(0,3)].filter(Boolean).join(" · ")}</p>
                              <p className="mt-0.5 text-[11px] text-muted-foreground">Shikimori ID: {item.id}{item.status ? " · " + item.status : ""}</p>
                            </div>
                            <button
                              type="button"
                              onClick={() => { void importCatalogTitle(item.id); }}
                              disabled={item.alreadyInCatalog || Boolean(adminTitleImportBusy) || adminTitleSearchBusy || adminImportRunning || metadataRefreshRunning}
                              className={item.alreadyInCatalog
                                ? "min-h-9 shrink-0 rounded-lg border border-border px-2.5 py-2 text-[11px] font-medium text-muted-foreground"
                                : "min-h-9 shrink-0 rounded-lg bg-gradient-to-r from-[#AC4EFC] to-[#8736FA] px-2.5 py-2 text-[11px] font-semibold text-white transition hover:brightness-110 disabled:cursor-wait disabled:opacity-50"}
                            >
                              {item.alreadyInCatalog
                                ? (language === "ru" ? "Уже добавлено" : "Already added")
                                : adminTitleImportBusy === item.id
                                  ? (language === "ru" ? "Добавляем…" : "Importing…")
                                  : (language === "ru" ? "Импортировать" : "Import")}
                            </button>
                          </article>
                        ))}
                      </div>
                    )}
                  </section>
                  <div className="my-4 flex items-center gap-3 text-[11px] uppercase tracking-[0.15em] text-muted-foreground"><span className="h-px flex-1 bg-border" /><span>{language === "ru" ? "или импорт по количеству" : "or import by quantity"}</span><span className="h-px flex-1 bg-border" /></div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                    <label className="text-sm">
                      <span className="mb-1 block text-xs text-muted-foreground">{language === "ru" ? "Количество новых записей" : "Number of new records"}</span>
                      <input type="number" min={1} step={1} value={adminImportTarget} onChange={event => setAdminImportTarget(event.target.value)} disabled={adminImportRunning || adminImport.state === "running"} className="h-10 w-full rounded-xl border border-[#453452] bg-[#050408] px-3 text-[#FFFFFF] focus:border-[#BE65FF] focus:outline-none focus:ring-1 focus:ring-[#BE65FF]" />
                    </label>
                    <label className="text-sm">
                      <span className="mb-1 block text-xs text-muted-foreground">{language === "ru" ? "Статус для массового импорта" : "Bulk import status"}</span>
                      <select value={adminImportStatusFilter} onChange={event => setAdminImportStatusFilter(event.target.value)} disabled={adminImportRunning || adminImport.state === "running"} className="h-10 w-full rounded-xl border border-[#453452] bg-[#050408] px-3 text-[#FFFFFF] focus:border-[#BE65FF] focus:outline-none focus:ring-1 focus:ring-[#BE65FF]">
                        <option value="">{language === "ru" ? "Любой статус" : "Any status"}</option>
                        <option value="ongoing">{language === "ru" ? "Онгоинг" : "Ongoing"}</option>
                        <option value="anons">{language === "ru" ? "Анонс" : "Announced"}</option>
                        <option value="released">{language === "ru" ? "Вышедшее" : "Released"}</option>
                      </select>
                    </label>
                    <button type="button" onClick={runCatalogImport} disabled={adminImportRunning || metadataRefreshRunning || (adminImport.state !== "running" && (!Number.isSafeInteger(Number(adminImportTarget)) || Number(adminImportTarget)<1))} className="self-end rounded-xl bg-gradient-to-r from-[#AC4EFC] to-[#8736FA] px-4 py-2.5 text-sm font-semibold text-white shadow-[0_0_16px_rgba(155,65,245,0.18)] transition hover:brightness-110 disabled:cursor-wait disabled:opacity-50">
                      {adminImportRunning ? (language === "ru" ? "Импорт…" : "Importing…") : adminImport.state === "running" ? (language === "ru" ? "Продолжить импорт" : "Resume import") : (language === "ru" ? "Начать импорт" : "Start import")}
                    </button>
                  </div>
                  <label className="mt-3 flex cursor-pointer items-start gap-3 rounded-xl border border-[#49375A] bg-[#100B17] p-3">
                    <input type="checkbox" checked={adminBulkBlock18Plus} onChange={event => { void saveAdminBulkImportFilter(event.target.checked); }} disabled={adminBulkFilterBusy || adminImportRunning || adminImport.state === "running" || metadataRefreshRunning} className="mt-1 h-4 w-4 shrink-0 accent-fuchsia-400 disabled:opacity-50"/>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-[#F8F4FF]">{language==="ru" ? "Исключать рейтинг 18+ при импорте по количеству" : "Exclude 18+ ratings from quantity imports"}</span>
                      <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{language==="ru" ? "Включено: тайтлы с рейтингом RX (18+) пропускаются. Хентай, яой и юри запрещены для массовой загрузки всегда. Поиск и ручной импорт по названию этими правилами не ограничиваются." : "When enabled, RX (18+) titles are skipped. Hentai, yaoi and yuri are always excluded from bulk imports. Title search and manual title imports are not affected."}</span>
                      {adminBulkFilterBusy && <span className="mt-1 block text-xs text-[#D0A8FF]">{language==="ru" ? "Сохраняем настройку…" : "Saving setting…"}</span>}
                    </span>
                  </label>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                    <div className="rounded-lg border border-[#243D35] bg-[#050408] p-2.5"><span className="block text-xs text-[#A89CB8]">{language === "ru" ? "Добавлено" : "Added"}</span><strong className="tabular-nums text-[#36EBA6]">{adminImport.added} / {adminImport.target}</strong></div>
                    <div className="rounded-lg border border-[#27374A] bg-[#050408] p-2.5"><span className="block text-xs text-[#A89CB8]">{language === "ru" ? "Дубликаты" : "Duplicates"}</span><strong className="tabular-nums text-[#91CFFF]">{adminImport.skipped}</strong></div>
                    <div className="rounded-lg border border-[#493A27] bg-[#050408] p-2.5"><span className="block text-xs text-[#A89CB8]">{language === "ru" ? "Неполные записи" : "Incomplete records"}</span><strong className="tabular-nums text-[#FFAA43]">{adminImport.incomplete}</strong></div>
                    <div className="rounded-lg border border-[#492638] bg-[#050408] p-2.5"><span className="block text-xs text-[#A89CB8]">{language === "ru" ? "Ошибки источника" : "Source errors"}</span><strong className="tabular-nums text-[#FF4A68]">{adminImport.errors}</strong></div>
                  </div>
                  {adminImportRunning && <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={adminImport.target || 1} aria-valuenow={adminImport.added}><div className="h-full rounded-full bg-gradient-to-r from-[#A83BFA] to-[#D08AFF] transition-all" style={{width:`${adminImport.target ? Math.min(100,adminImport.added/adminImport.target*100) : 0}%`}} /></div>}
                  <p className="mt-2 text-xs text-muted-foreground">{language === "ru" ? `Состояние: ${adminImport.state}. Страница Shikimori: ${adminImport.cursor}.` : `Status: ${adminImport.state}. Shikimori page: ${adminImport.cursor}.`}</p>
                  {adminImportMessage && <p className="mt-2 rounded-lg border border-border bg-background/60 p-2.5 text-xs" role="status">{adminImportMessage}</p>}
                </div>
              </details>
              <details open={expandedAdminSections.deletion} onToggle={event => { const isOpen = event.currentTarget.open; setExpandedAdminSections(current => current.deletion === isOpen ? current : {...current, deletion: isOpen}); }} className="group mb-3 overflow-hidden rounded-2xl border border-[#713342] bg-[#10090D]" aria-label={language==="ru" ? "Удаление тайтла из каталога" : "Delete title from catalog"}>
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4 hover:bg-card/80 [&::-webkit-details-marker]:hidden">
                  <span className="flex min-w-0 items-center gap-2.5"><Database className="h-5 w-5 shrink-0 text-[#FF758B]" /><span className="min-w-0"><span className="block font-semibold text-[#FFF2F4]">{language==="ru" ? "Удаление тайтла из каталога" : "Delete a title from the catalog"}</span><span className="mt-0.5 block text-xs text-muted-foreground">{language==="ru" ? "Найди запись по названию и удали её вместе со скриншотами" : "Find a catalog entry by title and remove it with its screenshots"}</span></span></span>
                  <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
                </summary>
                <div className="border-t border-border/70 p-3 sm:p-4">
                  <p className="mb-3 text-xs leading-relaxed text-muted-foreground">{language==="ru" ? "Поиск выполняется только по текущему каталогу, включая русское, английское и оригинальное названия. Удалённый тайтл будет пропущен массовым импортом. Его можно добавить снова только явным импортом по названию." : "Searches only the current catalog using Russian, English and original titles. Bulk import will skip a deleted title. It can be restored only with an explicit title import."}</p>
                  <form className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]" onSubmit={event=>{event.preventDefault();void searchCatalogDeletionTitle();}}>
                    <input type="search" value={adminDeleteQuery} onChange={event=>{setAdminDeleteQuery(event.target.value);setAdminDeleteResults([]);setAdminDeleteMessage("");}} minLength={2} maxLength={120} placeholder={language==="ru" ? "Название тайтла для удаления" : "Title to delete"} aria-label={language==="ru" ? "Название тайтла для удаления" : "Title to delete"} disabled={adminDeleteSearchBusy || Boolean(adminDeleteBusy) || adminImportRunning || metadataRefreshRunning} className="h-11 min-w-0 rounded-xl border border-[#59303B] bg-[#050408] px-3 text-sm text-white placeholder:text-muted-foreground focus:border-[#FF758B] focus:outline-none focus:ring-1 focus:ring-[#FF758B] disabled:opacity-60"/>
                    <button type="submit" disabled={adminDeleteSearchBusy || Boolean(adminDeleteBusy) || adminImportRunning || metadataRefreshRunning || adminDeleteQuery.trim().length<2} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[#A64B5D] px-4 py-2 text-sm font-semibold text-[#FFD8DF] transition hover:bg-[#2B1119] disabled:cursor-wait disabled:opacity-50"><Search className="h-4 w-4"/>{adminDeleteSearchBusy ? (language==="ru" ? "Ищем…" : "Searching…") : (language==="ru" ? "Найти в каталоге" : "Search catalog")}</button>
                  </form>
                  {adminDeleteMessage && <p role="status" className="mt-3 rounded-lg border border-border bg-background/60 p-2.5 text-xs text-muted-foreground">{adminDeleteMessage}</p>}
                  {adminDeleteResults.length>0 && <div className="mt-3 space-y-2">{adminDeleteResults.map(item=>
                    <article key={item.id} className="flex min-w-0 items-center gap-3 rounded-xl border border-[#4B2731] bg-[#0D0A10] p-2.5 sm:p-3">
                      {item.posterUrl ? <img src={item.posterUrl} alt="" loading="lazy" decoding="async" className="h-16 w-11 shrink-0 rounded-md bg-black/30 object-cover"/> : <div aria-hidden="true" className="grid h-16 w-11 shrink-0 place-items-center rounded-md bg-[#29151D] text-xs font-bold text-[#FF9BAB]">Y</div>}
                      <div className="min-w-0 flex-1"><h4 className="break-words text-sm font-medium text-white">{item.title}</h4><p className="mt-0.5 break-words text-xs text-muted-foreground">{[item.originalTitle!==item.title?item.originalTitle:"",item.englishTitle&&item.englishTitle!==item.originalTitle?item.englishTitle:"",item.year>0?String(item.year):"",item.ageRating??"",...item.genres.slice(0,3)].filter(Boolean).join(" · ")}</p><p className="mt-0.5 text-[11px] text-muted-foreground">Shikimori ID: {item.id}</p></div>
                      <button type="button" onClick={()=>{void deleteCatalogTitle(item.id);}} disabled={Boolean(adminDeleteBusy)||adminImportRunning||metadataRefreshRunning} className="min-h-9 shrink-0 rounded-lg border border-[#B84A60] px-2.5 py-2 text-[11px] font-semibold text-[#FFB6C4] transition hover:bg-[#3A1520] disabled:cursor-wait disabled:opacity-50">{adminDeleteBusy===item.id ? (language==="ru" ? "Удаляем…" : "Deleting…") : (language==="ru" ? "Удалить" : "Delete")}</button>
                    </article>
                  )}</div>}
                </div>
              </details>
              <details open={false} className="group mb-3 overflow-hidden rounded-2xl border border-[#6C3E91] bg-[#0D0A13]" aria-label={language === "ru" ? "Ручное обновление разделов" : "Manual section refresh"}>
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4 hover:bg-card/80 [&::-webkit-details-marker]:hidden">
                  <span className="flex min-w-0 items-center gap-2.5"><Database className="h-5 w-5 shrink-0 text-[#BE65FF]" /><span><span className="block font-semibold text-[#F8F4FF]">{language === "ru" ? "Обновление разделов главной" : "Home section metadata refresh"}</span><span className="mt-1 block text-xs text-muted-foreground">{language === "ru" ? "Только выбранный раздел и три поля метаданных" : "Only the selected section and three metadata fields"}</span></span></span><ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"/>
                </summary>
                <div className="grid gap-3 border-t border-border/70 p-4">
                  <label className="grid gap-1.5 text-sm"><span>{language === "ru" ? "Раздел для обновления" : "Section to refresh"}</span><select value={sectionMetadataTarget} onChange={event=>setSectionMetadataTarget(event.target.value as "ongoing" | "announcements")} className="min-h-11 rounded-lg border border-border bg-background px-3 py-2"><option value="ongoing">{language === "ru" ? "Сейчас выходит" : "Currently airing"}</option><option value="announcements">{language === "ru" ? "Анонсы" : "Announcements"}</option></select></label>
                  <p className="text-xs leading-relaxed text-muted-foreground">{language === "ru" ? "Проверяются только тайтлы выбранного раздела. Обновляются статус, дата следующей серии и общее количество серий. Остальные данные каталога не изменяются." : "Only titles in the selected section are checked. Status, next episode date, and total episode count are updated; other catalogue data is untouched."}</p>
                  <button type="button" disabled={sectionMetadataBusy || metadataRefreshRunning || adminImportRunning} onClick={async()=>{if(!isAdmin||sectionMetadataBusy)return;setSectionMetadataBusy(true);setAdminMessage("");try{const response=await fetch("/api/admin/catalog-import",{method:"POST",credentials:"same-origin",cache:"no-store",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"refresh_section_metadata",statusFilter:sectionMetadataTarget})});const payload=await response.json().catch(()=>({})) as {isAdmin?:boolean;error?:string;message?:string;total?:number;updated?:number};if(!response.ok||payload.isAdmin!==true)throw new Error(payload.message||payload.error||(language==="ru"?"Не удалось обновить раздел.":"Could not refresh section."));setAdminMessage(language==="ru"?(payload.total===0?"В выбранном разделе нет тайтлов.":`Готово: проверено ${payload.total}, обновлено ${payload.updated??0}.`):`Done: checked ${payload.total??0}, updated ${payload.updated??0}.`);}catch(error){setAdminMessage(error instanceof Error?error.message:(language==="ru"?"Ошибка обновления раздела.":"Section refresh failed."));}finally{setSectionMetadataBusy(false);}}} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">{sectionMetadataBusy?(language==="ru"?"Обновляем…":"Refreshing…"):(language==="ru"?"Обновить выбранный раздел":"Refresh selected section")}</button>
                </div>
              </details>
              <details open={expandedAdminSections.metadata} onToggle={event => { const isOpen = event.currentTarget.open; setExpandedAdminSections(current => current.metadata === isOpen ? current : {...current, metadata: isOpen}); }} style={{display:"none"}} className="group mb-3 overflow-hidden rounded-2xl border border-[#6C3E91] bg-[#0D0A13]" aria-label={language === "ru" ? "Обновление метаданных каталога" : "Refresh catalogue metadata"}>
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4 hover:bg-card/80 [&::-webkit-details-marker]:hidden">
                  <span className="flex min-w-0 items-center gap-2.5"><Database className="h-5 w-5 shrink-0 text-[#BE65FF]" /><span className="min-w-0"><span className="block font-semibold text-[#F8F4FF]">{language === "ru" ? "Обновление метаданных каталога" : "Refresh catalogue metadata"}</span><span className="mt-0.5 block text-xs text-muted-foreground">{language === "ru" ? "Прогресс сохраняется; можно сбросить и начать проверку заново" : "Progress is saved; reset it to start a fresh scan"}</span></span></span>
                  <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
                </summary>
                <div className="border-t border-border/70 p-3 sm:p-4">
                <div className="flex flex-col gap-3">
                  <p className="text-xs leading-relaxed text-muted-foreground">{language === "ru" ? "Дозаполняет отсутствующие метаданные и кадры из Shikimori. Уже заполненные метаданные не перезаписываются; новые записи не добавляются." : "Fills missing metadata and screenshots from Shikimori. Existing metadata is preserved; no records are added."}</p>
                  <div className="grid grid-cols-2 gap-1.5">
                    <button type="button" onClick={resetMetadataRefresh} disabled={metadataRefreshRunning || metadataAutoBusy || adminImportRunning || adminRunning} className="col-span-2 w-full rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-2 text-xs font-semibold text-amber-200 disabled:cursor-not-allowed disabled:opacity-45">{language === "ru" ? "Сбросить прогресс и начать сначала" : "Reset progress and start over"}</button>
                    <button type="button" onClick={runMetadataRefresh} disabled={metadataRefreshRunning || metadataAutoBusy || adminImportRunning || adminRunning} className="w-full rounded-lg bg-gradient-to-r from-[#AC4EFC] to-[#8736FA] px-2.5 py-2 text-xs font-semibold text-white shadow-[0_0_12px_rgba(155,65,245,0.15)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-45">{metadataRefreshRunning ? (language === "ru" ? "Выполняется вручную…" : "Manual run active…") : (language === "ru" ? "Запустить вручную" : "Run manually")}</button>
                    <button type="button" onClick={stopManualMetadataRefresh} disabled={!metadataRefreshRunning || metadataAutoBusy} className="w-full rounded-lg border border-border px-2.5 py-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-40">{language === "ru" ? "Стоп ручного запуска" : "Stop manual run"}</button>
                  </div>
                </div>
                {(metadataRefreshRunning || metadataRefreshProgress.total > 0) && (
                  <div className="mt-3">
                    <div className="mb-1 flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
                      <span>{metadataRefreshProgress.phase === "metadata" ? (language === "ru" ? "Метаданные" : "Metadata") : metadataRefreshProgress.phase === "screenshots" ? (language === "ru" ? "Проверено тайтлов" : "Titles checked") : metadataRefreshProgress.phase === "screenshots_retry" ? (language === "ru" ? "Повтор кадров" : "Screenshot retries") : (language === "ru" ? "Завершено" : "Completed")}: {metadataRefreshProgress.offset} / {metadataRefreshProgress.total}</span>
                      <span>{language === "ru" ? "Дополнено тайтлов" : "Titles enriched"}: {metadataRefreshProgress.updated} · {language === "ru" ? "URL кадров" : "Screenshot URLs"}: {metadataRefreshProgress.screenshotsSaved} · {language === "ru" ? "Ошибок кадров" : "Failed shots"}: {metadataRefreshProgress.screenshotFailures} · {language === "ru" ? "Ожидают повтора" : "Waiting to retry"}: {metadataRefreshProgress.screenshotRetries}</span>
                    </div>
                    <div role="progressbar" aria-valuemin={0} aria-valuemax={metadataRefreshProgress.total} aria-valuenow={metadataRefreshProgress.offset} className="h-1.5 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-gradient-to-r from-[#A83BFA] to-[#D08AFF] transition-all" style={{ width: (metadataRefreshProgress.total ? Math.min(100, metadataRefreshProgress.offset / metadataRefreshProgress.total * 100) : 0) + "%" }} />
                    </div>
                  </div>
                )}
                {metadataRefreshMessage && <p className="mt-3 rounded-lg border border-border bg-background/60 p-2.5 text-xs" role="status">{metadataRefreshMessage}</p>}
                  {metadataCatalogStats && (
                    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {[
                        [language === "ru" ? "Всего в каталоге" : "Catalog total", metadataCatalogStats.total],
                        [language === "ru" ? "Неполные метаданные" : "Incomplete metadata", metadataCatalogStats.incomplete],
                        [language === "ru" ? "Полные записи" : "Complete records", metadataCatalogStats.complete],
                        [language === "ru" ? "Анонсы" : "Announced", metadataCatalogStats.announced],
                        [language === "ru" ? "Без трейлера" : "Missing trailer", metadataCatalogStats.missingTrailer],
                        [language === "ru" ? "С трейлером" : "Has trailer", metadataCatalogStats.hasTrailer],
                                                    [language === "ru" ? "URL кадров" : "Screenshot URLs", metadataCatalogStats.savedScreenshotUrls],
                        [language === "ru" ? "Кадры проверены" : "Screenshots checked", metadataCatalogStats.screenshotDone],
                        [language === "ru" ? "Кадры: повторы" : "Screenshot retries", metadataCatalogStats.screenshotRetry],
                        [language === "ru" ? "Кадры: ошибки" : "Screenshot failures", metadataCatalogStats.screenshotFailed],
                      ].map(([label, value]) => <div key={String(label)} className="rounded-lg border border-border bg-background/50 p-2"><span className="block text-[11px] text-muted-foreground">{label}</span><strong className="mt-1 block text-base tabular-nums">{Number(value).toLocaleString()}</strong></div>)}
                    </div>
                  )}
                </div>
              </details>
              <details open={expandedAdminSections.quality} onToggle={event => { const isOpen = event.currentTarget.open; setExpandedAdminSections(current => current.quality === isOpen ? current : {...current, quality: isOpen}); }} className="group mb-3 overflow-hidden rounded-2xl border border-[#382846] bg-[#0C0A12]" aria-label={language === "ru" ? "Качество каталога" : "Catalog quality"}>
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4 hover:bg-card/80 [&::-webkit-details-marker]:hidden">
                  <span className="flex min-w-0 items-center gap-3"><Database className="h-6 w-6 shrink-0 text-[#BE65FF]"/><span className="min-w-0"><span className="block font-semibold text-[#F8F4FF]">{language === "ru" ? "Качество каталога" : "Catalog quality"}</span><span className="mt-0.5 block text-xs text-[#A89CB8]">{language === "ru" ? "Неполных записей: " : "Incomplete records: "}{catalogQualitySummary.incomplete}</span></span></span><span className="rounded-full bg-[#1D1729] px-3 py-1 text-xs text-[#DCC8F8]">{language === "ru" ? "Всего: " : "Total: "}{catalogQualitySummary.total}</span>
                  <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
                </summary>
                <div className="border-t border-border/70 p-3 sm:p-4">
                  <p className="mb-3 text-xs leading-relaxed text-muted-foreground">{language === "ru" ? "Найди записи без года, постера или описания. Сводка охватывает весь каталог; список разбит на страницы по 500 записей." : "Find records missing year, poster or description. Summary covers the whole catalog; the list is paginated in groups of 500."}</p>
                  <div className="mb-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                    <button type="button" onClick={() => setCatalogFilter("all")} className={"rounded-lg border p-2 text-left " + (catalogFilter==="all" ? "border-primary bg-primary/10" : "border-border bg-background/60")}><span className="block text-muted-foreground">{language === "ru" ? "Неполные" : "Incomplete"}</span><strong className="mt-1 block text-base tabular-nums">{catalogQualitySummary.incomplete}</strong></button>
                    <button type="button" onClick={() => setCatalogFilter("year")} className={"rounded-lg border p-2 text-left " + (catalogFilter==="year" ? "border-primary bg-primary/10" : "border-border bg-background/60")}><span className="block text-muted-foreground">{language === "ru" ? "Без года" : "No year"}</span><strong className="mt-1 block text-base tabular-nums">{catalogQualitySummary.missingYear}</strong></button>
                    <button type="button" onClick={() => setCatalogFilter("poster")} className={"rounded-lg border p-2 text-left " + (catalogFilter==="poster" ? "border-primary bg-primary/10" : "border-border bg-background/60")}><span className="block text-muted-foreground">{language === "ru" ? "Без постера" : "No poster"}</span><strong className="mt-1 block text-base tabular-nums">{catalogQualitySummary.missingPoster}</strong></button>
                    <button type="button" onClick={() => setCatalogFilter("description")} className={"rounded-lg border p-2 text-left " + (catalogFilter==="description" ? "border-primary bg-primary/10" : "border-border bg-background/60")}><span className="block text-muted-foreground">{language === "ru" ? "Без описания" : "No description"}</span><strong className="mt-1 block text-base tabular-nums">{catalogQualitySummary.missingDescription}</strong></button>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button type="button" disabled={catalogQualityBusy || catalogSelected.length===0} onClick={() => runCatalogQualityAction("repair")} className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50">{catalogQualityBusy ? (language==="ru"?"Обработка…":"Working…") : (language==="ru"?"Перезаполнить":"Repair selected")}</button>
                    <button type="button" disabled={catalogQualityBusy || catalogSelected.length===0} onClick={() => runCatalogQualityAction("delete")} className="rounded-lg border border-destructive/50 px-3 py-2 text-xs font-semibold text-destructive disabled:opacity-50">{language==="ru"?"Удалить выбранные":"Delete selected"}</button>
                    <button type="button" disabled={catalogQualityBusy} onClick={() => {setCatalogQualityBusy(true); refreshCatalogQuality().catch(error=>setAdminImportMessage(error instanceof Error?error.message:"Refresh failed")).finally(()=>setCatalogQualityBusy(false));}} className="rounded-lg border border-border px-3 py-2 text-xs">{language==="ru"?"Обновить список":"Refresh list"}</button>
                    <button type="button" disabled={catalogQualityBusy || visibleCatalogQuality.length===0 || catalogSelected.length>=100} onClick={() => setCatalogSelected(current => Array.from(new Set([...current,...visibleCatalogQuality.map(item=>item.id)])).slice(0,100))} className="rounded-lg border border-border px-3 py-2 text-xs disabled:opacity-40">{language==="ru"?"Выбрать страницу":"Select page"}</button>
                    <button type="button" disabled={catalogQualityBusy || catalogSelected.length===0} onClick={() => setCatalogSelected([])} className="rounded-lg border border-border px-3 py-2 text-xs disabled:opacity-40">{language==="ru"?"Снять выбор":"Clear selection"}</button>
                    <span className="text-xs text-muted-foreground">{language==="ru" ? "Выбрано: " : "Selected: "}{catalogSelected.length}/100</span>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span>{language==="ru" ? "Показано " : "Showing "}{catalogQualityOffset+1}-{catalogQualityOffset+catalogQuality.length} / {catalogQualitySummary.incomplete}</span>
                    <div className="flex gap-2">
                      <button type="button" disabled={catalogQualityBusy || catalogQualityOffset===0} onClick={() => {setCatalogQualityBusy(true);refreshCatalogQuality(Math.max(0,catalogQualityOffset-500)).catch(error=>setAdminImportMessage(error instanceof Error?error.message:"Refresh failed")).finally(()=>setCatalogQualityBusy(false));}} className="rounded-lg border border-border px-2.5 py-1.5 disabled:opacity-40">{language==="ru"?"Назад":"Previous"}</button>
                      <button type="button" disabled={catalogQualityBusy || !catalogQualityHasMore} onClick={() => {setCatalogQualityBusy(true);refreshCatalogQuality(catalogQualityOffset+500).catch(error=>setAdminImportMessage(error instanceof Error?error.message:"Refresh failed")).finally(()=>setCatalogQualityBusy(false));}} className="rounded-lg border border-border px-2.5 py-1.5 disabled:opacity-40">{language==="ru"?"Далее":"Next"}</button>
                    </div>
                  </div>
                  <div className="mt-3 max-h-64 space-y-2 overflow-y-auto">
                    {visibleCatalogQuality.length===0 ? <p className="rounded-lg bg-background/60 p-3 text-sm text-muted-foreground">{language==="ru"?"Записей с выбранным фильтром в списке нет. Обнови список для повторной проверки.":"No records for this filter in the current list. Refresh to check again."}</p> : visibleCatalogQuality.map(item => (
                      <label key={item.id} className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border bg-background/50 p-2.5 text-sm">
                        <input type="checkbox" checked={catalogSelected.includes(item.id)} disabled={!catalogSelected.includes(item.id) && catalogSelected.length>=100} onChange={event=>setCatalogSelected(current=>event.target.checked ? (current.includes(item.id)||current.length>=100 ? current : [...current,item.id]) : current.filter(id=>id!==item.id))} className="mt-1"/>
                        <span className="min-w-0 flex-1"><strong className="block">{item.title || (language==="ru"?"Без названия":"Untitled")}</strong><span className="text-xs text-muted-foreground">ID {item.id} · {[item.missingYear?(language==="ru"?"нет года":"no year"):null,item.missingPoster?(language==="ru"?"нет постера":"no poster"):null,item.missingDescription?(language==="ru"?"нет описания":"no description"):null].filter(Boolean).join(" · ")}</span></span>
                      </label>
                    ))}
                  </div>
                </div>
              </details>
              <details open={expandedAdminSections.maintenance} onToggle={event => { const isOpen = event.currentTarget.open; setExpandedAdminSections(current => current.maintenance === isOpen ? current : {...current, maintenance: isOpen}); }} className="group mb-3 overflow-hidden rounded-2xl border border-[#382846] bg-[#0C0A12]" aria-label={language === "ru" ? "Обслуживание" : "Maintenance"}>
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4 hover:bg-card/80 [&::-webkit-details-marker]:hidden">
                  <span className="flex min-w-0 items-center gap-3"><Settings className="h-6 w-6 shrink-0 text-[#BE65FF]"/><span><span className="block font-semibold text-[#F8F4FF]">{language==="ru"?"Обслуживание":"Maintenance"}</span><span className="mt-0.5 block text-xs text-[#A89CB8]">{language==="ru"?"Проверка подключения к D1":"D1 connectivity check"}</span></span></span>
                  <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
                </summary>
                <div className="border-t border-border/70 p-3 sm:p-4">
                  <p className="mb-3 text-xs text-muted-foreground">{language==="ru"?"Проверка безопасна: она не удаляет и не меняет данные каталога.":"Safe check: it does not change or delete catalog data."}</p>
                  <button type="button" onClick={runMaintenanceCheck} disabled={maintenanceBusy} className="rounded-lg border border-border px-3 py-2 text-sm font-medium disabled:opacity-50">{maintenanceBusy?(language==="ru"?"Проверка…":"Checking…"):(language==="ru"?"Проверить базу":"Check database")}</button>
                  {maintenanceMessage && <p role="status" className="mt-3 rounded-lg bg-background/60 p-3 text-xs">{maintenanceMessage}</p>}
                </div>
              </details>
              <details open={expandedAdminSections.audit} onToggle={event => { const isOpen = event.currentTarget.open; setExpandedAdminSections(current => current.audit === isOpen ? current : {...current, audit: isOpen}); }} className="group mb-3 overflow-hidden rounded-2xl border border-[#382846] bg-[#0C0A12]" aria-label={language==="ru"?"История административных операций":"Admin operation history"}>
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4 hover:bg-card/80 [&::-webkit-details-marker]:hidden">
                  <span className="flex min-w-0 items-center gap-3"><History className="h-6 w-6 shrink-0 text-[#BE65FF]"/><span><span className="block font-semibold text-[#F8F4FF]">{language==="ru"?"История операций":"Operation history"}</span><span className="mt-0.5 block text-xs text-[#A89CB8]">{language==="ru"?"Последние 30 событий":"Latest 30 events"}</span></span></span>
                  <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
                </summary>
                <div className="border-t border-border/70 p-3 sm:p-4">
                  {adminAuditLog.length===0 ? <p className="text-sm text-muted-foreground">{language==="ru"?"Событий пока нет.":"No events yet."}</p> : <div className="max-h-64 space-y-2 overflow-y-auto">{adminAuditLog.map(entry=><div key={entry.id} className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-border bg-background/50 p-2.5 text-xs"><div className="min-w-0 flex-1"><strong className="break-words">{entry.action}</strong><p className="mt-1 break-words text-muted-foreground">{JSON.stringify(entry.details)}</p></div><div className="shrink-0 text-right"><span className={entry.status==="success"?"text-emerald-500":"text-amber-500"}>{entry.status}</span><p className="mt-1 text-muted-foreground">{new Date(entry.created_at.replace(" ","T")+"Z").toLocaleString(language==="ru"?"ru-RU":"en-US")}</p></div></div>)}</div>}
                </div>
              </details>

              </>
            ) : (
              <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm">{telegramAuthError || (language === "ru" ? "Доступ запрещён. Войди через Telegram под аккаунтом администратора." : "Access denied. Sign in with the administrator Telegram account.")}</p>
            )}
          </div>
        </main>
      ) : view === "history" ? (
        <main id="main-content" className="px-4 pt-24 md:px-10 md:pt-24">
          <h1 className="mb-3 text-2xl font-bold md:text-3xl">{t("history.title")}</h1>
          {historyLoading ? (
            <p className="rounded-2xl border border-border bg-card/40 px-5 py-8 text-sm text-muted-foreground" role="status">{language === "ru" ? "Загружаем историю…" : "Loading history…"}</p>
          ) : !historyAuthenticated ? (
            <section className="rounded-2xl border border-dashed border-border bg-card/40 px-5 py-8 text-center">
              <p className="text-sm text-muted-foreground">{historyError || (language === "ru" ? "История просмотров доступна только в аккаунте YUME." : "Viewing history is available only in a YUME account.")}</p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                <button type="button" onClick={() => setView("login")} className="rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground">{language === "ru" ? "Войти через Telegram" : "Sign in with Telegram"}</button>
                <button type="button" onClick={() => setView("register")} className="rounded-xl border border-border px-4 py-2.5 text-sm font-semibold hover:bg-accent">{language === "ru" ? "Регистрация" : "Register"}</button>
              </div>
            </section>
          ) : historyItems.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-border bg-card/40 px-5 py-8 text-sm text-muted-foreground">{language === "ru" ? "История пока пуста. Открывай страницы аниме — они появятся здесь." : "Your history is empty. Open anime pages and they will appear here."}</p>
          ) : (
            <>
              {historyError && <p role="alert" className="mb-4 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">{historyError}</p>}
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
                {historyItems.map((item) => {
                  const anime = ANIME.find((entry) => entry.id === item.animeId);
                  const deleting = historyDeletingIds.includes(item.animeId);
                  return (
                    <div key={item.animeId} className="relative min-w-0">
                      {anime ? <AnimeCard anime={anime} onSelect={select} /> : (
                        <button type="button" onClick={() => navigate({ to: "/anime/$animeId", params: { animeId: item.animeId } })} className="w-full rounded-xl border border-border bg-card/50 p-4 text-left text-sm hover:bg-accent">
                          {language === "ru" ? "Открыть тайтл" : "Open title"} #{item.animeId}
                        </button>
                      )}
                      <button
                        type="button"
                        aria-label={language === "ru" ? "Удалить из истории просмотров" : "Remove from viewing history"}
                        title={language === "ru" ? "Удалить из истории" : "Remove from history"}
                        disabled={deleting}
                        onClick={(event) => { event.preventDefault(); event.stopPropagation(); void removeHistoryItem(item); }}
                        className="absolute right-2 top-2 z-20 flex h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-red-600 text-white shadow-[0_0_0_2px_rgba(0,0,0,0.7),0_4px_12px_rgba(0,0,0,0.65)] transition hover:scale-105 hover:bg-red-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-red-300 disabled:cursor-wait disabled:opacity-70"
                      >
                        <X className="h-5 w-5" strokeWidth={3} aria-hidden="true" />
                      </button>
                      <p className="mt-2 text-xs text-muted-foreground">{language === "ru" ? "Открыт" : "Opened"}: {new Date(item.viewedAt).toLocaleString(language === "ru" ? "ru-RU" : "en-GB")}</p>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </main>
      ) : null}
      {!["profile", "favorites", "watchlist", "privacy", "privacy-policy", "rules", "rights", "login", "register"].includes(view) && (
        <Footer onNavigate={setView} />
      )}
      </div>
    </div>
  );
}