# D1 consumption audit and low-risk optimizations

**Date:** 29 October 2026  
**Scope:** static review of the `main` source, D1 catalog access, Cloudflare Cron handlers, and authenticated endpoints. Production D1 metrics could not be queried because the account's current quota is exhausted. Savings below are estimates, not observed measurements.

## Changes applied

- Increased the persistent catalog snapshot cache from 30 seconds to 5 minutes, including the Cache API response TTL. With 1,155 catalog rows, a cache region refilling once per TTL would read about 3.33 million catalog rows/day at 30 seconds versus about 333 thousand/day at 5 minutes, before invalidations and cache misses. Actual usage depends on traffic, isolates, and Cloudflare cache locality.
- Split the Worker schedule: episode checks still run every five minutes, but upstream trailer and catalog-status work runs in two daily windows at 07:37 and 19:41 UTC. Each daily window processes up to ten trailer batches and ten status batches, with a pause between trailer requests. Notifications still check D1 every five minutes and contact Shikimori only when due episodes exist.
- Added an expression index on `(status, datetime(next_episode_at))` for rows with an episode date. The due-episode query can narrow the scan to ongoing entries with dates that have passed instead of repeatedly checking the full catalogue. The index is created by the existing catalog schema initializer, so no standalone migration is needed.
- Cached schema-initialization promises for the episode-notification and subscription handlers within a warm Worker isolate.
- Removed a second redundant set of `CREATE TABLE IF NOT EXISTS` statements from every authenticated notification GET request.
- Fixed the episode-notification job's status persistence to map Shikimori enum values (`ongoing`, `anons`, `released`) to the catalog's stored labels instead of writing raw API values. Non-ongoing titles now have their next-episode date cleared by this job.

## Security and data integrity

No authentication, session validation, same-origin checks, input validation, rate-limit settings, territorial filtering, Kodik URL allowlists, or security headers were weakened. The optimizations do not delete catalog rows or artwork. Existing records remain the source of truth; refresh tasks update fields.

## Remaining hotspots to monitor

- Rendering the full catalogue requires reading all catalogue rows on a cache refill. The longer snapshot TTL reduces the frequency but does not change the shape of the client-side filtering model.
- A cold direct visit to an anime detail page used to execute a correlated genre/JSON scan across the catalogue for up to 100 related candidates. It now loads one ordered catalog snapshot and populates the shared cache; follow-up detail visits reuse that snapshot rather than re-running the correlated query.
- Analytics stores raw page-view events. Its admin metrics include all-time distinct counts; these become more expensive as the event table grows. Any archival/aggregation change should preserve the meaning of the current metrics and requires a separate design.
- The admin metadata and screenshot repair workflows can perform many D1 writes when manually run. Keep these jobs manual and avoid running repair loops unnecessarily.
- Trailer discovery stores queue state and periodically revisits titles without a saved trailer. Its schedule is less frequent now, and queue batch size remains bounded.

## Verification limits

The code and workflow configuration were reviewed statically. The build, automated tests, and live D1 query plans/usage metrics were not run from this session. After the quota resets, compare Cloudflare D1 `rows_read`, `rows_written`, and query errors over equivalent periods before/after deployment, then verify notifications, trailer batching, and catalog refresh in production.
