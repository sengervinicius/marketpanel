-- db/init.sql — Phase 21 Postgres schema.
-- Designed for JSONB-heavy storage to minimise rewrite cost.
-- Tables are CREATE IF NOT EXISTS so this is idempotent.

-- ── Users ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id                      SERIAL PRIMARY KEY,
  username                TEXT UNIQUE NOT NULL,
  email                   TEXT UNIQUE,
  email_verified          BOOLEAN NOT NULL DEFAULT FALSE,
  hash                    TEXT NOT NULL,
  apple_user_id           TEXT UNIQUE,
  settings                JSONB NOT NULL DEFAULT '{}',
  is_paid                 BOOLEAN NOT NULL DEFAULT FALSE,
  subscription_active     BOOLEAN NOT NULL DEFAULT TRUE,
  trial_ends_at           BIGINT,
  plan_tier               TEXT NOT NULL DEFAULT 'trial',
  stripe_customer_id      TEXT,
  stripe_subscription_id  TEXT,
  persona                 JSONB NOT NULL DEFAULT '{}',
  gamification            JSONB NOT NULL DEFAULT '{"xp":0,"level":1}',
  referral_code           TEXT,
  referred_by             INTEGER,
  referral_rewards        JSONB NOT NULL DEFAULT '{"invited":0,"xpEarned":0}',
  created_at              BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT
);

