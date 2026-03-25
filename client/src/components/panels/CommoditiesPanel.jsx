// CommoditiesPanel.jsx — commodities grouped by category
import { useRef } from 'react';
import { COMMODITIES } from '../../utils/constants';

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

export function CommoditiesPanel({ data, loading, onTickerClick, onOpenDetail }) {
  const ptRef = useRef(null);
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#0a0a0a' }}>
      {/* Header */}
      <div style={{ padding: '4px 8px', borderBottom: '1px solid #2a2a2a', background: '#111', flexShrink: 0 }}>
        <span style={{ color: '#ffd54f', fontSize: '10px', fontWeight: 700, letterSpacing: '1px' }}>COMMODITIES</span>
        <span style={{ color: '#333', fontSize: '8px', marginLeft: 6 }}>ETF PROXIES</span>
      </div>

      {/* Column headers */}
      <div style={{ display: 'grid', gridTemplateColumns: COLS, padding: '2px 8px', borderBottom: '1px solid #1a1a1a', flexShrink: 0 }}>
        {['SYM', 'NAME', 'LAST', 'CHG%'].map((h, i) => (
          <span key={h} style={{ color: '#444', fontSize: '8px', fontWeight: 700, letterSpacing: '1px',
            textAlign: i >= 2 ? 'right' : 'left', paddingRight: i >= 2 ? 4 : 0 }}>{h}</span>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {loading || !data ? (
          <div style={{ padding: '20px', textAlign: 'center', color: '#444', fontSize: '10px' }}>LOADING...</div>
        ) : (
          GROUPS.map(g => {
            const items = COMMODITIES.filter(c => c.group === g.key);
            if (!items.length) return null;
            return (
              <div key={g.key}>
                <GroupHeader label={g.label} color={g.color} />
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
          })
        )}
      </div>
    </div>
  );
}
