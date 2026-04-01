// BrazilPanel.jsx — B3 stocks via server Yahoo Finance proxy
// Title and symbols are user-configurable via SettingsContext + PanelConfigModal.
import { useState, useEffect, useCallback, useRef, memo } from 'react';
import { useSettings } from '../../context/SettingsContext';
import PanelConfigModal from '../common/PanelConfigModal';
import EditablePanelHeader from '../common/EditablePanelHeader';
import PanelShell from '../common/PanelShell';
import { PriceRow } from '../common/PriceRow';
import ColumnHeaders from '../common/ColumnHeaders';
import { apiFetch } from '../../utils/api';

const COLS = '52px 1fr 64px 52px';

const SORT_COLS = [
  { key: 'symbol', label: 'TICKER', align: 'left' },
  { key: 'name',   label: 'NAME',   align: 'left' },
  { key: 'price',  label: 'PRICE',  align: 'right' },
  { key: 'chg',    label: 'CHG%',   align: 'right' },
];

function BrazilPanel({ onTickerClick, onOpenDetail }) {
  const ptRef = useRef(null);
  const { settings, updatePanelConfig } = useSettings();

  // Panel config from settings (with fallback defaults)
  const panelCfg = settings?.panels?.brazilB3 || {
    title: 'Brazil B3',
    symbols: ['VALE3.SA','PETR4.SA','ITUB4.SA','BBDC4.SA','ABEV3.SA','WEGE3.SA','RENT3.SA'],
  };
  const panelTitle   = panelCfg.title   || 'Brazil B3';
  const panelSymbols = panelCfg.symbols || [];

  const [stocks, setStocks]         = useState([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [configOpen, setConfigOpen] = useState(false);
  const [searchFilter, setSearchFilter] = useState('');
  const [collapsed, setCollapsed] = useState(false);
  const [sortKey, setSortKey] = useState(null);
  const [sortDir, setSortDir] = useState('desc');

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

  const fetchData = useCallback(async () => {
    try {
      const res = await apiFetch('/api/snapshot/brazil');
      if (!res.ok) throw new Error('server ' + res.status);
      const json = await res.json();
      if (!json.results?.length) throw new Error('no results');
      setStocks(json.results.map(s => ({
        symbol:    s.symbol,
        name:      s.name || s.symbol,
        price:     s.price,
        change:    s.change,
        changePct: s.changePct,
        volume:    s.volume,
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
    const id = setInterval(fetchData, 15_000);
    return () => clearInterval(id);
  }, [fetchData]);

  // Filter displayed rows to only the configured symbols (preserving order)
  let displayedStocks = panelSymbols.length > 0
    ? panelSymbols
        .map(sym => {
          const baseSym = sym.replace(/\.SA$/i, '');
          return stocks.find(s => s.symbol === baseSym || s.symbol === sym);
        })
        .filter(Boolean)
    : stocks;

  // Apply search filter
  if (searchFilter) {
    const sq = searchFilter.toLowerCase();
    displayedStocks = displayedStocks.filter(s =>
      s.symbol.toLowerCase().includes(sq) || s.name.toLowerCase().includes(sq)
    );
  }

  // Apply sorting
  if (sortKey) {
    displayedStocks = [...displayedStocks].sort((a, b) => {
      let va, vb;
      if (sortKey === 'symbol') { va = a.symbol; vb = b.symbol; }
      else if (sortKey === 'name') { va = a.name; vb = b.name; }
      else if (sortKey === 'price') { va = a.price ?? -Infinity; vb = b.price ?? -Infinity; }
      else if (sortKey === 'chg')   { va = a.changePct ?? -Infinity; vb = b.changePct ?? -Infinity; }
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
      >
        <button
          onClick={() => setCollapsed(v => !v)}
          title={collapsed ? 'Expand' : 'Collapse'}
          style={{ background: 'none', border: '1px solid var(--border-strong)', color: 'var(--text-muted)', fontSize: 9, padding: '1px 5px', cursor: 'pointer', fontFamily: 'inherit', borderRadius: 'var(--radius-sm)' }}
        >{collapsed ? '+' : '−'}</button>
      </EditablePanelHeader>

      {!collapsed && (<>
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
          {loading && !stocks.length && (
            <div style={{ padding: 'var(--sp-5)', color: 'var(--text-muted)', fontSize: 'var(--font-base)', textAlign: 'center' }}>LOADING...</div>
          )}
          {!loading && !error && !displayedStocks.length && (
            <div style={{ padding: 'var(--sp-5)', color: 'var(--text-muted)', fontSize: 'var(--font-base)', textAlign: 'center' }}>NO DATA</div>
          )}
          {displayedStocks.map(s => (
            <PriceRow
              key={s.symbol}
              symbol={s.symbol + '.SA'}
              displaySymbol={s.symbol}
              name={s.name}
              price={s.price}
              changePct={s.changePct}
              symbolColor="var(--section-brazil)"
              columns={COLS}
              draggable
              dragData={{ symbol: s.symbol + '.SA', name: s.name || s.symbol, type: 'BR' }}
              onClick={() => onTickerClick?.(s.symbol + '.SA')}
              onDoubleClick={() => onOpenDetail?.(s.symbol + '.SA')}
              onTouchHold={() => onOpenDetail?.(s.symbol + '.SA')}
              touchRef={ptRef}
              dataAttrs={{
                'data-ticker': s.symbol + '.SA',
                'data-ticker-label': s.name || s.symbol,
                'data-ticker-type': 'BR',
              }}
            />
          ))}
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
