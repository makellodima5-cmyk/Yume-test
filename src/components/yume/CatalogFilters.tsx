import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, SlidersHorizontal, X } from "lucide-react";
import { ALL_GENRES } from "@/data/anime";
import { useYumePreferences, displayGenre, displayAnimeKind, displayAnimeStatus } from "@/data/preferences";
import { telegramHapticImpact, telegramHapticSelection } from "@/lib/telegram-mini-app";

export type CatalogFiltersValue = {
  genres: string[];
  status: string;
  yearFrom: string;
  yearTo: string;
  minRating: number;
  type: string;
  ageRating: string;
};

export const EMPTY_CATALOG_FILTERS: CatalogFiltersValue = {
  genres: [],
  status: "Любой",
  yearFrom: "",
  yearTo: "",
  minRating: 0,
  type: "Любой",
  ageRating: "Любой",
};

type Props = {
  open: boolean;
  placement?: "catalog" | "home";
  draft: CatalogFiltersValue;
  setDraft: (value: CatalogFiltersValue) => void;
  onApply: () => void;
  onReset: () => void;
  onClose?: () => void;
  genres?: string[];
  statuses?: string[];
  types?: string[];
  ageRatings?: string[];
  yearMin?: number;
  yearMax?: number;
};

const selectClass = "h-9 w-full appearance-none rounded-lg border border-border bg-secondary px-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/50";
const labelClass = "mb-1 block text-xs text-muted-foreground";

