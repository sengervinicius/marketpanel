// CryptoPanel.jsx — crypto pairs, settings-integrated
import { useRef, useState, memo, useEffect, useMemo } from 'react';
import { useSettings } from '../../context/SettingsContext';
import { useOpenDetail } from '../../context/OpenDetailContext';
import PanelConfigModal from '../common/PanelConfigModal';
import EditablePanelHeader from '../common/EditablePanelHeader';
import PanelShell from '../common/PanelShell';
import { PriceRow } from '../common/PriceRow';
import ColumnHeaders from '../common/ColumnHeaders';
import { CRYPTO_PAIRS } from '../../utils/constants';
import { useFeedStatus } from '../../context/FeedStatusContext';
import { useSparklineData } from '../../hooks/useSparklineData';
import SkeletonLoader from '../shared/SkeletonLoader';
import IntegrityBadge from '../shared/IntegrityBadge';
import { COLS_STANDARD } from '../../utils/panelColumns';

// Was '56px 1fr 80px 64px' — chg% 64px tight for crypto volatility (+50% days happen).
const COLS = COLS_STANDARD;

const SORT_COLS = [
  { key: 'symbol', label: 'COIN', align: 'left' },
  { key: 'name',   label: 'NAME', align: 'left' },
  { key: 'price',  label: 'LAST', align: 'right' },
  { key: 'chg',    label: 'CHG%', align: 'right' },
];

