// ForexPanel.jsx — FX pairs + Crypto subsection, BBG-style, with sortable columns
// Features: feed-status badge, collapse, movers filter, custom subsections
import { useRef, useState, useMemo, useCallback, memo, useEffect } from 'react';
import { useSettings } from '../../context/SettingsContext';
import { useOpenDetail } from '../../context/OpenDetailContext';
import PanelConfigModal from '../common/PanelConfigModal';
import EditablePanelHeader from '../common/EditablePanelHeader';
import CustomSubsectionBlock from '../common/CustomSubsectionBlock';
import PanelShell from '../common/PanelShell';
import { PriceRow } from '../common/PriceRow';
import { SectionHeader } from '../common/SectionHeader';
import ColumnHeaders from '../common/ColumnHeaders';
import { FOREX_PAIRS, CRYPTO_PAIRS } from '../../utils/constants';
import { useFeedStatus } from '../../context/FeedStatusContext';
import { useSparklineData } from '../../hooks/useSparklineData';
import SkeletonLoader from '../shared/SkeletonLoader';
import IntegrityBadge from '../shared/IntegrityBadge';
import { COLS_FOREX } from '../../utils/panelColumns';

// Was '72px 1fr 76px 64px' — chg% too narrow for 2-digit moves (USDARS can spike).
const COLS = COLS_FOREX;

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

