-- Phase 10.7 — Morning Brief inbox.
--
-- Every morning the dispatcher cron generates a personalized brief for
-- each user who has opted in (default: both email + inbox on) and writes
-- a row here. The client renders an "inbox" panel with a numeric unread
-- badge in the app header; archived rows are re-readable up to 30 days.
--
-- Retention: a daily cleanup can `DELETE FROM brief_inbox WHERE created_at
-- < NOW() - INTERVAL '30 days'`. Cheap — the index below covers it.
--
-- Dedupe: one row per (user_id, brief_date). The UNIQUE constraint is
-- what makes the cron idempotent — re-running the dispatcher the same
-- day is a no-op rather than a duplicate send.

CREATE TABLE IF NOT EXISTS brief_inbox (
  id                  BIGSERIAL   PRIMARY KEY,
  user_id             INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  brief_date          DATE        NOT NULL,
  content             JSONB       NOT NULL DEFAULT '{}'::jsonb,
  delivered_email_at  TIMESTAMPTZ NULL,
  read_at             TIMESTAMPTZ NULL,
  dismissed_at        TIMESTAMPTZ NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, brief_date)
);

-- Primary access pattern: "give me this user's last 30 briefs newest-first".
CREATE INDEX IF NOT EXISTS idx_brief_inbox_user_recent
  ON brief_inbox (user_id, brief_date DESC);

-- Unread-count query hits this partial index.
CREATE INDEX IF NOT EXISTS idx_brief_inbox_user_unread
  ON brief_inbox (user_id)
  WHERE read_at IS NULL AND dismissed_at IS NULL;

-- Retention sweep index (cheap full-table DELETE ... WHERE created_at < ...).
CREATE INDEX IF NOT EXISTS idx_brief_inbox_retention
  ON brief_inbox (created_at);
