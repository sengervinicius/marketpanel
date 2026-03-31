// BrazilPanel.jsx â B3 stocks via server Yahoo Finance proxy
// Title and symbols are user-configurable via SettingsContext + PanelConfigModal.
import { useState, useEffect, useCallback, useRef, memo } from 'react';
import { useSettings } from '../../context/SettingsContext';
import PanelConfigModal from '../common/PanelConfigModal';
import EditablePanelHeader from '../common/EditablePanelHeader';
import { apiFetch } from '../../utils/api';

const SERVER = import.meta.env.VITE_API_URL || import.meta.env.VITE_SERVER_URL || '';

const fmt    = n => n == null ? 'â' : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtPct = n => n == null ? 'â' : (n >= 0 ? '+' : '') + n.toFixed(2) + '%';

const showInfo = (e, symbol, label, type) => {
  e.preventDefault();
  window.dispatchEvent(new CustomEvent('ticker:rightclick', {
    detail: { symbol, label, type, x: e.clientX + 6, y: e.clientY + 6 },
  }));
};

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

  const handleDropTicker = (ticker) => {
    const sym = ticker.trim().toUpperCase();
    const withSA = sym.endsWith('.SA') ? sym : sym + '.SA';
    if (!panelSymbols.includes(withSA) && !panelSymbols.includes(sym)) {
      updatePanelConfig('brazilB3', { title: panelTitle, symbols: [...panelSymbols, withSA] });
    }
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
          // symbols may be stored with or without .SA suffix
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

  const col = { color: '#555', fontSize: 7, letterSpacing: '0.15em', textTransform: 'uppercase' };

  const badge = error
    ? <span style={{ color: '#f44', fontSize: 7 }}>{error}</span>
    : lastUpdate && <span style={{ color: '#444', fontSize: 7 }}>{lastUpdate.toLocaleTimeString()}</span>;

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#0a0a0a' }}>
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
          style={{ background: 'none', border: '1px solid #2a2a2a', color: '#555', fontSize: 9, padding: '1px 5px', cursor: 'pointer', fontFamily: 'inherit', borderRadius: 2 }}
        >{collapsed ? '+' : 'â'}</button>
      </EditablePanelHeader>

      {/* Column headers */}
      <div style={{ display: 'grid', gridTemplateColumns: '52px 1fr 64px 52px', padding: '3px 8px', borderBottom: '1px solid #1a1a1a', flexShrink: 0 }}>
        <span style={col}>TICKER</span>
        <span style={col}>NAME</span>
        <span style={{ ...col, textAlign: 'right' }}>PRICE</span>
        <span style={{ ...col, textAlign: 'right' }}>CHG%</span>
      </div>

      {/* Rows */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {loading && !stocks.length && (
          <div style={{ padding: 12, color: '#444', fontSize: 8, textAlign: 'center' }}>LOADING...</div>
        )}
        {!loading && !error && !displayedStocks.length && (
          <div style={{ padding: 12, color: '#444', fontSize: 8, textAlign: 'center' }}>NO DATA</div>
        )}
        {displayedStocks.map((s, i) => {
          const up  = (s.changePct ?? 0) >= 0;
          const clr = up ? '#00c853' : '#f44336';
          return (
            <div
              key={s.symbol}
              data-ticker={s.symbol + '.SA'}
              data-ticker-label={s.name}
              data-ticker-type="BR"
              draggable
              onDragStart={e => {
                e.dataTransfer.setData('application/x-ticker',
                  JSON.stringify({ symbol: s.symbol + '.SA', label: s.name || s.symbol }));
                e.dataTransfer.effectAllowed = 'copy';
              }}
              onClick={() => onTickerClick?.(s.symbol + '.SA')}
              onDoubleClick={() => onOpenDetail?.(s.symbol + '.SA')}
              onContextMenu={e => showInfo(e, s.symbol + '.SA', s.name || s.symbol, 'BR')}
              onTouchStart={(e) => { e.stopPropagation(); clearTimeout(ptRef.current); ptRef.current = setTimeout(() => onOpenDetail?.(s.symbol + '.SA'), 500); }}
              onTouchEnd={() => clearTimeout(ptRef.current)}
              onTouchMove={() => clearTimeout(ptRef.current)}
              style={{
                display: 'grid', gridTemplateColumns: '52px 1fr 64px 52px',
                padding: '3px 8px', borderBottom: '1px solid #111',
                alignItems: 'center', cursor: 'grab',
                background: i % 2 === 0 ? 'transparent' : '#070709',
              }}
            >
              <span style={{ color: '#e8a020', fontWeight: 700, fontSize: 9 }}>{s.symbol}</span>
              <span style={{ color: '#666', fontSize: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {s.name}
              </span>
              <span style={{ color: '#ccc', fontSize: 9, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                {fmt(s.price)}
              </span>
              <span style={{ color: clr, fontSize: 9, textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                {fmtPct(s.changePct)}
              </span>
            </div>
          );
        })}
      </div>

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
    </div>
  );
}


export { BrazilPanel };
export default memo(BrazilPanel);
