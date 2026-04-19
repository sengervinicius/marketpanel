# Runbook — Stripe billing / price ID remediation

_Status: Wave F&F_
_Owner: Platform + Finance_
_Applies to: `server/billing.js`, `server/config/tiers.js`, Render env vars_

## Why this exists

Stripe checkout silently breaks when the server's `STRIPE_<TIER>_<PLAN>` env
vars point at a price that doesn't exist in the connected Stripe account.
Causes we've seen:

- **Mode mismatch** — a `price_…` was created in test mode and the server
  is running with a live `sk_live_…` key (or vice versa). Stripe isolates
  the two; you'll get `No such price: 'price_xxx'` even though the ID looks
  valid.
- **Archived price** — someone archived the price in the Stripe dashboard.
  Checkout returns a cryptic error and users can't subscribe.
- **Wrong account** — the ID was copy-pasted from a different Stripe org
  (e.g. Algotex test → Algotex live was never re-created).

Users see a checkout error, bounce, and don't complain — we lose F&F signups.
This runbook is the 5-minute fix.

## Detection

Two places surface this:

1. **Boot log** — on every server start, `validateStripePriceIds()` runs
   against every configured `STRIPE_*` price env var. Broken IDs appear as:

   ```
   [ERROR] [billing] Stripe price for STRIPE_NEW_PARTICLE_MONTHLY is INVALID
   (id=price_1TL58y20rDfXqR17vuUV1Tgc): No such price: ... Likely causes:
   mode mismatch (key is live-mode), archived price, or wrong account.
   ```

   Grafana / Sentry should alert on these lines (they include `keyMode` so
   you can tell test-vs-live at a glance).

2. **Per-request pre-flight** — every `createCheckoutSession()` re-verifies
   the price before creating a Stripe session. If it fails, the user sees a
   friendly "Checkout is temporarily unavailable" message and the server
   logs an ERROR with the offending env var name. _No orphan Stripe
   customer session is created._

## Fix — the 5-minute path

### 0. Preconditions

- Access to the Stripe dashboard for the **Algotex live** account.
- Access to Render → `senger-market-server` → Environment.
- Someone on-call can trigger a redeploy if hot-swap of env vars is
  disabled (Render usually does a zero-downtime restart on env change).

### 1. Check which env var is broken

Grep the server logs for `is INVALID` or `is ARCHIVED`. The log line names
the exact env var, e.g. `STRIPE_NEW_PARTICLE_MONTHLY`. That's the only one
you need to touch; the other five tier/plan combos may be fine.

### 2. Confirm the Stripe account mode

In the Stripe dashboard, look at the toggle at the top-left. You need to be
in the same mode as the server's key:

- Render key starts with `sk_live_…` → **Live mode** in dashboard
- Render key starts with `sk_test_…` → **Test mode** in dashboard

If the modes don't match, you've found the bug. Either (a) create the
prices in the right mode, or (b) flip the server's key — but (a) is the
answer for production.

### 3. Verify or recreate the price

Stripe Dashboard → Products → find or create the Particle product, then:

- **If the price exists and is active in the correct mode**: copy the
  `price_…` ID from the dashboard. Paste it into the corresponding Render
  env var.
- **If the price is archived**: unarchive it (Dashboard → Products → Price
  → ⋯ menu → Unarchive). No code change needed.
- **If the price doesn't exist** (e.g. first time setting up live mode):
  create it with the canonical amount/interval from
  `server/config/tiers.js`:

  | Env var | Amount | Interval |
  |---------|--------|----------|
  | `STRIPE_NEW_PARTICLE_MONTHLY` | $29.00 USD | monthly |
  | `STRIPE_NEW_PARTICLE_ANNUAL` | $290.00 USD | yearly |
  | `STRIPE_DARK_PARTICLE_MONTHLY` | $79.00 USD | monthly |
  | `STRIPE_DARK_PARTICLE_ANNUAL` | $790.00 USD | yearly |
  | `STRIPE_NUCLEAR_PARTICLE_MONTHLY` | $199.00 USD | monthly |
  | `STRIPE_NUCLEAR_PARTICLE_ANNUAL` | $1,990.00 USD | yearly |

  Copy the resulting `price_…` ID.

### 4. Update Render

Render → `senger-market-server` → Environment → edit the env var → paste
the new price ID → Save. Render restarts the service.

### 5. Verify the fix

Watch the boot log. You should see:

```
[INFO] [billing] Stripe price validator running in live mode
[INFO] [billing] All 6 configured Stripe price IDs validated against live-mode account
```

Then smoke-test: open an incognito window, log in with a test account,
click Subscribe on the broken tier/plan, confirm checkout opens cleanly.
Cancel out of the Stripe page — no real charge needed.

## Verifying locally before you push to Render

You can dry-run the validator against a live key without deploying:

```bash
cd server
STRIPE_SECRET_KEY=sk_live_xxx \
STRIPE_NEW_PARTICLE_MONTHLY=price_xxx \
STRIPE_NEW_PARTICLE_ANNUAL=price_yyy \
... \
node -e "require('./billing').validateStripePriceIds().then(r => console.log(r))"
```

Output is a JSON object: `{ validated, errors, mode }`. Zero errors and
`mode: 'live'` means you're good.

## Known gotchas

- **Recurring vs one-time**: all Particle prices must be `recurring`. A
  one-time price will pass validation but break the subscription webhook
  flow. Double-check the Price type when creating.
- **Currency mismatch**: all prices should be `usd`. If you create a BRL
  price, checkout succeeds but downstream audit logs get messy.
- **Stripe Test Clocks**: if you're testing annual renewal, use a Test
  Clock — don't wait a year.
- **Don't delete the old archived price**: Stripe history links still
  reference it, and past invoices stop rendering cleanly.

## Escalation

- If boot shows validator errors and the Render env vars look correct,
  suspect the `STRIPE_SECRET_KEY` is from a different account — verify
  with `stripe.accounts.retrieve()`.
- If checkout still fails after env var + redeploy, check Stripe → Events
  for the exact failure and page `#platform` with the event ID.
- If multiple tiers break at once, default to: the live-mode prices were
  wiped/regenerated, and the server is still pointing at the old IDs.
  Regenerate all six, paste all six into Render.

## Prevention

- When setting up a **new Stripe account or mode**, run the validator
  locally against the key before pushing anything to Render:
  `node -e "require('./billing').validateStripePriceIds()"`.
- Keep a copy of the live-mode price IDs in the password manager entry
  **Stripe Particle prices** so the remediation doesn't block on dashboard
  spelunking.
- Every quarter, verify all six IDs are still active. The boot-time
  validator catches this automatically, but it's worth a manual look.
