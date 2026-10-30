const SHIKIMORI_IMAGE_HOSTS = new Set(["shikimori.io", "shikimori.one"]);
const IMAGE_PATH_PATTERN = /^\/(?:system|uploads)\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]+\.(?:avif|gif|jpe?g|png|webp)$/i;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set([
  "image/avif",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

function parseAllowedSource(value: string | null | undefined): URL | null {
  if (!value || value.length > 2048) return null;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (
      url.protocol !== "https:" ||
      !SHIKIMORI_IMAGE_HOSTS.has(host) ||
      (url.port && url.port !== "443") ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !IMAGE_PATH_PATTERN.test(url.pathname) ||
      /%(?:2f|5c)/i.test(url.pathname) ||
      url.pathname.split("/").some((segment) => segment === "." || segment === "..")
    ) return null;
    return url;
  } catch {
    return null;
  }
}

export type ShikimoriImagePair = { originalUrl: string; previewUrl: string };

/** Rewrite Shikimori screenshot variants through the proxy; reject unexpected external hosts. */
export function toSameOriginShikimoriScreenshot(value: ShikimoriImagePair): ShikimoriImagePair | null {
  const rewrite = (input: string): string | undefined => {
    try {
      const source = new URL(input);
      if (source.protocol !== "https:" || !SHIKIMORI_IMAGE_HOSTS.has(source.hostname.toLowerCase())) return undefined;
      return toSameOriginShikimoriImage(source);
    } catch {
      return undefined;
    }
  };
  const originalUrl = rewrite(value.originalUrl);
  const previewUrl = rewrite(value.previewUrl);
  return originalUrl && previewUrl ? { ...value, originalUrl, previewUrl } : null;
}

export function toSameOriginShikimoriImage(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  let source: URL;
  try {
    source = new URL(value);
  } catch {
    return value;
  }
  if (!SHIKIMORI_IMAGE_HOSTS.has(source.hostname.toLowerCase())) return value;

  // Strip vendor query strings and fragments before creating the proxy URL.
  // Invalid Shikimori URLs are omitted instead of falling back to direct requests.
  source.search = "";
  source.hash = "";
  const url = parseAllowedSource(source.toString());
  if (!url) return undefined;
  return `/api/media/shikimori?src=${encodeURIComponent(url.origin + url.pathname)}`;
}

/** A narrow image-only proxy: exact host allowlist, static image paths, no redirects, bounded response size. */
export async function handleShikimoriImageProxy(source: string | null): Promise<Response> {
  const url = parseAllowedSource(source);
  const headers = {
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  };
  if (!url) return new Response("Invalid image source.", { status: 400, headers });

  let upstream: Response;
  try {
    upstream = await fetch(url.toString(), {
      method: "GET",
      redirect: "manual",
      headers: { Accept: "image/avif,image/webp,image/png,image/jpeg,image/gif" },
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    return new Response("Image unavailable.", { status: 502, headers });
  }
  if (upstream.status !== 200 || upstream.headers.has("Location")) {
    await upstream.body?.cancel().catch(() => undefined);
    return new Response("Image unavailable.", { status: 502, headers });
  }

  const contentType = (upstream.headers.get("Content-Type") ?? "").split(";")[0]!.trim().toLowerCase();
  const contentLength = Number(upstream.headers.get("Content-Length") ?? "0");
  if (!ALLOWED_IMAGE_TYPES.has(contentType) || contentLength > MAX_IMAGE_BYTES) {
    await upstream.body?.cancel().catch(() => undefined);
    return new Response("Unsupported image.", { status: 502, headers });
  }

  const reader = upstream.body?.getReader();
  if (!reader) return new Response("Image unavailable.", { status: 502, headers });
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_IMAGE_BYTES) {
        await reader.cancel().catch(() => undefined);
        return new Response("Image too large.", { status: 502, headers });
      }
      chunks.push(value);
    }
  } catch {
    await reader.cancel().catch(() => undefined);
    return new Response("Image unavailable.", { status: 502, headers });
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new Response(bytes, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(total),
      "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Cross-Origin-Resource-Policy": "same-origin",
    },
  });
}
