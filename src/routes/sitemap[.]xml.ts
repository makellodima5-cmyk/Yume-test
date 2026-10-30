import { createFileRoute } from "@tanstack/react-router";
import { getShikimoriCatalog } from "@/data/shikimori";
import { canonicalUrl } from "@/data/seo";

function xmlEscape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async () => {
        let animeIds: string[] = [];
        try {
          const catalog = await getShikimoriCatalog({ data: {} });
          animeIds = Array.from(
            new Set(catalog.items.map((anime) => anime.id).filter((id) => /^\d+$/.test(id))),
          ).slice(0, 1000);
        } catch {
          // Always keep a valid sitemap containing the homepage if the catalogue source is unavailable.
        }

        const urls = [canonicalUrl("/"), ...animeIds.map((id) => canonicalUrl(`/anime/${id}`))];
        const entries = urls
          .map((url) => `  <url><loc>${xmlEscape(url)}</loc></url>`)
          .join("\n");
        const sitemap = [
          '<?xml version="1.0" encoding="UTF-8"?>',
          '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
          entries,
          "</urlset>",
          "",
        ].join("\n");

        return new Response(sitemap, {
          headers: {
            "Content-Type": "application/xml; charset=utf-8",
            "Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
          },
        });
      },
    },
  },
});