function ForexPanel({ data = {}, cryptoData = {}, loading, onTickerClick }) {
  const openDetail = useOpenDetail();
  const ptRef = useRef(null);
  const { settings, updatePanelConfig } = useSettings();

  // Panel config from settings (with fallback defaults)
  const panelCfg = settings?.panels?.forex || {
    title: 'FX RATES / CRYPTO',
    symbols: [
      'EURUSD','GBPUSD','USDJPY','USDCHF','AUDUSD','USDCAD',
      'USDBRL','EURBRL','GBPBRL',
      'USDCNY','USDMXN',
      'BTCUSD','ETHUSD','SOLUSD','XRPUSD','BNBUSD','DOGEUSD',
    ],
    hiddenSubsections: [],
    customSubsections: [],
    subsectionLabels: {},
  };
  const panelTitle           = panelCfg.title                || 'FX RATES / CRYPTO';
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
  const [flashSym, setFlashSym] = useState(null);
  const { getBadge } = useFeedStatus();
  const badge = getBadge('forex');

  // Phase 2: Last-updated timestamp
  const [lastUpdated, setLastUpdated] = useState(null);
  useEffect(() => {
    if (data && Object.keys(data).length > 0) setLastUpdated(new Date());
  }, [data]);

  const saveCfg = useCallback((updates) => {
    updatePanelConfig('forex', { ...panelCfg, ...updates });
  }, [panelCfg, updatePanelConfig]);

  const handleSortClick = (key) => {
    if (sortKey === key) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortKey(key); setSortDir('desc'); }
  };

  // Handle drop ticker into panel
  // CIO-note (2026-04-20): previous behavior created an "ADDED"
  // custom subsection bucket, which polluted the UI and confused the
  // user ("wtf is ADDED subsection?"). New behavior appends the
  // dropped ticker directly to the main FX symbols list so it shows
  // up in the FX PAIRS or CRYPTO block like a normal default.
  // The C:/X: polygon prefix (if present from a chart drop) is stripped.
  const handleDropTicker = (ticker) => {
    let sym = String(ticker || '').trim().toUpperCase();
    if (!sym) return;
    sym = sym.replace(/^(C:|X:)/, '');
    if (panelSymbols.includes(sym)) return;
    saveCfg({ symbols: [...panelSymbols, sym] });
    setFlashSym(sym);
    setTimeout(() => setFlashSym(null), 1500);
  };

  const filteredForexPairs = panelSymbols.length > 0
    ? FOREX_PAIRS.filter(p => panelSymbols.includes(p.symbol) && (p.symbol.includes(searchFilter.toUpperCase()) || p.label.toUpperCase().includes(searchFilter.toUpperCase())))
    : FOREX_PAIRS.filter(p => p.symbol.includes(searchFilter.toUpperCase()) || p.label.toUpperCase().includes(searchFilter.toUpperCase()));

  const filteredCryptoPairs = panelSymbols.length > 0
    ? CRYPTO_PAIRS.filter(c => panelSymbols.includes(c.symbol) && (c.symbol.includes(searchFilter.toUpperCase()) || c.label.toUpperCase().includes(searchFilter.toUpperCase())))
        : CRYPTO_PAIRS.filter(c => c.symbol.includes(searchFilter.toUpperCase()) || c.label.toUpperCase().includes(searchFilter.toUpperCase()));

  const sortedForex  = useMemo(() =>
    sortPairs(filteredForexPairs,
      p => { const d = data?.[p.symbol] || {}; return (d.mid ?? d.ask ?? d.price) || null; },
      p => data?.[p.symbol]?.changePct ?? null,
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

  // Phase 2: Sparkline data
  const allFxTickers = useMemo(() => [
    ...filteredForex.map(p => p.symbol),
    ...filteredCrypto.map(c => 'X:' + c.symbol),
  ], [filteredForex, filteredCrypto]);
  const sparklines = useSparklineData(allFxTickers);

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
        lastUpdated={lastUpdated}
        source="Yahoo"
      >
        <IntegrityBadge domain="forex" />
        {/* Movers filter */}
        <button className="btn"
          onClick={() => setMoversOnly(v => !v)}
          title="Show only movers ≥ 1%"
          style={{ background: moversOnly ? '#1a1000' : 'none', border: `1px solid ${moversOnly ? 'var(--accent-text)' : 'var(--border-strong)'}`, color: moversOnly ? 'var(--accent-text)' : 'var(--text-muted)', fontSize: 'var(--font-xs)', padding: '1px 4px' }}
        >≥1%</button>
        {/* Collapse toggle */}
        <button className="btn"
          onClick={() => setCollapsed(v => !v)}
          title={collapsed ? 'Expand' : 'Collapse'}
          style={{ background: 'none', border: '1px solid var(--border-strong)', color: 'var(--text-muted)', fontSize: 9, padding: '1px 5px' }}
        >{collapsed ? '+' : '−'}</button>
      </EditablePanelHeader>

      {!collapsed && (
        <>
      {/* Sortable column headers */}
      <ColumnHeaders
        columns={SORT_COLS}
        gridColumns={COLS}
        sortKey={sortKey}
        sortDir={sortDir}
        onSortClick={handleSortClick}
      />

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {loading ? (
          <SkeletonLoader type="table" rows={6} columns={4} width="100%" height="auto" />
        ) : (
          <>
            {/* ── FX PAIRS ── */}
            <SectionHeader label={subsectionLabels['fxPairs'] || 'FX PAIRS'} sectionKey="fxPairs" color="var(--section-fx)" onRename={handleRenameSubsection} onToggleVisibility={handleToggleSubsection} isHideable={true} />
            {filteredForex.map(pair => {
              const d = data?.[pair.symbol] || {};
              const price = d.mid || d.ask || d.price;
              const chartSym = 'C:' + pair.symbol;
              return (
                <PriceRow
                  key={pair.symbol}
                  symbol={pair.symbol}
                  ticker={'C:' + pair.symbol}
                  name={pair.label}
                  price={price}
                  changePct={d.changePct}
                  symbolColor="var(--section-fx)"
                  columns={COLS}
                  decimals={4}
                  draggable
                  dragData={{ symbol: chartSym, name: pair.label, type: 'CURRENCY' }}
                  onClick={() => onTickerClick?.(chartSym)}
                  onDoubleClick={() => openDetail(chartSym)}
                  onTouchHold={() => openDetail(chartSym)}
                  touchRef={ptRef}
                  onContextMenu={e => showInfo(e, pair.symbol, pair.label, 'FX')}
                  dataAttrs={{
                    'data-ticker': pair.symbol,
                    'data-ticker-label': pair.label,
                    'data-ticker-type': 'FX',
                  }}
                  sparklineData={sparklines[pair.symbol]}
                />
              );
            })}

            {moversOnly && filteredForex.length === 0 && (
              <div style={{ padding: 'var(--sp-2) var(--sp-3)', color: 'var(--text-faint)', fontSize: 9 }}>No FX movers ≥ 1%</div>
            )}

            {!hiddenSubsections.includes('crypto') && (
              <>
                {/* ── CRYPTO ── */}
                <SectionHeader label={subsectionLabels['crypto'] || 'CRYPTO'} sectionKey="crypto" color="var(--section-crypto)" onRename={handleRenameSubsection} onToggleVisibility={handleToggleSubsection} isHideable={true} />
                {filteredCrypto.map(c => {
              const d   = cryptoData?.[c.symbol] || {};
              const chartSym = 'X:' + c.symbol;
              return (
                <PriceRow
                  key={c.symbol}
                  symbol={c.symbol}
                  ticker={'X:' + c.symbol}
                  displaySymbol={c.symbol.replace('USD', '')}
                  name={c.label}
                  price={d.price}
                  changePct={d.changePct}
                  symbolColor="var(--section-crypto)"
                  columns={COLS}
                  draggable
                  dragData={{ symbol: chartSym, name: c.label, type: 'CRYPTO' }}
                  onClick={() => onTickerClick?.(chartSym)}
                  onDoubleClick={() => openDetail(chartSym)}
                  onTouchHold={() => openDetail(chartSym)}
                  touchRef={ptRef}
                  onContextMenu={e => showInfo(e, c.symbol, c.label, 'CRYPTO')}
                  dataAttrs={{
                    'data-ticker': 'X:' + c.symbol,
                    'data-ticker-label': c.label,
                    'data-ticker-type': 'CRYPTO',
                  }}
                  sparklineData={sparklines['X:' + c.symbol]}
                />
              );
            })}
                {moversOnly && filteredCrypto.length === 0 && (
                  <div style={{ padding: 'var(--sp-2) var(--sp-3)', color: 'var(--text-faint)', fontSize: 9 }}>No crypto movers ≥ 1%</div>
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
                  onAddTicker={handleAddTickerToSubsection}
                  onRemoveTicker={handleRemoveTickerFromSubsection}
                  flashSymbol={flashSym}
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
    </PanelShell>
  );
}

export { ForexPanel };
export default memo(ForexPanel);
