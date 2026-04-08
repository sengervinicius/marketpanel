// CommoditiesPanel.jsx — commodities grouped by category, with sortable columns
// Features: feed-status badge, collapse, editable header, search, drag-drop, custom subsections
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
import { COMMODITIES } from '../../utils/constants';
import { useFeedStatus } from '../../context/FeedStatusContext';
import { useSparklineData } from '../../hooks/useSparklineData';
import SkeletonLoader from '../shared/SkeletonLoader';

const COLS = '44px 1fr 68px 60px';

const SORT_COLS = [
  { key: 'symbol', label: 'SYM',  align: 'left' },
  { key: 'name',   label: 'NAME', align: 'left' },
  { key: 'price',  label: 'LAST', align: 'right' },
  { key: 'chg',    label: 'CHG%', align: 'right' },
];

const GROUPS = [
  { key: 'Metals', label: 'METALS',      color: '#ffd54f' },
  { key: 'Energy', label: 'ENERGY',      color: '#ff9800' },
  { key: 'Agri',   label: 'AGRICULTURE', color: '#8bc34a' },
  { key: 'Mining', label: 'MINING',      color: '#90a4ae' },
];

const showInfo = (e, symbol, label, type) => {
  e.preventDefault();
  window.dispatchEvent(new CustomEvent('ticker:rightclick', {
    detail: { symbol, label, type, x: e.clientX + 6, y: e.clientY + 6 },
  }));
};