export function CatalogFilters({
  open,
  draft,
  setDraft,
  onApply,
  onReset,
  onClose,
  placement = "catalog",
  genres = ALL_GENRES,
  statuses = ["Вышел", "Онгоинг", "Анонс"],
  types = ["TV", "Фильм", "OVA", "ONA"],
  ageRatings = ["Без ограничений", "12+", "16+", "18+"],
  yearMin = 1900,
  yearMax = new Date().getFullYear(),
}: Props) {
  const { t, language } = useYumePreferences();
  const panelRef = useRef<HTMLDivElement>(null);
  const [positionStyle, setPositionStyle] = useState<CSSProperties>({});

  // Capture the panel's document coordinates once when it opens.
  // It then scrolls naturally with the page instead of staying fixed to the
  // viewport or following the user during scrolling.
  useLayoutEffect(() => {
    if (!open || typeof window === "undefined") return;
    const trigger = document.querySelector<HTMLElement>('[data-filter-trigger][aria-expanded="true"]');
    const anchor = trigger?.closest<HTMLElement>("[data-filter-anchor]") ?? trigger;
    const rect = anchor?.getBoundingClientRect();
    const triggerRect = trigger?.getBoundingClientRect();
    const viewportWidth = window.visualViewport?.width ?? window.innerWidth;
    const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    const width = Math.min(440, Math.max(240, viewportWidth - 24));
    const viewportLeft = Math.max(12, Math.min(rect?.left ?? 12, viewportWidth - width - 12));
    const viewportTop = triggerRect ? triggerRect.bottom + 8 : rect ? rect.bottom + 8 : 80;
    const top = Math.max(8, Math.min(viewportTop, viewportHeight - 160));
    setPositionStyle({
      position: "absolute",
      top: top + scrollY,
      left: viewportLeft + scrollX,
      width,
      maxHeight: Math.max(150, viewportHeight - top - 12),
    });
  }, [open, placement]);

  if (!open) return null;

  const update = (patch: Partial<CatalogFiltersValue>) => setDraft({ ...draft, ...patch });
  const toggleGenre = (genre: string) => update({
    genres: draft.genres.includes(genre)
      ? draft.genres.filter((item) => item !== genre)
      : [...draft.genres, genre],
  });

  const panel = (
    <div ref={panelRef} style={positionStyle} className="z-[100] overflow-y-auto overscroll-contain rounded-2xl border border-border bg-popover p-3 text-popover-foreground shadow-2xl shadow-black/25 sm:p-4" role="dialog" aria-label={t("filters.dialogLabel")} data-catalog-filter-panel>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-semibold"><SlidersHorizontal className="h-4 w-4 text-primary" /> {t("filters.title")}</div>
        <button type="button" onClick={onClose} aria-label={t("filters.close")} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-accent hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mb-3">
        <label className={labelClass} htmlFor="catalog-genre-toggle">{t("filters.genres")}</label>
        <details className="group">
          <summary id="catalog-genre-toggle" className={`${selectClass} flex cursor-pointer list-none items-center justify-between py-2.5 [&::-webkit-details-marker]:hidden`}>
            <span className="truncate">{draft.genres.length ? `${draft.genres.length}: ${draft.genres.slice(0, 2).map((genre) => displayGenre(genre, language)).join(", ")}${draft.genres.length > 2 ? "…" : ""}` : t("filters.chooseGenres")}</span>
            <ChevronDown className="ml-2 h-4 w-4 shrink-0 transition-transform group-open:rotate-180" />
          </summary>
          <div className="mt-1 max-h-48 space-y-1 overflow-y-auto rounded-xl border border-border bg-secondary p-2 text-secondary-foreground">
            {genres.map((genre) => {
              const active = draft.genres.includes(genre);
              return (
                <label key={genre} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-sm text-foreground hover:bg-accent hover:text-accent-foreground">
                  <input type="checkbox" checked={active} onChange={() => { telegramHapticSelection(); toggleGenre(genre); }} className="h-4 w-4 shrink-0 accent-fuchsia-400" />
                  <span>{displayGenre(genre, language)}</span>
                </label>
              );
            })}
          </div>
        </details>
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        <label><span className={labelClass}>{t("filters.status")}</span><span className="relative block"><select className={selectClass} value={draft.status} onChange={(e) => { telegramHapticSelection(); update({ status: e.target.value }); }}><option value="Любой">{t("filters.any")}</option>{statuses.map((status) => <option key={status} value={status}>{displayAnimeStatus(status, language)}</option>)}</select><ChevronDown className="pointer-events-none absolute right-2.5 top-3 h-3.5 w-3.5 text-muted-foreground" /></span></label>
        <label><span className={labelClass}>{t("filters.type")}</span><span className="relative block"><select className={selectClass} value={draft.type} onChange={(e) => { telegramHapticSelection(); update({ type: e.target.value }); }}><option value="Любой">{t("filters.any")}</option>{types.map((kind) => <option key={kind} value={kind}>{displayAnimeKind(kind, language)}</option>)}</select><ChevronDown className="pointer-events-none absolute right-2.5 top-3 h-3.5 w-3.5 text-muted-foreground" /></span></label>
        <label><span className={labelClass}>{t("filters.yearFrom")}</span><input className={selectClass} inputMode="numeric" type="number" min={yearMin} max={yearMax} placeholder={String(yearMin)} value={draft.yearFrom} onChange={(e) => update({ yearFrom: e.target.value })} /></label>
        <label><span className={labelClass}>{t("filters.yearTo")}</span><input className={selectClass} inputMode="numeric" type="number" min={yearMin} max={yearMax} placeholder={String(yearMax)} value={draft.yearTo} onChange={(e) => update({ yearTo: e.target.value })} /></label>
      </div>

      <div className="mt-3">
        <div className="mb-1 flex items-center justify-between"><label htmlFor="catalog-min-rating" className="text-xs text-muted-foreground">{t("filters.ratingFrom")}</label><span className="text-xs font-semibold tabular-nums">{draft.minRating.toFixed(1)}</span></div>
        <input id="catalog-min-rating" type="range" min="0" max="9" step="0.5" value={draft.minRating} onChange={(e) => update({ minRating: Number(e.target.value) })} className="h-2 w-full cursor-pointer accent-fuchsia-400" />
        <div className="flex justify-between text-[10px] text-muted-foreground"><span>0</span><span>9</span></div>
      </div>

      <label className="mt-3 block"><span className={labelClass}>{t("filters.ageRating")}</span><span className="relative block"><select className={selectClass} value={draft.ageRating} onChange={(e) => { telegramHapticSelection(); update({ ageRating: e.target.value }); }}><option value="Любой">{t("filters.any")}</option>{ageRatings.map((rating) => <option key={rating} value={rating}>{rating === "Без ограничений" ? t("filters.unrestricted") : rating}</option>)}</select><ChevronDown className="pointer-events-none absolute right-2.5 top-3 h-3.5 w-3.5 text-muted-foreground" /></span></label>

      <div className="mt-4 flex gap-2">
        <button type="button" onClick={() => { telegramHapticImpact("light"); onReset(); }} className="h-9 flex-1 rounded-lg border border-border bg-secondary text-sm transition hover:bg-accent">{t("catalog.reset")}</button>
        <button type="button" onClick={() => { telegramHapticImpact("light"); onApply(); }} className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg bg-neon text-sm font-semibold text-primary-foreground transition hover:brightness-110"><Check className="h-4 w-4" /> {t("filters.show")}</button>
      </div>
    </div>
  );

  // Render both home and catalog filters at the document root to avoid clipping.
  // Its captured document coordinates make it scroll with the page.
  if (typeof document !== "undefined") return createPortal(panel, document.body);
  return panel;
}
