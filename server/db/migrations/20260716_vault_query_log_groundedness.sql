-- Audit §6 remainder — citation groundedness post-check for the Vault page
-- ask-all answer. Stores { citationsValid, citationsTotal } computed after
-- streaming completes, attached to the vault_query_log row retrieve() wrote.
ALTER TABLE vault_query_log ADD COLUMN IF NOT EXISTS groundedness JSONB;
