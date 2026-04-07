# SPRINT 5 IMPLEMENTATION REPORT
## Sector Screen Ground Truth Fix

**Date:** 2026-04-07
**Commit:** `74ef3b3` (Sprint 5 main commit)
**Branch:** main
**Deploy:** senger-client.onrender.com / senger-server.onrender.com

---

## STEP 0 — GROUND TRUTH AUDIT

Before writing any code, the live app was opened and inspected with DevTools (Network + Console).

### A) MiniFinancials
- **API calls:** `/api/market/td/financials/{ticker}` — 6 tickers × 4 rounds = 24 requests observed. Many returned 503 (server overload).
- **Root cause 1:** `useEffect` depended on `[ticker, onError, accentColor]`. Both `onError` and `accentColor` are recreated on every parent render, triggering 4 rounds of re-fetches.
- **Root cause 2:** Year labels showed "—" because the code used `year.fiscal_period` but Twelve Data returns `fiscal_date` (e.g. "2024-12-31").
- **Root cause 3:** Chart was 90px tall with 20px max bars on #0a0a0a background — bars nearly invisible.

### B) FundamentalsTable
- **API call:** `/api/market/fundamentals/batch?tickers=...` returns only `pe`, `eps`, `marketCap` from Yahoo fallback.
- **Root cause:** Eulerpool provider (primary source) is optional and likely not configured. Yahoo Finance fallback hard-codes `revenue: null`, `ebitda: null`, `grossMargins: null`, `operatingMargins: null`, `profitMargins: null`, `returnOnEquity: null`.
- **Existing data source:** `useDeepScreenData` hook already fetches these fields from Twelve Data's `/statistics` endpoint (pe_ratio, revenue, gross_margin, operating_margin, profit_margin, return_on_equity).

### C) Chart Blinking
- **Root cause:** `SectorChartPanel` useEffect depends on `tickers` (array prop). Parent screens pass array literals like `['LMT', 'RTX', 'BA']` which create new references on every render, bypassing `React.memo` and retriggering the entire fetch cycle.

### D) Timeframe Selector
- **Home screen:** `MiniChart` in `ChartPanel.jsx` has RANGES array with 1D/3D/1M/6M/YTD/1Y buttons.
- **SectorChartStrip** (used by Energy, FxCrypto): Already has 1D/1W/1M/3M/6M/1Y buttons.
- **SectorChartPanel** (used by 10 other screens): NO timeframe selector — hard-coded to 3 months.

---

## TASK 1 (CRITICAL): Fix MiniFinancials Empty Black Boxes

**Changes in `client/src/components/screens/shared/MiniFinancials.jsx`:**
- **useEffect deps:** Changed from `[ticker, onError, accentColor]` to `[ticker]` only. Stored `onError` in a `useRef` to avoid stale closures without adding it to deps. This eliminates the 4-round re-fetch loop (24 requests → 6 requests).
- **Year label extraction:** New `extractYear()` function tries `fiscal_date`, `date`, `fiscal_period`, `period` in order. Also tries `total_revenue` as fallback for `revenue` field.
- **Chart visibility:** Height increased 90px → 110px. `maxBarSize` increased 20 → 28. Bar opacity increased 0.85 → 0.95. Net income green brightened #4caf50 → #66bb6a. Year tick font 8px → 9px, fill #666 → #888. Metric label color #666 → #888 with fontWeight 500.
- **Timeout:** Increased 12s → 15s to allow for server cold starts.

**Files:** `MiniFinancials.jsx`

---

## TASK 2: Fix FundamentalsTable Showing Dashes

**Root cause:** The `/api/market/fundamentals/batch` server endpoint falls back to Yahoo Finance when Eulerpool is unavailable. Yahoo's quote endpoint only provides pe, eps, marketCap. Revenue, margins, ROE, etc. are hard-coded as null.

**Solution:** FundamentalsTable now accepts an optional `statsMap` prop (a `Map<ticker, stats>` from `useDeepScreenData`). When present, missing fields from the batch endpoint are supplemented with Twelve Data statistics data.

**Changes in `client/src/components/screens/shared/FundamentalsTable.jsx`:**
- Added `TD_STATS_MAP` constant mapping Twelve Data field names to FundamentalsTable field names
- Added `mergeWithStats()` function that fills null batch fields from Twelve Data stats
- Twelve Data margin fields (0-1 ratio) are multiplied by 100 for percentage display
- Batch data takes priority — TD stats only fill gaps
- Added `useMemo` for merged data to avoid unnecessary recalculation

**Changes in 7 sector screen files (passing `statsMap` prop):**
1. `DefenceScreen.jsx` — `statsMap={statsMap}`
2. `TechAIScreen.jsx` — `statsMap={statsMap}`
3. `GlobalRetailScreen.jsx` — `statsMap={statsMap}`
4. `AsianMarketsScreen.jsx` — `statsMap={statsMap}`
5. `EuropeanMarketsScreen.jsx` — `statsMap={statsMap}`
6. `CryptoScreen.jsx` — `statsMap={statsMap}`
7. `CommoditiesScreen.jsx` — `statsMap={statsMap}`

**Files:** `FundamentalsTable.jsx`, `DefenceScreen.jsx`, `TechAIScreen.jsx`, `GlobalRetailScreen.jsx`, `AsianMarketsScreen.jsx`, `EuropeanMarketsScreen.jsx`, `CryptoScreen.jsx`, `CommoditiesScreen.jsx`

---

## TASK 3: Fix Chart Blinking/Reloading

**Root cause:** `SectorChartPanel` useEffect at line 166 depended on `[tickers, retryCount]`. The `tickers` prop is an array literal passed from parent screens — a new JavaScript reference every render. This bypassed React.memo and caused the entire chart data fetch to re-run on every parent state update (price polling, stats updates).

