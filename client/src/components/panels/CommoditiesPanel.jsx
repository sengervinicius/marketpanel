// CommoditiesPanel.jsx — commodities grouped by category, with sortable columns
// Features: feed-status badge, collapse, editable header, search, drag-drop, custom subsections
import { useRef, useState, useMemo, useCallback, memo } from 'react';
import { useSettings } from '../../context/SettingsContext';
import PanelConfigModal from '../common/PanelConfigModal';
import EditablePanelHeader from '../common/EditablePanelHeader';
import CustomSubsectionBlock from '../common/CustomSubsectionBlock';
import { COMMODITIES } from '../../utils/constants';
import { useFeedStatus } from '../../context/FeedStatusContext';
import { handlePanelDragOver, makePanelDropHandler } from '../../utils/dropHelper';

const fmt    = (n) => n == null ? '—' : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtPct = (n) => n == null ? '—' : (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
const COLS   = '44px 1fr 68px 60px';

const GROUPS = [
  { key: 'Metals', label: 'METALS',      color: '#ffd54f' },
  { key: 'Energy', label: 'ENERGY',      color: '#ff9800' },
  { key: 'Agri',   label: 'AGRICULTURE', color: '#8bc34a' },
  { key: 'Mining', label: 'MINING',      color: '#90a4ae' },
];

function GroupHeader({ label, color }) {
  return (
    <div style={{
      padding: '2px 8px', background: '#0c0c0c',
      borderTop: '1px solid #1a1a1a', borderBottom: '1px solid #1a1a1a',
    }}>
      <span style={{ color, fontSize: 7, fontWeight: 700, letterSpacing: '0.12em' }}>
        ── {label} ────────────────────────
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

function CommoditiesPanel({ data = {}, loading, onTickerClick, onOpenDetail }) {
  const ptRef = useRef(null);
  const { settings, updatePanelConfig } = useSettings();

  // Panel config from settings (with fallback defaults)
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
  const { getBadge } = useFeedStatus();
  const badge = getBadge('stocks'); // commodities are equities/ETFs

  const saveCfg = useCallback((updates) => {
    updatePanelConfig('commodities', { ...panelCfg, ...updates });
  }, [panelCfg, updatePanelConfig]);

  const handleDropTicker = (ticker) => {
    const sym = ticker.toUpperCase();
    if (!panelSymbols.includes(sym)) {
      saveCfg({ symbols: [...panelSymbols, sym] });
    }
  };

  const handleSortClick = (key) => {
    if (sortKey === key) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortKey(key); setSortDir('desc'); }
  };

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

  const sortedGroups = useMemo(() => {
    return GROUPS.map(g => {
      let items = COMMODITIES.filter(c => c.group === g.key);
      // Filter to only configured symbols if configured
      if (panelSymbols.length > 0) {
        items = items.filter(c => panelSymbols.includes(c.symbol));
      }
      // Apply search filter
      if (searchFilter) {
        const sq = searchFilter.toLowerCase();
        items = items.filter(c =>
          c.symbol.toLowerCase().includes(sq) || (c.label || '').toLowerCase().includes(sq)
        );
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
  }, [data, sortKey, sortDir, panelSymbols, searchFilter]);

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
        onTitleChange={(v) => saveCfg({ title: v })}
        onAddSubsection={handleAddSubsection}
        onRenameSubsection={handleRenameSubsection}
        onDeleteSubsection={handleDeleteSubsection}
        onConfigOpen={() => setConfigOpen(true)}
        onDropTicker={handleDropTicker}
        onSearchChange={setSearchFilter}
        feedBadge={{ bg: badge.bg, color: badge.color, text: badge.text }}
      >
        <button
          onClick={() => setCollapsed(v => !v)}
          title={collapsed ? 'Expand' : 'Collapse'}
          style={{ background: 'none', border: '1px solid #2a2a2a', color: '#555', fontSize: 9, padding: '1px 5px', cursor: 'pointer', fontFamily: 'inherit', borderRadius: 2 }}
        >{collapsed ? '+' : '−'}</button>
      </EditablePanelHeader>

      {!collapsed && (<>
      {/* Sortable column headers */}
      <div style={{ display: 'grid', gridTemplateColumns: COLS, padding: '2px 8px', borderBottom: '1px solid #1a1a1a', flexShrink: 0 }}>
        {[
          { key: 'symbol', label: 'SYM',  align: 'left' },
          { key: 'name',   label: 'NAME', align: 'left' },
          { key: 'price',  label: 'LAST', align: 'right' },
          { key: 'chg',    label: 'CHG%', align: 'right' },
        ].map(({ key, label, align }) => {
          const active = sortKey === key;
          const arrow  = active ? (sortDir === 'desc' ? ' ▼' : ' ▲') : '';
          return (
            <span key={key} onClick={() => handleSortClick(key)} style={{
              color: active ? '#ff9900' : '#444',
              fontSize: '8px', fontWeight: 700, letterSpacing: '1px',
              textAlign: align === 'right' ? 'right' : 'left',
              paddingRight: align === 'right' ? 4 : 0,
              cursor: 'pointer', userSelect: 'none',
            }}>{label}{arrow}</span>
          );
        })}
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {loading || !data ? (
          <div style={{ padding: '20px', textAlign: 'center', color: '#444', fontSize: '10px' }}>LOADING...</div>
        ) : (
          <>
          {sortedGroups.map(g => {
            const { items } = g;
            if (!items.length || hiddenSubsections.includes(g.key)) return null;
            return (
              <div key={g.key}>
                <GroupHeader label={subsectionLabels[g.key] || g.label} color={g.color} />
                {items.map(c => {
                  const d   = data[c.symbol] || {};
                  const pos = (d.changePct ?? 0) >= 0;
                  return (
                    <div
                      key={c.symbol}
                      data-ticker={c.symbol}
                      data-ticker-label={c.label}
                      data-ticker-type="COMMODITY"
                      draggable
                      onDragStart={e => {
                        e.dataTransfer.effectAllowed = 'copy';
                        e.dataTransfer.setData('application/x-ticker', JSON.stringify({ symbol: c.symbol, name: c.label, type: 'ETF' }));
                      }}
                      onClick={() => onTickerClick?.(c.symbol)}
                      onDoubleClick={() => onOpenDetail?.(c.symbol)}
             onTouchStart={(e) => { e.stopPropagation(); clearTimeout(ptRef.current); ptRef.current = setTimeout(() => onOpenDetail?.(c.symbol), 500); }}
             onTouchEnd={() => clearTimeout(ptRef.current)}
             onTouchMove={() => clearTimeout(ptRef.current)}
                      onContextMenu={e => showInfo(e, c.symbol, c.label, 'COMMODITY')}
                      style={{ display: 'grid', gridTemplateColumns: COLS, padding: '3px 8px', borderBottom: '1px solid #141414', cursor: 'pointer', alignItems: 'center' }}
                      onMouseEnter={e => e.currentTarget.style.background = '#141414'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                      <span style={{ color: g.color, fontSize: '10px', fontWeight: 700 }}>{c.symbol}</span>
                      <span style={{ color: '#555', fontSize: '9px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: 4 }}>{c.label}</span>
                      <span style={{ color: '#ccc', fontSize: '10px', textAlign: 'right', paddingRight: 4 }}>{fmt(d.price)}</span>
                      <span style={{ color: pos ? '#4caf50' : '#f44336', fontSize: '10px', textAlign: 'right', fontWeight: 600 }}>{fmtPct(d.changePct)}</span>
                    </div>
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
                onOpenDetail={onOpenDetail}
                onAddTicker={handleAddTickerToSubsection}
                onRemoveTicker={handleRemoveTickerFromSubsection}
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
    </div>
  );
}

export { CommoditiesPanel };
export default memo(CommoditiesPanel);
