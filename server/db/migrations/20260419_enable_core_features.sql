-- 20260419_enable_core_features.sql
-- ─────────────────────────────────────────────────────────────────────
-- Fix: production users were getting raw `ai_chat_disabled` 503 JSON
-- surfaced into Particle when they asked a question.
--
-- Root cause: the `ai_chat_enabled` and `vault_enabled` feature flags
-- were seeded with enabled=FALSE under the W6.1 "operations owns the
-- first explicit turn-on" policy. That policy silently broke the two
-- headline features of the product for every fresh install and every
-- production DB that was initialised before someone manually flipped
-- the flags. The flag primitive is still the correct emergency lever,
-- but the DEFAULT STATE must be "everything works".
--
-- This migration is idempotent — it only raises rows from OFF to ON.
-- If an operator has intentionally flipped a flag OFF (e.g. to
-- handle a live incident), leave that flip in place by scoping the
-- UPDATE to `enabled = FALSE` AND `rollout_pct < 100` only when we
-- can recognise the "pristine default" shape. We use a narrow match
-- on (enabled=FALSE AND rollout_pct=0) which is exactly what the old
-- seed produced. Any hand-edit that differs from that shape is left
-- untouched.
-- ─────────────────────────────────────────────────────────────────────

BEGIN;

-- Upgrade the two core-feature kill switches if they're still in the
-- pristine default-OFF shape the old seed produced.
UPDATE feature_flags
   SET enabled       = TRUE,
       rollout_pct   = 100,
       description   = 'Kill switch for /api/search/chat. Default ON — flip OFF only to take Particle AI offline.',
       updated_at    = NOW()
 WHERE name          = 'ai_chat_enabled'
   AND enabled       = FALSE
   AND rollout_pct   = 0;

UPDATE feature_flags
   SET enabled       = TRUE,
       rollout_pct   = 100,
       description   = 'Kill switch for vault upload + RAG surfaces. Default ON.',
       updated_at    = NOW()
 WHERE name          = 'vault_enabled'
   AND enabled       = FALSE
   AND rollout_pct   = 0;

-- Leave support_chat_enabled OFF by default — the Crisp SDK must not
-- load pre-consent.

COMMIT;
