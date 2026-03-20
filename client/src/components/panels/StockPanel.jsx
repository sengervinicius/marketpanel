// StockPanel.jsx — US equities + LATAM ADRs, BBG-style
import { US_STOCKS, LATAM_STOCKS } from '../../utils/constants';

const fmt = (n) => n == null ? '—' : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtPct = (n) => n == null ? '—' : (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
const COLS = '60px 1fr 68px 64px';
const ALL = [...US_STOCKS, ...LATAM_STOCKS];

export function StockPanel({ data, loading, onTickerClick }) {
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#0a0a0a' }}>
      <div style={{ padding: '4px 8px', borderBottom: '1px solid #2a2a2a', background: '#111', flexShrink: 0, display: 'flex', alignItems: 'center' }}>
        <span style={{ color: '#00bcd4', fontSize: '10px', fontWeight: 700, letterSpacing: '1px' }}>US EQUITIES</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: COLS, padding: '2px 8px', borderBottom: '1px solid #1a1a1a', flexShrink: 0 }}>
        {['TICKER', 'NAME', 'LAST', 'CHG%'].map(h => (
          <span key={h} style={{ color: '#444', fontSize: '8px', fontWeight: 700, letterSpacing: '1px' }}>{h}</span>
        ))}
      </div>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {loading || !data ? (
          <div style={{ padding: '20px', textAlign: 'center', color: '#444', fontSize: '10px' }}>LOADING...</div>
        ) : ALL.map(s => {
          const d = data[s.symbol] || {};
          const pos = (d.changePct ?? 0) >= 0;
          return (
            <div
              key={s.symbol}
              draggable
              onDragStart={e => {
                e.dataTransfer.effectAllowed = 'copy';
                e.dataTransfer.setData('application/x-ticker', JSON.stringify({ symbol: s.symbol, name: s.label, type: 'EQUITY' }));
              }}
              onClick={() => onTickerClick?.(s.symbol)}
              style={{ display: 'grid', gridTemplateColumns: COLS, padding: '3px 8px', borderBottom: '1px solid #141414', cursor: 'pointer', alignItems: 'center' }}
              onMouseEnter={e => e.currentTarget.style.background = '#141414'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              <span style={{ color: '#00bcd4', fontSize: '10px', fontWeight: 700 }}>{s.symbol}</span>
              <span style={{ color: '#555', fontSize: '9px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: 4 }}>{s.label}</span>
              <span style={{ color: '#ccc', fontSize: '10px', textAlign: 'right', paddingRight: 4 }}>{fmt(d.price)}</span>
              <span style={{ color: pos ? '#4caf50' : '#f44336', fontSize: '10px', textAlign: 'right', fontWeight: 600 }}>{fmtPct(d.changePct)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
