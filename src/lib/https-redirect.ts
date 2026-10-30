/**
 * Redirect cleartext HTTP requests before any application route or API handler runs.
 *
 * Permanent 308 redirects preserve the HTTP method and request body. The original
 * path and query are retained, while the scheme is upgraded to HTTPS.
 */
export function redirectHttpToHttps(request: Pick<Request, "url">): Response | null {
  const url = new URL(request.url);
  if (url.protocol !== "http:") return null;

  // Keep local development on HTTP; only redirect non-loopback hosts.
  const hostname = url.hostname.toLowerCase();
  if (
    ["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname) ||
    hostname.endsWith(".localhost")
  ) {
    return null;
  }

  url.protocol = "https:";
  // Port 80 is the default HTTP port, not a valid HTTPS destination port.
  if (url.port === "80") url.port = "";

  return new Response(null, {
    status: 308,
    headers: {
      Location: url.toString(),
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
}
