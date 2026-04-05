# State of Senger — Phase R Audit
**Date:** 2026-04-02
**Branch audited:** `feature/phase-13-leaderboards` (ab6392e) — includes all work through Phase 13
**Main HEAD:** `2f32309` (Phase 11) — Phases 12, 12a, 13 are on feature branches, NOT yet merged to main

---

## 1. High-Level Summary

**What Senger does well:**
The terminal has a solid multi-panel desktop layout (3 resizable rows, drag-reorderable), a functional mobile app with 5 tabs + submenu, real-time price streaming via Polygon WebSocket, and broad asset coverage (US equities, Brazil B3, FX, crypto, commodities, debt/yield curves, ETFs). The onboarding flow (template picker + persona selector + tour) is complete. The avatar system (11 3D chibi PNGs with glow ring animation) is polished. Portfolio management, alerts, and AI-powered search (Perplexity Sonar Pro) are all functional. The billing system (Stripe + Apple IAP) is wired. The workspace template system (17 templates, grouped) is clean and extensible.

**Biggest weaknesses:**
1. **Unmerged feature branches** — Phases 12/12a/13 sit on feature branches. Main is at Phase 11. This will cause merge conflicts if left too long.
2. **InstrumentDetail.jsx (1,914 lines)** — The single largest component, with 3 console.log placeholders (position editor, alert creator, sendToChat) that should have been wired in Phase 5.
3. **App.jsx (1,813 lines)** — Boot logic, panel routing, settings drawer, UserDropdown, DiscordLinkRow, mobile nav, and onboarding all in one file.
4. **Provider stubs** — bonds, funds, multiAsset, and some macro providers return mock/stub data. Not production-grade.
5. **No per-panel error boundaries** — A single panel crash takes down the entire desktop layout.
6. **No technical indicators on charts** — The `technicalindicators` library is imported in InstrumentDetail but NOT available in the main ChartPanel. No drawing tools exist anywhere.
7. **No sharing engine** — No WhatsApp/social image sharing, no portfolio summary cards, no viral mechanics.
8. **Gamification is display-only** — XP/level show in header and mobile, but there are no missions, quests, streaks, or achievement toasts.

---

## 2. By Area

