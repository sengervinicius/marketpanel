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
