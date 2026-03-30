// CryptoPanel.jsx — crypto pairs, settings-integrated
import { useRef, useState, memo } from 'react';
import { useSettings } from '../../context/SettingsContext';
import PanelConfigModal from '../common/PanelConfigModal';
import { CRYPTO_PAIRS } from '../../utils/constants';
import { useFeedStatus } from '../../context/FeedStatusContext';

const fmt    = (n) => n == null ? '—' : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtPct = (n) => n == null ? '—' : (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
const COLS   = '56px 1fr 80px 64px';

export function CryptoPanel({ data, loading, onTickerClick, onOpenDetail }) {
  const ptRef = useRef(null);
  const { settings, updatePanelConfig } = useSettings();
  const { getBadge } = useFeedStatus();
  const badge = getBadge('crypto');

  // Panel config from settings (with fallback defaults)
  const panelCfg = settings?.panels?.crypto || {
    title: 'Crypto',
    symbols: CRYPTO_PAIRS.map(c => c.symbol),
  };
  const panelTitle   = panelCfg.title   || 'Crypto';
  const panelSymbols = panelCfg.symbols || [];

  const [collapsed,   setCollapsed]   = useState(false);
  const [configOpen,  setConfigOpen]  = useState(false);

  // Filter to configured symbols (if any)
  const visiblePairs = panelSymbols.length > 0
    ? CRYPTO_PAIRS.filter(c => panelSymbols.includes(c.symbol))
    : CRYPTO_PAIRS;


  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#0a0a0a' }}>
      {/* Header */}
      <div style={{ padding: '4px 8px', borderBottom: '1px solid #2a2a2a', background: '#111', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ color: '#f48fb1', fontSize: '10px', fontWeight: 700, letterSpacing: '1px' }}>{panelTitle}</span>
          <span style={{ color: '#333', fontSize: '8px' }}>USD</span>
          <button
            onClick={() => setConfigOpen(true)}
            title="Configure panel"
            style={{
              background: 'none', border: 'none', color: '#444', cursor: 'pointer',
              fontSize: 9, padding: '0 2px', lineHeight: 1, display: 'flex', alignItems: 'center',
            }}
          >✎</button>
        </div>
        <span style={{ background: badge.bg, color: badge.color, fontSize: 7, fontWeight: 700, letterSpacing: '0.08em', padding: '1px 4px', borderRadius: 2, border: `1px solid ${badge.color}33` }}>
          {badge.text}
        </span>
        <div style={{ flex: 1 }} />
        <button
          onClick={() => setCollapsed(v => !v)}
          title={collapsed ? 'Expand' : 'Collapse'}
          style={{ background: 'none', border: '1px solid #2a2a2a', color: '#555', fontSize: 9, padding: '1px 5px', cursor: 'pointer', fontFamily: 'inherit', borderRadius: 2 }}
        >{collapsed ? '+' : '−'}</button>
      </div>

      {!collapsed && (<>
        {/* Column headers */}
        <div style={{ display: 'grid', gridTemplateColumns: COLS, padding: '2px 8px', borderBottom: '1px solid #1a1a1a', flexShrink: 0 }}>
          {['COIN', 'NAME', 'LAST', 'CHG%'].map(h => (
            <span key={h} style={{ color: '#444', fontSize: '8px', fontWeight: 700, letterSpacing: '1px' }}>{h}</span>
          ))}
        </div>

        <div style={{ flex: 1, overflowY: 'auto' }}>
          {loading || !data ? (
            <div style={{ padding: '20px', textAlign: 'center', color: '#444', fontSize: '10px' }}>LOADING...</div>
          ) : visiblePairs.map(c => {
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
                onDoubleClick={() => onOpenDetail?.(c.symbol)}
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
          })}
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
