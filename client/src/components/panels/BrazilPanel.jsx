// BrazilPanel.jsx — B3 stocks via server Yahoo Finance proxy
// Phase 10: Removed bespoke polling loop; prices flow through PriceContext via PriceRow's
// ticker prop. The initial /api/snapshot/brazil fetch seeds the batch map, and PriceRow's
// useMergedTickerQuote handles fallback for any symbol not in the snapshot.
// CIO-note (2026-04-21): removed the inline USD/BRL/MIX revenue-mix pill.
// It was misread as a price-currency label (users thought VALE3 was quoted
// in USD). The underlying revenueMix field is still carried on the row
// object so AI context / drag metadata / detail pages can surface it with
// clearer wording, but we do NOT render a 3-char badge next to the name.
import { useState, useEffect, useCallback, useRef, useMemo, memo } from 'react';
import { useSettings } from '../../context/SettingsContext';
import { useOpenDetail } from '../../context/OpenDetailContext';
import { useSparklineData } from '../../hooks/useSparklineData';
import PanelConfigModal from '../common/PanelConfigModal';
import EditablePanelHeader from '../common/EditablePanelHeader';
import PanelShell from '../common/PanelShell';
import { PriceRow } from '../common/PriceRow';
import ColumnHeaders from '../common/ColumnHeaders';
import { apiFetch } from '../../utils/api';
import { COLS_STANDARD_SPARK } from '../../utils/panelColumns';

// CIO-note (2026-04-20): was '52px 1fr 64px 52px' — CHG% of 52px crushed
// 2-digit % values into the price column (ONCO3 +15.33% case). The
// shared template reserves 76px for CHG% and 80px for price across the
// board so this bug cannot recur panel-by-panel.
const COLS = COLS_STANDARD_SPARK;

const SORT_COLS = [
  { key: 'symbol', label: 'TICKER', align: 'left' },
  { key: 'name',   label: 'NAME',   align: 'left' },
  { key: 'price',  label: 'PRICE',  align: 'right' },
  { key: 'chg',    label: 'CHG%',   align: 'right' },
];

// H2b item 4 — BCB Focus survey strip (Selic / IPCA / PIB / FX medians
// for current + next year). Hidden entirely when /api/market/brazil-focus
// is degraded; per-field em-dash when a single indicator is missing.
const focusStyles = {
  strip: {
    display: 'flex', alignItems: 'center', gap: 8, padding: '2px 8px',
    borderBottom: '1px solid var(--border-subtle)', fontFamily: 'var(--font-mono)',
    fontSize: 10, color: 'var(--text-secondary)', whiteSpace: 'nowrap',
    overflowX: 'auto', flexShrink: 0,
  },
  tag: { fontWeight: 700, letterSpacing: '0.08em', color: 'var(--sector-brazil)' },
  item: { display: 'inline-flex', gap: 3, alignItems: 'baseline' },
  label: { color: 'var(--text-faint)', fontSize: 9, letterSpacing: '0.05em' },
  value: { color: 'var(--text-primary)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' },
  sep: { color: 'var(--text-faint)' },
  yearBtn: {
    marginLeft: 'auto', background: 'none', border: '1px solid var(--border-strong)',
    color: 'var(--text-muted)', fontSize: 9, padding: '0 5px', cursor: 'pointer',
    borderRadius: 2, fontFamily: 'var(--font-mono)', letterSpacing: '0.05em', flexShrink: 0,
  },
};

function fmtFocus(v, digits = 2, suffix = '') {
  return v == null ? '—' : v.toFixed(digits) + suffix;
}

function FocusStrip({ focus }) {
  const yearKeys = useMemo(
    () => (focus ? Object.keys(focus.years || {}).sort() : []),
    [focus]
  );
  const [yearIdx, setYearIdx] = useState(0);
  if (!focus || yearKeys.length === 0) return null;

  const year = yearKeys[Math.min(yearIdx, yearKeys.length - 1)];
  const d = focus.years[year] || {};
  const hasAny = ['selic', 'ipca', 'pib', 'fx'].some(k => d[k] != null);
  if (!hasAny && yearKeys.length === 1) return null;

  const items = [
    ['SELIC', fmtFocus(d.selic, 2, '%')],
    ['IPCA',  fmtFocus(d.ipca, 2, '%')],
    ['PIB',   fmtFocus(d.pib, 1, '%')],
    ['FX',    fmtFocus(d.fx, 2)],
  ];

  return (
    <div
      style={focusStyles.strip}
      title={`BCB Focus survey medians${focus.referenceDate ? ` · ${focus.referenceDate}` : ''}`}
    >
      <span style={focusStyles.tag}>FOCUS {year.slice(2)}</span>
      {items.map(([label, value], i) => (
        <span key={label} style={focusStyles.item}>
          {i > 0 && <span style={focusStyles.sep}>·</span>}
          <span style={focusStyles.label}>{label}</span>
          <span style={focusStyles.value}>{value}</span>
        </span>
      ))}
      {yearKeys.length > 1 && (
        <button
          style={focusStyles.yearBtn}
          onClick={() => setYearIdx(i => (i + 1) % yearKeys.length)}
          title="Toggle reference year"
        >
          {yearKeys[(yearIdx + 1) % yearKeys.length].slice(2)} ›
        </button>
      )}
    </div>
  );
}

