// ForexPanel.jsx — FX pairs + Crypto subsection, BBG-style, with sortable columns
// Features: feed-status badge, collapse, movers filter, custom subsections
import { useRef, useState, useMemo, useCallback, memo } from 'react';
import { useSettings } from '../../context/SettingsContext';
import PanelConfigModal from '../common/PanelConfigModal';
import EditablePanelHeader from '../common/EditablePanelHeader';
import CustomSubsectionBlock from '../common/CustomSubsectionBlock';
import PanelShell from '../common/PanelShell';
import { PriceRow } from '../common/PriceRow';
import { SectionHeader } from '../common/SectionHeader';
import ColumnHeaders from '../common/ColumnHeaders';
import { FOREX_PAIRS, CRYPTO_PAIRS } from '../../utils/constants';
import { useFeedStatus } from '../../context/FeedStatusContext';

const COLS = '72px 1fr 76px 64px';

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

  // Handle drop ticker into panel
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
      >
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
          <div style={{ padding: 'var(--sp-5)', textAlign: 'center', color: 'var(--text-muted)' }}>LOADING...</div>
        ) : (
          <>
            {/* ── FX PAIRS ── */}
            <SectionHeader label={subsectionLabels['fxPairs'] || 'FX PAIRS'} color="var(--section-fx)" />
            {filteredForex.map(pair => {
              const d = data?.[pair.symbol] || {};
              const price = d.mid || d.ask || d.price;
              const chartSym = 'C:' + pair.symbol;
              return (
                <PriceRow
                  key={pair.symbol}
                  symbol={pair.symbol}
                  name={pair.label}
                  price={price}
                  changePct={d.changePct}
                  symbolColor="var(--section-fx)"
                  columns={COLS}
                  decimals={4}
                  draggable
                  dragData={{ symbol: chartSym, name: pair.label, type: 'CURRENCY' }}
                  onClick={() => onTickerClick?.(chartSym)}
                  onDoubleClick={() => onOpenDetail?.(chartSym)}
                  onTouchHold={() => onOpenDetail?.(chartSym)}
                  touchRef={ptRef}
                  onContextMenu={e => showInfo(e, pair.symbol, pair.label, 'FX')}
                  dataAttrs={{
                    'data-ticker': pair.symbol,
                    'data-ticker-label': pair.label,
                    'data-ticker-type': 'FX',
                  }}
                />
              );
            })}

            {moversOnly && filteredForex.length === 0 && (
              <div style={{ padding: 'var(--sp-2) var(--sp-3)', color: 'var(--text-faint)', fontSize: 9 }}>No FX movers ≥ 1%</div>
            )}

            {!hiddenSubsections.includes('crypto') && (
              <>
                {/* ── CRYPTO ── */}
                <SectionHeader label={subsectionLabels['crypto'] || 'CRYPTO'} color="var(--section-crypto)" />
                {filteredCrypto.map(c => {
              const d   = cryptoData?.[c.symbol] || {};
              const chartSym = 'X:' + c.symbol;
              return (
                <PriceRow
                  key={c.symbol}
                  symbol={c.symbol}
                  displaySymbol={c.symbol.replace('USD', '')}
                  name={c.label}
                  price={d.price}
                  changePct={d.changePct}
                  symbolColor="var(--section-crypto)"
                  columns={COLS}
                  draggable
                  dragData={{ symbol: chartSym, name: c.label, type: 'CRYPTO' }}
                  onClick={() => onTickerClick?.(chartSym)}
                  onDoubleClick={() => onOpenDetail?.(chartSym)}
                  onTouchHold={() => onOpenDetail?.(chartSym)}
                  touchRef={ptRef}
                  onContextMenu={e => showInfo(e, c.symbol, c.label, 'CRYPTO')}
                  dataAttrs={{
                    'data-ticker': 'X:' + c.symbol,
                    'data-ticker-label': c.label,
                    'data-ticker-type': 'CRYPTO',
                  }}
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
    </PanelShell>
  );
}

export { ForexPanel };
export default memo(ForexPanel);
