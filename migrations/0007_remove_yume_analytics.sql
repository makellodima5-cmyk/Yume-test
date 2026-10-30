-- Retire first-party visit analytics and remove its historical event data.
-- Also remove previously stored AniList CDN banner URLs so the catalogue no longer depends on AniList assets.
-- Apply this migration only after deploying the version that removes the analytics endpoint and AniList integration.
UPDATE anime_catalog SET banner_url = NULL, updated_at = CURRENT_TIMESTAMP WHERE banner_url LIKE 'https://s4.anilist.co/%';
DROP TABLE IF EXISTS yume_analytics_events;
