import { Star } from "lucide-react";
import type { Anime } from "@/data/anime";
import { useYumePreferences, displayAnimeTitle, displayGenre, displayAnimeKind, displayAnimeStatus } from "@/data/preferences";
import { isNewRelease } from "@/data/anime-sections";
import { telegramHapticImpact } from "@/lib/telegram-mini-app";
import { toSameOriginShikimoriImage } from "@/lib/shikimori-image-proxy";

export function PosterArt({ anime, className = "" }: { anime: Anime; className?: string }) {
  const h = anime.hue;
  return (
    <div
      className={"relative overflow-hidden " + className}
      style={{
        background:
          "radial-gradient(circle at 70% 25%, oklch(0.85 0.12 " +
          h +
          ") 0 12%, transparent 13%), radial-gradient(ellipse at 30% 100%, oklch(0.55 0.25 " +
          h +
          ") 0%, transparent 60%), linear-gradient(160deg, oklch(0.3 0.12 " +
          h +
          "), oklch(0.12 0.05 " +
          (h + 20) +
          "))",
      }}
    >
      <span className="absolute inset-0 flex select-none items-center justify-center font-display text-6xl font-bold text-foreground/25">
        {anime.glyph}
      </span>
      {anime.posterUrl && (
        <img
          src={toSameOriginShikimoriImage(anime.posterUrl)}
          alt=""
          aria-hidden="true"
          loading="lazy"
          decoding="async"
          onError={(event) => {
            event.currentTarget.style.display = "none";
          }}
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
    </div>
  );
}

export function AnimeCard({ anime, onSelect }: { anime: Anime; onSelect: (a: Anime) => void }) {
  const { language, t } = useYumePreferences();
  return (
    <button
      type="button"
      onClick={() => { telegramHapticImpact("light"); onSelect(anime); }}
      className="yume-tactile-control group w-36 shrink-0 text-left focus-visible:outline-none sm:w-44"
    >
      <div className="relative aspect-[2/3] overflow-hidden rounded-xl ring-1 ring-border transition duration-300 group-hover:-translate-y-1 group-hover:shadow-neon group-focus-visible:ring-2 group-focus-visible:ring-ring">
        <PosterArt anime={anime} className="h-full w-full transition duration-500 group-hover:scale-105" />
        {anime.rating !== null && (
          <div className="absolute left-2 top-2 flex items-center gap-1 rounded-full glass px-2 py-0.5 text-xs font-semibold">
            <Star className="h-3 w-3 fill-gold text-gold" />
            {anime.rating.toFixed(1)}
          </div>
        )}
        {isNewRelease(anime) && (
          <div className="absolute right-2 top-2 rounded-full bg-neon px-2 py-0.5 text-[10px] font-bold uppercase text-primary-foreground">
            {t("anime.new")}
          </div>
        )}
      </div>
      <div className="mt-2 line-clamp-1 text-sm font-semibold">{displayAnimeTitle(anime, language)}</div>
      <div className="text-xs text-muted-foreground">
        {anime.year || t("anime.yearUnknown")} · {anime.genres[0] ? displayGenre(anime.genres[0], language) : anime.kind ? displayAnimeKind(anime.kind, language) : displayAnimeStatus(anime.status, language)}
      </div>
    </button>
  );
}
