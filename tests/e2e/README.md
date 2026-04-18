# Particle e2e test suite

These are **smoke-level** Playwright tests. They're designed to be
fast and deterministic enough to run on every PR without flakiness.

## What we cover today

| Spec | Flow |
|---|---|
| `smoke.spec.js` | Public pages render: landing, `/legal/terms`, `/legal/privacy`. |
| `auth.spec.js` | Signup → email verification stub → login → logout. |
| `chat.spec.js` | Logged-in user opens chat, sends a trivial prompt, receives a response with AI disclaimer. Skipped if `ai_chat_enabled` flag is off. |
| `billing.spec.js` | Free-tier user opens the upgrade modal, cancels (no actual Stripe charge). |
| `flags.spec.js` | Verifies the `/api/flags` endpoint responds and at least one known flag is present. |

## What we deliberately do NOT cover

- Stripe charge paths (use Stripe's test mode separately).
- Actual LLM invocation (stub the response).
- Market-data WebSocket (flaky in CI; covered by unit tests).

## Running locally

```bash
# One-time
npm install
npm run test:e2e:install

# Need a running stack:
npm run dev    # in one terminal

# Then
npm run test:e2e
```

## CI

GitHub Actions workflow `.github/workflows/e2e.yml` boots both the
server and the client, waits for `/healthz`, and runs the full suite.

## Flag-gated tests

Tests that depend on a feature flag check `/api/flags` first and `.skip()`
themselves if the flag is off. This keeps the suite green when an admin
kills a feature for legitimate operational reasons.
