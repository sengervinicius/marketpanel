-- ─────────────────────────────────────────────────────────────────────
-- Wave 1 / WS1 — Coverage Matrix
-- Replaces the hardcoded provider routing table in
-- server/config/providerMatrix.js with a database-driven coverage
-- declaration that the router queries at request time and that CI
-- verifies every night via canonical probes.
--
-- Apply order:
--   1. This migration creates tables + indexes.
--   2. Server boot syncs adapter CoverageDeclaration rows into
--      coverage_matrix (inserts-or-updates keyed on (adapter, market,
--      asset_class, capability)).
--   3. The nightly quality harness writes to coverage_probes and
--      updates last_verified_at / last_result / confidence on
--      coverage_matrix.
--
-- Safe to run multiple times (IF NOT EXISTS throughout).
-- ─────────────────────────────────────────────────────────────────────

BEGIN;

-- ── Enum types ────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE coverage_confidence AS ENUM ('high', 'medium', 'low', 'unverified');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE coverage_probe_result AS ENUM ('ok', 'error', 'timeout', 'sla_miss', 'schema_mismatch');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Main matrix table ────────────────────────────────────────────────
-- Every (adapter, market, asset_class, capability) cell is a row. The
-- router enumerates rows for a target (market, asset_class, capability)
-- ordered by confidence DESC, last_verified_at DESC, latency_p95_ms ASC
-- to build the adapter chain for dispatch.

CREATE TABLE IF NOT EXISTS coverage_matrix (
  id                BIGSERIAL PRIMARY KEY,
  adapter           TEXT NOT NULL,
  adapter_version   TEXT NOT NULL,
  market            TEXT NOT NULL,       -- e.g. 'US', 'B3', 'KRX', 'TSE', 'HKEX', 'EU', 'GLOBAL'
  asset_class       TEXT NOT NULL,       -- e.g. 'equity', 'curve', 'options', 'fx', 'crypto', 'news', 'calendar'
  capability        TEXT NOT NULL,       -- e.g. 'quote', 'candles', 'curve', 'chain', 'news', 'calendar', 'fundamentals'
  confidence        coverage_confidence NOT NULL DEFAULT 'unverified',
  declared_confidence coverage_confidence NOT NULL DEFAULT 'unverified',
  latency_p95_target_ms INTEGER NOT NULL CHECK (latency_p95_target_ms > 0),
  latency_p95_observed_ms INTEGER,
  freshness_sla_sec INTEGER NOT NULL CHECK (freshness_sla_sec >= 0),
  rate_limit_rps    INTEGER,
  requires_env_vars TEXT[] DEFAULT ARRAY[]::TEXT[],
  enabled           BOOLEAN NOT NULL DEFAULT TRUE,
  last_verified_at  TIMESTAMPTZ,
  last_result       coverage_probe_result,
  consecutive_greens INTEGER NOT NULL DEFAULT 0,
  consecutive_reds   INTEGER NOT NULL DEFAULT 0,
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (adapter, market, asset_class, capability)
);

CREATE INDEX IF NOT EXISTS ix_coverage_route
  ON coverage_matrix (market, asset_class, capability, confidence DESC, last_verified_at DESC)
  WHERE enabled = TRUE;

CREATE INDEX IF NOT EXISTS ix_coverage_adapter ON coverage_matrix (adapter);
CREATE INDEX IF NOT EXISTS ix_coverage_stale   ON coverage_matrix (last_verified_at)
  WHERE enabled = TRUE;

-- ── Probe audit trail ────────────────────────────────────────────────
-- Every nightly CI probe writes a row here. Long-retained for trend
-- analysis. last_verified_at on coverage_matrix is the latest row.

CREATE TABLE IF NOT EXISTS coverage_probes (
  id              BIGSERIAL PRIMARY KEY,
  matrix_id       BIGINT NOT NULL REFERENCES coverage_matrix(id) ON DELETE CASCADE,
  ran_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  result          coverage_probe_result NOT NULL,
  latency_ms      INTEGER,
  error_code      TEXT,
  error_message   TEXT,
  payload_hash    TEXT,
  probe_symbol    TEXT,
  probe_metadata  JSONB,
  ci_run_id       TEXT,
  ci_commit_sha   TEXT
);

CREATE INDEX IF NOT EXISTS ix_probes_matrix_time ON coverage_probes (matrix_id, ran_at DESC);
CREATE INDEX IF NOT EXISTS ix_probes_errors ON coverage_probes (result, ran_at DESC)
  WHERE result <> 'ok';