CREATE INDEX IF NOT EXISTS idx_users_username_lower ON users (LOWER(username));
CREATE INDEX IF NOT EXISTS idx_users_email_lower    ON users (LOWER(email));
CREATE INDEX IF NOT EXISTS idx_users_stripe         ON users (stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_referral_code  ON users (referral_code) WHERE referral_code IS NOT NULL;

-- ── Portfolios (one document per user, JSONB) ────────────────────────────
CREATE TABLE IF NOT EXISTS portfolios (
  user_id     INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  version     INTEGER NOT NULL DEFAULT 1,
  portfolios  JSONB NOT NULL DEFAULT '[]',
  positions   JSONB NOT NULL DEFAULT '[]',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Alerts (one row per alert) ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS alerts (
  id                      TEXT NOT NULL,
  user_id                 INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type                    TEXT NOT NULL,
  symbol                  TEXT NOT NULL DEFAULT '',
  portfolio_position_id   TEXT,
  parameters              JSONB NOT NULL DEFAULT '{}',
  note                    TEXT,
  active                  BOOLEAN NOT NULL DEFAULT TRUE,
  triggered_at            TEXT,
  dismissed               BOOLEAN NOT NULL DEFAULT FALSE,
  created_at              TEXT NOT NULL,
  updated_at              TEXT NOT NULL,
  PRIMARY KEY (user_id, id)
);

CREATE INDEX IF NOT EXISTS idx_alerts_active ON alerts (user_id, active) WHERE active = TRUE;
CREATE INDEX IF NOT EXISTS idx_alerts_user ON alerts(user_id);

-- ── Trial abuse prevention ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS used_trials (
  email TEXT PRIMARY KEY,
  first_trial_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_used_trials_email ON used_trials(LOWER(email));

-- ── Password resets ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS password_resets (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  expires_at BIGINT NOT NULL,
  used BOOLEAN DEFAULT FALSE,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets(user_id);
CREATE INDEX IF NOT EXISTS idx_password_resets_expires ON password_resets(expires_at);

-- ── Email verification tokens ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS email_verifications (
  token       TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL,
  email       TEXT NOT NULL,
  expires_at  BIGINT NOT NULL,
  verified    BOOLEAN DEFAULT FALSE,
  created_at  BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_email_verifications_user ON email_verifications(user_id);
CREATE INDEX IF NOT EXISTS idx_email_verifications_expires ON email_verifications(expires_at);

-- ── User behavior tracking (silent personalization) ─────────────────────────
CREATE TABLE IF NOT EXISTS user_behavior (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL,
  event_type  TEXT NOT NULL,
  payload     JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_behavior_user_time ON user_behavior (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_behavior_type ON user_behavior (event_type);

-- ── Wire entries (proactive AI market commentary) ───────────────────────────
CREATE TABLE IF NOT EXISTS wire_entries (
  id          SERIAL PRIMARY KEY,
  content     TEXT NOT NULL,
  tickers     TEXT[] DEFAULT '{}',
  category    TEXT DEFAULT 'market',
  mood        TEXT DEFAULT 'neutral',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_wire_created ON wire_entries (created_at DESC);

-- ── Vault documents ────────────────────────────────────────────────────────
-- NOTE: Full vault schema is managed by vault.js ensureTable(). This is a
-- minimal stub so init.sql doesn't conflict. ensureTable() will add missing
-- columns via ALTER TABLE IF NOT EXISTS.
CREATE TABLE IF NOT EXISTS vault_documents (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  filename    TEXT NOT NULL DEFAULT 'untitled.pdf',
  source      TEXT DEFAULT 'upload',
  is_global   BOOLEAN NOT NULL DEFAULT FALSE,
  metadata    JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_vault_documents_user ON vault_documents(user_id);
CREATE INDEX IF NOT EXISTS idx_vault_documents_global ON vault_documents(is_global) WHERE is_global = TRUE;

-- ── Vault chunks (document segments for retrieval) ──────────────────────────
-- NOTE: embedding column type VECTOR requires pgvector extension. If pgvector
-- is not installed, vault.js ensureTable() will handle the fallback.
CREATE TABLE IF NOT EXISTS vault_chunks (
  id          SERIAL PRIMARY KEY,
  document_id INTEGER NOT NULL REFERENCES vault_documents(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL DEFAULT 0,
  chunk_index INTEGER NOT NULL,
  content     TEXT NOT NULL,
  metadata    JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_vault_chunks_document ON vault_chunks(document_id);
CREATE INDEX IF NOT EXISTS idx_vault_chunks_user ON vault_chunks(user_id);

-- ── User Memories (Cross-Session Persistent Memory) ─────────────────────────
CREATE TABLE IF NOT EXISTS user_memories (
  id                SERIAL PRIMARY KEY,
  user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  memory_type       VARCHAR(50) NOT NULL, -- 'fact', 'preference', 'position', 'thesis'
  content           TEXT NOT NULL,
  confidence        REAL DEFAULT 1.0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_referenced   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reference_count   INTEGER DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_user_memories_user ON user_memories(user_id);
CREATE INDEX IF NOT EXISTS idx_user_memories_type ON user_memories(user_id, memory_type);
CREATE INDEX IF NOT EXISTS idx_user_memories_confidence ON user_memories(user_id, confidence) WHERE confidence > 0.3;

-- ── Refresh tokens (rotation-safe) ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS refresh_tokens (
  token       TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL,
  family_id   TEXT NOT NULL,
  expires_at  BIGINT NOT NULL,
  revoked     BOOLEAN DEFAULT FALSE,
  created_at  BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_family ON refresh_tokens(family_id);

-- ── Action feedback (user engagement tracking for AI signal optimization) ────
CREATE TABLE IF NOT EXISTS action_feedback (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action_type VARCHAR(50) NOT NULL,
  ticker      VARCHAR(20),
  params      TEXT,
  context     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_action_feedback_user ON action_feedback(user_id);
CREATE INDEX IF NOT EXISTS idx_action_feedback_user_ticker ON action_feedback(user_id, ticker);
CREATE INDEX IF NOT EXISTS idx_action_feedback_type ON action_feedback(user_id, action_type);

-- ── Vault Signals (Cross-user document clustering) ────────────────────────
-- Detects when multiple users upload documents about the same ticker/topic
CREATE TABLE IF NOT EXISTS vault_signals (
  id              SERIAL PRIMARY KEY,
  ticker          TEXT NOT NULL UNIQUE,
  signal_type     TEXT NOT NULL DEFAULT 'cluster',
  user_count      INTEGER NOT NULL,
  document_count  INTEGER NOT NULL,
  first_seen      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_vault_signals_ticker ON vault_signals(ticker);
CREATE INDEX IF NOT EXISTS idx_vault_signals_created ON vault_signals(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vault_signals_user_count ON vault_signals(user_count DESC);

-- ── Conversation Memory (Phase 5: Typed memory records) ───────────────────
-- Replaces flat message rolling window with structured, typed records
-- that survive context switches and provide Claude with focused context.
CREATE TABLE IF NOT EXISTS conversation_memory (
  id                SERIAL PRIMARY KEY,
  user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id        TEXT NOT NULL,
  type              VARCHAR(20) NOT NULL CHECK (type IN ('topic','entity_focus','thesis','constraint','preference','followup')),
  content           TEXT NOT NULL,
  tickers_mentioned TEXT[] DEFAULT '{}',
  ttl_hours         INTEGER NOT NULL DEFAULT 2,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at        TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '2 hours')
);
CREATE INDEX IF NOT EXISTS idx_conv_memory_user ON conversation_memory(user_id);
CREATE INDEX IF NOT EXISTS idx_conv_memory_user_active ON conversation_memory(user_id, expires_at) WHERE expires_at > NOW();
CREATE INDEX IF NOT EXISTS idx_conv_memory_session ON conversation_memory(user_id, session_id);
CREATE INDEX IF NOT EXISTS idx_conv_memory_type ON conversation_memory(user_id, type);

-- ── Stripe event idempotency (W0.6) ────────────────────────────────────────
-- Records each successfully processed Stripe webhook event so we never
-- re-apply a subscription/payment transition twice (Stripe retries on 5xx
-- or network hiccups). The table is append-only; pruning is optional.
CREATE TABLE IF NOT EXISTS stripe_events_processed (
  event_id      TEXT PRIMARY KEY,
  event_type    TEXT NOT NULL,
  received_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at  TIMESTAMPTZ,
  status        TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received','processed','failed')),
  error_message TEXT
);
CREATE INDEX IF NOT EXISTS idx_stripe_events_received ON stripe_events_processed (received_at DESC);
CREATE INDEX IF NOT EXISTS idx_stripe_events_type ON stripe_events_processed (event_type);

-- ── Admin audit log (W0.8) ────────────────────────────────────────────────
-- Append-only trail of every privileged action taken through /api/admin/*.
-- Actor is the authenticated admin userId; ip/user_agent aid forensics.
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id           BIGSERIAL PRIMARY KEY,
  actor_id     INTEGER NOT NULL,
  actor_email  TEXT,
  action       TEXT NOT NULL,             -- e.g. 'user.delete', 'tier.override'
  target_type  TEXT,                       -- e.g. 'user', 'subscription'
  target_id    TEXT,
  route        TEXT NOT NULL,              -- HTTP method + path
  status_code  INTEGER,
  ip           TEXT,
  user_agent   TEXT,
  req_id       TEXT,
  details      JSONB NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_admin_audit_actor ON admin_audit_log (actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_action ON admin_audit_log (action, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_target ON admin_audit_log (target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON admin_audit_log (created_at DESC);

-- ── AI usage ledger (W1.2) ────────────────────────────────────────────────
-- Per-user daily token accounting across every model provider. One row per
-- (user_id, day, model) tuple. Token counts and cents accumulate with UPSERT.
-- Queries:
--   daily quota:     SELECT COALESCE(SUM(tokens_in + tokens_out), 0) FROM ai_usage_ledger
--                     WHERE user_id = $1 AND day = CURRENT_DATE;
--   monthly spend:   SELECT COALESCE(SUM(cents), 0) FROM ai_usage_ledger
--                     WHERE day >= date_trunc('month', CURRENT_DATE);
--   top spenders:    SELECT user_id, SUM(cents) AS spend FROM ai_usage_ledger
--                     WHERE day >= CURRENT_DATE - INTERVAL '30 days'
--                     GROUP BY user_id ORDER BY spend DESC LIMIT 20;
CREATE TABLE IF NOT EXISTS ai_usage_ledger (
  user_id     INTEGER     NOT NULL,
  day         DATE        NOT NULL DEFAULT CURRENT_DATE,
  model       TEXT        NOT NULL,
  tokens_in   BIGINT      NOT NULL DEFAULT 0,
  tokens_out  BIGINT      NOT NULL DEFAULT 0,
  calls       INTEGER     NOT NULL DEFAULT 0,
  cents       NUMERIC(14,4) NOT NULL DEFAULT 0,
  last_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, day, model)
);
CREATE INDEX IF NOT EXISTS idx_ai_usage_day ON ai_usage_ledger (day DESC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_user_day ON ai_usage_ledger (user_id, day DESC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_model_day ON ai_usage_ledger (model, day DESC);
-- Wave 2 partition candidate: `ai_usage_ledger` by day (see W1.6 audit).

-- ── Org-wide kill-switch flags (W1.2) ─────────────────────────────────────
-- Single-row table holding runtime feature flags that modelRouter consults on
-- every call. Flipped automatically by the budget watchdog; can also be
-- toggled manually by an admin for incident response.
CREATE TABLE IF NOT EXISTS ai_kill_switch (
  singleton        BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  force_haiku      BOOLEAN NOT NULL DEFAULT FALSE,
  block_all_ai     BOOLEAN NOT NULL DEFAULT FALSE,
  reason           TEXT,
  tripped_at       TIMESTAMPTZ,
  tripped_by       TEXT,
  monthly_budget_cents BIGINT NOT NULL DEFAULT 100000,  -- $1,000 default
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO ai_kill_switch (singleton) VALUES (TRUE) ON CONFLICT DO NOTHING;

-- ── LGPD DSAR tables (W1.1) ───────────────────────────────────────────────
-- W1.1 LGPD Art. 18 compliance.
--
-- dsar_erasure_queue — soft-delete staging table. A POST /api/privacy/me
-- DELETE inserts the user here with `hard_delete_after = NOW() + 30 days`.
-- A daily retention cron (server/jobs/lgpdRetention.js) deletes the row
-- plus the associated user record and all FK children once the grace
-- window expires. If the user re-authenticates before then, we clear
-- `pending_deletion_at` on users and delete the queue row.
--
-- dpo_tickets — public-facing contact form for data-subject inquiries.
-- DPO reviews weekly. PII (email, name) redacted after 90 days.
CREATE TABLE IF NOT EXISTS dsar_erasure_queue (
  user_id            INTEGER     PRIMARY KEY,
  requested_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  hard_delete_after  TIMESTAMPTZ NOT NULL,
  reason             TEXT,
  status             TEXT        NOT NULL DEFAULT 'pending'
                                 CHECK (status IN ('pending','cancelled','executed','failed')),
  executed_at        TIMESTAMPTZ,
  last_error         TEXT
);
CREATE INDEX IF NOT EXISTS idx_dsar_due ON dsar_erasure_queue (hard_delete_after)
  WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS dpo_tickets (
  id           SERIAL      PRIMARY KEY,
  email        TEXT        NOT NULL,
  name         TEXT,
  subject      TEXT        NOT NULL,
  message      TEXT        NOT NULL,
  ip_hash      TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  handled_at   TIMESTAMPTZ,
  handled_by   TEXT,
  notes        TEXT
);
CREATE INDEX IF NOT EXISTS idx_dpo_tickets_created ON dpo_tickets (created_at DESC);

-- Marker column on users so the runtime can refuse login during grace window.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'pending_deletion_at'
  ) THEN
    ALTER TABLE users ADD COLUMN pending_deletion_at TIMESTAMPTZ;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'marketing_opt_out'
  ) THEN
    ALTER TABLE users ADD COLUMN marketing_opt_out BOOLEAN NOT NULL DEFAULT FALSE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'ai_training_opt_out'
  ) THEN
    ALTER TABLE users ADD COLUMN ai_training_opt_out BOOLEAN NOT NULL DEFAULT FALSE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'analytics_opt_out'
  ) THEN
    ALTER TABLE users ADD COLUMN analytics_opt_out BOOLEAN NOT NULL DEFAULT FALSE;
  END IF;
END$$;
