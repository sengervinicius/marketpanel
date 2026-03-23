/**
 * DICurvePanel â Multi-country yield curves (BR, US, UK)
 * BR: Tesouro Direto Prefixado + BCB DI overnight
 * US: US Treasury par yield curve (treasury.gov)
 * UK: Bank of England gilt spot rates
 */
import { useState, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

const API = import.meta.env.VITE_API_URL || '';

const COUNTRIES = [
  { id: 'BR', label: 'BR', color: '#e8a020', note: 'TESOURO PREFIXADO + BCB DI Â· % A.A.' },
  { id: 'US', label: 'US', color: '#4d9fec', note: 'US TREASURY PAR YIELD CURVE Â· %' },
  { id: 'UK', label: 'UK', color: '#e05c8a', note: 'UK GILT SPOT CURVE Â· BANK OF ENGLAND Â· %' },
];

export function DICurvePanel({ compact = false }) {
  const [all, setAll]         = useState({});
  const [active, setActive]   = useState('BR');
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  async function load() {
    try {
      setError(null);
      const res  = await fetch(API + '/api/yield-curves');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setAll(json);
    } catch (e) {
      console.warn('[DICurvePanel] load error:', e.message);
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const iv = setInterval(load, 600_000);
    return () => clearInterval(iv);
  }, []);

  const country = COUNTRIES.find(c => c.id === active);
  const curve   = all[active]?.curve || [];
  const src     = all[active]?.source || '';
  const updAt   = all[active]?.updatedAt
    ? new Date(all[active].updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : '';

  const rates   = curve.map(c => c.rate);
  const minRate = rates.length ? Math.floor(Math.min(...rates) - 0.8) : 0;
  const maxRate = rates.length ? Math.ceil(Math.max(...rates)  + 0.8) : 10;

  const chartH = compact ? 100 : 145;

  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      background: '#040508',
      height: compact ? 'auto' : '100%',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: compact ? '2px 6px' : '3px 8px',
        borderBottom: '1px solid #141420',
        background: '#070707',
        flexShrink: 0,
        height: 22,
      }}>
        <span style={{ color: '#e8a020', fontWeight: 700, fontSize: compact ? 8 : 9, letterSpacing: '0.12em' }}>
          YIELD CURVES
        </span>
        <span style={{ color: '#252535', fontSize: 7 }}>
          {loading ? 'LOADINGâ¦' : error ? 'ERR' : updAt}
        </span>
      </div>

      {/* Tab row */}
      <div style={{
        display: 'flex', flexShrink: 0,
        borderBottom: '1px solid #0d0d18',
        background: '#050508',
      }}>
        {COUNTRIES.map(c => (
          <button
            key={c.id}
            onClick={() => setActive(c.id)}
            style={{
              flex: 1, padding: '3px 0', border: 'none', cursor: 'pointer',
              background: active === c.id ? '#0a0a10' : 'transparent',
              color: active === c.id ? c.color : '#333',
              fontSize: compact ? 7 : 8, fontWeight: 700, letterSpacing: '0.1em',
              borderBottom: active === c.id ? `2px solid ${c.color}` : '2px solid transparent',
              fontFamily: 'inherit',
              transition: 'color 0.15s',
            }}
          >
            {c.label}
          </button>
        ))}
      </div>

      {/* Chart */}
      {loading ? (
        <div style={{ height: chartH, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#1e1e2e', fontSize: 8 }}>
          loadingâ¦
        </div>
      ) : error || curve.length === 0 ? (
        <div style={{ height: chartH, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#2a2a3a', fontSize: 7, flexDirection: 'column', gap: 4 }}>
          <span>DATA UNAVAILABLE</span>
          <button onClick={load} style={{ background: 'none', border: '1px solid #1a1a2a', color: '#333', fontSize: 7, cursor: 'pointer', padding: '2px 6px', borderRadius: 2, fontFamily: 'inherit' }}>
            RETRY
          </button>
        </div>
      ) : (
        <div style={{ height: chartH, flexShrink: 0 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={curve} margin={{ top: 6, right: 8, bottom: 2, left: 0 }}>
              <XAxis
                dataKey="tenor"
                tick={{ fill: '#3a3a5a', fontSize: compact ? 6 : 7 }}
                tickLine={false}
                axisLine={{ stroke: '#141420' }}
              />
              <YAxis
                domain={[minRate, maxRate]}
                tick={{ fill: '#3a3a5a', fontSize: compact ? 6 : 7 }}
                tickLine={false}
                axisLine={false}
                width={32}
                tickFormatter={v => v.toFixed(1) + '%'}
              />
              <Tooltip
                contentStyle={{
                  background: '#07090f', border: '1px solid #2a2a3a',
                  fontSize: 8, padding: '4px 8px', borderRadius: 2,
                }}
                itemStyle={{ color: country.color }}
                labelStyle={{ color: '#666', marginBottom: 2 }}
                formatter={v => [v != null ? v.toFixed(2) + '%' : 'â', 'yield']}
              />
              <Line
                type="monotone"
                dataKey="rate"
                stroke={country.color}
                strokeWidth={1.5}
                dot={{ fill: country.color, r: 2.5, strokeWidth: 0 }}
                activeDot={{ r: 4, fill: country.color, strokeWidth: 0 }}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Numeric row */}
      {!loading && !error && curve.length > 0 && (
        <div style={{
          display: 'flex', flexWrap: 'wrap', gap: '1px 6px',
          padding: compact ? '2px 6px 3px' : '3px 8px 4px',
          borderTop: '1px solid #0d0d18',
          flexShrink: 0,
        }}>
          {curve.map(pt => (
            <div key={pt.tenor} style={{ display: 'flex', gap: 2, alignItems: 'baseline' }}>
              <span style={{ color: '#2a2a45', fontSize: 6.5, letterSpacing: '0.04em' }}>{pt.tenor}</span>
              <span style={{ color: country.color, fontSize: 8, fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                {pt.rate.toFixed(2)}%
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Footer */}
      <div style={{ padding: '1px 8px', flexShrink: 0 }}>
        <span style={{ color: '#141428', fontSize: 6, letterSpacing: '0.05em' }}>
          {country.note}{src ? ` Â· ${src.toUpperCase()}` : ''}
        </span>
      </div>
    </div>
  );
}
