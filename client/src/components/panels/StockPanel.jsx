// StockPanel.jsx — US equities + Brazil ADRs with section headers and sortable columns
// Features: feed-status badge, collapse, movers filter, heatmap view, custom subsections
import { useRef, useState, useMemo, useCallback, memo } from 'react';
import { useSettings } from '../../context/SettingsContext';
import PanelConfigModal from '../common/PanelConfigModal';
import EditablePanelHeader from '../common/EditablePanelHeader';
import CustomSubsectionBlock from '../common/CustomSubsectionBlock';
import PanelShell from '../common/PanelShell';
import { PriceRow } from '../common/PriceRow';
import { SectionHeader } from '../common/SectionHeader';
import ColumnHeaders from '../common/ColumnHeaders';
import { US_STOCKS, BRAZIL_ADRS } from '../../utils/constants';
import { useFeedStatus } from '../../context/FeedStatusContext';
import './StockPanel.css';

const fmt    = (n) => n == null ? '—' : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtPct = (n) => n == null ? '—' : (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
const COLS   = '60px 1fr 68px 60px';

const showInfo = (e, symbol, label, type) => {
  e.preventDefault();
  window.dispatchEvent(new CustomEvent('ticker:rightclick', {
    detail: { symbol, label, type, x: e.clientX + 6, y: e.clientY + 6 },
  }));
};

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
  if (pct == null) return 'var(--border-default)';
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
    hiddenSubsections: [],
    customSubsections: [],
    subsectionLabels: {},
  };
  const panelTitle           = panelCfg.title                || 'US Equities';
  const panelSymbols         = panelCfg.symbols              || [];
  const hiddenSubsections    = panelCfg.hiddenSubsections    || [];
  const customSubsections    = panelCfg.customSubsections    || [];
  const subsectionLabels     = panelCfg.subsectionLabels     || {};
  const availableSubsections = [{ key: 'brazilAdrs', label: 'BRAZIL ADRs' }];

  const [sortKey,    setSortKey]    = useState(null);
  const [sortDir,    setSortDir]    = useState('desc');
  const [collapsed,  setCollapsed]  = useState(false);
  const [moversOnly, setMoversOnly] = useState(false);
  const [heatmap,    setHeatmap]    = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [searchFilter, setSearchFilter] = useState('');
  const { getBadge } = useFeedStatus();
  const badge = getBadge('stocks');

  const saveCfg = useCallback((updates) => {
    updatePanelConfig('usEquities', { ...panelCfg, ...updates });
  }, [panelCfg, updatePanelConfig]);

  // Handle drop ticker into panel — add to a custom subsection so it's visible
  const handleDropTicker = (ticker) => {
    const sym = ticker.trim().toUpperCase();
    if (!sym) return;
    const subs = [...customSubsections];
    let target = subs.find(s => s.key === 'custom-dropped');
    if (!target) {
      target = { key: 'custom-dropped', label: 'ADDED', color: '#00bcd4', symbols: [] };
      subs.push(target);
    }
    if (target.symbols.includes(sym)) return;
    const updated = subs.map(s =>
      s.key === target.key ? { ...s, symbols: [...s.symbols, sym] } : s
    );
    saveCfg({ customSubsections: updated });
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

  // --- Subsection handlers ---
  const handleToggleSubsection = (key) => {
    const current = hiddenSubsections || [];
    const updated = current.includes(key)
      ? current.filter(k => k !== key)
      : [...current, key];
    saveCfg({ hiddenSubsections: updated });
  };

  const handleAddSubsection = ({ label, color }) => {
    const key = 'custom-' + Date.now();
    saveCfg({ customSubsections: [...customSubsections, { key, label, color, symbols: [] }] });
  };

  const handleRenameSubsection = (key, newLabel) => {
    const builtIn = availableSubsections.find(s => s.key === key);
    if (builtIn) {
      saveCfg({ subsectionLabels: { ...subsectionLabels, [key]: newLabel } });
    } else {
      saveCfg({
        customSubsections: customSubsections.map(s =>
          s.key === key ? { ...s, label: newLabel } : s
        ),
      });
    }
  };

  const handleDeleteSubsection = (key) => {
    saveCfg({
      customSubsections: customSubsections.filter(s => s.key !== key),
      hiddenSubsections: hiddenSubsections.filter(k => k !== key),
    });
  };

  const handleAddTickerToSubsection = (key, symbol) => {
    saveCfg({
      customSubsections: customSubsections.map(s =>
        s.key === key && !s.symbols.includes(symbol)
          ? { ...s, symbols: [...s.symbols, symbol] }
          : s
      ),
    });
  };

  const handleRemoveTickerFromSubsection = (key, symbol) => {
    saveCfg({
      customSubsections: customSubsections.map(s =>
        s.key === key ? { ...s, symbols: s.symbols.filter(sym => sym !== symbol) } : s
      ),
    });
  };

  return (
    <PanelShell onDropTicker={handleDropTicker}>
      {/* Header */}
      <EditablePanelHeader
        title={panelTitle}
        availableSubsections={availableSubsections}
        hiddenSubsections={hiddenSubsections}
        customSubsections={customSubsections}
        subsectionLabels={subsectionLabels}
        onToggleSubsection={handleToggleSubsection}
        onTitleChange={(t) => saveCfg({ title: t })}
        onAddSubsection={handleAddSubsection}
        onRenameSubsection={handleRenameSubsection}
        onDeleteSubsection={handleDeleteSubsection}
        onConfigOpen={() => setConfigOpen(true)}
        onDropTicker={handleDropTicker}
        onSearchChange={setSearchFilter}
        feedBadge={badge}
      >
        {/* Movers filter toggle */}
        <button className={`stp-movers-btn ${moversOnly ? 'stp-movers-btn-active' : ''}`}
          onClick={() => setMoversOnly(v => !v)}
          title="Show only movers ≥ 2%"
        >≥2%</button>
        {/* Heatmap toggle */}
        <button className={`stp-heatmap-btn ${heatmap ? 'stp-heatmap-btn-active' : ''}`}
          onClick={() => setHeatmap(v => !v)}
          title="Toggle heatmap view"
        >HEAT</button>
        {/* Collapse toggle */}
        <button className="stp-reset-btn"
          onClick={() => setCollapsed(v => !v)}
          title={collapsed ? 'Expand' : 'Collapse'}
        >{collapsed ? '+' : '−'}</button>
      </EditablePanelHeader>

      {!collapsed && (
        <>
          {/* Sortable column headers (hidden in heatmap mode) */}
          {!heatmap && (
            <ColumnHeaders
              columns={SORT_COLS}
              gridColumns={COLS}
              sortKey={sortKey}
              sortDir={sortDir}
              onSortClick={handleSortClick}
            />
          )}

          <div className="stp-content">
            {loading || !data ? (
              <div className="stp-loading">LOADING...</div>
            ) : heatmap ? (
              /* Heatmap grid */
              <div className="stp-movers-grid">
                {allItems.map(s => {
                  const pct  = data?.[s.symbol]?.changePct ?? null;
                  const bg   = heatColor(pct);
                  const pos  = (pct ?? 0) >= 0;
                  return (
                    <div
                      key={s.symbol}
                      className="stp-movers-card"
                      data-ticker={s.symbol}
                      data-ticker-label={s.label}
                      data-ticker-type="EQUITY"
                      onClick={() => onTickerClick?.(s.symbol)}
                      onDoubleClick={() => onOpenDetail?.(s.symbol)}
                      onContextMenu={e => showInfo(e, s.symbol, s.label, 'EQUITY')}
                      title={`${s.symbol}\n${fmtPct(pct)}`}
                      style={{
                        width: 54, height: 38, background: bg,
                        border: '1px solid #222',
                      }}
                      onMouseEnter={e => e.currentTarget.style.filter = 'brightness(1.4)'}
                      onMouseLeave={e => e.currentTarget.style.filter = 'none'}
                    >
                      <span className="stp-movers-symbol">{s.symbol.replace('.SA', '')}</span>
                      <span className="stp-movers-pct" style={{ color: pos ? '#81c784' : '#ef9a9a' }}>{fmtPct(pct)}</span>
                    </div>
                  );
                })}
                {allItems.length === 0 && (
                  <div className="stp-no-movers">No movers matching filter.</div>
                )}
              </div>
            ) : (
              <>
                <SectionHeader label={subsectionLabels['usEquities'] || 'US EQUITIES'} color="var(--section-equity)" />
                {filteredUS.map(s => (
                  <PriceRow
                    key={s.symbol}
                    symbol={s.symbol}
                    name={s.label}
                    price={(data[s.symbol] || {}).price}
                    changePct={(data[s.symbol] || {}).changePct}
                    symbolColor="var(--section-equity)"
                    columns={COLS}
                    draggable
                    dragData={{ symbol: s.symbol, name: s.label, type: 'EQUITY' }}
                    onClick={() => onTickerClick?.(s.symbol)}
                    onDoubleClick={() => onOpenDetail?.(s.symbol)}
                    onTouchHold={() => onOpenDetail?.(s.symbol)}
                    touchRef={ptRef}
                    onContextMenu={e => showInfo(e, s.symbol, s.label, 'EQUITY')}
                    dataAttrs={{
                      'data-ticker': s.symbol,
                      'data-ticker-label': s.label,
                      'data-ticker-type': 'EQUITY',
                    }}
                  />
                ))}
                {moversOnly && filteredUS.length === 0 && (
                  <div className="stp-section-empty">No US movers ≥ 2%</div>
                )}

                {!hiddenSubsections.includes('brazilAdrs') && (
                  <>
                    <SectionHeader label={subsectionLabels['brazilAdrs'] || 'BRAZIL ADRs'} color="var(--section-brazil)" />
                    {filteredBrazil.map(s => (
                      <PriceRow
                        key={s.symbol}
                        symbol={s.symbol}
                        name={s.label}
                        price={(data[s.symbol] || {}).price}
                        changePct={(data[s.symbol] || {}).changePct}
                        symbolColor="var(--section-brazil)"
                        columns={COLS}
                        draggable
                        dragData={{ symbol: s.symbol, name: s.label, type: 'EQUITY' }}
                        onClick={() => onTickerClick?.(s.symbol)}
                        onDoubleClick={() => onOpenDetail?.(s.symbol)}
                        onTouchHold={() => onOpenDetail?.(s.symbol)}
                        touchRef={ptRef}
                        onContextMenu={e => showInfo(e, s.symbol, s.label, 'ADR')}
                        dataAttrs={{
                          'data-ticker': s.symbol,
                          'data-ticker-label': s.label,
                          'data-ticker-type': 'ADR',
                        }}
                      />
                    ))}
                    {moversOnly && filteredBrazil.length === 0 && (
                      <div className="stp-section-empty">No ADR movers ≥ 2%</div>
                    )}
                  </>
                )}

                {/* Custom subsections */}
                {customSubsections.map((sub) => {
                  if (hiddenSubsections.includes(sub.key)) return null;
                  return (
                    <CustomSubsectionBlock
                      key={sub.key}
                      subsection={sub}
                      data={data}
                      gridCols={COLS}
                      onTickerClick={onTickerClick}
                      onOpenDetail={onOpenDetail}
                      onAddTicker={handleAddTickerToSubsection}
                      onRemoveTicker={handleRemoveTickerFromSubsection}
                    />
                  );
                })}
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
            saveCfg({ title, symbols });
            setConfigOpen(false);
          }}
          onClose={() => setConfigOpen(false)}
        />
      )}
    </PanelShell>
  );
}

export { StockPanel };
export default memo(StockPanel);
