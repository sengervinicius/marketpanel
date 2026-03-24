// StockPanel.jsx — US equities + Brazil ADRs with section headers
import { US_STOCKS, BRAZIL_ADRS } from '../../utils/constants';

const fmt    = (n) => n == null ? '—' : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtPct = (n) => n == null ? '—' : (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
const COLS   = '60px 1fr 68px 60px';

const showInfo = (e, symbol, label, type) => {
  e.preventDefault();
  window.dispatchEvent(new CustomEvent('ticker:rightclick', {
    detail: { symbol, label, type, x: e.clientX + 6, y: e.clientY + 6 },
  }));
};

function SectionDivider({ label, color = '#444' }) {
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

let _pt = null;
export function StockPanel({ data, loading, onTickerClick, onOpenDetail }) {
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#0a0a0a' }}>
      {/* Header */}
      <div style={{ padding: '4px 8px', borderBottom: '1px solid #2a2a2a', background: '#111', flexShrink: 0 }}>
        <span style={{ color: '#00bcd4', fontSize: '10px', fontWeight: 700, letterSpacing: '1px' }}>US EQUITIES</span>
        <span style={{ color: '#333', fontSize: '8px', marginLeft: 6 }}>· BRAZIL ADRs</span>
      </div>

      {/* Column headers */}
      <div style={{ display: 'grid', gridTemplateColumns: COLS, padding: '2px 8px', borderBottom: '1px solid #1a1a1a', flexShrink: 0 }}>
        {['TICKER', 'NAME', 'LAST', 'CHG%'].map((h, i) => (
          <span key={h} style={{ color: '#444', fontSize: '8px', fontWeight: 700, letterSpacing: '1px',
            textAlign: i >= 2 ? 'right' : 'left', paddingRight: i >= 2 ? 4 : 0 }}>{h}</span>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {loading || !data ? (
          <div style={{ padding: '20px', textAlign: 'center', color: '#444', fontSize: '10px' }}>LOADING...</div>
        ) : (
          <>
            <SectionDivider label="US EQUITIES" color="#00bcd4" />
            {US_STOCKS.map(s => (
              <div
                key={s.symbol}
                data-ticker={s.symbol}
                data-ticker-label={s.label}
                data-ticker-type="EQUITY"
                draggable
                onDragStart={e => {
                  e.dataTransfer.effectAllowed = 'copy';
                  e.dataTransfer.setData('application/x-ticker', JSON.stringify({ symbol: s.symbol, name: s.label, type: 'EQUITY' }));
                }}
                onClick={() => onTickerClick?.(s.symbol)}
                onDoubleClick={() => onOpenDetail?.(s.symbol)}
             onTouchStart={(e) => { e.stopPropagation(); _pt = setTimeout(() => onOpenDetail?.(s.symbol), 500); }}
             onTouchEnd={() => clearTimeout(_pt)}
             onTouchMove={() => clearTimeout(_pt)}
                onContextMenu={e => showInfo(e, s.symbol, s.label, 'EQUITY')}
                style={{ display: 'grid', gridTemplateColumns: COLS, padding: '3px 8px', borderBottom: '1px solid #141414', cursor: 'pointer', alignItems: 'center' }}
                onMouseEnter={e => e.currentTarget.style.background = '#141414'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                <span style={{ color: '#00bcd4', fontSize: '10px', fontWeight: 700 }}>{s.symbol}</span>
                <span style={{ color: '#555', fontSize: '9px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: 4 }}>{s.label}</span>
                <span style={{ color: '#ccc', fontSize: '10px', textAlign: 'right', paddingRight: 4 }}>{fmt((data[s.symbol] || {}).price)}</span>
                <span style={{ color: ((data[s.symbol] || {}).changePct ?? 0) >= 0 ? '#4caf50' : '#f44336', fontSize: '10px', textAlign: 'right', fontWeight: 600 }}>{fmtPct((data[s.symbol] || {}).changePct)}</span>
              </div>
            ))}

            <SectionDivider label="BRAZIL ADRs" color="#ffa726" />
            {BRAZIL_ADRS.map(s => (
              <div
                key={s.symbol}
                data-ticker={s.symbol}
                data-ticker-label={s.label}
                data-ticker-type="ADR"
                draggable
                onDragStart={e => {
                  e.dataTransfer.effectAllowed = 'copy';
                  e.dataTransfer.setData('application/x-ticker', JSON.stringify({ symbol: s.symbol, name: s.label, type: 'EQUITY' }));
                }}
                onClick={() => onTickerClick?.(s.symbol)}
                onDoubleClick={() => onOpenDetail?.(s.symbol)}
             onTouchStart={(e) => { e.stopPropagation(); _pt = setTimeout(() => onOpenDetail?.(s.symbol), 500); }}
             onTouchEnd={() => clearTimeout(_pt)}
             onTouchMove={() => clearTimeout(_pt)}
                onContextMenu={e => showInfo(e, s.symbol, s.label, 'ADR')}
                style={{ display: 'grid', gridTemplateColumns: COLS, padding: '3px 8px', borderBottom: '1px solid #141414', cursor: 'pointer', alignItems: 'center' }}
                onMouseEnter={e => e.currentTarget.style.background = '#141414'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                <span style={{ color: '#ffa726', fontSize: '10px', fontWeight: 700 }}>{s.symbol}</span>
                <span style={{ color: '#555', fontSize: '9px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: 4 }}>{s.label}</span>
                <span style={{ color: '#ccc', fontSize: '10px', textAlign: 'right', paddingRight: 4 }}>{fmt((data[s.symbol] || {}).price)}</span>
                <span style={{ color: ((data[s.symbol] || {}).changePct ?? 0) >= 0 ? '#4caf50' : '#f44336', fontSize: '10px', textAlign: 'right', fontWeight: 600 }}>{fmtPct((data[s.symbol] || {}).changePct)}</span>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