**Changes in `client/src/components/screens/shared/SectorChartPanel.jsx`:**
- Added `const tickerKey = useMemo(() => tickers.join(','), [tickers])` to serialize the array into a stable string
- Changed useEffect dependency from `[tickers, retryCount]` to `[tickerKey, rangeIdx, retryCount]`
- Inside useEffect, reconstruct array with `tickerKey.split(',')` when needed
- Added `useCallback` for `handleTickerClick` to prevent unnecessary child re-renders

**Files:** `SectorChartPanel.jsx`

---

## TASK 4: Add Timeframe Selector to Sector Charts

**Changes in `client/src/components/screens/shared/SectorChartPanel.jsx`:**
- Added `RANGES` constant matching SectorChartStrip and home screen patterns:
  - 1D (5min bars), 1W (30min bars), 1M (daily), 3M (daily, default), 6M (daily), 1Y (daily)
- Added `rangeIdx` state (default: 3 = 3M)
- Added `RangeBar` component with styled buttons (active button uses `accentColor` prop or default orange)
- Updated `fetchCharts` to use `RANGES[rangeIdx]` for `from` date, `timespan`, and `multiplier` parameters
- Range bar appears above charts in all states (loading, error, data)
- Added `accentColor` prop to SectorChartPanel for screen-specific button highlight

**Files:** `SectorChartPanel.jsx`

---

## TASK 5: Visual Style Alignment

**Changes already incorporated in Tasks 1-4:**
- Timeframe selector styling consistent with SectorChartStrip and home screen
- MiniFinancials bar colors brightened for dark background contrast
- Chart green/red colors consistent across all components (#4caf50/#f44336)
- Range bar button styling: active state uses accent color with dark text, inactive uses transparent with #888 text and #333 border

**Files:** `SectorChartPanel.jsx`, `MiniFinancials.jsx`

---

## VERIFICATION CHECKLIST

| # | Check | Expected | Result |
|---|-------|----------|--------|
| 1 | MiniFinancials useEffect deps = [ticker] only | No re-fetch on parent render | **PASS** — code verified |
| 2 | MiniFinancials year labels use fiscal_date | "2024", "2023", "2022" (not "—") | **PENDING DEPLOY** |
| 3 | MiniFinancials bars visible on dark bg | Taller chart (110px), brighter colors | **PENDING DEPLOY** |
| 4 | FundamentalsTable shows P/E from TD stats | Non-dash values in P/E column | **PENDING DEPLOY** |
| 5 | FundamentalsTable shows Revenue from TD stats | "$XXB" format in Revenue column | **PENDING DEPLOY** |
| 6 | FundamentalsTable shows Gross%/Op%/ROE% | Percentage values, color coded | **PENDING DEPLOY** |
| 7 | Charts don't blink on data updates | Stable after initial load | **PENDING DEPLOY** |
| 8 | Timeframe selector visible on sector charts | 1D/1W/1M/3M/6M/1Y buttons | **PENDING DEPLOY** |
| 9 | Timeframe buttons change chart data | Clicking 1M shows 30-day range | **PENDING DEPLOY** |
| 10 | Build succeeds with no errors | `vite build` exits 0 | **PASS** — built in 5.66s |
| 11 | All 7 screens pass statsMap to FundamentalsTable | statsMap prop present in JSX | **PASS** — code verified |
| 12 | Defence screen renders correctly | Charts + tables + financials | **PENDING DEPLOY** |
| 13 | Tech screen renders correctly | Charts + tables + fundamentals | **PENDING DEPLOY** |

**Result: 3/13 PASS, 10/13 PENDING DEPLOY VERIFICATION**

---

## FILES CHANGED (10 files)

| File | Changes |
|------|---------|
| `shared/MiniFinancials.jsx` | Complete Sprint 5 fix: useEffect deps, extractYear(), visibility |
| `shared/FundamentalsTable.jsx` | Added statsMap fallback, mergeWithStats(), TD_STATS_MAP |
| `shared/SectorChartPanel.jsx` | Sprint 5 rewrite: tickerKey memo, RANGES, RangeBar, accentColor |
| `DefenceScreen.jsx` | Added `statsMap={statsMap}` to FundamentalsTable |
| `TechAIScreen.jsx` | Added `statsMap={statsMap}` to FundamentalsTable |
| `GlobalRetailScreen.jsx` | Added `statsMap={statsMap}` to FundamentalsTable |
| `AsianMarketsScreen.jsx` | Added `statsMap={statsMap}` to FundamentalsTable |
| `EuropeanMarketsScreen.jsx` | Added `statsMap={statsMap}` to FundamentalsTable |
| `CryptoScreen.jsx` | Added `statsMap={statsMap}` to FundamentalsTable |
| `CommoditiesScreen.jsx` | Added `statsMap={statsMap}` to FundamentalsTable |

---

## KNOWN ISSUES (Carried Forward)

1. **China & HK tickers missing data** — Carried from Sprint 4. HKEX tickers show dashes for Mkt Cap/P/E.
2. **005930.KS chart data unavailable** — KRX tickers don't return chart data.
3. **MiniFinancials timeout for some tickers** — Rate limiting (30 req/min) means only ~2 tickers get full financials per minute. Mitigated by removing re-fetch loop (Task 1).
4. **Home screen not responsive** — Carried from Sprint 3.
5. **Render cold start latency** — Carried from Sprint 3. Both services can cold-start in 10-30s.
6. **Asian/Euro Macro Dashboard crash** — `TypeError: e.map is not a function` in SectionErrorBoundary. Macro API response is not an array. Caught by error boundary.
