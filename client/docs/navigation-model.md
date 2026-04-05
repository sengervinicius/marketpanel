# Navigation Model — Phase S3.A

This document defines how users reach different surfaces and data in the Senger Market Terminal after Phase S3.A (Search & Navigation as First-Class Citizens).

## Desktop Surfaces

### Header (Always Visible)
- **Logo** — Returns to home/dashboard
- **Search Bar** — Always-visible input field, prominently displayed
  - Keyboard shortcut: Cmd/Ctrl+K opens search modal
  - Placeholder: "Search stocks, ETFs, FX, crypto, commodities... (⌘K)"
  - Supports: ticker symbol, company name, macro theme, or natural language queries
- **Workspace Selector** — Switch between workspaces (if implemented)
- **Settings** — User preferences, account settings

### How Users Reach Search
1. **Visible Input** — Click the search bar in the header to begin typing
2. **Keyboard Shortcut** — Press Cmd/Ctrl+K or "/" to open/focus search
3. **Results Display** — Registry results + AI semantic suggestions
4. **Selection** — Click a result to open InstrumentDetail view

### Sector Screens
- **Discovery Path** — MarketScreenGallery strip (e.g., "Top Gainers", "Trending", "Crypto", "Energy")
- **Navigation** — User selects a sector screen, displays tabular data with clickable tickers
- **Detail Access** — Click any ticker in the sector screen to open InstrumentDetail

### Portfolio / Alerts / Screener
- **Layout Panels** — Available as draggable, resizable panel blocks in the main workspace
- **Content** — Each panel displays watchlist, alert configuration, or screener results
- **Power-User Feature** — Users can arrange multiple panels in a custom layout
- **Detail Navigation** — Click a ticker within a panel to open InstrumentDetail

---

## Mobile Surfaces

### Bottom Navigation (5 Primary Tabs)
1. **Home** — Dashboard with customizable tiles, quick access to common instruments
2. **Charts** — Detailed charting and technical analysis view
3. **Search** — Dedicated search interface (equivalent to header search on desktop)
4. **Watchlist / Portfolio** — Saved watchlist and portfolio positions
5. **More** — Settings, additional options, and secondary navigation

### Sector Screens on Mobile
- **From Home** — Clicking a home tile can navigate to a sector screen or instrument detail
- **From More Menu** — Secondary menu provides access to all available sector screens

### Navigation Flow
- **Search → Detail** — User searches for an instrument, clicks result to open InstrumentDetail
- **Home Tile → Detail or Sector** — User clicks a tile, which leads to either:
  - InstrumentDetail (single instrument)
  - Sector Screen (tabular view of multiple instruments, clickable for detail)
- **Sector Screen → Detail** — User clicks a ticker in the sector screen

---

## Relationship Model

### Search → Detail (Always Accessible)
- From any search interface (header on desktop, Search tab on mobile), users can navigate directly to **InstrumentDetail**
- InstrumentDetail displays comprehensive data: price, chart, news, fundamentals, etc.

### Sector Screen → Detail
- Sector screens (e.g., "Top Gainers", "Trending") display tabular data with clickable tickers
- Clicking a ticker navigates to InstrumentDetail for that instrument
- Example flow: Home → Sector Screen → Detail

### Legacy Panels as Power-User Layout Blocks
- **Portfolio Panel** — Shows watchlist or custom portfolio; draggable tickers navigate to detail
- **Alerts Panel** — Manages alert rules; triggering an alert can navigate to detail
- **Screener Panel** — Displays screener results; clickable tickers navigate to detail
- These panels can be combined in custom layouts for advanced traders

---

## URL and State Structure

### Desktop
- `/` — Home/Dashboard
- `/search?q=<query>` — Search with initial query (optional)
- `/detail/<symbol>` — InstrumentDetail for a specific symbol
- `/sector/<screenName>` — Sector screen (e.g., `/sector/top-gainers`)

### Mobile
- `/` — Home tab
- `/charts` — Charts tab
- `/search` — Search tab (optionally with query in state)
- `/watchlist` — Watchlist/Portfolio tab
- `/more` — More menu tab
- `/detail/<symbol>` — InstrumentDetail overlay or full-screen view

---

## Search Features & Behavior

### Query Resolution
- User types: ticker, company name, or natural language
- **Alias Resolution** — Common names (e.g., "WTI", "CRUDE") resolve to canonical symbols
- **Registry Search** — Fast lookup against known instruments
- **Polygon Search** — Extended search for OTC, micro-cap, and international instruments
- **AI Semantic Search** — Natural language understanding (e.g., "tech stocks near 50-day MA")

### Result Normalization
- All results normalized to consistent shape: `{ symbol, name, assetClass, exchange, raw }`
- Metadata preserved for UI rendering (e.g., asset type badges, coverage indicators)

### Recent Searches
- Module-level cache stores up to 5 most recent searches
- Persists across page navigation but clears on full page refresh
- Displayed as quick-access list when search is focused with empty query

---

## Keyboard Shortcuts

### Desktop
- **Cmd/Ctrl+K** — Open search
- **/** — Open search (when not in input)
- **ArrowUp / ArrowDown** — Navigate search results
- **Enter** — Select highlighted result
- **Escape** — Close search modal

### Mobile
- **Tab navigation** — Navigate between bottom tabs
- **Search tab** — Focus on search input
- **Results** — Swipe/scroll to browse, tap to select

---

## Design Principles

1. **Search First** — Search is primary navigation mechanism; always visible or one keystroke away
2. **Multi-Path Navigation** — Users can reach instruments via search, sector screens, or home tiles
3. **Consistent Detail View** — All paths converge to a single InstrumentDetail component
4. **Mobile Parity** — Core functionality available on both desktop and mobile
5. **Power-User Flexibility** — Advanced users can combine panels for custom analysis workflows
