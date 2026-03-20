// ForexPanel.jsx — FX pairs, BBG-style
import { FOREX_PAIRS } from '../../utils/constants';

const fmt4 = (n) => n == null ? '—' : n.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
const fmtPct = (n) => n == null ? '—' : (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
const COLS = '72px 1fr 76px 64px';

export function ForexPanel({ data, loading, onTickerClick }) {
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#0a0a0a' }}>
      <div style={{ padding: '4px 8px', borderBottom: '1px solid #2a2a2a', background: '#111', flexShrink: 0 }}>
        <span style={{ color: '#ce93d8', fontSize: '10px', fontWeight: 700, letterSpacing: '1px' }}>FX / FOREX</span>
        <span style={{ color: '#333', fontSize: '8px', marginLeft: 6 }}>MID RATES</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: COLS, padding: '2px 8px', borderBottom: '1px solid #1a1a1a', flexShrink: 0 }}>
        {['PAIR', '', 'RATE', 'CHG%'].map((h, i) => (
          <span key={i} style={{ color: '#444', fontSize: '8px', fontWeight: 700, letterSpacing: '1px' }}>{h}</span>
        ))}
      </div>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {loading || !data ? (
          <div style={{ padding: '20px', textAlign: 'center', color: '#444', fontSize: '10px' }}>LOADING...</div>
        ) : FOREX_PAIRS.map(pair => {
          const d = data[pair.symbol] || {};
          const price = d.mid || d.ask || d.price;
          const pos = (d.changePct ?? 0) >= 0;
          const chartSym = pair.symbol + '=X';
          return (
            <div
              key={pair.symbol}
              draggable
              onDragStart={e => {
                e.dataTransfer.effectAllowed = 'copy';
                e.dataTransfer.setData('application/x-ticker', JSON.stringify({ symbol: chartSym, name: pair.label, type: 'CURRENCY' }));
              }}
              onClick={() => onTickerClick?.(chartSym)}
              style={{ display: 'grid', gridTemplateColumns: COLS, padding: '3px 8px', borderBottom: '1px solid #141414', cursor: 'pointer', alignItems: 'center' }}
              onMouseEnter={e => e.currentTarget.style.background = '#141414'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              <span style={{ color: '#ce93d8', fontSize: '10px', fontWeight: 700 }}>{pair.label}</span>
              <span style={{ color: '#333', fontSize: '9px' }}></span>
              <span style={{ color: '#ccc', fontSize: '10px', textAlign: 'right', paddingRight: 4 }}>{fmt4(price)}</span>
              <span style={{ color: pos ? '#4caf50' : '#f44336', fontSize: '10px', textAlign: 'right', fontWeight: 600 }}>{fmtPct(d.changePct)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