function CommoditiesPanel({ data = {}, loading, onTickerClick }) {
  const openDetail = useOpenDetail();
  const ptRef = useRef(null);
  const { settings, updatePanelConfig } = useSettings();

  const panelCfg = settings?.panels?.commodities || {
    title: 'Commodities',
    symbols: COMMODITIES.map(c => c.symbol),
    hiddenSubsections: [],
    customSubsections: [],
    subsectionLabels: {},
  };
  const panelTitle           = panelCfg.title                || 'Commodities';
  const panelSymbols         = panelCfg.symbols              || [];
  const hiddenSubsections    = panelCfg.hiddenSubsections    || [];
  const customSubsections    = panelCfg.customSubsections    || [];
  const subsectionLabels     = panelCfg.subsectionLabels     || {};
  const availableSubsections = [
    { key: 'Metals', label: 'METALS' },
    { key: 'Energy', label: 'ENERGY' },
    { key: 'Agri', label: 'AGRICULTURE' },
    { key: 'Mining', label: 'MINING' },
  ];

  const [sortKey,   setSortKey]   = useState(null);
  const [sortDir,   setSortDir]   = useState('desc');
  const [collapsed, setCollapsed] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [searchFilter, setSearchFilter] = useState('');
  const [moversOnly, setMoversOnly] = useState(false);
  const [flashSym, setFlashSym] = useState(null);
  const { getBadge } = useFeedStatus();
  const badge = getBadge('commodities');

  // Phase 2: Last-updated timestamp
  const [lastUpdated, setLastUpdated] = useState(null);
  useEffect(() => {
    if (data && Object.keys(data).length > 0) setLastUpdated(new Date());
  }, [data]);

  const saveCfg = useCallback((updates) => {
    updatePanelConfig('commodities', { ...panelCfg, ...updates });
  }, [panelCfg, updatePanelConfig]);

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
    setFlashSym(sym);
    setTimeout(() => setFlashSym(null), 1500);
  };

  const handleSortClick = (key) => {
    if (sortKey === key) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortKey(key); setSortDir('desc'); }
  };

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

  const sortedGroups = useMemo(() => {
    return GROUPS.map(g => {
      let items = COMMODITIES.filter(c => c.group === g.key);
      if (panelSymbols.length > 0) {
        items = items.filter(c => panelSymbols.includes(c.symbol));
      }
      if (searchFilter) {
        const sq = searchFilter.toLowerCase();
        items = items.filter(c =>
          c.symbol.toLowerCase().includes(sq) || (c.label || '').toLowerCase().includes(sq)
        );
      }
      if (moversOnly) {
        items = items.filter(c => Math.abs(data[c.symbol]?.changePct ?? 0) >= 2);
      }
      if (sortKey && data) {
        items = [...items].sort((a, b) => {
          let va, vb;
          if (sortKey === 'symbol') { va = a.symbol; vb = b.symbol; }
          else if (sortKey === 'name') { va = a.label; vb = b.label; }
          else if (sortKey === 'price') { va = data[a.symbol]?.price ?? -Infinity; vb = data[b.symbol]?.price ?? -Infinity; }
          else if (sortKey === 'chg')   { va = data[a.symbol]?.changePct ?? -Infinity; vb = data[b.symbol]?.changePct ?? -Infinity; }
          if (typeof va === 'string') return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
          return sortDir === 'asc' ? va - vb : vb - va;
        });
      }
      return { ...g, items };
    });
  }, [data, sortKey, sortDir, panelSymbols, searchFilter, moversOnly]);

  const commodityTickers = useMemo(() => COMMODITIES.map(c => c.symbol), []);
  const sparklines = useSparklineData(commodityTickers);

  return (
    <PanelShell onDropTicker={handleDropTicker}>
      {/* Header */}
      <EditablePanelHeader
        title={panelTitle}
        availableSubsections={availableSubsections}
        hiddenSubsections={hiddenSubsections}
        customSubsections={customSubsections}
        subsectionLabels={subsectionLabels}
        lastUpdated={lastUpdated}
        onToggleSubsection={handleToggleSubsection}
        onTitleChange={(v) => saveCfg({ title: v })}
        onAddSubsection={handleAddSubsection}
        onRenameSubsection={handleRenameSubsection}
        onDeleteSubsection={handleDeleteSubsection}
        onConfigOpen={() => setConfigOpen(true)}
        onDropTicker={handleDropTicker}
        onSearchChange={setSearchFilter}
        feedBadge={{ bg: badge.bg, color: badge.color, text: badge.text }}
      >
        <button className="btn"
          onClick={() => setCollapsed(v => !v)}
          title={collapsed ? 'Expand' : 'Collapse'}
          style={{ background: 'none', border: '1px solid var(--border-strong)', color: 'var(--text-muted)', fontSize: 9, padding: '1px 5px' }}
        >{collapsed ? '+' : '−'}</button>
        <button className="btn"
          onClick={() => setMoversOnly(v => !v)}
          title="Show only movers ≥ 2%"
          style={{ background: moversOnly ? '#1a1000' : 'none', border: `1px solid ${moversOnly ? 'var(--accent-text)' : 'var(--border-strong)'}`, color: moversOnly ? 'var(--accent-text)' : 'var(--text-muted)', fontSize: 'var(--font-xs)', padding: '1px 4px' }}
        >≥2%</button>
      </EditablePanelHeader>

      {!collapsed && (<>
        {/* Sortable column headers */}
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
          ) : (
            <>
            {sortedGroups.map(g => {
              const { items } = g;
              if (!items.length || hiddenSubsections.includes(g.key)) return null;
              return (
                <div key={g.key}>
                  <SectionHeader label={subsectionLabels[g.key] || g.label} color={g.color} />
                  {items.map(c => {
                    const d = data[c.symbol] || {};
                    return (
                      <PriceRow
                        key={c.symbol}
                        symbol={c.symbol}
                        ticker={c.symbol}
                        name={c.label}
                        price={d.price}
                        changePct={d.changePct}
                        symbolColor={g.color}
                        columns={COLS}
                        draggable
                        dragData={{ symbol: c.symbol, name: c.label, type: 'ETF' }}
                        onClick={() => onTickerClick?.(c.symbol)}
                        onDoubleClick={() => openDetail(c.symbol)}
                        onTouchHold={() => openDetail(c.symbol)}
                        touchRef={ptRef}
                        sparklineData={sparklines[c.symbol]}
                        onContextMenu={e => showInfo(e, c.symbol, c.label, 'COMMODITY')}
                        dataAttrs={{
                          'data-ticker': c.symbol,
                          'data-ticker-label': c.label,
                          'data-ticker-type': 'COMMODITY',
                        }}
                      />
                    );
                  })}
                </div>
              );
            })}

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
                  onAddTicker={handleAddTickerToSubsection}
                  onRemoveTicker={handleRemoveTickerFromSubsection}
                  flashSymbol={flashSym}
                />
              );
            })}
            </>
          )}
        </div>
      </>)}

      {/* Panel config modal */}
      {configOpen && (
        <PanelConfigModal
          panelId="commodities"
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

export { CommoditiesPanel };
export default memo(CommoditiesPanel);
