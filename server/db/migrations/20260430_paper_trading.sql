-- R1.3 — Paper trading.
--
-- Hypothetical portfolios that turn the watchlist → "what if I had bought
-- this?" → P&L pipeline. Pure simulation; no broker connection, no real
-- money, no order routing. Three additive tables, gated end-to-end behind
-- the PAPER_TRADING_V1 feature flag.
--
-- Broker-lock invariant
-- =====================
-- The whole point of the `is_paper` column on every table is that this
-- data NEVER touches a real broker. We do NOT wire anything to Plaid,
-- Apex, or any execution venue from these tables. The SQL CHECK
-- constraint enforces this at the DB layer:
--
--   CHECK (is_paper = TRUE)
--
-- If a future feature needs broker-backed trading, it MUST live in a
-- separate set of tables (live_portfolios / live_positions / live_fills)
-- with its own auditing, idempotency, and reconciliation. Paper-trading
-- routes (server/routes/paperTrading.js) read/write these three tables
-- only and refuse to mix.
--
-- Retention
-- =========
-- Portfolios and their positions are user-owned and retained until the
-- user (or admin reset endpoint) deletes them. Fills are append-only and
-- intended as the audit trail for P&L; we keep them for 5 years per the
-- LGPD baseline (well within retention bounds for non-PII trade ledgers).

CREATE TABLE IF NOT EXISTS paper_portfolios (
  id            BIGSERIAL    PRIMARY KEY,
  user_id       INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          TEXT         NOT NULL,
  base_ccy      CHAR(3)      NOT NULL DEFAULT 'USD',
  cash_balance  NUMERIC(18,4) NOT NULL DEFAULT 0,
  -- Initial cash deposit, captured for return-vs-deposit calculations
  -- (TWR / IRR are out of scope for V1; we keep this field so V2 can
  -- compute money-weighted returns without a back-fill).
  initial_cash  NUMERIC(18,4) NOT NULL DEFAULT 0,
  is_paper      BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT paper_portfolios_paper_only CHECK (is_paper = TRUE),
  CONSTRAINT paper_portfolios_cash_finite CHECK (cash_balance = cash_balance), -- rejects NaN
  CONSTRAINT paper_portfolios_initial_cash_nonneg CHECK (initial_cash >= 0)
);

-- Most reads are "all of this user's portfolios newest-first".
CREATE INDEX IF NOT EXISTS idx_paper_portfolios_user
  ON paper_portfolios (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS paper_positions (
  id              BIGSERIAL    PRIMARY KEY,
  portfolio_id    BIGINT       NOT NULL REFERENCES paper_portfolios(id) ON DELETE CASCADE,
  symbol          TEXT         NOT NULL,
  -- Net signed quantity. Positive = long, negative = short. Closed
  -- positions are kept with quantity = 0 so the realized P&L row chain
  -- stays intact for audit; UI filters them out by default.
  quantity        NUMERIC(20,6) NOT NULL DEFAULT 0,
  -- Volume-weighted average cost basis in the portfolio's base ccy.
  -- Recalculated on every fill in services/paperTrading/positions.js
  -- using the standard moving-average method.
  avg_cost        NUMERIC(18,6) NOT NULL DEFAULT 0,
  -- Realized P&L accumulated across all closed/reduced trades on this
  -- symbol in this portfolio. Unrealized P&L is computed on read by
  -- looking up the latest quote (lookup_quote tool).
  realized_pnl    NUMERIC(18,4) NOT NULL DEFAULT 0,
  is_paper        BOOLEAN      NOT NULL DEFAULT TRUE,
  opened_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT paper_positions_paper_only CHECK (is_paper = TRUE),
  CONSTRAINT paper_positions_qty_finite CHECK (quantity = quantity),
  CONSTRAINT paper_positions_cost_finite CHECK (avg_cost = avg_cost),
  CONSTRAINT paper_positions_pnl_finite CHECK (realized_pnl = realized_pnl),
  -- One row per (portfolio, symbol) — accumulating, not journal style.
  UNIQUE (portfolio_id, symbol)
);

CREATE INDEX IF NOT EXISTS idx_paper_positions_portfolio
  ON paper_positions (portfolio_id);

CREATE TABLE IF NOT EXISTS paper_fills (
  id              BIGSERIAL    PRIMARY KEY,
  portfolio_id    BIGINT       NOT NULL REFERENCES paper_portfolios(id) ON DELETE CASCADE,
  symbol          TEXT         NOT NULL,
  -- 'BUY' or 'SELL'. We store the raw side so SHORT-COVER and SHORT-OPEN
  -- can be inferred from quantity sign + position state at the time of
  -- the fill (services/paperTrading/fills.js does this).
  side            TEXT         NOT NULL CHECK (side IN ('BUY','SELL')),
  -- Always positive; the side column carries the sign.
  quantity        NUMERIC(20,6) NOT NULL CHECK (quantity > 0),
  -- Fill price in the portfolio's base ccy. Sourced from lookup_quote
  -- at the time the user submits the trade (no slippage model in V1).
  price           NUMERIC(18,6) NOT NULL CHECK (price > 0),
  -- Optional: per-trade commission, default 0. Provides a hook for
  -- experimentation later (e.g. modeling B3 emolumentos for BR users)
  -- without another schema change.
  commission      NUMERIC(18,4) NOT NULL DEFAULT 0 CHECK (commission >= 0),
  -- Realized P&L attributable to THIS fill specifically. Useful for
  -- per-trade tear-sheets later (R1.5).
  realized_pnl    NUMERIC(18,4) NOT NULL DEFAULT 0,
  is_paper        BOOLEAN      NOT NULL DEFAULT TRUE,
  filled_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT paper_fills_paper_only CHECK (is_paper = TRUE)
);

CREATE INDEX IF NOT EXISTS idx_paper_fills_portfolio_recent
  ON paper_fills (portfolio_id, filled_at DESC);

CREATE INDEX IF NOT EXISTS idx_paper_fills_symbol
  ON paper_fills (portfolio_id, symbol, filled_at DESC);
