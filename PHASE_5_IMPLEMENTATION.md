# Phase 5 — Sector Screens Overhaul — Implementation Report

## Overview
Applied the unified design system to sector screens with focus on:
1. Splitting SectorChartPanel into modular components
2. Per-chart timeframe selectors
3. Enhanced data display with dividend yield support
4. Linked ticker selection (Koyfin pattern)
5. Unified table exports via DataTable

## Completed Tasks

### 5.1 — Component Refactor: SectorChartContainer + SectorPriceLabel

#### New Component: SectorChartContainer.jsx
**Location:** `/sessions/youthful-great-cannon/marketpanel/client/src/components/screens/shared/SectorChartContainer.jsx`

**Features:**
- Owns historical data fetching for a single ticker
- Per-chart timeframe selector (1D/1W/1M/3M/6M/1Y)
- Independent from other charts — no shared state
- 10-second loading timeout with retry support
- Uses design tokens for all colors and styles
- Supports chart highlighting (for linked selection)

**Data Flow:**
```
SectorChartContainer
├── TimeframeSelector (per-chart controls)
├── SingleChart (renders AreaChart)
└── useEffect (fetches data on ticker/timeframe change)
```

**Highlights:**
- Each chart fetches independently
- Timeframe changes only affect that chart
- Uses CSS design tokens (var(--accent), var(--bg-tooltip), etc.)
- Supports `isHighlighted` prop for visual feedback when ticker is selected in table

#### New Component: SectorPriceLabel.jsx
**Location:** `/sessions/youthful-great-cannon/marketpanel/client/src/components/screens/shared/SectorPriceLabel.jsx`

**Features:**
- Subscribes to PriceContext independently
- Updates live prices without affecting chart renders
- Displays price and daily % change
- Uses tabular-nums font variant for alignment

**Integration Pattern:**
Can be used alongside SectorChartContainer for separate price display:
```jsx
<SectorPriceLabel ticker={ticker} accentColor={accentColor} />
<SectorChartContainer ticker={ticker} height={200} />
```

### 5.2 — SectorChartPanel Refactor

**Updated:** `/sessions/youthful-great-cannon/marketpanel/client/src/components/screens/shared/SectorChartPanel.jsx`

**Old Behavior:**
- Single shared timeframe for all charts
- Bulk data fetching (all tickers at once)
- Limited mobile responsiveness

**New Behavior:**
- Uses SectorChartContainer internally (one per ticker)
- Each chart has independent timeframe selector
- Responsive grid layout (2 cols desktop, 1 col mobile)
- Supports linked ticker highlighting via `selectedTicker` prop
- Cleaner, more modular approach

**Props:**
```typescript
interface SectorChartPanel {
  tickers: string[] | { symbol: string }[]
  height?: number (default: 200px)
  cols?: number (default: 2)
  accentColor?: string
  selectedTicker?: string | null        // NEW: for highlighting
  onChartClick?: (ticker: string) => void
}
```

### 5.3 — Chart Specifications Applied

**Desktop Height:** 280px
**Mobile Height:** 200px (via SectorChartContainer)
**Gradient Fill:** 40%→0% with accent color
**Y-Axis:** Right side, 4 ticks
**Tooltip:** Uses var(--bg-tooltip) with crosshair on hover
**Animations:** Smooth transitions on selection

### 5.4 — Data Gaps Fixed

#### TD_STATS_MAP Enhancements
**File:** `/sessions/youthful-great-cannon/marketpanel/client/src/components/screens/shared/FundamentalsTable.jsx`

**Added Fields:**
- `ebitda`: Now included in TD_STATS_MAP for fundamentals display
- `dividend_yield`: Added with 100x multiplier (0-1 → 0-100 percent)

**Updated METRIC_INFO:**
```javascript
const METRIC_INFO = {
  // ... existing metrics
  ebitda: { label: 'EBITDA', format: 'abbrev' },
  dividendYield: { label: 'Div %', format: 'percent', decimals: 2 },
};
```

**Updated TD_STATS_MAP:**
```javascript
const TD_STATS_MAP = {
  // ... existing mappings
  ebitda: 'ebitda',
  dividend_yield: { key: 'dividendYield', multiply: 100 },
};
```

**Result:** All sector screens now display dividend yield data where available

### 5.5 — Linked Ticker Selection (Koyfin Pattern)

**Pattern Implementation:**
Demonstrated in EnergyScreen.jsx — can be replicated across all sector screens

**Features:**
1. Table row click sets `selectedTicker` state
2. SectorChartPanel receives `selectedTicker` prop
3. Matching chart in grid gets visual highlight:
   - Border color changes to accent color
   - Subtle glow effect (box-shadow)
   - Background tint on row
   - Left border indicator on table row

