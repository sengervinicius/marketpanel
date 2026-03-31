// ForexPanel.jsx — FX pairs + Crypto subsection, BBG-style, with sortable columns
// Features: feed-status badge, collapse, movers filter, custom subsections
import { useRef, useState, useMemo, useCallback, memo } from 'react';
import { useSettings } from '../../context/SettingsContext';
import PanelConfigModal from '../common/PanelConfigModal';
import EditablePanelHeader from '../common/EditablePanelHeader';
import CustomSubsectionBlock from '../common/CustomSubsectionBlock';
import { FOREX_PAIRS, CRYPTO_PAIRS } from '../../utils/constants';
import { useFeedStatus } from '../../context/FeedStatusContext';
import { handlePanelDragOver, makePanelDropHandler } from '../../utils/dropHelper';

const fmt4   = (n) => n == null ? '—' : n.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
const fmt2   = (n) => n == null ? '—' : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtPct = (n) => n == null ? '—' : (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
const COLS   = '72px 1fr 76px 64px';

function SectionDivider({ label, color }) {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: COLS,
      padding: '2px 8px', background: '#0c0c0c',
      borderTop: '1px solid #1a1a1a', borderBottom: '1px solid #1a1a1a',
      alignItems: 'center', flexShrink: 0,
    }}>
      <span style={{ color, fontSize: 7, fontWeight: 700, letterSpacing: '0.12em', gridColumn: '1 / -1' }}>
        ── {label} ──────────────────────────
      </span>
    </div>
  );
}

const showInfo = (e, symbol, label, type) => {
  e.preventDefault();
  window.dispatchEvent(new CustomEvent('ticker:rightclick', {
    detail: { symbol, label, type, x: e.clientX + 6, y: e.clientY + 6 },
  }));
};

const SORT_COLS = [
  { key: 'symbol', label: 'PAIR',  align: 'left' },
  { key: 'name',   label: 'NAME',  align: 'left' },
  { key: 'price',  label: 'RATE',  align: 'right' },
  { key: 'chg',    label: 'CHG%',  align: 'right' },
];

function sortPairs(pairs, getRate, getChg, sortKey, sortDir) {
  if (!sortKey) return pairs;
  return [...pairs].sort((a, b) => {
    let va, vb;
    if (sortKey === 'symbol') { va = a.symbol; vb = b.symbol; }
    else if (sortKey === 'name') { va = a.label; vb = b.label; }
    else if (sortKey === 'price') { va = getRate(a) ?? -Infinity; vb = getRate(b) ?? -Infinity; }
    else if (sortKey === 'chg')   { va = getChg(a)  ?? -Infinity; vb = getChg(b)  ?? -Infinity; }
    if (typeof va === 'string') return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
    return sortDir === 'asc' ? va - vb : vb - va;
  });
}