-- ── Trigger: auto-update updated_at ──────────────────────────────────
CREATE OR REPLACE FUNCTION coverage_matrix_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_coverage_matrix_touch ON coverage_matrix;
CREATE TRIGGER trg_coverage_matrix_touch
  BEFORE UPDATE ON coverage_matrix
  FOR EACH ROW EXECUTE FUNCTION coverage_matrix_touch_updated_at();

-- ── Initial seed from providerMatrix.js ──────────────────────────────
-- These rows reflect the current adapter state *as declared* — not
-- verified. The first nightly probe run will set confidence based on
-- real behavior and start tracking consecutive_greens. The
-- declared_confidence column preserves what the adapter originally
-- claimed vs. what CI has measured.
--
-- Existing-stack first: Finnhub + Twelvedata are pre-seeded as medium
-- confidence across Asia + Europe because we already pay for them and
-- the adapter wiring is the only gap. Q1 CI will flip them to high
-- after 14 consecutive greens.

INSERT INTO coverage_matrix
  (adapter, adapter_version, market, asset_class, capability,
   declared_confidence, confidence, latency_p95_target_ms, freshness_sla_sec, requires_env_vars, notes)
VALUES
  -- Polygon — US equities, forex, crypto (golden path in Wave 1)
  ('polygon', '1.0.0', 'US',     'equity', 'quote',   'high',   'unverified', 900, 60, ARRAY['POLYGON_API_KEY'], 'Golden path adapter, Wave 1 reference'),
  ('polygon', '1.0.0', 'US',     'equity', 'candles', 'high',   'unverified', 1500, 86400, ARRAY['POLYGON_API_KEY'], NULL),
  ('polygon', '1.0.0', 'US',     'equity', 'news',    'medium', 'unverified', 2000, 900, ARRAY['POLYGON_API_KEY'], NULL),
  ('polygon', '1.0.0', 'FX',     'fx',     'quote',   'high',   'unverified', 800, 30, ARRAY['POLYGON_API_KEY'], NULL),
  ('polygon', '1.0.0', 'CRYPTO', 'crypto', 'quote',   'high',   'unverified', 800, 30, ARRAY['POLYGON_API_KEY'], NULL),
  ('polygon', '1.0.0', 'US',     'options','chain',   'high',   'unverified', 1800, 60, ARRAY['POLYGON_API_KEY'], NULL),

  -- Finnhub — global quotes + macro calendar (unlocks Asia + EU on existing spend)
  ('finnhub', '1.0.0', 'US',     'equity', 'quote',   'high',   'unverified', 1200, 60, ARRAY['FINNHUB_API_KEY'], 'Cross-source for US'),
  ('finnhub', '1.0.0', 'KRX',    'equity', 'quote',   'medium', 'unverified', 1500, 900, ARRAY['FINNHUB_API_KEY'], 'Existing-stack Asian coverage, validate in Q1'),
  ('finnhub', '1.0.0', 'TSE',    'equity', 'quote',   'medium', 'unverified', 1500, 900, ARRAY['FINNHUB_API_KEY'], 'Existing-stack Asian coverage, validate in Q1'),
  ('finnhub', '1.0.0', 'HKEX',   'equity', 'quote',   'medium', 'unverified', 1500, 900, ARRAY['FINNHUB_API_KEY'], 'Existing-stack Asian coverage, validate in Q1'),
  ('finnhub', '1.0.0', 'B3',     'equity', 'quote',   'medium', 'unverified', 1500, 900, ARRAY['FINNHUB_API_KEY'], 'Existing-stack Brazil coverage'),
  ('finnhub', '1.0.0', 'EU',     'equity', 'quote',   'medium', 'unverified', 1500, 900, ARRAY['FINNHUB_API_KEY'], 'Existing-stack EU coverage, validate in Q1'),
  ('finnhub', '1.0.0', 'GLOBAL', 'calendar','calendar','high', 'unverified', 2000, 3600, ARRAY['FINNHUB_API_KEY'], 'Macro calendar — primary feed'),
  ('finnhub', '1.0.0', 'GLOBAL', 'news',   'news',    'medium', 'unverified', 2000, 900, ARRAY['FINNHUB_API_KEY'], NULL),

  -- Twelvedata — global cross-source
  ('twelvedata', '1.0.0', 'KRX',  'equity', 'quote',   'medium', 'unverified', 1500, 900, ARRAY['TWELVEDATA_API_KEY'], 'Cross-source for Asia'),
  ('twelvedata', '1.0.0', 'TSE',  'equity', 'quote',   'medium', 'unverified', 1500, 900, ARRAY['TWELVEDATA_API_KEY'], 'Cross-source for Asia'),
  ('twelvedata', '1.0.0', 'HKEX', 'equity', 'quote',   'medium', 'unverified', 1500, 900, ARRAY['TWELVEDATA_API_KEY'], 'Cross-source for Asia'),
  ('twelvedata', '1.0.0', 'B3',   'equity', 'quote',   'medium', 'unverified', 1500, 900, ARRAY['TWELVEDATA_API_KEY'], 'Cross-source for Brazil'),
  ('twelvedata', '1.0.0', 'EU',   'equity', 'quote',   'medium', 'unverified', 1500, 900, ARRAY['TWELVEDATA_API_KEY'], 'Cross-source for EU'),
  ('twelvedata', '1.0.0', 'US',   'equity', 'fundamentals','medium','unverified', 2000, 86400, ARRAY['TWELVEDATA_API_KEY'], 'Tri-source fundamentals'),
  ('twelvedata', '1.0.0', 'EU',   'equity', 'fundamentals','medium','unverified', 2000, 86400, ARRAY['TWELVEDATA_API_KEY'], 'Tri-source fundamentals'),
  ('twelvedata', '1.0.0', 'B3',   'equity', 'fundamentals','medium','unverified', 2000, 86400, ARRAY['TWELVEDATA_API_KEY'], 'Tri-source fundamentals'),

  -- Eulerpool — European fundamentals
  ('eulerpool', '1.0.0', 'EU', 'equity', 'fundamentals', 'high', 'unverified', 2500, 86400, ARRAY['EULERPOOL_API_KEY'], 'Primary EU fundamentals'),

  -- ECB SDMX — European sovereign curves (free public data)
  ('ecb_sdmx', '1.0.0', 'EU', 'curve', 'curve', 'high', 'unverified', 3000, 86400, ARRAY[]::TEXT[], 'Free public data, zero cost'),

  -- FRED — US + international macro series
  ('fred', '1.0.0', 'US',     'macro', 'series',   'high',   'unverified', 1500, 86400, ARRAY['FRED_API_KEY'], 'US macro series'),
  ('fred', '1.0.0', 'GLOBAL', 'macro', 'series',   'medium', 'unverified', 1500, 86400, ARRAY['FRED_API_KEY'], 'International series via FRED'),
  ('fred', '1.0.0', 'US',     'curve', 'curve',    'high',   'unverified', 1500, 86400, ARRAY['FRED_API_KEY'], 'Treasury curve'),

  -- Unusual Whales — US options flow + Congress + dark pool (under-exploited)
  ('unusual_whales', '1.0.0', 'US', 'options', 'flow',    'high', 'unverified', 2000, 300, ARRAY['UW_API_KEY'], 'WS13 — promote to first-class'),
  ('unusual_whales', '1.0.0', 'US', 'political','trades', 'high', 'unverified', 2000, 3600, ARRAY['UW_API_KEY'], 'WS13 — Congress trades surface'),
  ('unusual_whales', '1.0.0', 'US', 'dark_pool','prints', 'high', 'unverified', 2000, 300, ARRAY['UW_API_KEY'], 'WS13 — dark-pool surface'),

  -- Perplexity Sonar — cited research / news synthesis
  ('sonar', '1.0.0', 'GLOBAL', 'research', 'cited_answer', 'high', 'unverified', 6000, 300, ARRAY['PERPLEXITY_API_KEY'], 'WS13 — promote to cited research surface')

ON CONFLICT (adapter, market, asset_class, capability) DO UPDATE SET
  declared_confidence = EXCLUDED.declared_confidence,
  latency_p95_target_ms = EXCLUDED.latency_p95_target_ms,
  freshness_sla_sec = EXCLUDED.freshness_sla_sec,
  requires_env_vars = EXCLUDED.requires_env_vars,
  notes = EXCLUDED.notes,
  updated_at = NOW();

COMMIT;

-- ── Rollback (manual) ────────────────────────────────────────────────
-- DROP TABLE coverage_probes;
-- DROP TABLE coverage_matrix;
-- DROP FUNCTION coverage_matrix_touch_updated_at();
-- DROP TYPE coverage_probe_result;
-- DROP TYPE coverage_confidence;
