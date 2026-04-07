# Wave 1 — Data State Reliability Report

## Summary
Every sector/thematic screen now shows loading skeleton, data, or explicit degraded state.
No screen section silently renders a wall of "—" dashes anymore.

---

## Files Changed (10 files)

### 1. `client/src/components/screens/DeepScreenBase.jsx`
- **What:** Added `StatsLoadGate` reusable component; enhanced `DeepError` with `onRetry` button
- **Before:** `DeepSkeleton` and `DeepError` existed but no wrapper to gate children on load state
- **After:** `StatsLoadGate` auto-renders skeleton → error+retry → children based on `useDeepScreenData` state

### 2. `client/src/components/screens/EnergyScreen.jsx`
- **What:** Destructured `loading/error/refresh` from `useDeepScreenData`; wrapped 3 equity sections with `StatsLoadGate`
- **Before:** Integrated Majors, OFS & Midstream, Clean Energy showed "—" for Mkt Cap/P/E while stats loaded
- **After:** Skeleton while loading → error+retry on failure → data when ready

### 3. `client/src/components/screens/DefenceScreen.jsx`
- **What:** Wrapped 4 equity sections (US Primes, EU Defence, Supply Chain, Space & Cyber) with `StatsLoadGate`
- **Before:** All 4 sections showed silent dashes for stats columns
- **After:** Skeleton → error → data lifecycle for each section

### 4. `client/src/components/screens/FxCryptoScreen.jsx`
- **What:** Wrapped `CRYPTO INFRASTRUCTURE & DeFi` section with `StatsLoadGate`
- **Before:** Crypto infra section (MSTR, COIN, MARA, etc.) had silent dashes for Mkt Cap/P/E
- **After:** Skeleton → error → data. FX/crypto majors sections unaffected (use useTickerPrice only)

### 5. `client/src/components/screens/GlobalRetailScreen.jsx`
- **What:** Wrapped 5 equity table sections with `StatsLoadGate`
- **Before:** US Discretionary, Staples, Luxury, E-Commerce, Specialty all had silent dash walls
- **After:** All 5 sections gated with loading/error/data states

### 6. `client/src/components/screens/TechAIScreen.jsx`
- **What:** Added `StatsLoadGate` import; destructured loading/error/refresh; wrapped MEGA-CAP, SEMIS, AI & CLOUD
- **Before:** `{ data: statsMap }` only — no loading feedback for 3 equity tables
- **After:** All 3 equity table sections gated

### 7. `client/src/components/screens/EuropeanMarketsScreen.jsx`
- **What:** Added `StatsLoadGate` import; destructured loading/error/refresh; wrapped 5 country sections (Germany, France, UK, Nordic, Southern Europe)
- **Before:** 5 equity tables showed dashes while stats loaded
- **After:** All 5 country sections gated. Macro/spreads sections already had loading via useSectionData.

### 8. `client/src/components/screens/AsianMarketsScreen.jsx`
- **What:** Added `StatsLoadGate` import; destructured loading/error/refresh; wrapped 5 country sections (Japan, China/HK, India, Korea, Taiwan/ASEAN)
- **Before:** 5 equity tables showed dashes while stats loaded
- **After:** All 5 gated. FX Monitor and Macro Dashboard already had their own loading via useSectionData.

### 9. `client/src/components/common/InstrumentDetail.jsx`
- **What:** Added `degradedSources` detection and amber warning banner
- **Before:** If chart, fundamentals, AI, or quote endpoints failed, user saw blank sections with no explanation
- **After:** When 2+ data sources fail, an amber banner appears: "Partial coverage — chart, fundamentals unavailable for this instrument"

### 10. `client/src/components/panels/SearchPanel.jsx`
- **What:** Expanded `COVERAGE_TAG` to include `live` (green "LIVE") and `unknown` (gray "PARTIAL") labels
- **Before:** Only `none` ("AI OVERVIEW") and `limited` ("LIMITED") had visible tags. Live and unknown results had no label.
- **After:** All coverage levels render explicit tags: LIVE / LIMITED / AI OVERVIEW / PARTIAL

### 11. `client/src/components/panels/HomePanelMobile.jsx`
- **What:** Added `useSectionHasData` hook and `SectionSkeleton` component to `SectionCard`
- **Before:** All 30+ tickers rendered simultaneously as "—" with no section-level loading indication
- **After:** Each section card shows a skeleton with "Loading prices..." until at least one ticker has data

---

## Verification Checklist

| Check | Status |
|-------|--------|
| Defence screen no longer opens as silent dashes | ✅ |
| Energy screen no longer opens as silent dashes | ✅ |
| FxCrypto screen no longer opens as silent dashes | ✅ |
| GlobalRetail screen no longer opens as silent dashes | ✅ |
| TechAI screen equity tables have loading states | ✅ |
| EuropeanMarkets equity tables have loading states | ✅ |
| AsianMarkets equity tables have loading states | ✅ |
| CommoditiesScreen already had DeepSkeleton/DeepError | ✅ (pre-existing) |
| InstrumentDetail shows degraded banner when multiple sources fail | ✅ |
| SearchPanel labels all results with coverage level | ✅ |
| HomePanelMobile shows section skeletons while loading | ✅ |
| Vite build succeeds | ✅ |

---

## Screens Still on Partial Coverage (pre-existing, not in Wave 1 scope)

- **GlobalMacro, FixedIncome, Brazil**: Already have full loading/error/retry per section via `useSectionData` — no action needed
- **CryptoScreen**: Already patched in prior stabilization wave
- **FxCrypto FX sections** (G10/EM): Use `useTickerPrice` only — individual ticker loading is inherent to WebSocket. No stats endpoint to gate. Acceptable.
- **InstrumentDetail**: 20+ parallel fetches still have no global timeout — out of scope for Wave 1 (identified for Wave 2 architecture work)