function ForexPanel({ data = {}, cryptoData = {}, loading, onTickerClick, onOpenDetail }) {
  const ptRef = useRef(null);
  const { settings, updatePanelConfig } = useSettings();

  // Panel config from settings (with fallback defaults)
  const panelCfg = settings?.panels?.forex || {
    title: 'FX',
    symbols: [...FOREX_PAIRS.map(p => p.symbol), ...CRYPTO_PAIRS.map(c => c.symbol)],
    hiddenSubsections: [],
    customSubsections: [],
    subsectionLabels: {},
  };
  const panelTitle           = panelCfg.title                || 'FX';
  const panelSymbols         = panelCfg.symbols              || [];
  const hiddenSubsections    = panelCfg.hiddenSubsections    || [];
  const customSubsections    = panelCfg.customSubsections    || [];
  const subsectionLabels     = panelCfg.subsectionLabels     || {};
  const availableSubsections = [{ key: 'crypto', label: 'CRYPTO' }];

  const [sortKey,      setSortKey]      = useState(null);
  const [sortDir,      setSortDir]      = useState('desc');
  const [collapsed,    setCollapsed]    = useState(false);
  const [moversOnly,   setMoversOnly]   = useState(false);
  const [configOpen,   setConfigOpen]   = useState(false);
  const [searchFilter, setSearchFilter] = useState('');
  const { getBadge } = useFeedStatus();
  const badge = getBadge('forex');

  const saveCfg = useCallback((updates) => {
    updatePanelConfig('forex', { ...panelCfg, ...updates });
  }, [panelCfg, updatePanelConfig]);

  const handleSortClick = (key) => {
    if (sortKey === key) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortKey(key); setSortDir('desc'); }
  };

  const handleDropTicker = (ticker) => {
    const sym = ticker.trim().toUpperCase();
    if (sym && !panelSymbols.includes(sym)) {
      saveCfg({ symbols: [...panelSymbols, sym] });
    }
  };

  const filteredForexPairs = panelSymbols.length > 0
    ? FOREX_PAIRS.filter(p => panelSymbols.includes(p.symbol) && (p.symbol.includes(searchFilter.toUpperCase()) || p.label.toUpperCase().includes(searchFilter.toUpperCase())))
    : FOREX_PAIRS.filter(p => p.symbol.includes(searchFilter.toUpperCase()) || p.label.toUpperCase().includes(searchFilter.toUpperCase()));

  const filteredCryptoPairs = panelSymbols.length > 0
    ? CRYPTO_PAIRS.filter(c => panelSymbols.includes(c.symbol) && (c.symbol.includes(searchFilter.toUpperCase()) || c.label.toUpperCase().includes(searchFilter.toUpperCase())))
        : CRYPTO_PAIRS.filter(c => c.symbol.includes(searchFilter.toUpperCase()) || c.label.toUpperCase().includes(searchFilter.toUpperCase()));

  const sortedForex  = useMemo(() =>
    sortPairs(filteredForexPairs,
      p => { const d = data?.[p.symbol] || {}; return d.mid || d.ask || d.price; },
      p => data?.[p.symbol]?.changePct,
      sortKey, sortDir),
  [data, sortKey, sortDir, filteredForexPairs]);

  const sortedCrypto = useMemo(() =>
    sortPairs(filteredCryptoPairs,
      c => cryptoData?.[c.symbol]?.price,
      c => cryptoData?.[c.symbol]?.changePct,
      sortKey, sortDir),
  [cryptoData, sortKey, sortDir, filteredCryptoPairs]);

  // Movers filter: abs(changePct) >= 1% for FX
  const filteredForex  = useMemo(() => moversOnly ? sortedForex.filter(p  => Math.abs(data?.[p.symbol]?.changePct ?? 0) >= 1)        : sortedForex,  [sortedForex,  data, moversOnly]);
  const filteredCrypto = useMemo(() => moversOnly ? sortedCrypto.filter(c => Math.abs(cryptoData?.[c.symbol]?.changePct ?? 0) >= 1)    : sortedCrypto, [sortedCrypto, cryptoData, moversOnly]);

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

  // Merge data sources for custom subsections
  const mergedData = useMemo(() => ({ ...data, ...cryptoData }), [data, cryptoData]);

  return (
    <div
      style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#0a0a0a' }}
      onDragOver={handlePanelDragOver}
      onDrop={makePanelDropHandler(handleDropTicker)}
    >
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
        {/* Movers filter */}
        <button
          onClick={() => setMoversOnly(v => !v)}
          title="Show only movers ≥ 1%"
          style={{ background: moversOnly ? '#1a1000' : 'none', border: `1px solid ${moversOnly ? '#ff9900' : '#2a2a2a'}`, color: moversOnly ? '#ff9900' : '#444', fontSize: 7, padding: '1px 4px', cursor: 'pointer', fontFamily: 'inherit', borderRadius: 2 }}
        >≥1%</button>
        {/* Collapse toggle */}
        <button
          onClick={() => setCollapsed(v => !v)}
          title={collapsed ? 'Expand' : 'Collapse'}
          style={{ background: 'none', border: '1px solid #2a2a2a', color: '#555', fontSize: 9, padding: '1px 5px', cursor: 'pointer', fontFamily: 'inherit', borderRadius: 2 }}
        >{collapsed ? '+' : '−'}</button>
      </EditablePanelHeader>

      {!collapsed && (
        <>
      {/* Sortable column headers */}
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

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {loading ? (
          <div style={{ padding: '20px', textAlign: 'center', color: '#444', fontSize: '10px' }}>LOADING...</div>
        ) : (
          <>
            {/* ── FX PAIRS ── */}
            <SectionDivider label={subsectionLabels['fxPairs'] || 'FX PAIRS'} color="#ce93d8" />
            {filteredForex.map(pair => {
              const d = data?.[pair.symbol] || {};
              const price = d.mid || d.ask || d.price;
              const pos   = (d.changePct ?? 0) >= 0;
              const chartSym = 'C:' + pair.symbol;
              return (
                <div
                  key={pair.symbol}
                  data-ticker={pair.symbol}
                  data-ticker-label={pair.label}
                  data-ticker-type="FX"
                  draggable
                  onDragStart={e => {
                    e.dataTransfer.effectAllowed = 'copy';
                    e.dataTransfer.setData('application/x-ticker', JSON.stringify({ symbol: chartSym, name: pair.label, type: 'CURRENCY' }));
                  }}
                  onClick={() => onTickerClick?.(chartSym)}
                  onDoubleClick={() => onOpenDetail?.(chartSym)}
                  onTouchStart={(e) => { e.stopPropagation(); clearTimeout(ptRef.current); ptRef.current = setTimeout(() => onOpenDetail?.(chartSym), 500); }}
                  onTouchEnd={() => clearTimeout(ptRef.current)}
                  onTouchMove={() => clearTimeout(ptRef.current)}
                  onContextMenu={e => showInfo(e, pair.symbol, pair.label, 'FX')}
                  style={{ display: 'grid', gridTemplateColumns: COLS, padding: '3px 8px', borderBottom: '1px solid #141414', cursor: 'pointer', alignItems: 'center' }}
                  onMouseEnter={e => e.currentTarget.style.background = '#141414'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <span style={{ color: '#ce93d8', fontSize: '10px', fontWeight: 700 }}>{pair.label}</span>
                  <span style={{ color: '#333', fontSize: '9px' }}></span>
                  <span style={{ color: '#ccc', fontSize: '10px', textAlign: 'right', paddingRight: 4 }}>{fmt4(price)}</span>
                  <span style={{ color: pos ? '#4caf50' : '#f44336', fontSize: '10px', textAlign: 'right', fontWeight: 600 }}>{fmtPct(d.changePct)}</span>
                </div>
              );
            })}

            {moversOnly && filteredForex.length === 0 && (
              <div style={{ padding: '8px 12px', color: '#333', fontSize: 9 }}>No FX movers ≥ 1%</div>
            )}

            {!hiddenSubsections.includes('crypto') && (
              <>
                {/* ── CRYPTO ── */}
                <SectionDivider label={subsectionLabels['crypto'] || 'CRYPTO'} color="#f48fb1" />
                {filteredCrypto.map(c => {
              const d   = cryptoData?.[c.symbol] || {};
              const pos = (d.changePct ?? 0) >= 0;
              const chartSym = 'X:' + c.symbol;
              return (
                <div
                  key={c.symbol}
                  data-ticker={'X:' + c.symbol}
                  data-ticker-label={c.label}
                  data-ticker-type="CRYPTO"
                  draggable
                  onDragStart={e => {
                    e.dataTransfer.effectAllowed = 'copy';
                    e.dataTransfer.setData('application/x-ticker', JSON.stringify({ symbol: chartSym, name: c.label, type: 'CRYPTO' }));
                  }}
                  onClick={() => onTickerClick?.(chartSym)}
                  onDoubleClick={() => onOpenDetail?.(chartSym)}
                  onTouchStart={(e) => { e.stopPropagation(); clearTimeout(ptRef.current); ptRef.current = setTimeout(() => onOpenDetail?.(chartSym), 500); }}
                  onTouchEnd={() => clearTimeout(ptRef.current)}
                  onTouchMove={() => clearTimeout(ptRef.current)}
                  onContextMenu={e => showInfo(e, c.symbol, c.label, 'CRYPTO')}
                  style={{ display: 'grid', gridTemplateColumns: COLS, padding: '3px 8px', borderBottom: '1px solid #141414', cursor: 'pointer', alignItems: 'center' }}
                  onMouseEnter={e => e.currentTarget.style.background = '#141414'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <span style={{ color: '#f48fb1', fontSize: '10px', fontWeight: 700 }}>{c.symbol.replace('USD', '')}</span>
                  <span style={{ color: '#555', fontSize: '9px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: 4 }}>{c.label}</span>
                  <span style={{ color: '#ccc', fontSize: '10px', textAlign: 'right', paddingRight: 4 }}>{fmt2(d.price)}</span>
                  <span style={{ color: pos ? '#4caf50' : '#f44336', fontSize: '10px', textAlign: 'right', fontWeight: 600 }}>{fmtPct(d.changePct)}</span>
                </div>
              );
            })}
                {moversOnly && filteredCrypto.length === 0 && (
                  <div style={{ padding: '8px 12px', color: '#333', fontSize: 9 }}>No crypto movers ≥ 1%</div>
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
                  data={mergedData}
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
          panelId="forex"
          currentTitle={panelTitle}
          currentSymbols={panelSymbols}
          onSave={({ title, symbols }) => {
            saveCfg({ title, symbols });
            setConfigOpen(false);
          }}
          onClose={() => setConfigOpen(false)}
        />
      )}
    </div>
  );
}

export { ForexPanel };
export default memo(ForexPanel);