export function CryptoPanel({ data = {}, loading, onTickerClick }) {
  const openDetail = useOpenDetail();
  const ptRef = useRef(null);
  const { settings, updatePanelConfig } = useSettings();
  const { getBadge } = useFeedStatus();
  const badge = getBadge('crypto');

  // Phase 2: Last-updated timestamp
  const [lastUpdated, setLastUpdated] = useState(null);
  useEffect(() => {
    if (data && Object.keys(data).length > 0) setLastUpdated(new Date());
  }, [data]);

  // Panel config from settings (with fallback defaults)
  const panelCfg = settings?.panels?.crypto || {
    title: 'Crypto',
    symbols: CRYPTO_PAIRS.map(c => c.symbol),
    hiddenSubsections: [],
  };
  const panelTitle           = panelCfg.title                || 'Crypto';
  const panelSymbols         = panelCfg.symbols              || [];
  const hiddenSubsections    = panelCfg.hiddenSubsections    || [];
  const availableSubsections = [{ key: 'usd', label: 'USD' }];

  const [collapsed,   setCollapsed]   = useState(false);
  const [configOpen,  setConfigOpen]  = useState(false);
  const [searchFilter, setSearchFilter] = useState('');
  const [sortKey,     setSortKey]     = useState(null);
  const [sortDir,     setSortDir]     = useState('desc');
  const [moversOnly,  setMoversOnly]  = useState(false);

  const handleDropTicker = (ticker) => {
    const sym = ticker.toUpperCase();
    const cryptoSym = sym.endsWith('USD') ? sym : sym + 'USD';
    if (!panelSymbols.includes(cryptoSym)) {
      updatePanelConfig('crypto', { ...panelCfg, symbols: [...panelSymbols, cryptoSym] });
    }
  };

  const handleSortClick = (key) => {
    if (sortKey === key) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortKey(key); setSortDir('desc'); }
  };

  // Filter to configured symbols (if any)
  let visiblePairs = panelSymbols.length > 0
    ? CRYPTO_PAIRS.filter(c => panelSymbols.includes(c.symbol))
    : CRYPTO_PAIRS;

  // Apply search filter
  if (searchFilter) {
    const sq = searchFilter.toLowerCase();
    visiblePairs = visiblePairs.filter(c =>
      c.symbol.toLowerCase().includes(sq) || (c.label || c.name || '').toLowerCase().includes(sq)
    );
  }

  // Apply movers filter (≥3%)
  if (moversOnly) {
    visiblePairs = visiblePairs.filter(c => Math.abs(data[c.symbol]?.changePct ?? 0) >= 3);
  }

  // Apply sorting
  if (sortKey && data) {
    visiblePairs = [...visiblePairs].sort((a, b) => {
      let va, vb;
      if (sortKey === 'symbol') { va = a.symbol; vb = b.symbol; }
      else if (sortKey === 'name') { va = a.label; vb = b.label; }
      else if (sortKey === 'price') { va = data[a.symbol]?.price ?? -Infinity; vb = data[b.symbol]?.price ?? -Infinity; }
      else if (sortKey === 'chg')   { va = data[a.symbol]?.changePct ?? -Infinity; vb = data[b.symbol]?.changePct ?? -Infinity; }
      if (typeof va === 'string') return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
      return sortDir === 'asc' ? va - vb : vb - va;
    });
  }

  // Phase 2: Sparkline data for crypto tickers
  const cryptoSparkTickers = useMemo(() => visiblePairs.map(c => 'X:' + c.symbol), [visiblePairs]);
  const sparklines = useSparklineData(cryptoSparkTickers);

  return (
    <PanelShell onDropTicker={handleDropTicker}>
      {/* Header */}
      <EditablePanelHeader
        title={panelTitle}
        availableSubsections={availableSubsections}
        hiddenSubsections={hiddenSubsections}
        lastUpdated={lastUpdated}
        onToggleSubsection={(key) => {
          const current = hiddenSubsections || [];
          const updated = current.includes(key)
            ? current.filter(k => k !== key)
            : [...current, key];
          updatePanelConfig('crypto', { ...panelCfg, hiddenSubsections: updated });
        }}
        onTitleChange={(v) => updatePanelConfig('crypto', { ...panelCfg, title: v })}
        onConfigOpen={() => setConfigOpen(true)}
        onDropTicker={handleDropTicker}
        onSearchChange={setSearchFilter}
        feedBadge={{ bg: badge.bg, color: badge.color, text: badge.text }}
      >
        <IntegrityBadge domain="crypto" />
        <button className="btn"
          onClick={() => setCollapsed(v => !v)}
          title={collapsed ? 'Expand' : 'Collapse'}
          style={{ background: 'none', border: '1px solid var(--border-strong)', color: 'var(--text-muted)', fontSize: 9, padding: '1px 5px' }}
        >{collapsed ? '+' : '−'}</button>
        <button className="btn"
          onClick={() => setMoversOnly(v => !v)}
          title="Show only movers ≥ 3%"
          style={{ background: moversOnly ? '#1a1000' : 'none', border: `1px solid ${moversOnly ? 'var(--accent-text)' : 'var(--border-strong)'}`, color: moversOnly ? 'var(--accent-text)' : 'var(--text-muted)', fontSize: 'var(--font-xs)', padding: '1px 4px' }}
        >≥3%</button>
      </EditablePanelHeader>

      {!collapsed && !hiddenSubsections.includes('usd') && (<>
        {/* Column headers */}
        <ColumnHeaders
          columns={SORT_COLS}
          gridColumns={COLS}
          sortKey={sortKey}
          sortDir={sortDir}
          onSortClick={handleSortClick}
        />

        <div style={{ flex: 1, overflowY: 'auto' }}>
          {loading || !data ? (
            <SkeletonLoader type="table" rows={6} columns={4} width="100%" height="auto" />
          ) : visiblePairs.length > 0 ? visiblePairs.map(c => {
            const d = data[c.symbol] || {};
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
                onTouchHold={() => openDetail(c.symbol)}
                touchRef={ptRef}
                sparklineData={sparklines['X:' + c.symbol]}
                dataAttrs={{
                  'data-ticker': c.symbol,
                  'data-ticker-label': c.label || c.name || c.symbol,
                  'data-ticker-type': 'CRYPTO',
                }}
              />
            );
          }) : (
            <div style={{ padding: 'var(--sp-5)', textAlign: 'center', color: 'var(--text-muted)' }}>NO CRYPTO PAIRS</div>
          )}
        </div>
      </>)}

      {/* Panel config modal */}
      {configOpen && (
        <PanelConfigModal
          panelId="crypto"
          currentTitle={panelTitle}
          currentSymbols={panelSymbols}
          onSave={({ title, symbols }) => {
            updatePanelConfig('crypto', { title, symbols });
            setConfigOpen(false);
          }}
          onClose={() => setConfigOpen(false)}
        />
      )}
    </PanelShell>
  );
}

export default memo(CryptoPanel);
