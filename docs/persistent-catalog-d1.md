# YUME persistent anime catalog (Cloudflare D1)

## Worker and database configuration

The repository declares the Worker configuration in `wrangler.jsonc`. It binds the existing D1 database `yume_db` (ID `fb5ba87d-e921-4dde-829e-7b1bddcf123b`) to the runtime name `YUME_DB`, which must match the binding used by the application.

The connected Cloudflare Workers & Pages Git integration builds changes from GitHub and is the intended production deployment path when changes are merged into `main`. The `Cloudflare Worker CI` workflow separately runs the automated test suite, builds the project and verifies that the generated Wrangler configuration contains this D1 binding. It deliberately does not run a second deployment in parallel with Cloudflare's native integration.

For a manual deployment from an authenticated developer machine, run:

```sh
bun run deploy:cloudflare
```

The command requires Wrangler authentication with the intended Cloudflare account. Never commit an API token to the repository.

## First initialization

The first request to the catalog after the binding is active creates the tables if needed and tries to collect 1,000 unique, eligible records from Shikimori. A ready marker is written only after all 1,000 records are stored. An incomplete upstream response is not promoted to the permanent catalog; the request returns a neutral temporary-unavailable state and can be retried.

Once initialized, catalog and homepage lists are read from D1. Normal visits do not rebuild the 1,000-title selection from Shikimori. Provider failures are written to the Worker console; the main UI uses a neutral message instead.

## Editing the catalog

The `anime_catalog` table is the authoritative persistent list. Records remain there until an administrator changes them. Each row stores the normalized fields used by YUME, including titles, genres, status, rating, artwork URLs, studios, release metadata, and an optional YouTube trailer ID. The `position` column controls the default order.

The SQL schema is also tracked in `migrations/0001_create_anime_catalog.sql`. The application creates missing tables on first use, so a Wrangler migration is not required for initial table creation. Keep the migration file aligned with `CREATE_SCHEMA` in `src/data/catalog-d1.server.ts` when the schema changes.

## Catalog identity vs. live details

D1 remains the durable catalogue index: Shikimori ID, stored display title, poster URL, latest known score, ordering, and the summary fields used by catalogue search, filters, and home sections. When a user opens an anime detail page, YUME requests that title by Shikimori ID and uses the live response for its description, status, genres, episode counts, airing dates, studios, type, age rating, and trailer. The page keeps the D1 title and poster stable; a successful live score refresh is written back to D1. A short in-isolate cache limits repeated upstream requests, and the previous D1 record remains a fallback if Shikimori is unavailable.

Past `next_episode_at` values are never shown as upcoming. The new `migrations/0006_clear_stale_episode_dates.sql` clears the legacy episode schedule snapshot once; it does not alter table structure or require changing any migration that has already been applied.

For the production database, open the existing `yume_db` database in Cloudflare D1 Console and execute the contents of `migrations/0006_clear_stale_episode_dates.sql` once. Do not rerun older migrations or edit them retroactively. Verify with:

```sql
SELECT COUNT(*) AS stale_schedule_rows
FROM anime_catalog
WHERE next_episode_at IS NOT NULL;
```

The expected result after applying the cleanup is `0`. The field remains in the schema for compatibility with existing catalog import code, but it is no longer the source of truth for a selected title's episode schedule.

## Important constraints

- The catalog is capped at 1,000 records.
- Search and filters operate on records already stored in YUME; search terms are not sent to Shikimori.
- The catalog is not considered live-configured until the Cloudflare deployment with the `YUME_DB` binding has completed and the first seed has succeeded.
- The image files themselves are not stored in D1; YUME stores artwork URLs and the browser fetches images from their hosts.
- A successful build verifies the Worker artifact and binding configuration, but it does not prove that the production D1 database is accessible or that the initial 1,000-record seed has completed. Confirm both in the deployed Worker logs after the first request.
