-- Selected anime details now resolve episode schedules from Shikimori at request time.
-- Clear legacy schedule snapshots so an upstream failure cannot keep showing old dates.
UPDATE anime_catalog
SET next_episode_at = NULL,
    updated_at = CURRENT_TIMESTAMP
WHERE next_episode_at IS NOT NULL;
