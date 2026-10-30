import { describe, expect, it } from "vitest";
import { applySecurityHeaders } from "./security-headers";

describe("applySecurityHeaders", () => {
  it("adds baseline browser security headers and an enforcing CSP to HTML responses", () => {
    const response = applySecurityHeaders(
      new Response("<html></html>", { headers: { "Content-Type": "text/html; charset=utf-8" } }),
      "https://example.com/",
    );

    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("X-Frame-Options")).toBe("SAMEORIGIN");
    expect(response.headers.get("X-Permitted-Cross-Domain-Policies")).toBe("none");
    expect(response.headers.get("X-DNS-Prefetch-Control")).toBe("off");
    expect(response.headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(response.headers.get("Permissions-Policy")).toContain("camera=()");
    expect(response.headers.get("Strict-Transport-Security")).toBe("max-age=31536000");
    expect(response.headers.get("Content-Security-Policy")).toContain("default-src 'self'");
    expect(response.headers.get("Content-Security-Policy")).toContain("object-src 'none'");
    expect(response.headers.get("Content-Security-Policy")).toContain("script-src 'self' 'unsafe-inline'");
    expect(response.headers.get("Content-Security-Policy")).toContain("frame-src 'self'");
    expect(response.headers.get("Content-Security-Policy-Report-Only")).toContain("default-src 'self'");
    expect(response.headers.get("Content-Security-Policy-Report-Only")).toContain("report-uri /api/csp-report");
    expect(response.headers.get("Content-Security-Policy-Report-Only")).toContain("report-to csp-endpoint");
    expect(response.headers.get("Reporting-Endpoints")).toBe('csp-endpoint="https://example.com/api/csp-report"');
  });

  it("does not add a document CSP to JSON responses", () => {
    const response = applySecurityHeaders(
      new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } }),
      "https://example.com/api",
    );

    expect(response.headers.get("Content-Security-Policy")).toBeNull();
    expect(response.headers.get("Content-Security-Policy-Report-Only")).toBeNull();
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("preserves a route's explicit enforcing CSP", () => {
    const response = applySecurityHeaders(
      new Response("<html></html>", {
        headers: {
          "Content-Type": "text/html",
          "Content-Security-Policy": "default-src 'none'",
        },
      }),
      "https://example.com/",
    );

    expect(response.headers.get("Content-Security-Policy")).toBe("default-src 'none'");
    expect(response.headers.get("Content-Security-Policy-Report-Only")).toContain("default-src 'self'");
  });

  it("does not add HSTS to non-HTTPS URLs", () => {
    const response = applySecurityHeaders(
      new Response("ok", { headers: { "Content-Type": "text/plain" } }),
      "http://localhost:8787/",
    );

    expect(response.headers.get("Strict-Transport-Security")).toBeNull();
  });
});
