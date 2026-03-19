/**
 * SentimentPanel — market breadth, fixed income yields, and a heatmap
 */

import { SectionHeader } from '../common/SectionHeader';
import { fmtPrice, fmtPct } from '../../utils/format';
import { YIELDS } from '../../utils/constants';

function BreadthBar({ label, items, category }) {
  const values = Object.values(items);
  if (values.length === 0) return null;
  const up = values.filter((v) => (v.changePct ?? 0) > 0).length;
  const down = values.length - up;
  const upPct = (up / values.length) * 100;
  const avg = values.reduce((a, b) => a + (b.changePct || 0), 0) / values.length;

  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
        <span style={{ color: '#888', fontSize: 10, letterSpacing: 0.5 }}>{label}</span>
        <span style={{ fontSize: 9, color: avg >= 0 ? '#00cc44' : '#cc2200' }}>
          avg {fmtPct(avg)}  ▲{up} ▼{down}
        </span>
      </div>
      <div style={{ display: 'flex', height: 8, borderRadius: 1, overflow: 'hidden', gap: 1 }}>
        <div style={{ flex: upPct, background: '#006622', minWidth: upPct > 0 ? 2 : 0 }} />
        <div style={{ flex: 100 - upPct, background: '#660000', minWidth: upPct < 100 ? 2 : 0 }} />
      </div>
    </div>
  );
}

// Mock yield data — in production, replace with Polygon Treasury data
const MOCK_YIELDS = {
  'US2Y':  { value: 4.721, change: -0.012 },
  'US5Y':  { value: 4.234, change: -0.008 },
  'US10Y': { value: 4.312, change: -0.005 },
  'US30Y': { value: 4.598, change:  0.003 },
  'BR10Y': { value: 13.87, change:  0.045 },
  'DE10Y': { value: 2.834, change: -0.018 },
};

export function SentimentPanel({ stocks, forex, crypto }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Market Breadth */}
      <SectionHeader title="MARKET BREADTH" />
      <div style={{ padding: '8px 6px', borderBottom: '1px solid #111' }}>
        <BreadthBar label="US EQUITIES" items={stocks} />
        <BreadthBar label="FOREX"       items={forex}  />
        <BreadthBar label="CRYPTO"      items={crypto} />
      </div>

      {/* Fixed Income */}
      <SectionHeader title="FIXED INCOME" right="YIELDS" />
      <div style={{ padding: '4px 6px', borderBottom: '1px solid #111' }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr 1fr',
          gap: 3,
        }}>
          {YIELDS.map(({ label, symbol }) => {
            const d = MOCK_YIELDS[symbol] || {};
            const up = (d.change || 0) >= 0;
            return (
              <div key={symbol} style={{
                background: '#050505',
                border: '1px solid #1a1a1a',
                padding: '3px 6px',
              }}>
                <div style={{ color: '#555', fontSize: 9 }}>{label}</div>
                <div style={{ color: '#e8e8e8', fontWeight: 700, fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>
                  {d.value?.toFixed(3)}%
                </div>
                <div style={{ color: up ? '#00cc44' : '#cc2200', fontSize: 9 }}>
                  {up ? '+' : ''}{d.change?.toFixed(3)}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Heatmap: top movers */}
      <SectionHeader title="TOP MOVERS" />
      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 4px' }}>
        {(() => {
          const allStocks = Object.values(stocks)
            .filter((s) => s.changePct != null)
            .sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct))
            .slice(0, 12);

          if (allStocks.length === 0) {
            return <div style={{ color: '#333', padding: 8, fontSize: 10, textAlign: 'center' }}>Loading...</div>;
          }

          return (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 2 }}>
              {allStocks.map((s) => {
                const up = (s.changePct ?? 0) >= 0;
                const intensity = Math.min(Math.abs(s.changePct || 0) / 5, 1);
                const bg = up
                  ? `rgba(0, ${Math.floor(80 + intensity * 120)}, ${Math.floor(30 + intensity * 50)}, ${0.15 + intensity * 0.4})`
                  : `rgba(${Math.floor(80 + intensity * 120)}, 0, 0, ${0.15 + intensity * 0.4})`;

                return (
                  <div key={s.symbol} style={{
                    background: bg,
                    border: `1px solid ${up ? '#004400' : '#440000'}`,
                    padding: '4px',
                    textAlign: 'center',
                  }}>
                    <div style={{ color: '#ff6600', fontWeight: 700, fontSize: 10 }}>{s.symbol}</div>
                    <div style={{ color: up ? '#00cc44' : '#cc2200', fontSize: 10, fontWeight: 600 }}>
                      {fmtPct(s.changePct)}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })()}
      </div>
    </div>
  );
}
