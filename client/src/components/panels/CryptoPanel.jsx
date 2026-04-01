// CryptoPanel.jsx — crypto pairs, settings-integrated
import { useRef, useState, memo } from 'react';
import { useSettings } from '../../context/SettingsContext';
import PanelConfigModal from '../common/PanelConfigModal';
import EditablePanelHeader from '../common/EditablePanelHeader';
import { CRYPTO_PAIRS } from '../../utils/constants';
import { useFeedStatus } from '../../context/FeedStatusContext';
import { handlePanelDragOver, makePanelDropHandler } from '../../utils/dropHelper';

const fmt    = (n) => n == null ? '—' : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtPct = (n) => n == null ? '—' : (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
const COLS   = '56px 1fr 80px 64px';

export function CryptoPanel({ data = {}, loading, onTickerClick, onOpenDetail }) {
  const ptRef = useRef(null);
  const { settings, updatePanelConfig } = useSettings();
  const { getBadge } = useFeedStatus();
  const badge = getBadge('crypto');

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
        <button
          onClick={() => setCollapsed(v => !v)}
          title={collapsed ? 'Expand' : 'Collapse'}
          style={{ background: 'none', border: '1px solid #2a2a2a', color: '#555', fontSize: 9, padding: '1px 5px', cursor: 'pointer', fontFamily: 'inherit', borderRadius: 2 }}
        >{collapsed ? '+' : '−'}</button>
        <button
          onClick={() => setMoversOnly(v => !v)}
          title="Show only movers ≥ 3%"
          style={{ background: moversOnly ? '#1a1000' : 'none', border: `1px solid ${moversOnly ? '#ff9900' : '#2a2a2a'}`, color: moversOnly ? '#ff9900' : '#444', fontSize: 7, padding: '1px 4px', cursor: 'pointer', fontFamily: 'inherit', borderRadius: 2 }}
        >≥3%</button>
      </EditablePanelHeader>

      {!collapsed && !hiddenSubsections.includes('usd') && (<>
        {/* Column headers */}
        <div style={{ display: 'grid', gridTemplateColumns: COLS, padding: '2px 8px', borderBottom: '1px solid #1a1a1a', flexShrink: 0 }}>
          {[
            { key: 'symbol', label: 'COIN', align: 'left' },
            { key: 'name', label: 'NAME', align: 'left' },
            { key: 'price', label: 'LAST', align: 'right' },
            { key: 'chg', label: 'CHG%', align: 'right' },
          ].map(({ key, label, align }) => {
            const active = sortKey === key;
            const arrow = active ? (sortDir === 'desc' ? ' ▼' : ' ▲') : '';
            return (
              <span
                key={key}
                onClick={() => handleSortClick(key)}
                style={{
                  color: active ? '#ff9900' : '#444',
                  fontSize: '8px',
                  fontWeight: 700,
                  letterSpacing: '1px',
                  textAlign: align === 'right' ? 'right' : 'left',
                  paddingRight: align === 'right' ? 4 : 0,
                  cursor: 'pointer',
                  userSelect: 'none',
                }}
              >
                {label}{arrow}
              </span>
            );
          })}
        </div>

        <div style={{ flex: 1, overflowY: 'auto' }}>
          {loading || !data ? (
            <div style={{ padding: '20px', textAlign: 'center', color: '#444', fontSize: '10px' }}>LOADING...</div>
          ) : visiblePairs.length > 0 ? visiblePairs.map(c => {
            const d   = data[c.symbol] || {};
            const pos = (d.changePct ?? 0) >= 0;
            const chartSym = 'X:' + c.symbol;
            return (
              <div
                key={c.symbol}
                data-ticker={c.symbol}
                data-ticker-label={c.label || c.name || c.symbol}
                data-ticker-type="CRYPTO"
                draggable
                onDragStart={e => {
                  e.dataTransfer.effectAllowed = 'copy';
                  e.dataTransfer.setData('application/x-ticker', JSON.stringify({ symbol: chartSym, name: c.label, type: 'CRYPTO' }));
                }}
                onClick={() => onTickerClick?.(chartSym)}
                onDoubleClick={() => onOpenDetail?.(chartSym)}
                onTouchStart={(e) => { e.stopPropagation(); clearTimeout(ptRef.current); ptRef.current = setTimeout(() => onOpenDetail?.(c.symbol), 500); }}
                onTouchEnd={() => clearTimeout(ptRef.current)}
                onTouchMove={() => clearTimeout(ptRef.current)}
                style={{ display: 'grid', gridTemplateColumns: COLS, padding: '3px 8px', borderBottom: '1px solid #141414', cursor: 'pointer', alignItems: 'center' }}
                onMouseEnter={e => e.currentTarget.style.background = '#141414'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                <span style={{ color: '#f48fb1', fontSize: '10px', fontWeight: 700 }}>{c.symbol.replace('USD', '')}</span>
                <span style={{ color: '#555', fontSize: '9px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: 4 }}>{c.label}</span>
                <span style={{ color: '#ccc', fontSize: '10px', textAlign: 'right', paddingRight: 4 }}>{fmt(d.price)}</span>
                <span style={{ color: pos ? '#4caf50' : '#f44336', fontSize: '10px', textAlign: 'right', fontWeight: 600 }}>{fmtPct(d.changePct)}</span>
              </div>
            );
          }) : (
            <div style={{ padding: '20px', textAlign: 'center', color: '#444', fontSize: '10px' }}>NO CRYPTO PAIRS</div>
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
    </div>
  );
}

export default memo(CryptoPanel);
