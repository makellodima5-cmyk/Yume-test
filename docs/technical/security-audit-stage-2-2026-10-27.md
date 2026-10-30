# YUME security audit: Stage 2

**Audit date:** 2026-10-27  
**Scope:** source review of the working branch against `main`, read-only production HTTP/browser probes, automated CI, and the limited CertScore public scan. This is not a penetration test, legal opinion, or certification.

## Findings closed in the working branch

### Cookie consent and analytics
- The production first layer exposed “Essential only” and “Accept all” but no granular settings action. The branch now adds “Settings / Настроить”, an optional analytics toggle, and explicit save/refusal choices.
- An isolated live browser test confirmed the existing opt-in/refusal path: YUME analytics identifiers and POSTs appeared after opt-in and were removed/stopped after refusal in the observed window.
- Global Privacy Control was indeterminate in the external scanner. The branch now honours `navigator.globalPrivacyControl === true` in the browser and `Sec-GPC: 1` in the analytics endpoint, even if an older opt-in cookie remains. Both branches have tests.
- Analytics event identifiers are hashed server-side; the reviewed handler does not read or store raw client IP addresses. This does not establish what hosting providers include in their own infrastructure logs.

### Third-party image cookies
- Shikimori poster responses return `Server: ddos-guard` and `Set-Cookie` values named `__ddg1_`, `__ddg8_`, `__ddg9_`, and `__ddg10_`. These are from the third-party resource/protection layer, not YUME analytics. The exact purpose of every cookie is not authoritatively documented by the primary sources reviewed.
- Rather than block a likely protective mechanism, the branch routes catalog posters and screenshot previews/links through a restricted same-origin proxy. It accepts HTTPS static image paths only from the exact Shikimori host allowlist, refuses redirects and non-image responses, caps output at 8 MiB, and does not forward upstream `Set-Cookie` headers. Tests cover allowed/blocked URLs, redirects, and cookie-header isolation.
- This behavior is not live until the branch is released. The production network scan must confirm that poster and screenshot requests succeed and that the browser no longer receives these third-party cookies for those assets.

### Contrast
- The existing footer opacity fix is retained.
- The branch sets primary button foreground to a dark color token rather than near-white. A token-level sRGB calculation from the declared CSS values estimates about 5.24:1 for the primary background with the new dark foreground versus about 3.68:1 for the previous near-white foreground.
- That calculation does not cover every component, overlay, gradient, font weight, or theme. The exact live-browser retest remains a release check.

### Secret and CI hygiene
- `.gitignore` excludes `.env`, `.env.*`, `.wrangler/`, `.dev.vars`, and `.dev.vars.*`, while allowing example env templates. No matching secret/config filenames were found in the current tracked branch tree and GitHub code searches for common literal secret patterns returned no results.
- Workflow actions are pinned to full commit SHAs verified against their version tags.
- Current branch CI checks tests, ESLint, high/critical dependency audit, the Worker build, generated Worker configuration/Cron/D1 assertions, and `wrangler deploy --dry-run`. A green run is build-time evidence, not a live deployment.
- `.gitignore` does not rewrite Git history. The available connector could not retrieve repository secret-scanning and Dependabot alert inventories, so this audit does not claim complete historical secret scanning or a full alert inventory. Rotate any credential only if a genuine exposure is found, and avoid publishing replacement values.

## Security controls inspected

- HTTPS redirect, security response headers, and local-development exceptions for the redirect helper.
- Telegram Mini App `initData` signature verification, freshness bounds, OIDC state/nonce/PKCE flow, and secure HttpOnly session cookies.
- Same-origin checks on authenticated mutation handlers; session lookups use hashed session tokens; account-owned library/history operations are scoped to the authenticated user.
- Admin import/trailer operations check the administrator session/Telegram ID, verify same-origin writes, use parameterized D1 statements and operation locks.
- Telegram webhook validates the Telegram secret-token header and restricts commands to configured usernames.
- Kodik request input is validated, outbound request has a timeout, returned player URLs are restricted to the allowlist, and the API token is not included in the client response.
- No production D1 row data was exported or queried during this work.

These are source-review observations, not guarantees that every flow is free of vulnerabilities.

## Residual issues and release checks

1. **No CSP header yet.** The shared security-header helper intentionally omits Content-Security-Policy because the app has inline bootstrap code and Telegram/video embeds. A safe CSP needs a nonce/hash and explicit vendor allowlist with browser regression tests. Do not add a rushed blanket policy that breaks login, styles, or embeds.
2. **Rate limiting is an infrastructure task.** The public Kodik proxy and authentication/webhook endpoints use input validation and timeouts, but source review did not establish comprehensive per-IP/request rate limiting at the Cloudflare edge. No Cloudflare account/dashboard configuration was changed in this audit; configure and test edge rate limits separately if the connected account and correct permissions are available.
3. **External-provider disclosure is not consent to every provider.** Google Fonts and Telegram Web Apps resources are loaded site-wide and can receive request metadata. Their purpose is now named in the policy text on this branch; vendor contracts, retention, transfer/location, and the final legal wording need owner review.
4. **Third-party cookie semantics are not legally adjudicated.** Shikimori/DDos-Guard's exact per-cookie purpose and necessity remain to be confirmed by the provider if formal closure is required.
5. **Post-deploy regression is mandatory.** Verify HTTPS and policy, run fresh axe/color-contrast checks in supported themes, run consent accept/refuse/reopen tests, verify GPC on the network, verify poster/screenshot proxy output and no direct Shikimori cookies, and rerun the external scan. The existing CertScore report is `completed_limited` at 92/100, covers only one page, reported 0 axe failures in its limited sample, and did not exercise consent actions. It cannot establish legal compliance or site-wide accessibility.

## Release status

The fixes are committed on `security/consent-preferences-final-2026-10-27` and grouped into PR #98. The PR is open and has not been merged or deployed. This branch report must not be interpreted as confirmation that the live Worker already runs these changes.
