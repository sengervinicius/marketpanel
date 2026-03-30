// IndexPanel.jsx — world index ETF proxies, BBG-style
import { useRef, useState, memo } from 'react';
import { useFeedStatus } from '../../context/FeedStatusContext';
import { WORLD_INDEXES } from '../../utils/constants';

const fmt    = (n) => n == null ? '—' : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtPct = (n) => n == null ? '—' : (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
const COLS   = '56px 1fr 68px 64px';

const showInfo = (e, symbol, label, type) => {
  e.preventDefault();
  window.dispatchEvent(new CustomEvent('ticker:rightclick', {
    detail: { symbol, label, type, x: e.clientX + 6, y: e.clientY + 6 },
  }));
};

function IndexPanel({ data = {}, loading, onTickerClick, onOpenDetail }) {
  const ptRef = useRef(null);
  const [collapsed, setCollapsed] = useState(false);
  const { getBadge } = useFeedStatus();
  const badge = getBadge('stocks');
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#0a0a0a' }}>
      <div style={{ padding: '4px 8px', borderBottom: '1px solid #2a2a2a', background: '#111', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ color: '#ff6600', fontSize: '10px', fontWeight: 700, letterSpacing: '1px' }}>WORLD INDEXES</span>
        <span style={{ color: '#333', fontSize: '8px' }}>ETF PROXIES</span>
        <span style={{ background: badge.bg, color: badge.color, fontSize: 7, fontWeight: 700, letterSpacing: '0.08em', padding: '1px 4px', borderRadius: 2, border: `1px solid ${badge.color}33` }}>
          {badge.text}
        </span>
        <div style={{ flex: 1 }} />
        <button onClick={() => setCollapsed(v => !v)} title={collapsed ? 'Expand' : 'Collapse'}
          style={{ background: 'none', border: '1px solid #2a2a2a', color: '#555', fontSize: 9, padding: '1px 5px', cursor: 'pointer', fontFamily: 'inherit', borderRadius: 2 }}
        >{collapsed ? '+' : '−'}</button>
      </div>
      {!collapsed && (<>
      {/* Column headers */}
      <div style={{ display: 'grid', gridTemplateColumns: COLS, padding: '2px 8px', borderBottom: '1px solid #1a1a1a', flexShrink: 0 }}>
        {['TICKER', 'NAME', 'LAST', 'CHG%'].map((h, i) => (
          <span key={h} style={{
            color: '#444', fontSize: '8px', fontWeight: 700, letterSpacing: '1px',
            textAlign: i >= 2 ? 'right' : 'left',
            paddingRight: i >= 2 ? 4 : 0,
          }}>{h}</span>
        ))}
      </div>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {loading || !data ? (
          <div style={{ padding: '20px', textAlign: 'center', color: '#444', fontSize: '10px' }}>LOADING...</div>
        ) : WORLD_INDEXES.map(idx => {
          const d   = data[idx.symbol] || {};
          const pos = (d.changePct ?? 0) >= 0;
          return (
            <div
              key={idx.symbol}
              data-ticker={idx.symbol}
              data-ticker-label={idx.label}
              data-ticker-type="ETF"
              draggable
              onDragStart={e => {
                e.dataTransfer.effectAllowed = 'copy';
                e.dataTransfer.setData('application/x-ticker', JSON.stringify({ symbol: idx.symbol, name: idx.label, type: 'ETF' }));
              }}
              onClick={() => onTickerClick?.(idx.symbol)}
              onDoubleClick={() => onOpenDetail?.(idx.symbol)}
              onTouchStart={e => { e.stopPropagation(); clearTimeout(ptRef.current); ptRef.current = setTimeout(() => onOpenDetail?.(idx.symbol), 500); }}
              onTouchEnd={() => clearTimeout(ptRef.current)}
              onTouchMove={() => clearTimeout(ptRef.current)}
              onContextMenu={e => showInfo(e, idx.symbol, idx.label, 'ETF')}
              style={{ display: 'grid', gridTemplateColumns: COLS, padding: '3px 8px', borderBottom: '1px solid #141414', cursor: 'pointer', alignItems: 'center' }}
              onMouseEnter={e => e.currentTarget.style.background = '#141414'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              <span style={{ color: '#ff6600', fontSize: '10px', fontWeight: 700 }}>{idx.symbol}</span>
              <span style={{ color: '#555', fontSize: '9px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: 4 }}>{idx.label}</span>
              <span style={{ color: '#ccc', fontSize: '10px', textAlign: 'right', paddingRight: 4, fontVariantNumeric: 'tabular-nums' }}>{fmt(d.price)}</span>
              <span style={{ color: pos ? '#4caf50' : '#f44336', fontSize: '10px', textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{fmtPct(d.changePct)}</span>
            </div>
          );
        })}
      </div>
      </>)}
    </div>
  );
}

export { IndexPanel };
export default memo(IndexPanel);
