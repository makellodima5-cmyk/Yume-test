import { useEffect, useRef, useState } from "react";
import { Bookmark, Star, X } from "lucide-react";
import type { Anime } from "@/data/anime";
import { getShikimoriAnimeScreenshots, type ShikimoriScreenshot } from "@/data/shikimori";
import { PosterArt } from "./Poster";
import { toSameOriginShikimoriImage } from "@/lib/shikimori-image-proxy";

export function AnimeModal({ anime, note, onClose }: { anime: Anime | null; note?: string | undefined; onClose: () => void }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [screenshots, setScreenshots] = useState<ShikimoriScreenshot[]>([]);
  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    setMsg(null);
    setScreenshots([]);
    if (!anime || !/^\d{1,12}$/.test(anime.id)) return;
    let cancelled = false;
    getShikimoriAnimeScreenshots({ data: { animeId: anime.id } })
      .then((result) => { if (!cancelled) setScreenshots(result.items ?? []); })
      .catch(() => { if (!cancelled) setScreenshots([]); });
    return () => { cancelled = true; };
  }, [anime?.id]);

  useEffect(() => {
    if (!anime) return;

    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusableSelector = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const focusableElements = () => Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? [],
    );
    (focusableElements()[0] ?? dialogRef.current)?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab") return;

      const elements = focusableElements();
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (!first || !last) {
        event.preventDefault();
        dialogRef.current?.focus();
      } else if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      restoreFocusRef.current?.focus();
      restoreFocusRef.current = null;
    };
  }, [anime, onClose]);
  if (!anime) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-background/80 backdrop-blur-sm md:items-center" onClick={onClose} role="presentation">
      <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="anime-modal-title" onClick={(e) => e.stopPropagation()} className="relative max-h-[calc(100dvh-1rem)] w-full max-w-3xl overflow-x-hidden overflow-y-auto rounded-t-3xl bg-popover ring-1 ring-border animate-in fade-in slide-in-from-bottom-4 md:rounded-3xl">
        <button onClick={onClose} aria-label="Закрыть" className="absolute right-4 top-4 z-10 rounded-full glass p-2 ring-1 ring-border hover:bg-accent">
          <X className="h-4 w-4" />
        </button>
        <div className="flex flex-col gap-6 p-6 md:flex-row">
          <PosterArt anime={anime} className="mx-auto aspect-[2/3] w-40 shrink-0 rounded-xl ring-1 ring-border md:w-52" />
          <div className="flex-1">
            {note && <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-magenta">{note}</div>}
            <h2 id="anime-modal-title" className="break-words text-2xl font-bold">{anime.title}</h2>
            <div className="text-sm text-muted-foreground">{anime.original}</div>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
              <span className="flex items-center gap-1 rounded-full bg-secondary px-2.5 py-1 font-semibold"><Star className="h-3 w-3 fill-gold text-gold" />{anime.rating.toFixed(1)}</span>
              <span className="rounded-full bg-secondary px-2.5 py-1">{anime.year}</span>
              <span className="rounded-full bg-secondary px-2.5 py-1">{anime.episodes} эп.</span>
              <span className="rounded-full bg-accent px-2.5 py-1">{anime.status}</span>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {anime.genres.map((g) => <span key={g} className="text-xs text-primary">#{g}</span>)}
            </div>
            <p className="mt-4 text-sm leading-relaxed text-foreground/85">{anime.description}</p>
            <div className="mt-6 flex flex-wrap gap-3">
              <button onClick={() => setMsg("Добавлено в «Буду смотреть» (демо, без сохранения).")} className="inline-flex items-center gap-2 rounded-full bg-secondary px-5 py-2.5 text-sm font-semibold ring-1 ring-border hover:bg-accent">
                <Bookmark className="h-4 w-4" /> В список
              </button>
            </div>
            {msg && <div className="mt-4 rounded-xl bg-accent/60 px-4 py-2.5 text-sm" role="status" aria-live="polite">{msg}</div>}
          </div>
        </div>
        {screenshots.length > 0 && (
          <section className="border-t border-border px-6 py-5" aria-label="Кадры аниме">
            <h3 className="mb-3 text-sm font-semibold">Кадры из аниме</h3>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {screenshots.map((shot) => {
                const originalUrl = toSameOriginShikimoriImage(shot.originalUrl);
                const previewUrl = toSameOriginShikimoriImage(shot.previewUrl);
                if (!originalUrl || !previewUrl) return null;
                return (
                  <a key={shot.originalUrl} href={originalUrl} target="_blank" rel="noreferrer" className="group block overflow-hidden rounded-xl ring-1 ring-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                    <img src={previewUrl} alt={`Кадр из аниме ${anime.title}`} loading="lazy" className="aspect-video w-full object-cover transition-transform group-hover:scale-[1.03]" />
                  </a>
                );
              })}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}