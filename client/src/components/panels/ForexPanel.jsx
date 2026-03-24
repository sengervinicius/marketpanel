// ForexPanel.jsx — FX pairs + Crypto subsection, BBG-style
import { FOREX_PAIRS, CRYPTO_PAIRS } from '../../utils/constants';

const fmt4   = (n) => n == null ? '—' : n.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
const fmt2   = (n) => n == null ? '—' : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtPct = (n) => n == null ? '—' : (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
const COLS   = '72px 1fr 76px 64px';

function SectionDivider({ label, color }) {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: COLS,
      padding: '2px 8px', background: '#0c0c0c',
      borderTop: '1px solid #1a1a1a', borderBottom: '1px solid #1a1a1a',
      alignItems: 'center', flexShrink: 0,
    }}>
      <span style={{ color, fontSize: 7, fontWeight: 700, letterSpacing: '0.12em', gridColumn: '1 / -1' }}>
        ── {label} ──────────────────────────
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

export function ForexPanel({ data, cryptoData, loading, onTickerClick }) {
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#0a0a0a' }}>
      {/* Header */}
      <div style={{ padding: '4px 8px', borderBottom: '1px solid #2a2a2a', background: '#111', flexShrink: 0 }}>
        <span style={{ color: '#ce93d8', fontSize: '10px', fontWeight: 700, letterSpacing: '1px' }}>FX / FOREX · CRYPTO</span>
        <span style={{ color: '#333', fontSize: '8px', marginLeft: 6 }}>LIVE RATES</span>
      </div>

      {/* Column headers */}
      <div style={{ display: 'grid', gridTemplateColumns: COLS, padding: '2px 8px', borderBottom: '1px solid #1a1a1a', flexShrink: 0 }}>
        {['PAIR', 'NAME', 'RATE', 'CHG%'].map((h, i) => (
          <span key={i} style={{ color: '#444', fontSize: '8px', fontWeight: 700, letterSpacing: '1px',
            textAlign: i >= 2 ? 'right' : 'left', paddingRight: i >= 2 ? 4 : 0 }}>{h}</span>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {loading ? (
          <div style={{ padding: '20px', textAlign: 'center', color: '#444', fontSize: '10px' }}>LOADING...</div>
        ) : (
          <>
            {/* ── FX PAIRS ── */}
            <SectionDivider label="FX PAIRS" color="#ce93d8" />
            {FOREX_PAIRS.map(pair => {
              const d = data?.[pair.symbol] || {};
              const price = d.mid || d.ask || d.price;
              const pos   = (d.changePct ?? 0) >= 0;
              const chartSym = pair.symbol + '=X';
              return (
                <div
                  key={pair.symbol}
                  data-ticker={pair.symbol}
                  data-ticker-label={pair.label}
                  data-ticker-type="FX"
                  draggable
                  onDragStart={e => {
                    e.dataTransfer.effectAllowed = 'copy';
                    e.dataTransfer.setData('application/x-ticker', JSON.stringify({ symbol: chartSym, name: pair.label, type: 'CURRENCY' }));
                  }}
                  onClick={() => onTickerClick?.(chartSym)}
                  onContextMenu={e => showInfo(e, pair.symbol, pair.label, 'FX')}
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

            {/* ── CRYPTO ── */}
            <SectionDivider label="CRYPTO" color="#f48fb1" />
            {CRYPTO_PAIRS.map(c => {
              const d   = cryptoData?.[c.symbol] || {};
              const pos = (d.changePct ?? 0) >= 0;
              const chartSym = 'X:' + c.symbol;
              return (
                <div
                  key={c.symbol}
                  data-ticker={'X:' + c.symbol}
                  data-ticker-label={c.label}
                  data-ticker-type="CRYPTO"
                  draggable
                  onDragStart={e => {
                    e.dataTransfer.effectAllowed = 'copy';
                    e.dataTransfer.setData('application/x-ticker', JSON.stringify({ symbol: chartSym, name: c.label, type: 'CRYPTO' }));
                  }}
                  onClick={() => onTickerClick?.(chartSym)}
                  onContextMenu={e => showInfo(e, c.symbol, c.label, 'CRYPTO')}
                  style={{ display: 'grid', gridTemplateColumns: COLS, padding: '3px 8px', borderBottom: '1px solid #141414', cursor: 'pointer', alignItems: 'center' }}
                  onMouseEnter={e => e.currentTarget.style.background = '#141414'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <span style={{ color: '#f48fb1', fontSize: '10px', fontWeight: 700 }}>{c.symbol.replace('USD', '')}</span>
                  <span style={{ color: '#555', fontSize: '9px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: 4 }}>{c.label}</span>
                  <span style={{ color: '#ccc', fontSize: '10px', textAlign: 'right', paddingRight: 4 }}>{fmt2(d.price)}</span>
                  <span style={{ color: pos ? '#4caf50' : '#f44336', fontSize: '10px', textAlign: 'right', fontWeight: 600 }}>{fmtPct(d.changePct)}</span>
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}
