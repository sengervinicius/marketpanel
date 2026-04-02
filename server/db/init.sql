-- db/init.sql — Phase 21 Postgres schema.
-- Designed for JSONB-heavy storage to minimise rewrite cost.
-- Tables are CREATE IF NOT EXISTS so this is idempotent.

-- ── Users ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id                      SERIAL PRIMARY KEY,
  username                TEXT UNIQUE NOT NULL,
  email                   TEXT UNIQUE,
  hash                    TEXT NOT NULL,
  apple_user_id           TEXT UNIQUE,
  settings                JSONB NOT NULL DEFAULT '{}',
  is_paid                 BOOLEAN NOT NULL DEFAULT FALSE,
  subscription_active     BOOLEAN NOT NULL DEFAULT TRUE,
  trial_ends_at           BIGINT,
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
  user_id     INTEGER PRIMARY KEY,
  version     INTEGER NOT NULL DEFAULT 1,
  portfolios  JSONB NOT NULL DEFAULT '[]',
  positions   JSONB NOT NULL DEFAULT '[]',
  updated_at  TEXT,
  created_at  TEXT
);

-- ── Alerts (one row per alert) ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS alerts (
  id                      TEXT NOT NULL,
  user_id                 INTEGER NOT NULL,
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
