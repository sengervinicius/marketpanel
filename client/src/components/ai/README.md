# AI Components & Hooks

Unified AI integration layer for the Senger Market Terminal.

## Quick Start

### Import the hook
```javascript
import { useAIInsight } from '../../hooks/useAIInsight';
```

### Import the component
```javascript
import { AIInsightCard } from '../ai';
```

### Use the hook directly
```javascript
const { loading, error, insight, refresh } = useAIInsight({
  type: 'sector',           // insight type
  context: { symbols: ['SPY'] },
  cacheKey: 'sector-spy',
  autoFetch: false,         // trigger manually
});

if (loading) return <p>Loading...</p>;
if (error) return <p>Error: {error}</p>;
if (insight) return <p>{insight.body}</p>;
return <button onClick={refresh}>Generate</button>;
```

### Use the component (recommended)
```javascript
<AIInsightCard
  type="sector"
  context={{ symbols: ['SPY'] }}
  cacheKey="sector-spy"
/>
```

## Insight Types

| Type | Endpoint | Use Case |
|------|----------|----------|
| `sector` | `/api/search/sector-brief` | Sector analysis |
| `macro` | `/api/search/macro-insight` | Macro economic insights |
| `chart` | `/api/search/chart-insight` | Technical analysis |
| `fundamentals` | `/api/search/fundamentals` | Company fundamentals |
| `yield-curve` | `/api/search/yield-curve-analysis` | Fixed income analysis |
| `commodity` | `/api/search/commodity-brief` | Commodity market insights |
| `em-country` | `/api/search/em-country-brief` | Emerging market analysis |
| `cross-asset` | `/api/search/cross-asset-signal` | Multi-asset signals |
| `general` | `/api/search/ai` | General queries |

## Component Props

```typescript
interface AIInsightCardProps {
  type: string;              // Required: insight type
  context: object;           // Required: request body
  cacheKey: string;          // Required: unique cache key
  ttlMs?: number;            // Optional: cache TTL ms (default: 300000)
  autoFetch?: boolean;       // Optional: fetch on mount (default: false)
  title?: string;            // Optional: override display title
  compact?: boolean;         // Optional: compact mode (default: false)
}
```

## Hook API

```typescript
interface UseAIInsightOptions {
  type: string;              // Required
  context: object;           // Required
  cacheKey: string;          // Required
  ttlMs?: number;            // Optional (default: 300000)
  autoFetch?: boolean;       // Optional (default: false)
}

interface UseAIInsightReturn {
  loading: boolean;          // Fetch in progress
  error: string | null;      // Error message, if any
  insight: object | null;    // Normalized insight data
  refresh: () => Promise;    // Manual fetch trigger
}
```

## Caching

- **Strategy**: Global in-memory Map, shared across all hook instances
- **TTL**: Default 5 minutes (300,000 ms)
- **Throttle**: Minimum 5 seconds between identical requests
- **Eviction**: Least-recently-used when cache exceeds 100 entries
- **Max Size**: ~100KB total

### Cache Key Best Practices

Make cache keys unique and descriptive:

```javascript
// Good
const cacheKey = 'sector-spy-qqq';
const cacheKey = `chart-${symbol}-${range}`;
const cacheKey = `fundamentals-${symbol}`;

// Avoid
const cacheKey = 'data';           // Too generic
const cacheKey = Date.now();       // Always unique, defeats caching
```

## Response Format

All responses are normalized to this shape:

```javascript
{
  title: string | null,           // Display title
  body: string,                   // Main content
  bullets: string[] | null,       // Optional bullet points
  generatedAt: string,            // ISO timestamp
  // Additional fields vary by type...
}
```

## Error Handling

```javascript
const { loading, error, insight, refresh } = useAIInsight({ ... });

if (error && !insight) {
  // First fetch failed
  return <AIError message={error} onRetry={refresh} />;
}

if (error && insight) {
  // Had data, refresh failed - stale data still visible
  console.warn('Refresh failed:', error);
  return <p>{insight.body}</p>;
}
```

## Section Data Hook

For page-level or section-level data fetching:

```javascript
import { useSectionData } from '../../hooks/useSectionData';

const { data, loading, error, refresh, lastUpdated } = useSectionData({
  cacheKey: 'sector-rotation',
  fetcher: async () => {
    const res = await apiFetch('/api/sectors/rotation', { method: 'GET' });
    return res.json();
  },
  refreshMs: 60000,  // Auto-refresh every minute
  enabled: true,     // Can be disabled conditionally
});
```

## Styling

All AI components use CSS classes with BEM naming:

- `.ai-card` - Main container
- `.ai-card--compact` - Compact variant
- `.ai-card--empty` - Before first fetch
- `.ai-card--loading` - Fetching state
- `.ai-card--error` - Error state
- `.ai-card--loaded` - Success state

Override colors in your CSS:

```css
.ai-card {
  --ai-bg: #111;
  --ai-border: #1e1e1e;
  --ai-badge: #ff6b00;
}
```

## Performance Tips

1. **Use unique cache keys** - Same key = cache hit
2. **Avoid autoFetch in loops** - Explodes network requests
3. **Throttle manual refreshes** - 5s minimum between requests
4. **Set appropriate TTLs** - Balance freshness vs. caching
5. **Monitor cache size** - Use DevTools to check memory
6. **Disable when not visible** - Use `useVisible` hook if available

## Testing

```javascript
// Mock the hook in tests
jest.mock('../../hooks/useAIInsight', () => ({
  useAIInsight: () => ({
    loading: false,
    error: null,
    insight: { title: 'Test', body: 'Test insight' },
    refresh: jest.fn(),
  }),
}));

// Test the component
render(<AIInsightCard type="sector" context={{}} cacheKey="test" />);
expect(screen.getByText('Test')).toBeInTheDocument();
```

## Troubleshooting

### Cache not working?
- Check cache key is consistent
- Verify TTL hasn't expired (DevTools → Application → Session Storage)
- Look for network requests in DevTools

### Component not showing?
- Verify context object is not empty
- Check type is in ENDPOINT_MAP
- Review error state in React DevTools

### Memory growing?
- Check cache size (should max at 100 entries)
- Look for cache key collisions
- Verify unused insights are being evicted

## Related Files

- `/hooks/useAIInsight.js` - Hook implementation
- `/hooks/useSectionData.js` - Section data hook
- `/components/ai/AIInsightCard.jsx` - Component
- `/components/ai/AIInsightCard.css` - Styles
- `/utils/api.js` - apiFetch utility
