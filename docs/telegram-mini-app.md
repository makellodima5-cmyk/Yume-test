# Telegram Mini App integration

## Current implementation

The Telegram Web App SDK is loaded by the root document. The client bridge calls `ready()` and `expand()`, and synchronizes Telegram viewport and safe-area values with CSS custom properties. VK ID and Yandex ID authentication endpoints and UI have been removed. YUME account sign-in and creation are available only inside the Telegram Mini App; a browser opened outside Telegram can browse the catalog without the removed website login flow.

The `/api/telegram/init-data` endpoint validates the raw `Telegram.WebApp.initData` payload using Telegram's HMAC-SHA-256 algorithm and rejects malformed payloads, duplicate query keys, invalid signatures, missing user identity, and authentication data older than five minutes (with a 30-second future-clock tolerance).

## Telegram accounts and sessions

- On Mini App startup, the client submits the raw `initData` to the server. It never trusts `initDataUnsafe` or a client-supplied Telegram ID.
- Existing Telegram accounts receive a new server session. New users are shown a short privacy disclosure before the account is created.
- On consent, the server creates a YUME account keyed by the verified Telegram ID and records the consent timestamp and policy version. The account stores Telegram profile fields and does not require a date of birth.
- Sessions use the existing `__Host-yume-session` HttpOnly, Secure, SameSite=Lax cookie and store only a SHA-256 token hash in D1. Sessions expire after 30 days.
- `GET /api/telegram/init-data` checks the current session; `DELETE /api/telegram/init-data` revokes it and clears the cookie.
- Migration `0005_telegram_only_accounts.sql` makes Telegram the only supported identity provider, removes the legacy date-of-birth field, and retains only verified Telegram accounts and their sessions.

## Required server secrets

Configure `TELEGRAM_BOT_TOKEN` and `YUME_AUTH_SESSION_SECRET` in the deployment environment. The session secret must be at least 32 characters. Never put either secret in client-side code or commit them to the repository.

## Deployment and verification

Apply the D1 migration before enabling Telegram account creation. Run automated tests, lint, and the Cloudflare Worker build in CI. Apply the pending migrations to the configured remote D1 database before production use. No Telegram bot webhook is required for Mini App `initData` authentication; webhook and `/start` welcome-message behavior can be added separately when the bot flow is designed.

## Account-owned favorites and watchlist

- Favorites and the “Want to watch” list are stored in D1 table `yume_saved_anime`, associated with the authenticated Telegram YUME account, not just with the current browser.
- `GET /api/telegram/library` reads the current account's lists. `POST /api/telegram/library` supports a one-time merge of previous browser lists and idempotent add/remove operations. Requests require a valid Telegram session cookie; mutations also reject cross-origin requests.
- The API validates numeric anime IDs and limits each list to 500 IDs. The client refreshes lists from D1 after sign-in and updates local browser storage as a cache.
- At first successful sign-in on each browser, any existing local lists are merged once into the account. A per-account marker prevents stale local data from being re-imported on every launch, which avoids bringing back items removed on another device.
- Migration `0004_add_saved_anime_library.sql` creates the saved-list table and index. Apply migrations `0003` and `0004` to the production D1 database before launch. The endpoint also ensures the table exists as a safe fallback.
- Outside Telegram, existing website lists remain browser-local. Server-side syncing currently applies to Telegram accounts only.
