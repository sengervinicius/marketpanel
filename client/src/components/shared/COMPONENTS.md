# Shared UI Components — Phase 1 Megazord Redesign

Universal, reusable components used across all screens in the MarketPanel application.

## Components Overview

### 1. DataTable

Universal table component used across all screens with advanced features.

**Import:**
```jsx
import { DataTable } from './components/shared';
```

**Props:**
- `columns` (array): Column definitions with `{ key, label, width, align, format, sortable }`
- `data` (array): Array of row objects
- `onRowClick` (function): Callback when a row is clicked
- `loading` (boolean): Show skeleton loading state
- `emptyMessage` (string): Message when no data available
- `className` (string): Additional CSS classes
- `stickyFirstColumn` (boolean): Keep first column visible on mobile scroll
- `keyboardNav` (boolean): Enable keyboard navigation (↑↓ arrows, Enter)

**Features:**
- ✅ Sortable columns with ▲/▼ indicators
- ✅ Row hover: `var(--bg-hover)` background
- ✅ Row click: Calls `onRowClick(row)`
- ✅ Missing data: "—" in `var(--text-faint)` color
- ✅ Loading state: Skeleton rows matching column layout
- ✅ Mobile: Horizontal scroll with sticky first column
- ✅ `font-variant-numeric: tabular-nums` on number columns
- ✅ CSV export: [⬇ CSV] button
- ✅ Copy to clipboard: [⧉ Copy] button
- ✅ Keyboard navigation: ↑↓ arrows, Enter
- ✅ Active row: `var(--bg-active)` background
- ✅ Design tokens from `tokens.css`

**Example:**
```jsx
const columns = [
  { key: 'symbol', label: 'Symbol', width: '100px', sortable: true },
  { key: 'price', label: 'Price', width: '120px', align: 'right', sortable: true, format: (v) => v.toFixed(2) },
  { key: 'change', label: 'Change %', width: '100px', align: 'right', sortable: true },
];

const data = [
  { symbol: 'AAPL', price: 150.25, change: 2.5 },
  { symbol: 'TSLA', price: 245.80, change: -1.2 },
];

<DataTable
  columns={columns}
  data={data}
  onRowClick={(row) => console.log(row)}
  loading={false}
  stickyFirstColumn={true}
  keyboardNav={true}
/>
```

---

### 2. SkeletonLoader

Configurable skeleton loading component for various layouts.

**Import:**
```jsx
import { SkeletonLoader } from './components/shared';
```

**Props:**
- `type` (string): 'chart' | 'table' | 'card' | 'text' | 'row'
- `width` (string): Custom width (default: '100%')
- `height` (string): Custom height (default: '200px')
- `rows` (number): Number of rows (for table/text)
- `columns` (number): Number of columns (for table/row)
- `className` (string): Additional CSS classes

**Features:**
- ✅ Shimmer animation: `var(--bg-panel)` → `var(--bg-surface)` → `var(--bg-panel)`
- ✅ 1.5s ease infinite animation
- ✅ Chart skeleton: Rectangular shape
- ✅ Table skeleton: Rows with column widths
- ✅ Card skeleton: Rectangle with text lines
- ✅ Text skeleton: Varying width lines
- ✅ Row skeleton: Horizontal cells

**Example:**
```jsx
// Chart loading
<SkeletonLoader type="chart" height="300px" />

// Table loading
<SkeletonLoader type="table" rows={5} columns={4} />

// Card loading
<SkeletonLoader type="card" width="300px" height="250px" />

// Text loading
<SkeletonLoader type="text" rows={4} />

// Row loading
<SkeletonLoader type="row" columns={3} />
```

---

### 3. SectionHeader

Unified section headers across all screens.

**Import:**
```jsx
import { SectionHeader } from './components/shared';
```

**Props:**
- `title` (string): Section title
- `subtitle` (string): Optional subtitle
- `accentColor` (string): Color for title (default: `var(--accent)`)
- `children` (ReactNode): Right-side action elements
- `className` (string): Additional CSS classes

**Features:**
- ✅ 11px uppercase title with 2px letter-spacing
- ✅ Accent color customization
- ✅ Border-bottom at 20% opacity
- ✅ Right-side action slot
- ✅ Design tokens styling
- ✅ Responsive layout

**Example:**
```jsx
<SectionHeader
  title="Portfolio Holdings"
  subtitle="Last updated 2 minutes ago"
  accentColor="var(--sector-tech)"
>
  <button>Add Position</button>
  <button>Export</button>
</SectionHeader>
```

---

### 4. EmptyState

Component for failed/empty data sections.

**Import:**
```jsx
import { EmptyState } from './components/shared';
```

**Props:**
- `message` (string): Empty state message
- `onRetry` (function): Callback for retry button (if null, button hidden)
- `icon` (ReactNode): Optional icon element
- `className` (string): Additional CSS classes

**Features:**
- ✅ Centered message in `var(--text-muted)`
- ✅ [Retry] button with accent color
- ✅ Optional icon display
- ✅ Responsive layout

**Example:**
```jsx
<EmptyState
  message="No positions found"
  icon={<span style={{ fontSize: '32px' }}>📊</span>}
  onRetry={() => fetchPositions()}
/>
```

---

## Design Tokens

All components use design tokens from `tokens.css`:

**Colors:**
- `--bg-app`: Deepest background
- `--bg-panel`: Panel/card background
- `--bg-surface`: Elevated surface
- `--bg-hover`: Hover state
- `--bg-active`: Active/pressed state
- `--text-primary`: Primary text
- `--text-secondary`: Secondary text
- `--text-muted`: Muted text
- `--text-faint`: Faint text
- `--accent`: Senger orange
- `--border-subtle`: Subtle borders
- `--border-default`: Standard borders

**Sizing:**
- `--row-height`: 26px
- `--row-height-touch`: 44px
- `--space-*`: Spacing scale (1, 2, 3, 4, 5, 6, 8, 10, 12, 16)
- `--radius-*`: Border radius (sm, md, lg, full)

**Typography:**
- `--font-ui`: UI font family
- `--font-mono`: Monospace font
- `--text-*`: Font sizes (2xs, xs, sm, base, md, lg, xl, 2xl)
- `--weight-*`: Font weights (normal, medium, semibold, bold)

**Animation:**
- `--duration-*`: Animation durations (instant, fast, normal, slow)
- `--ease-*`: Easing functions (default, in, out, bounce)

---

## CSS Architecture

All components use CSS classes with `dt-`, `sk-`, `sh-`, `es-` prefixes to avoid conflicts:
- `DataTable`: `dt-*`
- `SkeletonLoader`: `sk-*`
- `SectionHeader`: `sh-*`
- `EmptyState`: `es-*`

All CSS values use design tokens—no hardcoded colors or sizing.

---

## Export

Import all at once:
```jsx
import { DataTable, SkeletonLoader, SectionHeader, EmptyState } from './components/shared';
```

Or import individually:
```jsx
import DataTable from './components/shared/DataTable';
import SkeletonLoader from './components/shared/SkeletonLoader';
import SectionHeader from './components/shared/SectionHeader';
import EmptyState from './components/shared/EmptyState';
```

---

## Browser Support

All components use modern CSS features and are tested on:
- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

---

## Accessibility

All components follow WCAG 2.1 AA standards:
- Keyboard navigation support
- Focus indicators
- Semantic HTML
- ARIA attributes where needed
- Color contrast compliance
- Motion preferences respect
