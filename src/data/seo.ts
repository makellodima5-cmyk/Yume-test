// Temporary public origin until the permanent domain is selected. Update this before the final SEO release.
export const SITE_ORIGIN = "https://yume-staging.makellodima5.workers.dev";
export const SITE_NAME = "YUME";
export const DEFAULT_META_DESCRIPTION =
  "YUME — каталог аниме с рейтингами, новинками и тематическими подборками.";

export function canonicalUrl(pathname: string): string {
  const input = typeof pathname === "string" ? pathname.trim() : "/";
  const pathOnly = (input.split(/[?#]/, 1)[0] || "/").replace(/^\/+/, "");
  const safePath = pathOnly ? `/${pathOnly}` : "/";
  return new URL(safePath, SITE_ORIGIN).toString();
}

export function sanitizeMetaDescription(
  value: string | null | undefined,
  fallback = DEFAULT_META_DESCRIPTION,
  maxLength = 160,
): string {
  const clean = (value ?? "")
    .replace(/\[(?:character|anime|manga|person)=[^\]]+\]/gi, " ")
    .replace(/\[\/(?:character|anime|manga|person)\]/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
  const source = clean || fallback;
  if (source.length <= maxLength) return source;
  const truncated = source.slice(0, Math.max(1, maxLength - 1));
  const lastSpace = truncated.lastIndexOf(" ");
  return `${truncated.slice(0, lastSpace > maxLength * 0.6 ? lastSpace : truncated.length).trimEnd()}…`;
}

export function absoluteImageUrl(value: string | null | undefined): string | undefined {
  if (!value?.trim()) return undefined;
  try {
    const url = new URL(value.trim(), SITE_ORIGIN);
    if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
    if (url.username || url.password) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}
