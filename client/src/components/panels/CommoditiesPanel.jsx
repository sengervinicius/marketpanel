// CommoditiesPanel.jsx — commodity ETF proxies, BBG-style
import { COMMODITIES } from '../../utils/constants';

const fmt = (n) => n == null ? '—' : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtPct = (n) => n == null ? '—' : (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
const COLS = '52px 1fr 68px 64px';

export function CommoditiesPanel({ data, loading, onTickerClick }) {
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#0a0a0a' }}>
      <div style={{ padding: '4px 8px', borderBottom: '1px solid #2a2a2a', background: '#111', flexShrink: 0 }}>
        <span style={{ color: '#ffd54f', fontSize: '10px', fontWeight: 700, letterSpacing: '1px' }}>COMMODITIES</span>
        <span style={{ color: '#333', fontSize: '8px', marginLeft: 6 }}>ETF PROXIES</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: COLS, padding: '2px 8px', borderBottom: '1px solid #1a1a1a', flexShrink: 0 }}>
        {['SYM', 'NAME', 'LAST', 'CHG%'].map(h => (
          <span key={h} style={{ color: '#444', fontSize: '8px', fontWeight: 700, letterSpacing: '1px' }}>{h}</span>
        ))}
      </div>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {loading || !data ? (
          <div style={{ padding: '20px', textAlign: 'center', color: '#444', fontSize: '10px' }}>LOADING...</div>
        ) : COMMODITIES.map(c => {
          const d = data[c.symbol] || {};
          const pos = (d.changePct ?? 0) >= 0;
          return (
            <div
              key={c.symbol}
              draggable
              onDragStart={e => {
                e.dataTransfer.effectAllowed = 'copy';
                e.dataTransfer.setData('application/x-ticker', JSON.stringify({ symbol: c.symbol, name: c.label, type: 'ETF' }));
              }}
              onClick={() => onTickerClick?.(c.symbol)}
              style={{ display: 'grid', gridTemplateColumns: COLS, padding: '3px 8px', borderBottom: '1px solid #141414', cursor: 'pointer', alignItems: 'center' }}
              onMouseEnter={e => e.currentTarget.style.background = '#141414'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              <span style={{ color: '#ffd54f', fontSize: '10px', fontWeight: 700 }}>{c.symbol}</span>
              <span style={{ color: '#555', fontSize: '9px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: 4 }}>{c.label} ({c.unit})</span>
              <span style={{ color: '#ccc', fontSize: '10px', textAlign: 'right', paddingRight: 4 }}>{fmt(d.price)}</span>
              <span style={{ color: pos ? '#4caf50' : '#f44336', fontSize: '10px', textAlign: 'right', fontWeight: 600 }}>{fmtPct(d.changePct)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