function BrazilPanel({ onTickerClick }) {
  const openDetail = useOpenDetail();
  const ptRef = useRef(null);
  const { settings, updatePanelConfig } = useSettings();

  // Panel config from settings (with fallback defaults)
  const panelCfg = settings?.panels?.brazilB3 || {
    title: 'Brazil B3',
    symbols: ['VALE3.SA','PETR4.SA','ITUB4.SA','BBDC4.SA','ABEV3.SA','WEGE3.SA','RENT3.SA'],
  };
  const panelTitle   = panelCfg.title   || 'Brazil B3';
  const panelSymbols = panelCfg.symbols || [];

  // Snapshot from server — used to seed names and initial prices.
  // PriceRow handles live updates via PriceContext's ticker prop.
  const [snapshot, setSnapshot]       = useState([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState(null);
  const [lastUpdate, setLastUpdate]   = useState(null);
  const [lastUpdated, setLastUpdated] = useState(new Date());
  const [configOpen, setConfigOpen]   = useState(false);
  const [searchFilter, setSearchFilter] = useState('');
  const [collapsed, setCollapsed]     = useState(false);
  const [sortKey, setSortKey]         = useState(null);
  const [sortDir, setSortDir]         = useState('desc');

  // Phase 2: Sparkline data for Brazil tickers
  const brazilTickers = useMemo(() => panelSymbols.map(sym => sym.endsWith('.SA') ? sym : sym + '.SA'), [panelSymbols]);
  const sparklines = useSparklineData(brazilTickers);

  // H2b item 4 — BCB Focus strip (server caches 6h; hidden on failure)
  const [focus, setFocus] = useState(null);
  useEffect(() => {
    let alive = true;
    apiFetch('/api/market/brazil-focus')
      .then(r => (r.ok ? r.json() : null))
      .then(j => { if (alive && j?.ok && j.years) setFocus(j); })
      .catch(() => { /* strip stays hidden */ });
    return () => { alive = false; };
  }, []);

  // Update lastUpdated when snapshot changes
  useEffect(() => {
    if (snapshot.length > 0) {
      setLastUpdated(new Date());
    }
  }, [snapshot]);

  const handleDropTicker = (ticker) => {
    const sym = ticker.trim().toUpperCase();
    const withSA = sym.endsWith('.SA') ? sym : sym + '.SA';
    if (!panelSymbols.includes(withSA) && !panelSymbols.includes(sym)) {
      updatePanelConfig('brazilB3', { title: panelTitle, symbols: [...panelSymbols, withSA] });
    }
  };

  const handleSortClick = (key) => {
    if (sortKey === key) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortKey(key); setSortDir('desc'); }
  };

  // Fetch snapshot once + refresh every 30s (just for metadata/names; PriceContext handles live prices)
  const fetchData = useCallback(async () => {
    try {
      const res = await apiFetch('/api/snapshot/brazil');
      if (!res.ok) throw new Error('server ' + res.status);
      const json = await res.json();
      if (!json.results?.length) throw new Error('no results');
      setSnapshot(json.results.map(s => ({
        symbol:     s.symbol,
        name:       s.name || s.symbol,
        price:      s.price,
        change:     s.change,
        changePct:  s.changePct,
        volume:     s.volume,
        // Phase 9.5 metadata — carried through so the revenue-mix pill
        // can render without a second fetch.
        sector:     s.sector     || null,
        capTier:    s.capTier    || null,
        revenueMix: s.revenueMix || null,
      })));
      setLastUpdate(new Date());
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const id = setInterval(fetchData, 30_000); // metadata refresh (PriceContext handles live)
    return () => clearInterval(id);
  }, [fetchData]);

  // Build a batchMap keyed by both bare symbol and .SA symbol for PriceRow lookup
  const batchMap = useMemo(() => {
    const m = {};
    snapshot.forEach(s => {
      m[s.symbol] = s;
      m[s.symbol + '.SA'] = s;
      // Also keyed without .SA if it has it
      if (s.symbol.endsWith('.SA')) {
        m[s.symbol.replace('.SA', '')] = s;
      }
    });
    return m;
  }, [snapshot]);

  // Filter displayed rows to only the configured symbols (preserving order)
  let displayedStocks = panelSymbols.length > 0
    ? panelSymbols
        .map(sym => {
          const baseSym = sym.replace(/\.SA$/i, '');
          return snapshot.find(s => s.symbol === baseSym || s.symbol === sym)
            || { symbol: baseSym, name: baseSym, price: null, changePct: null }; // placeholder for PriceContext
        })
    : snapshot;

  // Apply search filter
  if (searchFilter) {
    const sq = searchFilter.toLowerCase();
    displayedStocks = displayedStocks.filter(s =>
      s.symbol.toLowerCase().includes(sq) || s.name.toLowerCase().includes(sq)
    );
  }

  // Apply sorting — uses batchMap for sort values; PriceContext extras aren't in the map
  // but that's acceptable since batch data IS the same source as PriceContext
  if (sortKey) {
    displayedStocks = [...displayedStocks].sort((a, b) => {
      let va, vb;
      const da = batchMap[a.symbol] || {};
      const db = batchMap[b.symbol] || {};
      if (sortKey === 'symbol') { va = a.symbol; vb = b.symbol; }
      else if (sortKey === 'name') { va = a.name; vb = b.name; }
      else if (sortKey === 'price') { va = da.price ?? -Infinity; vb = db.price ?? -Infinity; }
      else if (sortKey === 'chg')   { va = da.changePct ?? -Infinity; vb = db.changePct ?? -Infinity; }
      if (typeof va === 'string') return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
      return sortDir === 'asc' ? va - vb : vb - va;
    });
  }

  const badge = error
    ? <span style={{ color: 'var(--price-down)', fontSize: 'var(--font-xs)' }}>{error}</span>
    : lastUpdate && <span style={{ color: 'var(--text-faint)', fontSize: 'var(--font-xs)' }}>{lastUpdate.toLocaleTimeString()}</span>;

  return (
    <PanelShell onDropTicker={handleDropTicker}>
      {/* Header */}
      <EditablePanelHeader
        title={panelTitle}
        onTitleChange={(t) => updatePanelConfig('brazilB3', { title: t, symbols: panelSymbols })}
        onConfigOpen={() => setConfigOpen(true)}
        onDropTicker={handleDropTicker}
        onSearchChange={setSearchFilter}
        feedBadge={badge}
        lastUpdated={lastUpdated}
        source="Yahoo/BCB"
      >
        <button className="btn"
          onClick={() => setCollapsed(v => !v)}
          title={collapsed ? 'Expand' : 'Collapse'}
          style={{ background: 'none', border: '1px solid var(--border-strong)', color: 'var(--text-muted)', fontSize: 9, padding: '1px 5px' }}
        >{collapsed ? '+' : '−'}</button>
      </EditablePanelHeader>

      {!collapsed && (<>
        {/* BCB Focus strip (H2b) — hides itself when the endpoint degrades */}
        <FocusStrip focus={focus} />

        {/* Column headers */}
        <ColumnHeaders
          columns={SORT_COLS}
          gridColumns={COLS}
          sortKey={sortKey}
          sortDir={sortDir}
          onSortClick={handleSortClick}
        />

        {/* Rows */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {loading && !snapshot.length && (
            <div style={{ padding: 'var(--sp-5)', color: 'var(--text-muted)', textAlign: 'center' }}>LOADING...</div>
          )}
          {!loading && !error && !displayedStocks.length && (
            <div style={{ padding: 'var(--sp-5)', color: 'var(--text-faint)', textAlign: 'center', fontSize: 11 }}>Loading B3 data...</div>
          )}
          {displayedStocks.map(s => {
            const sym = s.symbol.endsWith('.SA') ? s.symbol : s.symbol + '.SA';
            const displaySym = s.symbol.replace('.SA', '');
            const d = batchMap[s.symbol] || {};
            // revenueMix is still carried on row objects + drag metadata
            // so AI context and the instrument-detail pane can use it;
            // we just don't render the inline 3-char pill anymore.
            const mix = d.revenueMix || s.revenueMix || null;
            return (
              <PriceRow
                key={sym}
                symbol={sym}
                ticker={sym}
                displaySymbol={displaySym}
                name={s.name}
                price={d.price}
                changePct={d.changePct}
                symbolColor="var(--section-brazil)"
                columns={COLS}
                draggable
                dragData={{ symbol: sym, name: s.name || s.symbol, type: 'BR', revenueMix: mix }}
                onClick={() => onTickerClick?.(sym)}
                onDoubleClick={() => openDetail(sym)}
                onTouchHold={() => openDetail(sym)}
                touchRef={ptRef}
                sparklineData={sparklines[sym]}
                dataAttrs={{
                  'data-ticker': sym,
                  'data-ticker-label': s.name || s.symbol,
                  'data-ticker-type': 'BR',
                  'data-revenue-mix': mix || '',
                }}
              />
            );
          })}
        </div>
      </>)}

      {/* Panel config modal */}
      {configOpen && (
        <PanelConfigModal
          panelId="brazilB3"
          currentTitle={panelTitle}
          currentSymbols={panelSymbols}
          assetClasses={['equity']}
          onSave={({ title, symbols }) => {
            updatePanelConfig('brazilB3', { title, symbols });
            setConfigOpen(false);
          }}
          onClose={() => setConfigOpen(false)}
        />
      )}
    </PanelShell>
  );
}


export { BrazilPanel };
export default memo(BrazilPanel);
