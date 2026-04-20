-- P5 — DB-backed AI chat conversations (24h retention, cross-device).
--
-- Replaces the localStorage-only persistence previously used in
-- ChatPanel.jsx. Each conversation is scoped to one user; one row per
-- turn in ai_messages. A lightweight sidebar lists recent conversations
-- (last 24h) and lets the user click back into one.
--
-- Retention: a cron / job can `DELETE FROM ai_conversations WHERE
-- last_message_at < NOW() - INTERVAL '24 hours'` once a day. The index
-- below makes that query cheap. Until the cron exists, the listing API
-- query-filters on the same condition so expired rows are never shown.

CREATE TABLE IF NOT EXISTS ai_conversations (
  id               BIGSERIAL   PRIMARY KEY,
  user_id          INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title            TEXT        NOT NULL DEFAULT 'New chat',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_message_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  message_count    INTEGER     NOT NULL DEFAULT 0,
  metadata         JSONB       NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_ai_conv_user_recent
  ON ai_conversations (user_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_conv_retention
  ON ai_conversations (last_message_at)
  WHERE last_message_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS ai_messages (
  id               BIGSERIAL   PRIMARY KEY,
  conversation_id  BIGINT      NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  role             TEXT        NOT NULL CHECK (role IN ('user','assistant','system')),
  content          TEXT        NOT NULL DEFAULT '',
  metadata         JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ai_msg_conv_ordered
  ON ai_messages (conversation_id, created_at ASC);
