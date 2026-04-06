# Wave 3 Shared Components - Usage Guide

## Quick Import

```javascript
import {
  FundamentalsTable,
  SectorScatterPlot,
  MiniFinancials,
  InsiderActivity,
  SectorChartPanel,
  FullPageScreenLayout,
} from './components/screens/shared';
```

## Component-by-Component Usage

### FundamentalsTable

```jsx
<FundamentalsTable
  tickers={['AAPL', 'MSFT', 'GOOGL']}
  metrics={['pe', 'eps', 'marketCap', 'grossMargins']}
  title="Tech Leaders Fundamentals"
  onTickerClick={(ticker) => navigate(`/ticker/${ticker}`)}
/>
```

**Props:**
- `tickers`: string[] (required)
- `metrics`: string[] (optional, defaults to all available)
- `title`: string (optional)
- `onTickerClick`: (ticker: string) => void (optional)

---

### SectorScatterPlot

```jsx
const scatterData = [
  { ticker: 'AAPL', x: 15.5, y: 28.3 },
  { ticker: 'MSFT', x: 12.2, y: 32.1 },
];

<SectorScatterPlot
  data={scatterData}
  xLabel="Revenue Growth (%)"
  yLabel="P/E Ratio"
  title="Valuation vs Growth"
  onDotClick={(ticker) => navigate(`/ticker/${ticker}`)}
  height={280}
/>
```

**Props:**
- `data`: Array<{ticker, x, y}> (required)
- `xLabel`: string (default: "X Axis")
- `yLabel`: string (default: "Y Axis")
- `title`: string (optional)
- `onDotClick`: (ticker: string) => void (optional)
- `height`: number (default: 280)

---

### MiniFinancials

```jsx
<MiniFinancials
  ticker="AAPL"
  onError={(err) => console.error('Financial load failed:', err)}
/>
```

**Props:**
- `ticker`: string (required)
- `onError`: (err: Error) => void (optional)

**Displays:** 3-year stacked bar chart (Revenue + Net Income)

---

### InsiderActivity

```jsx
<InsiderActivity
  tickers={['AAPL', 'TSLA', 'MSFT']}
  limit={5}
  onTickerClick={(ticker) => navigate(`/ticker/${ticker}`)}
/>
```

**Props:**
- `tickers`: string[] (required, max 8)
- `limit`: number (default: 5 per ticker)
- `onTickerClick`: (ticker: string) => void (optional)

**Displays:** Sorted insider buy/sell transactions (max 30 rows)

---

### SectorChartPanel

```jsx
<SectorChartPanel
  tickers={['AAPL', 'MSFT', 'GOOGL', 'AMZN']}
  height={200}
  cols={2}
/>
```

**Props:**
- `tickers`: string[] (required)
- `height`: number (default: 200, px per chart)
- `cols`: number (default: 2, desktop columns)

**Displays:** Responsive grid of area charts (1 col mobile, cols cols desktop)

---

### FullPageScreenLayout

```jsx
<FullPageScreenLayout
  title="Technology Sector"
  accentColor="#ff6b00"
  subtitle="Tracking the largest tech companies"
  lastUpdated={new Date()}
  onBack={() => navigate('/')}
  sections={[
    {
      id: 'fundamentals',
      title: 'Fundamentals',
      badge: '5',
      component: () => <FundamentalsTable tickers={['AAPL', 'MSFT']} />,
    },
    {
      id: 'charts',
      title: 'Technical',
      span: 'full',
      component: () => <SectorChartPanel tickers={['AAPL', 'MSFT', 'GOOGL']} />,
    },
  ]}
>
  {/* ETF strips or other full-width content */}
  <div style={{ padding: '8px 0' }}>
    <h3>Related ETFs</h3>
    {/* Content here */}
  </div>
</FullPageScreenLayout>
```

