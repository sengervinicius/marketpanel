-- 20260420_force_core_features_on.sql
-- ─────────────────────────────────────────────────────────────────────
-- Follow-up to 20260419_enable_core_features.sql.
--
-- Why this exists:
--   The 20260419 migration flipped ai_chat_enabled + vault_enabled to
--   (enabled=TRUE, rollout_pct=100) only when the row was in the exact
--   pristine (enabled=FALSE AND rollout_pct=0) shape. In production we
--   still see /api/search/chat returning 503 ai_chat_disabled, which
--   means the prod row was in a different shape — most likely a half-
--   flip (enabled=TRUE with rollout_pct=0, which produces OFF for any
--   anonymous or unbucketed user), or enabled=FALSE with a non-zero
--   rollout_pct, or the flag row was already edited by a prior admin
--   action that left updated_by=NULL.
--
--   Evaluating isOn() for an anonymous /chat request with rollout_pct<100
--   returns false (we can't bucket a null userId), so ANY non-100 pct
--   with enabled=TRUE still yields OFF for the friendly-family + unauth
--   traffic we care about right now.
--
-- What this migration does:
--   For the two core kill switches, force (enabled=TRUE, rollout_pct=100)
--   but ONLY when updated_by IS NULL. A non-null updated_by is the
--   fingerprint of an operator who has explicitly touched this flag via
--   the admin API (services/featureFlags.js `upsert` sets it); we respect
--   that choice unconditionally.
--
--   If the row doesn't exist at all, insert it fully-on.
--
--   Safe to re-run: idempotent. Matches nothing if an operator has since
--   set updated_by.
--
-- Rollback:
--   Operators can still flip OFF via the admin panel — that sets
--   updated_by and makes this migration a no-op on next boot.
-- ─────────────────────────────────────────────────────────────────────

BEGIN;

-- ai_chat_enabled — insert if missing, otherwise force ON when not
-- previously touched by an operator.
INSERT INTO feature_flags (name, enabled, rollout_pct, description, updated_at, updated_by)
VALUES (
  'ai_chat_enabled',
  TRUE,
  100,
  'Kill switch for /api/search/chat. Default ON — flip OFF only to take Particle AI offline.',
  NOW(),
  NULL
)
ON CONFLICT (name) DO UPDATE
  SET enabled       = TRUE,
      rollout_pct   = 100,
      description   = COALESCE(feature_flags.description,
                              'Kill switch for /api/search/chat. Default ON — flip OFF only to take Particle AI offline.'),
      updated_at    = NOW()
  WHERE feature_flags.updated_by IS NULL;

-- vault_enabled — same treatment.
INSERT INTO feature_flags (name, enabled, rollout_pct, description, updated_at, updated_by)
VALUES (
  'vault_enabled',
  TRUE,
  100,
  'Kill switch for vault upload + RAG surfaces. Default ON.',
  NOW(),
  NULL
)
ON CONFLICT (name) DO UPDATE
  SET enabled       = TRUE,
      rollout_pct   = 100,
      description   = COALESCE(feature_flags.description,
                              'Kill switch for vault upload + RAG surfaces. Default ON.'),
      updated_at    = NOW()
  WHERE feature_flags.updated_by IS NULL;

-- support_chat_enabled stays OFF by default (Crisp SDK must not load
-- pre-consent); no-op for this migration.

COMMIT;
