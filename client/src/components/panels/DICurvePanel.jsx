/**
 * DICurvePanel — Brazilian pre-fixed yield curve
 * Data: Tesouro Direto LTN (Prefixado) bonds via public TD JSON API
 * Short end: BCB DI overnight rate (proxied via /api/di-curve)
 */
import { useState, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

const API = import.meta.env.VITE_API_URL || '';

export function DICurvePanel({ compact = false }) {
  const [curve, setCurve] = useState([]);
  const [source, setSource] = useState('');
  const [updatedAt, setUpdatedAt] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  async function load() {
    try {
      setError(null);
      const res = await fetch(API + '/api/di-curve');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setCurve(json.curve || []);
      setSource(json.source || '');
      setUpdatedAt(
        json.updatedAt
          ? new Date(json.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          : ''
      );
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

  const rates = curve.map(c => c.rate);
  const minRate = rates.length ? Math.floor(Math.min(...rates) - 0.8) : 10;
  const maxRate = rates.length ? Math.ceil(Math.max(...rates) + 0.8) : 20;

  const chartHeight = compact ? 110 : 155;

  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      background: '#040508',
      height: compact ? 'auto' : '100%',
      overflow: 'hidden',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: compact ? '2px 6px' : '3px 8px',
        borderBottom: '1px solid #141420',
        background: '#070707',
        flexShrink: 0,
        height: 22,
      }}>
        <span style={{ color: '#e8a020', fontWeight: 700, fontSize: compact ? 8 : 9, letterSpacing: '0.12em' }}>
          BR YIELD CURVE
        </span>
        <span style={{ color: '#252535', fontSize: 7 }}>
          {loading ? 'LOADING…' : error ? 'ERR' : updatedAt}
        </span>
      </div>

      {loading ? (
        <div style={{ height: chartHeight, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#1e1e2e', fontSize: 8 }}>
          loading…
        </div>
      ) : error || curve.length === 0 ? (
        <div style={{ height: chartHeight, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#2a2a3a', fontSize: 7, flexDirection: 'column', gap: 4 }}>
          <span>DATA UNAVAILABLE</span>
          <button onClick={load} style={{ background: 'none', border: '1px solid #1a1a2a', color: '#333', fontSize: 7, cursor: 'pointer', padding: '2px 6px', borderRadius: 2, fontFamily: 'inherit' }}>
            RETRY
          </button>
        </div>
      ) : (
        <div style={{ height: chartHeight, flexShrink: 0 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={curve} margin={{ top: 8, right: 8, bottom: 2, left: 0 }}>
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
                itemStyle={{ color: '#e8a020' }}
                labelStyle={{ color: '#666', marginBottom: 2 }}
                formatter={v => [v != null ? v.toFixed(2) + '%' : '—', 'yield']}
              />
              <Line
                type="monotone"
                dataKey="rate"
                stroke="#e8a020"
                strokeWidth={1.5}
                dot={{ fill: '#e8a020', r: 2.5, strokeWidth: 0 }}
                activeDot={{ r: 4, fill: '#ff9933', strokeWidth: 0 }}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

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
              <span style={{ color: '#999', fontSize: 8, fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                {pt.rate.toFixed(2)}%
              </span>
            </div>
          ))}
        </div>
      )}

      <div style={{ padding: '1px 8px', flexShrink: 0 }}>
        <span style={{ color: '#141428', fontSize: 6, letterSpacing: '0.05em' }}>
          {source === 'Tesouro Direto'
            ? 'TESOURO PREFIXADO (LTN) + BCB DI · ANNUALIZED % A.A.'
            : 'INDICATIVE · BCB/SYNTHETIC · % A.A.'}
        </span>
      </div>
    </div>
  );
}