### 2.1 Foundation & Correctness — DONE (with caveats)
- WebSocket stability: Polygon proxy works, reconnects, throttles ticks. Chat WS is functional but lacks binary message support and per-message ack (TODO in useWebSocket.js).
- Data accuracy: Yahoo Finance primary, Polygon/Finnhub/Alpha Vantage fallback. LRU cache (60s default). Stale-while-revalidate on rate limits.
- Yield curves: Phase 9 overhauled Brazil DI removal + sovereign curves. DebtPanel (512 lines) is solid.
- Alerts: Full CRUD + 45s evaluation scheduler. One-shot trigger (alert deactivates after firing).
- Auth: JWT 30-day expiry, Apple Sign In, Stripe billing, Apple IAP.
- **Gaps:** JWT_SECRET falls back to insecure placeholder if not set (logs error but doesn't crash). MongoDB falls back to in-memory silently. No refresh token rotation. No per-user rate limiting on expensive endpoints.

### 2.2 Trader Features — PARTIAL
- **Charts:** Candlestick via Recharts with SMA/EMA/RSI/MACD/Bollinger in InstrumentDetail ONLY. ChartPanel (desktop main chart) does NOT have these indicators. No drawing tools anywhere.
- **Screener:** Fundamental screener (POST /run) works. universes endpoint exists. UI is functional.
- **Macro:** Fed funds, unemployment, inflation, GDP, interest rates endpoints exist. MacroPanel renders them. Data comes from FRED/ECB/BCB.
- **Options:** NOT STARTED. No options chain, greeks, or strategy builder.
- **InstrumentDetail placeholders:** `openPositionEditor`, `openAlertCreator`, `sendToChat` are console.log stubs. These should wire to existing AlertEditor and PositionEditor components.
- **Gaps:** No technical indicators on desktop ChartPanel. No drawing tools. No options data. InstrumentDetail placeholders unwired since Phase 4.

### 2.3 UX & Visual Polish — PARTIAL
- **Desktop layout:** 3-row resizable grid works. Panels have consistent headers via EditablePanelHeader. WorkspaceSwitcher in header.
- **Mobile nav:** 5 tabs + More submenu. HomePanelMobile, ChartsPanelMobile, PortfolioMobile, AlertsMobile all functional.
- **Theme:** Dark/light toggle via ThemeContext. CSS custom properties throughout.
- **Typography:** Consistent font-ui/font-mono variables. Accent color (#ff6600) used everywhere.
- **Gaps:**
  - No per-panel error boundaries — single panel crash kills the whole layout.
  - `_getMarketState` import in App.jsx is unused (dead import).
  - CSS class `rp-row-change.live` in RatesPanel uses dot notation (should be BEM `--live`).
  - RatesPanel has `STATIC_CB_RATES` with hardcoded central bank rates (not fetched from API).
  - Some panels have inconsistent column header implementations (each defines its own).

### 2.4 Social & Gamification — PARTIAL
- **Personas:** 11 types, fully wired. PersonaSelector in onboarding. Backend PATCH /api/users/persona.
- **Avatars:** 11 3D chibi PNGs, glow ring, breathe animation, circular mask. Used in header, mobile, chat, leaderboard.
- **XP/Levels:** Backend: 5 event types (complete_onboarding: 50, open_instrument: 5, create_alert: 15, apply_workspace: 10, select_persona: 25). Frontend: "Lv X . Y XP" in header/mobile + slim progress bar on mobile.
- **Leaderboards:** Global (top 100), persona-specific (top 50), weekly (7-day return, top 50). Cron every 4h. LeaderboardPanel with segmented control, gold/silver/bronze ranks.
- **Discord:** OAuth2 link/unlink, auto guild-join if bot token set. Graceful degradation.
- **Gaps:**
  - No missions/quests/streaks/daily challenges.
  - No achievement badges or toast notifications for XP gain.
  - No social sharing (portfolio cards, performance summaries).
  - Leaderboard has no pagination or load-more.
  - Weekly competition has no prize or reward mechanic.
  - Chat is functional but "sendToChat" from InstrumentDetail is a stub.

### 2.5 Sharing & Growth — NOT STARTED
- No WhatsApp/social image sharing.
- No portfolio summary card generation.
- No waitlist/referral/viral mechanics.
- No OG image or link preview generation.
- No "share my performance" feature.

---

## 3. Must-Fix Before Building More

1. **Merge feature branches to main.** Phases 12, 12a, 13 are diverged. The longer this waits, the worse merge conflicts get.
2. **Wire InstrumentDetail placeholders.** `openPositionEditor` and `openAlertCreator` should open the existing AlertEditor/PositionEditor modals. `sendToChat` should open ChatPanel with a pre-filled message. These are 3 console.log stubs that have been there since Phase 4.
3. **Remove dead import** in App.jsx: `_getMarketState`.
4. **Add per-panel error boundaries** so a single panel crash doesn't take down the entire layout. Wrap each panel in renderPanel with a lightweight ErrorBoundary component.
5. **Fix CSS class** `rp-row-change.live` in RatesPanel to proper BEM naming.

---

## 4. Ordered Phase Roadmap

### Phase 14 — Merge, Cleanup & Error Boundaries
**GOAL:** Unblock future development by merging all feature branches, fixing dead code, and adding resilience.
**SCOPE:**
- Merge Phase 12 + 12a + 13 branches into main (resolve conflicts).
- Wire InstrumentDetail 3 placeholder functions to real components.
- Add per-panel ErrorBoundary wrapper in renderPanel.
- Remove dead imports, fix CSS naming issues.
- Verify build clean.

### Phase 15 — Technical Indicators on Desktop Charts & Drawing Tools
**GOAL:** Give traders the analysis tools they expect on the main chart — SMA, EMA, RSI, MACD, Bollinger, and basic drawing tools (trendlines, horizontal lines).
**SCOPE:**
- Port indicator logic from InstrumentDetail to ChartPanel.
- Add indicator selector toolbar (toggle SMA/EMA/RSI/MACD/Bollinger).
- Add drawing tools: trendline, horizontal line, Fibonacci retracement.
- Persist indicator/drawing state in settings.
- Mobile chart: same indicator toolbar (compact).

### Phase 16 — Mobile Home & Navigation Overhaul
**GOAL:** Make the mobile experience feel like a premium trading app, not a shrunken desktop.
**SCOPE:**
- Redesign HomePanelMobile with market summary cards, trending movers, watchlist preview.
- Add pull-to-refresh across all mobile panels.
- Add swipe gestures for tab navigation.
- Add bottom sheet for InstrumentDetail (instead of full-screen overlay).
- Consistent header bar with avatar, market status, and notification bell.

### Phase 17 — Missions, Quests & Streaks
**GOAL:** Turn passive users into engaged daily traders with progression mechanics.
**SCOPE:**
- Backend: Mission model with daily/weekly/one-time types.
- Frontend: MissionsPanel (desktop) + missions section on mobile More screen.
- Achievement toast notifications when XP is earned.
- Daily login streak tracking (1d/3d/7d/30d rewards).
- Persona-specific quests ("As a Crypto Degen, buy 3 altcoins this week").

### Phase 18 — Sharing Engine & Viral Moments
**GOAL:** Let users share their wins and drive organic growth.
**SCOPE:**
- Backend: Image generation service (portfolio card, performance summary, ticker snapshot).
- Frontend: Share button on InstrumentDetail, PortfolioPanel, LeaderboardPanel.
- WhatsApp/Twitter/LinkedIn deep link with OG image.
- "Share your rank" after weekly competition ends.
- Referral code system (invite friends, both get XP).

### Phase 19 — Advanced Screener & Watchlist Alerts
**GOAL:** Make the screener a daily-use tool with saved searches and automatic notifications.
**SCOPE:**
- Saved screener presets (per user, persisted to settings).
- Screener alert: "Notify me when a stock matches these criteria."
- Watchlist grouping (create named lists: "Tech Plays", "Dividend Kings").
- Bulk alert creation from screener results.

### Phase 20 — Options Chain & Strategy Basics
**GOAL:** First pass at options data for advanced traders.
**SCOPE:**
- Backend: Options chain endpoint (Polygon or CBOE data).
- Frontend: Options tab in InstrumentDetail (calls/puts table, strike prices, greeks).
- Basic strategy builder: covered call, protective put, straddle.
- P&L diagram for selected strategy.

### Phase 21 — Performance & Scale
**GOAL:** Prepare for 10K+ concurrent users.
**SCOPE:**
- Postgres migration for users, portfolios, alerts (from in-memory Maps).
- Redis for session cache, leaderboard cache, rate limiting.
- node-cron for predictable job scheduling (replace setInterval).
- Request-level timeouts middleware.
- Per-user rate limiting on expensive endpoints.
- Add structured logging (JSON) for observability.

---

## 5. File Inventory (Current State)

| Area | Files | Total LOC (approx) |
|------|-------|---------------------|
| Backend routes | 18 route files | ~3,500 |
| Backend stores | 4 (auth, chat, portfolio, alert) | ~2,100 |
| Backend providers | 7 | ~1,500 |
| Backend utils/jobs | 5 | ~400 |
| Frontend panels | 28 (desktop + mobile) | ~7,500 |
| Frontend common | 18 components | ~4,200 |
| Frontend context | 10 providers | ~2,000 |
| Frontend config | 4 files | ~1,000 |
| Frontend hooks | 3 files | ~400 |
| Frontend utils | 5 files | ~700 |
| App.jsx | 1 file | 1,813 |
| **Total** | **~100 JS/JSX files** | **~25,000** |