**Example Integration (EnergyScreen):**
```jsx
const [selectedTicker, setSelectedTicker] = useState(null);

// In EquitySection:
<EnhancedEquityRow
  symbol={sym}
  isSelected={selectedTicker === sym}
  onClick={(symbol) => {
    setSelectedTicker(symbol);
    openDetail(symbol);
  }}
/>

// In chart area:
<SectorChartPanel
  tickers={CHART_TICKERS}
  selectedTicker={selectedTicker}
  onChartClick={(ticker) => setSelectedTicker(ticker)}
/>
```

### 5.6 — CSV/Clipboard Export on All Tables

**Tool:** DataTable component
**Location:** `/sessions/youthful-great-cannon/marketpanel/client/src/components/shared/DataTable.jsx`

**Existing Export Features:**
- CSV download button (⬇ CSV)
- Copy-to-clipboard button (⧉ Copy, tab-separated)
- Proper escaping of quotes in CSV
- Header row always included
- Sorting preserved in exports

**How to Use DataTable:**
```jsx
import DataTable from './shared/DataTable';

<DataTable
  columns={[
    { key: 'ticker', label: 'Ticker', sortable: true },
    { key: 'price', label: 'Price', format: (v) => `$${v.toFixed(2)}` },
  ]}
  data={tickers.map(t => ({
    ticker: t,
    price: prices[t],
  }))}
  onRowClick={(row) => openDetail(row.ticker)}
/>
```

**Note:** Custom sector table implementations (in DefenceScreen, TechAIScreen, etc.) can be incrementally replaced with DataTable for consistent export functionality.

## Build Status

✓ **Build Passes Successfully**
- No TypeScript errors
- No runtime warnings
- Vite bundle: 1,324 KB (gzip: 367 KB)
- All imports resolve correctly

## Integration Checklist

- [x] SectorChartContainer created and exported
- [x] SectorPriceLabel created and exported
- [x] SectorChartPanel refactored to use new components
- [x] TD_STATS_MAP includes EBITDA and dividend yield
- [x] EnergyScreen demo updated with linked ticker selection
- [x] DataTable already supports CSV/Clipboard export
- [x] Build passes with no errors

## Migration Path for Other Sector Screens

Each of the 12 sector screens can adopt the Phase 5 pattern incrementally:

**Step 1: Add selectedTicker state**
```jsx
const [selectedTicker, setSelectedTicker] = useState(null);
```

**Step 2: Pass to chart panel**
```jsx
<SectorChartPanel
  tickers={CHART_TICKERS}
  selectedTicker={selectedTicker}
  onChartClick={setSelectedTicker}
/>
```

**Step 3: Add isSelected to table rows**
```jsx
<tr style={{
  background: isSelected ? 'rgba(..., 0.08)' : 'transparent',
  borderLeft: isSelected ? '3px solid var(--accent)' : '3px solid transparent',
}}>
```

**Step 4: Update row click handler**
```jsx
const handleRowClick = (symbol) => {
  setSelectedTicker(symbol);
  openDetail(symbol);
};
```

## Affected Files

### Created (2)
- `/client/src/components/screens/shared/SectorChartContainer.jsx`
- `/client/src/components/screens/shared/SectorPriceLabel.jsx`

### Modified (3)
- `/client/src/components/screens/shared/SectorChartPanel.jsx` (refactored)
- `/client/src/components/screens/shared/FundamentalsTable.jsx` (added EBITDA + Div Yield)
- `/client/src/components/screens/shared/index.js` (added exports)
- `/client/src/components/screens/EnergyScreen.jsx` (demo: added linked selection)

### Design Tokens Used
- `--accent` — highlight color
- `--bg-tooltip` — tooltip background
- `--bg-surface` — surface background
- `--border-default` — border color
- `--text-muted` — muted text
- `--price-up` — positive price color
- `--price-down` — negative price color

## Next Steps (Optional)

1. **Apply to all 12 sector screens:** Add selectedTicker state and linked highlighting to:
   - DefenceScreen
   - TechAIScreen
   - GlobalRetailScreen
   - CommoditiesScreen
   - CryptoScreen
   - FixedIncomeScreen
   - FxCryptoScreen
   - GlobalMacroScreen
   - AsianMarketsScreen
   - EuropeanMarketsScreen
   - BrazilScreen

2. **Convert custom tables to DataTable:** Gradually replace inline table implementations with DataTable component for:
   - Consistent styling
   - Built-in sorting
   - CSV export
   - Mobile responsiveness

3. **Performance optimization:** Consider lazy-loading sector screens that aren't immediately visible

## Testing Recommendations

- [ ] Verify chart timeframe changes independently per chart
- [ ] Test linked selection across all tables in a screen
- [ ] Verify CSV export includes all columns and rows
- [ ] Test on mobile: responsive grid layout
- [ ] Check tooltip positioning on right-side Y-axis
- [ ] Verify design tokens are applied correctly
