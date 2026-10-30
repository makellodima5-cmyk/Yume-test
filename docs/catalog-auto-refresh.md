# YUME catalog import and screenshot enrichment

## Current design

Catalog metadata enrichment is manual-only. The Cloudflare Cron Trigger runs lightweight episode checks every five minutes. Catalog status synchronization runs in two daily windows at 07:37 and 19:41 UTC. Trailer lookup is manual-only and is not run by Cron. The separate full metadata/screenshot enrichment remains manual-only. The admin interface no longer exposes start/stop controls for catalog auto-refresh.

New catalog imports now request scene screenshot URLs in the same Shikimori GraphQL response as titles, descriptions, posters, trailers, genres, and other metadata. YUME stores at most five unique screenshots for newly imported anime. The screenshot URLs and per-title status are written in the same D1 batch as the catalog records. Previously saved screenshot rows are preserved rather than destructively trimmed by this change.

The import no longer launches a second full-catalog enrichment pass when it finishes. Existing populated metadata fields are preserved, and existing titles are skipped during import. This avoids automatically rescanning the catalog after every import.

## Backfilling existing catalog entries

For existing catalog rows, the manual metadata refresh remains available when an explicit repair is needed:

1. Missing metadata is identified from the fields already supported by YUME. Complete records are skipped.
2. The screenshot phase reads an indexed page of up to 40 catalog rows and requests screenshots for eligible IDs together through Shikimori GraphQL.
3. At most five unique screenshots are stored when frames are newly fetched. Existing screenshot rows, future/unreleased titles, and recently confirmed empty screenshot results are skipped. Older rows that already contain more than five screenshots are preserved.
4. A provider/network failure leaves the current page cursor unchanged, so restarting manual mode retries the same batch.
5. Temporary screenshot retries are also batched. The durable cursor and screenshot statuses are stored in D1.

The metadata update step uses the existing catalog row already read for the current page. It no longer performs a second SELECT for every incomplete anime. Metadata updates are batched in D1, and an index on position and ID supports ordered catalog paging.

## D1 usage

The admin status panel polls every five seconds. Polling uses a lightweight status=1 endpoint that reads saved progress without running full-catalog quality aggregates or counting every screenshot status. Full quality and completeness summaries are calculated on initial load or when the user explicitly opens/refreshes catalog quality.

The production Worker runs scheduled maintenance every five minutes rather than every minute, and the due-episode query has a matching expression index. This reduces repeated D1 reads; exact savings must still be measured from Cloudflare metrics. Validate the change by comparing Cloudflare D1 rows_read and rows_written, the time to import a page, response size, and Worker errors before and after deployment.

## Deployment and operations

- Keep the YUME_DB D1 binding configured.
- The existing five-minute Cron Trigger runs only the episode-notification check. The two daily Cron windows run catalog status synchronization. Trailer lookup and metadata/screenshot enrichment are manual-only.
- No new API key or external service binding is required.
- Use the manual Run manually / Stop manual controls only when an existing catalog needs repair. The cursor is saved after each successful page; after a transient upstream failure, retrying resumes the same page.
- Newly imported titles get their screenshot URLs as part of import, so there is no automatic full-catalog follow-up pass.
- Image bytes are not copied to R2; only image URLs are stored in D1.
- The screenshot status table is created defensively by the application. Applying tracked migrations remains the recommended production practice.

## Source-provider notes

Shikimori remains the source for metadata and scene screenshots. GraphQL's screenshots field provides original and preview URLs, so the import can avoid one REST request per title. The five-frame cap limits stored rows and display volume; it does not reduce the number of screenshot links returned by GraphQL if the source sends the full list.

AniList, Jikan, Kitsu, and TMDB should not be added as silent fallbacks without a reliable ID mapping, measured coverage, and review of their API terms. Poster/backdrop fields from other providers are not equivalent to scene screenshots.
