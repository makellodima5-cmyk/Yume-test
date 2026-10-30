# YUME security audit: Stage 3 CSP reporting

**Audit date:** 2026-10-29  
**Scope:** source review and automated test design for CSP report-only telemetry and related deployment configuration. This is not a penetration test, legal opinion, or certification.

## Changes in this stage

- Keep Content Security Policy in `Content-Security-Policy-Report-Only` mode. No resource is blocked by this policy yet.
- Configure both `report-uri` and Reporting API `report-to` to send browser CSP violations to the same-origin `/api/csp-report` endpoint.
- Set the `Reporting-Endpoints` response header for the default HTML policy.
- Add a dedicated Cloudflare rate-limit binding for the reporting endpoint: 30 requests per minute per trusted Cloudflare client IP. If the binding or trusted client IP is missing, the endpoint fails closed.
- Restrict reporting to POST and supported JSON report content types; reject malformed and oversized payloads.
- Normalize reports before logging: preserve directive names and origins, reduce same-origin URLs to `self`, and discard paths, query strings, fragments, arbitrary report fields, and raw request bodies. The endpoint does not persist reports in D1.
- Add unit coverage for header wiring, both browser report formats, malformed/oversized payloads, rate-limit behavior, and URL/query-string sanitization.

## Important limits

- Report-only mode does not block malicious content. The policy still needs browser observation and an explicit compatibility review before any enforcing CSP is considered.
- Report delivery varies by browser. Absence of reports is not proof that a policy is clean or that clients are receiving the updated header.
- The rate limit uses Cloudflare's approximate, location-local counters. It is abuse protection, not exact accounting.
- Server logs will contain minimized violation summaries. Check Cloudflare log access and retention settings before treating this as permanent monitoring.
- Telegram authentication, YouTube embeds, Kodik players, and inline styles/scripts require real-browser regression checks before enforcing CSP.

## Release checks

1. CI: tests, lint, dependency audit, Worker build/config checks, and deploy dry-run must pass.
2. Production smoke: HTML documents return CSP Report-Only plus Reporting-Endpoints; API endpoints retain no document CSP.
3. Browser: inspect CSP violations while testing Telegram login, anime pages, Kodik player, YouTube embeds, fonts, and poster images.
4. Review observed violations and update the allowlist only for confirmed required origins. Do not add blanket `https:` script permission or switch to enforcing CSP without validating the inline bootstrap strategy.

**Status:** implementation prepared for CI review. Live browser observation and enforcement decision remain release checks.
