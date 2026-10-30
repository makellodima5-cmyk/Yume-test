-- Cover the Queue consumer's keyset-paginated subscriber fanout.
-- The index keeps each page bounded without sorting/scanning all subscriptions.
CREATE INDEX IF NOT EXISTS idx_yume_anime_subscriptions_fanout
  ON yume_anime_subscriptions(anime_id, active, user_id);
