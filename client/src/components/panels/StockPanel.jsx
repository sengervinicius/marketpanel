// StockPanel.jsx — US equities + Brazil ADRs with section headers and sortable columns
// Features: feed-status badge, collapse, movers filter, heatmap view
import { useRef, useState, useMemo, memo } from 'react';
import { useSettings } from '../../context/SettingsContext';
import PanelConfigModal from '../common/PanelConfigModal';
import EditablePanelHeader from '../common/EditablePanelHeader';
import { US_STOCKS, BRAZIL_ADRS } from '../../utils/constants';
import { useFeedStatus } from '../../context/FeedStatusContext';

const fmt    = (n) => n == null ? '—' : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtPct = (n) => n == null ? '—' : (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
const COLS   = '60px 1fr 68px 60px';

const showInfo = (e, symbol, label, type) => {
  e.preventDefault();
  window.dispatchEvent(new CustomEvent('ticker:rightclick', {
    detail: { symbol, label, type, x: e.clientX + 6, y: e.clientY + 6 },
  }));
};

function SectionDivider({ label, color = '#444' }) {
  return (
    <div style={{
      padding: '2px 8px', background: '#0c0c0c',
      borderTop: '1px solid #1a1a1a', borderBottom: '1px solid #1a1a1a',
    }}>
      <span style={{ color, fontSize: 7, fontWeight: 700, letterSpacing: '0.12em' }}>
        —— {label} ————————————————————————
      </span>
    </div>
  );
}

const SORT_COLS = [
  { key: 'symbol', label: 'TICKER', align: 'left' },
  { key: 'name',   label: 'NAME',   align: 'left' },
  { key: 'price',  label: 'LAST',   align: 'right' },
  { key: 'chg',    label: 'CHG%',   align: 'right' },
];

function sortItems(items, data, sortKey, sortDir) {
  if (!sortKey) return items;
  return [...items].sort((a, b) => {
    let va, vb;
    if (sortKey === 'symbol') { va = a.symbol; vb = b.symbol; }
    else if (sortKey === 'name') { va = a.label; vb = b.label; }
    else if (sortKey === 'price') { va = data?.[a.symbol]?.price ?? -Infinity; vb = data?.[b.symbol]?.price ?? -Infinity; }
    else if (sortKey === 'chg') { va = data?.[a.symbol]?.changePct ?? -Infinity; vb = data?.[b.symbol]?.changePct ?? -Infinity; }
    if (typeof va === 'string') return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
    return sortDir === 'asc' ? va - vb : vb - va;
  });
}

// Heatmap cell color based on % change
function heatColor(pct) {
  if (pct == null) return '#1a1a1a';
  if (pct >= 3)  return '#1b5e20';
  if (pct >= 1)  return '#2e7d32';
  if (pct >= 0)  return '#1a3a1a';
  if (pct >= -1) return '#3a1a1a';
  if (pct >= -3) return '#7f1010';
  return '#b71c1c';
}

function StockPanel({ data = {}, loading, onTickerClick, onOpenDetail }) {
  const ptRef = useRef(null);
  const { settings, updatePanelConfig } = useSettings();

  // Panel config from settings (with fallback defaults)
  const panelCfg = settings?.panels?.usEquities || {
    title: 'US Equities',
    symbols: [...US_STOCKS.map(s => s.symbol), ...BRAZIL_ADRS.map(s => s.symbol)],
  };
  const panelTitle   = panelCfg.title   || 'US Equities';
  const panelSymbols = panelCfg.symbols || [];

  const [sortKey,    setSortKey]    = useState(null);
  const [sortDir,    setSortDir]    = useState('desc');
  const [collapsed,  setCollapsed]  = useState(false);
  const [moversOnly, setMoversOnly] = useState(false);
  const [heatmap,    setHeatmap]    = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [searchFilter, setSearchFilter] = useState('');
  const { getBadge } = useFeedStatus();
  const badge = getBadge('stocks');

  // Handle drop ticker into panel
  const handleDropTicker = (ticker) => {
    const sym = ticker.trim().toUpperCase();
    if (sym && !panelSymbols.includes(sym)) {
      updatePanelConfig('usEquities', { title: panelTitle, symbols: [...panelSymbols, sym] });
    }
  };

  const handleSortClick = (key) => {
    if (sortKey === key) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortKey(key); setSortDir('desc'); }
  };

  const baseUS = panelSymbols.length > 0
    ? US_STOCKS.filter(s => panelSymbols.includes(s.symbol))
    : US_STOCKS;

  const baseBrazil = panelSymbols.length > 0
    ? BRAZIL_ADRS.filter(s => panelSymbols.includes(s.symbol))
    : BRAZIL_ADRS;

  const sortedUS     = useMemo(() => sortItems(baseUS,     data, sortKey, sortDir), [data, sortKey, sortDir, baseUS]);
  const sortedBrazil = useMemo(() => sortItems(baseBrazil, data, sortKey, sortDir), [data, sortKey, sortDir, baseBrazil]);

  // Movers filter: abs(changePct) >= 2%
  const movedUS     = useMemo(() => moversOnly ? sortedUS.filter(s    => Math.abs(data?.[s.symbol]?.changePct ?? 0) >= 2)     : sortedUS,     [sortedUS,     data, moversOnly]);
  const movedBrazil = useMemo(() => moversOnly ? sortedBrazil.filter(s => Math.abs(data?.[s.symbol]?.changePct ?? 0) >= 2)     : sortedBrazil, [sortedBrazil, data, moversOnly]);

  // Search filter
  const sq = searchFilter.toLowerCase();
  const filteredUS     = useMemo(() => !sq ? movedUS     : movedUS.filter(s     => s.symbol.toLowerCase().includes(sq) || (s.name || '').toLowerCase().includes(sq)), [movedUS, sq]);
  const filteredBrazil = useMemo(() => !sq ? movedBrazil : movedBrazil.filter(s => s.symbol.toLowerCase().includes(sq) || (s.name || '').toLowerCase().includes(sq)), [movedBrazil, sq]);

  // All items for heatmap
  const allItems = useMemo(() => [...filteredUS, ...filteredBrazil], [filteredUS, filteredBrazil]);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#0a0a0a' }}>
      {/* Header */}
      <EditablePanelHeader
        title={panelTitle}
        subsections={['BRAZIL ADRs']}
        onTitleChange={(t) => updatePanelConfig('usEquities', { title: t, symbols: panelSymbols })}
        onConfigOpen={() => setConfigOpen(true)}
        onDropTicker={handleDropTicker}
        onSearchChange={setSearchFilter}
        feedBadge={badge}
      >
        {/* Movers filter toggle */}
        <button
          onClick={() => setMoversOnly(v => !v)}
          title="Show only movers ≥ 2%"
          style={{ background: moversOnly ? '#1a1000' : 'none', border: `1px solid ${moversOnly ? '#ff9900' : '#2a2a2a'}`, color: moversOnly ? '#ff9900' : '#444', fontSize: 7, padding: '1px 4px', cursor: 'pointer', fontFamily: 'inherit', borderRadius: 2 }}
        >≥2%</button>
        {/* Heatmap toggle */}
        <button
          onClick={() => setHeatmap(v => !v)}
          title="Toggle heatmap view"
          style={{ background: heatmap ? '#0a001a' : 'none', border: `1px solid ${heatmap ? '#ce93d8' : '#2a2a2a'}`, color: heatmap ? '#ce93d8' : '#444', fontSize: 7, padding: '1px 4px', cursor: 'pointer', fontFamily: 'inherit', borderRadius: 2 }}
        >HEAT</button>
        {/* Collapse toggle */}
        <button
          onClick={() => setCollapsed(v => !v)}
          title={collapsed ? 'Expand' : 'Collapse'}
          style={{ background: 'none', border: '1px solid #2a2a2a', color: '#555', fontSize: 9, padding: '1px 5px', cursor: 'pointer', fontFamily: 'inherit', borderRadius: 2 }}
        >{collapsed ? '+' : '−'}</button>
      </EditablePanelHeader>

      {!collapsed && (
        <>
          {/* Sortable column headers (hidden in heatmap mode) */}
          {!heatmap && (
            <div style={{ display: 'grid', gridTemplateColumns: COLS, padding: '2px 8px', borderBottom: '1px solid #1a1a1a', flexShrink: 0 }}>
              {SORT_COLS.map(({ key, label, align }) => {
                const active = sortKey === key;
                const arrow  = active ? (sortDir === 'desc' ? ' ▼' : ' ▲') : '';
                return (
                  <span
                    key={key}
                    onClick={() => handleSortClick(key)}
                    style={{
                      color: active ? '#ff9900' : '#444',
                      fontSize: '8px', fontWeight: 700, letterSpacing: '1px',
                      textAlign: align === 'right' ? 'right' : 'left',
                      paddingRight: align === 'right' ? 4 : 0,
                      cursor: 'pointer', userSelect: 'none',
                    }}
                  >
                    {label}{arrow}
                  </span>
                );
              })}
            </div>
          )}

          <div style={{ flex: 1, overflowY: 'auto' }}>
            {loading || !data ? (
              <div style={{ padding: '20px', textAlign: 'center', color: '#444', fontSize: '10px' }}>LOADING...</div>
            ) : heatmap ? (
              /* Heatmap grid */
              <div style={{ padding: '6px 4px', display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                {allItems.map(s => {
                  const pct  = data?.[s.symbol]?.changePct ?? null;
                  const bg   = heatColor(pct);
                  const pos  = (pct ?? 0) >= 0;
                  return (
                    <div
                      key={s.symbol}
                      data-ticker={s.symbol}
                      data-ticker-label={s.label}
                      data-ticker-type="EQUITY"
                      onClick={() => onTickerClick?.(s.symbol)}
                      onDoubleClick={() => onOpenDetail?.(s.symbol)}
                      onContextMenu={e => showInfo(e, s.symbol, s.label, 'EQUITY')}
                      title={`${s.symbol}\n${fmtPct(pct)}`}
                      style={{
                        width: 54, height: 38, background: bg,
                        border: '1px solid #222', borderRadius: 2, cursor: 'pointer',
                        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                        transition: 'filter 0.15s',
                      }}
                      onMouseEnter={e => e.currentTarget.style.filter = 'brightness(1.4)'}
                      onMouseLeave={e => e.currentTarget.style.filter = 'none'}
                    >
                      <span style={{ color: '#e0e0e0', fontSize: 8, fontWeight: 700, letterSpacing: '0.04em' }}>{s.symbol.replace('.SA', '')}</span>
                      <span style={{ color: pos ? '#81c784' : '#ef9a9a', fontSize: 8, fontWeight: 600, marginTop: 1 }}>{fmtPct(pct)}</span>
                    </div>
                  );
                })}
                {allItems.length === 0 && (
                  <div style={{ color: '#444', fontSize: 9, padding: 12 }}>No movers matching filter.</div>
                )}
              </div>
            ) : (
              <>
                <SectionDivider label="US EQUITIES" color="#00bcd4" />
                {filteredUS.map(s => (
                  <div
                    key={s.symbol}
                    data-ticker={s.symbol}
                    data-ticker-label={s.label}
                    data-ticker-type="EQUITY"
                    draggable
                    onDragStart={e => {
                      e.dataTransfer.effectAllowed = 'copy';
                      e.dataTransfer.setData('application/x-ticker', JSON.stringify({ symbol: s.symbol, name: s.label, type: 'EQUITY' }));
                    }}
                    onClick={() => onTickerClick?.(s.symbol)}
                    onDoubleClick={() => onOpenDetail?.(s.symbol)}
                    onTouchStart={(e) => { e.stopPropagation(); clearTimeout(ptRef.current); ptRef.current = setTimeout(() => onOpenDetail?.(s.symbol), 500); }}
                    onTouchEnd={() => clearTimeout(ptRef.current)}
                    onTouchMove={() => clearTimeout(ptRef.current)}
                    onContextMenu={e => showInfo(e, s.symbol, s.label, 'EQUITY')}
                    style={{ display: 'grid', gridTemplateColumns: COLS, padding: '3px 8px', borderBottom: '1px solid #141414', cursor: 'pointer', alignItems: 'center' }}
                    onMouseEnter={e => e.currentTarget.style.background = '#141414'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <span style={{ color: '#00bcd4', fontSize: '10px', fontWeight: 700 }}>{s.symbol}</span>
                    <span style={{ color: '#555', fontSize: '9px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: 4 }}>{s.label}</span>
                    <span style={{ color: '#ccc', fontSize: '10px', textAlign: 'right', paddingRight: 4 }}>{fmt((data[s.symbol] || {}).price)}</span>
                    <span style={{ color: ((data[s.symbol] || {}).changePct ?? 0) >= 0 ? '#4caf50' : '#f44336', fontSize: '10px', textAlign: 'right', fontWeight: 600 }}>{fmtPct((data[s.symbol] || {}).changePct)}</span>
                  </div>
                ))}
                {moversOnly && filteredUS.length === 0 && (
                  <div style={{ padding: '8px 12px', color: '#333', fontSize: 9 }}>No US movers ≥ 2%</div>
                )}

                <SectionDivider label="BRAZIL ADRs" color="#ffa726" />
                {filteredBrazil.map(s => (
                  <div
                    key={s.symbol}
                    data-ticker={s.symbol}
                    data-ticker-label={s.label}
                    data-ticker-type="ADR"
                    draggable
                    onDragStart={e => {
                      e.dataTransfer.effectAllowed = 'copy';
                      e.dataTransfer.setData('application/x-ticker', JSON.stringify({ symbol: s.symbol, name: s.label, type: 'EQUITY' }));
                    }}
                    onClick={() => onTickerClick?.(s.symbol)}
                    onDoubleClick={() => onOpenDetail?.(s.symbol)}
                    onTouchStart={(e) => { e.stopPropagation(); clearTimeout(ptRef.current); ptRef.current = setTimeout(() => onOpenDetail?.(s.symbol), 500); }}
                    onTouchEnd={() => clearTimeout(ptRef.current)}
                    onTouchMove={() => clearTimeout(ptRef.current)}
                    onContextMenu={e => showInfo(e, s.symbol, s.label, 'ADR')}
                    style={{ display: 'grid', gridTemplateColumns: COLS, padding: '3px 8px', borderBottom: '1px solid #141414', cursor: 'pointer', alignItems: 'center' }}
                    onMouseEnter={e => e.currentTarget.style.background = '#141414'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <span style={{ color: '#ffa726', fontSize: '10px', fontWeight: 700 }}>{s.symbol}</span>
                    <span style={{ color: '#555', fontSize: '9px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: 4 }}>{s.label}</span>
                    <span style={{ color: '#ccc', fontSize: '10px', textAlign: 'right', paddingRight: 4 }}>{fmt((data[s.symbol] || {}).price)}</span>
                    <span style={{ color: ((data[s.symbol] || {}).changePct ?? 0) >= 0 ? '#4caf50' : '#f44336', fontSize: '10px', textAlign: 'right', fontWeight: 600 }}>{fmtPct((data[s.symbol] || {}).changePct)}</span>
                  </div>
                ))}
                {moversOnly && filteredBrazil.length === 0 && (
                  <div style={{ padding: '8px 12px', color: '#333', fontSize: 9 }}>No ADR movers ≥ 2%</div>
                )}
              </>
            )}
          </div>
        </>
      )}

      {/* Panel config modal */}
      {configOpen && (
        <PanelConfigModal
          panelId="usEquities"
          currentTitle={panelTitle}
          currentSymbols={panelSymbols}
          onSave={({ title, symbols }) => {
            updatePanelConfig('usEquities', { title, symbols });
            setConfigOpen(false);
          }}
          onClose={() => setConfigOpen(false)}
        />
      )}
    </div>
  );
}

export { StockPanel };
export default memo(StockPanel);
