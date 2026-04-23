-- 20260422_light_theme_flag.sql
-- ─────────────────────────────────────────────────────────────────────
-- #239 P1.5 — Feature-flag off the light-theme toggle (D2.4).
--
-- Why this exists:
--   ThemeContext.jsx already writes data-theme="light" and applies a
--   complete set of light CSS custom properties at document.documentElement
--   level. That half-works: any component styled exclusively through the
--   design tokens (--bg-app, --text-primary, etc.) re-skins cleanly, but
--   a long tail of component CSS files still hardcodes dark colours
--   (#0a0a0a, #141414, #F97316) that don't reference the tokens. There
--   are also zero [data-theme="light"] selectors anywhere in the client
--   CSS to paper over those hardcoded colours.
--
--   The net effect in prod today: if a user clicks the sun/moon toggle
--   in the header, the global background flips but ~40% of panels remain
--   dark, producing an unreadable half-state that looks broken to a CIO
--   evaluating the terminal for the first time.
--
-- What this migration does:
--   Insert (or idempotently upsert) a feature_flags row `light_theme_enabled`
--   defaulting to OFF (enabled=FALSE, rollout_pct=0). The client Header
--   gate will hide the toggle button whenever this flag is OFF; the
--   command-palette 'toggle-theme' action will no-op.
--
--   This is a surgical kill switch — not a removal. When the CSS audit
--   completes and every panel has proper [data-theme="light"] overrides
--   (or tokenised fully), an operator flips the flag via /admin/flags and
--   the toggle reappears without a deploy.
--
-- Rollout:
--   - OFF by default (enabled=FALSE).
--   - Operators who have previously hand-edited this row (updated_by IS
--     NOT NULL) are respected — this migration is a no-op for them.
--
-- Safe to re-run: idempotent on the name.
-- ─────────────────────────────────────────────────────────────────────

BEGIN;

INSERT INTO feature_flags (name, enabled, rollout_pct, description, updated_at, updated_by)
VALUES (
  'light_theme_enabled',
  FALSE,
  0,
  'Gate for the header light/dark theme toggle. OFF until per-component [data-theme="light"] CSS ships (P1.5 / D2.4). Clients hide the toggle when OFF.',
  NOW(),
  NULL
)
ON CONFLICT (name) DO UPDATE
  SET description = COALESCE(feature_flags.description,
                            'Gate for the header light/dark theme toggle. OFF until per-component [data-theme="light"] CSS ships (P1.5 / D2.4). Clients hide the toggle when OFF.'),
      updated_at  = NOW()
  WHERE feature_flags.updated_by IS NULL;

COMMIT;