**Props:**
- `title`: string (required)
- `accentColor`: string hex (default: #ff6b00)
- `subtitle`: string (optional)
- `lastUpdated`: Date (optional)
- `onBack`: () => void (optional)
- `sections`: Array<SectionConfig> (required)
- `children`: ReactNode (optional, rendered below grid)

**Section Config:**
```typescript
{
  id: string,              // Unique identifier
  title: string,           // Display title
  badge?: string,          // Optional badge text
  span?: 'full' | 'half',  // Desktop: full spans 3 cols
  component: React.FC,     // Component or function returning JSX
}
```

---

## Color Values Reference

```javascript
// Available for use in custom styling
const COLORS = {
  BG_DARK: '#0a0a0a',
  BG_DARKER: '#0d0d0d',
  BORDER: '#1e1e1e',
  BORDER_LIGHT: '#151515',
  TEXT_PRIMARY: '#e0e0e0',
  TEXT_SECONDARY: '#999',
  TEXT_MUTED: '#555',
  TEXT_MUTED_LIGHT: '#666',
  ACCENT: '#ff6b00',
  SUCCESS: '#4caf50',
  DANGER: '#f44336',
  WARNING: '#ff9800',
  INFO: '#4a90d9',
};
```

---

## Common Patterns

### Fetching data before component mount

```jsx
useEffect(() => {
  const fetchTickers = async () => {
    const data = await apiJSON('/api/sectors/tech/tickers');
    setTickers(data.symbols);
  };
  fetchTickers();
}, []);

return <FundamentalsTable tickers={tickers} />;
```

### Handling section errors with error boundary

Components already include SectionErrorBoundary, so individual section failures won't crash the page.

### Mobile-responsive layout

All components automatically adapt to mobile via `useIsMobile` hook.

### Adding custom styling to components

```jsx
<div style={{ padding: '12px', background: '#0a0a0a' }}>
  <FundamentalsTable tickers={tickers} />
</div>
```

---

## Testing Tips

### Mock data for development

```javascript
// FundamentalsTable
const mockFundamentals = [
  { ticker: 'AAPL', pe: 28.5, eps: 6.05, marketCap: 2.8e12, ... },
];

// SectorScatterPlot
const mockScatter = [
  { ticker: 'AAPL', x: 15.5, y: 28.3 },
  { ticker: 'MSFT', x: 12.2, y: 32.1 },
];

// InsiderActivity
const mockInsider = [
  { ticker: 'AAPL', transaction_date: '2024-01-15', name: 'John Doe', type: 'buy', shares: 1000, value: 150000 },
];
```

### Disabling API calls during development

Most components handle empty data gracefully. Pass empty arrays to see loading/empty states:
```jsx
<FundamentalsTable tickers={[]} />  // Shows "No data"
<InsiderActivity tickers={[]} />     // Shows "No insider activity"
```

---

## Performance Considerations

1. **FundamentalsTable**: Max 20 tickers per request
2. **InsiderActivity**: Fetches 8 tickers in parallel (limit impact)
3. **SectorChartPanel**: 3-month daily data = ~60 candles per chart
4. **MiniFinancials**: Single ticker, lightweight
5. **FullPageScreenLayout**: Memoization via SectionErrorBoundary

For large data sets, consider:
- Pagination in FundamentalsTable
- Lazy loading sections in FullPageScreenLayout
- Reducing chart data range in SectorChartPanel

---

## Troubleshooting

### "apiFetch is not defined"
Make sure import path is correct:
```javascript
import { apiFetch } from '../../../utils/api';
```

### Tables look cramped
Adjust section height in FullPageScreenLayout:
```jsx
sections={[
  {
    id: 'fundamentals',
    title: 'Fundamentals',
    component: FundamentalsTable,
    // Parent container has min-height: 200px
  },
]}
```

### Charts not rendering
Check that:
1. Data array is not empty
2. Recharts is installed (`npm list recharts`)
3. ResponsiveContainer has parent with defined width/height

### Sticky headers overlapping
Verify z-index values in ScreenShared.css (header z: 10, section z: 2)

---

## Future Enhancements (Post-Wave 3)

- Pagination for large tables
- Chart date range selector
- Export to CSV functionality
- Customizable color schemes
- Table column visibility toggle
- Advanced filtering
- Real-time data updates via WebSocket
- AI insights integration (Wave 6)

---

**Last Updated:** 2026-04-06
**Version:** 1.0
**Status:** Production Ready
