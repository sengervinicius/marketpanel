// SentimentPanel.jsx — market breadth, yields (mock), top movers heatmap
// Accepts full data object: { stocks, forex, crypto }

const MOCK_YIELDS = {
  'US2Y':  { value: 4.721, change: -0.012 },
  'US5Y':  { value: 4.234, change: -0.008 },
  'US10Y': { value: 4.312, change: -0.005 },
  'US30Y': { value: 4.598, change:  0.003 },
  'BR10Y': { value: 13.87, change:  0.045 },
  'DE10Y': { value: 2.834, change: -0.018 },
};

const YIELDS = [
  { label: 'US 2Y',  symbol: 'US2Y'  },
  { label: 'US 5Y',  symbol: 'US5Y'  },
  { label: 'US 10Y', symbol: 'US10Y' },
  { label: 'US 30Y', symbol: 'US30Y' },
  { label: 'BR 10Y', symbol: 'BR10Y' },
  { label: 'DE 10Y', symbol: 'DE10Y' },
];

function BreadthBar({ label, items }) {
  if (!items) return null;
  const values = Object.values(items);
  if (!values.length) return null;
  const up = values.filter(v => (v.changePct ?? 0) > 0).length;
  const down = values.length - up;
  const upPct = (up / values.length) * 100;
  const avg = values.reduce((a, b) => a + (b.changePct || 0), 0) / values.length;
  return (
    <div style={{ marginBottom: 3 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
        <span style={{ color: '#888', fontSize: 9, letterSpacing: 0.5 }}>{label}</span>
        <span style={{ fontSize: 9, color: avg >= 0 ? '#4caf50' : '#f44336' }}>
          avg {avg >= 0 ? '+' : ''}{avg.toFixed(2)}% ▲{up} ▼{down}
        </span>
      </div>
      <div style={{ display: 'flex', height: 6, overflow: 'hidden', gap: 1 }}>
        <div style={{ flex: upPct, background: '#1b5e20', minWidth: upPct > 0 ? 2 : 0 }} />
        <div style={{ flex: 100 - upPct, background: '#b71c1c', minWidth: upPct < 100 ? 2 : 0 }} />
      </div>
    </div>
  );
}

export function SentimentPanel({ data, loading }) {
  const stocks = data?.stocks || {};
  const forex  = data?.forex  || {};
  const crypto = data?.crypto || {};

  const topMovers = Object.values(stocks)
    .filter(s => s.changePct != null)
    .sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct))
    .slice(0, 12);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#0a0a0a', overflow: 'hidden' }}>
      {/* Market Breadth */}
      <div style={{ padding: '4px 8px', borderBottom: '1px solid #2a2a2a', background: '#111', flexShrink: 0 }}>
        <span style={{ color: '#80cbc4', fontSize: '10px', fontWeight: 700, letterSpacing: '1px' }}>MARKET BREADTH</span>
      </div>
      <div style={{ padding: '4px 8px', borderBottom: '1px solid #1a1a1a', flexShrink: 0 }}>
        {loading ? (
          <div style={{ color: '#444', fontSize: '10px' }}>LOADING...</div>
        ) : (
          <>
            <BreadthBar label="US EQUITIES" items={stocks} />
            <BreadthBar label="FOREX" items={forex} />
            <BreadthBar label="CRYPTO" items={crypto} />
          </>
        )}
      </div>
      {/* Fixed Income */}
      <div style={{ padding: '4px 8px', borderBottom: '1px solid #1a1a1a', background: '#0d0d0d', flexShrink: 0 }}>
        <span style={{ color: '#80cbc4', fontSize: '10px', fontWeight: 700, letterSpacing: '1px' }}>FIXED INCOME</span>
        <span style={{ color: '#333', fontSize: '8px', marginLeft: 6 }}>YIELDS</span>
      </div>
      <div style={{ padding: '4px 6px', borderBottom: '1px solid #1a1a1a', flexShrink: 0 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 3 }}>
          {YIELDS.map(({ label, symbol }) => {
            const d = MOCK_YIELDS[symbol] || {};
            const up = (d.change || 0) >= 0;
            return (
              <div key={symbol} style={{ background: '#050505', border: '1px solid #1a1a1a', padding: '3px 5px' }}>
                <div style={{ color: '#555', fontSize: 8 }}>{label}</div>
                <div style={{ color: '#e0e0e0', fontWeight: 700, fontSize: 11 }}>{d.value?.toFixed(3)}%</div>
                <div style={{ color: up ? '#4caf50' : '#f44336', fontSize: 9 }}>{up ? '+' : ''}{d.change?.toFixed(3)}</div>
              </div>
            );
          })}
        </div>
      </div>
      {/* Top Movers */}
      <div style={{ padding: '4px 8px', borderBottom: '1px solid #1a1a1a', background: '#0d0d0d', flexShrink: 0 }}>
        <span style={{ color: '#80cbc4', fontSize: '10px', fontWeight: 700, letterSpacing: '1px' }}>TOP MOVERS</span>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '4px' }}>
        {loading || topMovers.length === 0 ? (
          <div style={{ color: '#333', padding: 8, fontSize: 10, textAlign: 'center' }}>Loading...</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 2 }}>
            {topMovers.map(s => {
              const up = (s.changePct ?? 0) >= 0;
              const intensity = Math.min(Math.abs(s.changePct || 0) / 5, 1);
              const bg = up
                ? `rgba(0, ${Math.floor(80 + intensity * 120)}, ${Math.floor(30 + intensity * 50)}, ${0.15 + intensity * 0.4})`
                : `rgba(${Math.floor(80 + intensity * 120)}, 0, 0, ${0.15 + intensity * 0.4})`;
              return (
                <div key={s.symbol} style={{ background: bg, border: `1px solid ${up ? '#004400' : '#440000'}`, padding: '4px', textAlign: 'center' }}>
                  <div style={{ color: '#ff6600', fontWeight: 700, fontSize: 10 }}>{s.symbol}</div>
                  <div style={{ color: up ? '#4caf50' : '#f44336', fontSize: 10, fontWeight: 600 }}>
                    {(s.changePct >= 0 ? '+' : '')}{s.changePct?.toFixed(2)}%
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
