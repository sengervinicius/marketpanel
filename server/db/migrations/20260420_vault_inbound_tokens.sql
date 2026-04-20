-- 20260420_vault_inbound_tokens.sql
-- ─────────────────────────────────────────────────────────────────────
-- P4 — per-user inbound email address.
--
-- Each user gets a unique, revocable token that becomes part of their
-- personal inbound address: `vault-<token>@the-particle.com`. Mail sent
-- to that address has its attachments (and body, when attachments are
-- absent) ingested into the user's PRIVATE vault (vault_documents.
-- is_global = FALSE). Contrast with the admin address `vault@...` which
-- ingests to the GLOBAL/central vault.
--
-- A separate table — rather than a column on users — was chosen so:
--   (a) rotation preserves history (old row becomes revoked_at, new row
--       is active). This gives us an audit trail if a leaked token is
--       ever used to attempt ingestion after rotation.
--   (b) the active-lookup path is an indexed exact-match on a PK,
--       independent of the users table.
--   (c) revocation can flip a single row without touching users.
--
-- Uniqueness: each user may have at most ONE active token at a time,
-- enforced by a partial unique index on (user_id) where revoked_at IS
-- NULL. Historical revoked rows are kept indefinitely so collisions on
-- a previously-used token are detectable.
--
-- The token is a 24-char base64url string (18 random bytes). Collision
-- probability is negligible within our expected population (≤ 10^4
-- users vs. 6.3×10^32 token space), but we still TRIGGER a retry at
-- the insert level if PK collision occurs — see services/inboundTokens.js.
-- ─────────────────────────────────────────────────────────────────────

BEGIN;

CREATE TABLE IF NOT EXISTS vault_inbound_tokens (
  token         TEXT PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at    BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT,
  last_used_at  BIGINT,
  revoked_at    BIGINT
);

-- One active token per user at most. Partial index — revoked rows are
-- ignored for uniqueness so they can accumulate without limit.
CREATE UNIQUE INDEX IF NOT EXISTS idx_vault_inbound_tokens_user_active
  ON vault_inbound_tokens(user_id)
  WHERE revoked_at IS NULL;

-- Supports `SELECT ... WHERE user_id = $1 ORDER BY created_at DESC`
-- for the Settings "recent rotations" view.
CREATE INDEX IF NOT EXISTS idx_vault_inbound_tokens_user_history
  ON vault_inbound_tokens(user_id, created_at DESC);

COMMIT;
