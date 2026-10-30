/**
 * Apply browser security headers to every Worker response.
 *
 * CSP is enforced with an explicit resource allowlist. Inline scripts remain
 * permitted for the current SSR hydration bootstrap; third-party script
 * execution is restricted to the documented Telegram origins. Keep Report-Only
 * enabled as well so any missed resource dependency is observable during rollout.
 */
const CSP_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'self'",
  "form-action 'self' https://oauth.telegram.org",
  "script-src 'self' 'unsafe-inline' https://telegram.org https://oauth.telegram.org",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob: https:",
  "connect-src 'self' https://telegram.org https://*.telegram.org https://shikimori.one https://*.shikimori.one",
 "frame-src 'self' https://oauth.telegram.org https://www.youtube-nocookie.com https://youtube.com https://www.youtube.com https://*.youtube.com ",
  "media-src 'self' blob: data: https:",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "report-uri /api/csp-report",
  "report-to csp-endpoint",
].join("; ");

export function applySecurityHeaders(response: Response, requestUrl: string): Response {
  const headers = new Headers(response.headers);
  if (!headers.has("X-Content-Type-Options")) headers.set("X-Content-Type-Options", "nosniff");
  if (!headers.has("X-Permitted-Cross-Domain-Policies")) headers.set("X-Permitted-Cross-Domain-Policies", "none");
  if (!headers.has("X-DNS-Prefetch-Control")) headers.set("X-DNS-Prefetch-Control", "off");
  if (!headers.has("Referrer-Policy")) headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  if (!headers.has("X-Frame-Options")) headers.set("X-Frame-Options", "SAMEORIGIN");
  if (!headers.has("Permissions-Policy")) {
    headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  }

  // Apply CSP only to HTML documents. Preserve stricter route-specific policies.
  const contentType = headers.get("Content-Type") ?? "";
  if (contentType.toLowerCase().includes("text/html")) {
    if (!headers.has("Content-Security-Policy")) {
      headers.set("Content-Security-Policy", CSP_POLICY);
    }
    if (!headers.has("Content-Security-Policy-Report-Only")) {
      headers.set("Content-Security-Policy-Report-Only", CSP_POLICY);
    }
    if (!headers.has("Reporting-Endpoints")) {
      try {
        const endpointUrl = new URL("/api/csp-report", requestUrl).toString();
        headers.set("Reporting-Endpoints", `csp-endpoint="${endpointUrl}"`);
      } catch {
        // Do not prevent a response when a local test supplies an invalid URL.
      }
    }
  }

  try {
    if (new URL(requestUrl).protocol === "https:" && !headers.has("Strict-Transport-Security")) {
      headers.set("Strict-Transport-Security", "max-age=31536000");
    }
  } catch {
    // Invalid URL inputs should not prevent the response from being returned.
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
