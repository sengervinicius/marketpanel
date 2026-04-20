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

-- ── Vault inbound tokens (P4: per-user inbound email address) ───────────────
-- Each user gets ONE active token at a time. Their personal address is
-- `vault-<token>@the-particle.com`. See server/services/inboundTokens.js.
CREATE TABLE IF NOT EXISTS vault_inbound_tokens (
  token         TEXT PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at    BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT,
  last_used_at  BIGINT,
  revoked_at    BIGINT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_vault_inbound_tokens_user_active
  ON vault_inbound_tokens(user_id)
  WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_vault_inbound_tokens_user_history
  ON vault_inbound_tokens(user_id, created_at DESC);

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

-- ── Vault Query Log (W4.2: retrieval audit trail) ─────────────────────────
-- Every call to vault.retrieve() writes one row here. Used for:
--   (a) LGPD DSAR — "what does Particle know I've asked about?"
--   (b) Citation-accuracy eval harness (W4.5) — regression testing
--   (c) Retrieval regression detection — latency + passage-count drift
--   (d) Abuse / quota monitoring — users hammering the AI at free tier
-- Retention policy (enforced by a separate cron, NOT in this schema):
--   30 days for free-tier users, 12 months for paid. Hash stays forever
--   because it contains no PII by itself.
-- All fields on one row per query to keep write amplification minimal.
CREATE TABLE IF NOT EXISTS vault_query_log (
  id                  BIGSERIAL PRIMARY KEY,
  user_id             INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  query_text          TEXT NOT NULL,          -- truncated to 1000 chars upstream
  query_hash          TEXT NOT NULL,          -- SHA-256 of the raw query for dedup / analytics
  query_scrubbed_hits INTEGER NOT NULL DEFAULT 0, -- W4.1 scrubber hits against THIS query
  passage_count       INTEGER NOT NULL DEFAULT 0,
  passages            JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Each element: { chunk_id, document_id, filename, similarity, rrf_rank }
  embedding_provider  TEXT,                   -- 'openai' | 'voyage' | null
  reranker_used       TEXT,                   -- 'cohere' | 'haiku' | 'none'
  latency_ms          INTEGER NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_vault_query_log_user      ON vault_query_log(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vault_query_log_created   ON vault_query_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vault_query_log_hash      ON vault_query_log(query_hash);

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
-- NOTE: no WHERE predicate — NOW() is STABLE, not IMMUTABLE, so Postgres
-- rejects it in an index predicate (which must be pure). The full index
-- still serves the "WHERE expires_at > NOW()" query correctly; the planner
-- applies the predicate at scan time. This was the bug that aborted
-- init.sql mid-run on fresh DBs and prevented feature_flags from ever
-- being created (incident 2026-04-20).
CREATE INDEX IF NOT EXISTS idx_conv_memory_user_active ON conversation_memory(user_id, expires_at);
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

-- ── Subscription audit (W2.1) ─────────────────────────────────────────────
-- Append-only ledger of every plan/tier/paid transition. Populated by
-- Stripe webhook, IAP validator, admin overrides, and the reconciler.
-- Retention: 5 years (fiscal law); partition candidate on created_at.
CREATE TABLE IF NOT EXISTS subscription_audit (
  id            BIGSERIAL   PRIMARY KEY,
  user_id       INTEGER     NOT NULL,
  source        TEXT        NOT NULL
                            CHECK (source IN ('stripe_webhook','iap_receipt',
                                              'admin_override','reconciler','self_serve')),
  action        TEXT        NOT NULL,
  before_state  JSONB       NOT NULL DEFAULT '{}'::jsonb,
  after_state   JSONB       NOT NULL DEFAULT '{}'::jsonb,
  meta          JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_subaudit_user     ON subscription_audit (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_subaudit_source   ON subscription_audit (source, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_subaudit_action   ON subscription_audit (action, created_at DESC);

-- ── IAP receipt ledger (W2.3) ─────────────────────────────────────────────
-- Authoritative copy of every validated App Store / Play Store receipt.
-- One row per original_transaction_id. The reconciler consults this daily
-- to re-check expiry against Apple/Google and downgrade on lapse.
CREATE TABLE IF NOT EXISTS iap_receipts (
  original_transaction_id  TEXT        PRIMARY KEY,
  user_id                  INTEGER     NOT NULL,
  store                    TEXT        NOT NULL CHECK (store IN ('apple','google')),
  product_id               TEXT        NOT NULL,
  expires_at               TIMESTAMPTZ,
  auto_renew               BOOLEAN     NOT NULL DEFAULT FALSE,
  last_validated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  latest_receipt           TEXT,
  tier                     TEXT,
  status                   TEXT        NOT NULL DEFAULT 'active'
                                       CHECK (status IN ('active','expired','revoked','grace')),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_iap_user     ON iap_receipts (user_id);
CREATE INDEX IF NOT EXISTS idx_iap_expires  ON iap_receipts (expires_at);
CREATE INDEX IF NOT EXISTS idx_iap_status   ON iap_receipts (status, expires_at);

-- W6.1 — DIY feature flags.
--
-- Each flag is one row. Evaluation order in featureFlags.js:
--   1. enabled=false → OFF for everyone (kill switch)
--   2. cohort_rule matches (tiers/userIds/emailDomains) → ON
--   3. rollout_pct > 0 and deterministic hash(userId||name) % 100 < pct → ON
--   4. otherwise OFF
--
-- cohort_rule is JSONB so we can evolve without schema churn:
--   {"tiers": ["particle_pro","particle_elite"]}
--   {"userIds": [1, 2, 42]}
--   {"emailDomains": ["arccapital.com.br"]}
CREATE TABLE IF NOT EXISTS feature_flags (
  name         TEXT        PRIMARY KEY,
  enabled      BOOLEAN     NOT NULL DEFAULT FALSE,
  rollout_pct  INTEGER     NOT NULL DEFAULT 0 CHECK (rollout_pct BETWEEN 0 AND 100),
  cohort_rule  JSONB,
  description  TEXT,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by   TEXT
);

-- Audit trail — immutable log of every flag mutation.
CREATE TABLE IF NOT EXISTS feature_flag_audit (
  id          BIGSERIAL   PRIMARY KEY,
  name        TEXT        NOT NULL,
  before      JSONB,
  after       JSONB,
  actor       TEXT,
  reason      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_flag_audit_name    ON feature_flag_audit (name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_flag_audit_created ON feature_flag_audit (created_at DESC);

-- Seed the flags we use on day 1. Kill-switches default to their
-- "everything-works" state (ON) — the switch exists for an emergency
-- operator flip, NOT as a gate that silently breaks the product in
-- fresh installs. A flag seeded OFF that nobody remembers to flip is
-- exactly how we got "ai_chat_disabled" bleeding to users in prod.
-- ON CONFLICT DO NOTHING keeps production state intact on re-run;
-- to migrate an existing prod DB that was seeded OFF under the old
-- policy, see server/db/migrations/20260419_enable_core_features.sql.
INSERT INTO feature_flags (name, enabled, rollout_pct, description)
VALUES
  ('ai_chat_enabled', TRUE, 100,
   'Kill switch for /api/search/chat. Default ON — flip OFF only to take Particle AI offline.'),
  ('vault_enabled',   TRUE, 100,
   'Kill switch for vault upload + RAG surfaces. Default ON.'),
  ('support_chat_enabled', FALSE, 0,
   'W6.7 — show the Crisp in-app support widget. Default OFF so the SDK never loads pre-consent.')
ON CONFLICT (name) DO NOTHING;

-- ── AI chat conversations (P5: DB-backed sidebar, cross-device) ─────────────
-- One row per AI conversation; messages live in ai_messages. Retention is
-- 24h enforced both by the listing API's WHERE clause and (eventually) by
-- a daily cron that DELETEs expired rows.
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
