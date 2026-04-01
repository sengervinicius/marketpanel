/**
 * YieldCurvePanel — BR / US / UK / EU sovereign yield curves
 * Layout: 4 stacked chart blocks filling the full panel height — no tabs
 */
import { useState, useEffect, memo } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { apiFetch } from '../../utils/api';

const CURVES = [
  { id: 'BR', label: 'BRAZIL',          color: '#e8a020', note: 'TESOURO PREFIXADO + BCB DI · % P.A.' },
  { id: 'US', label: 'UNITED STATES',  color: '#4d9fec', note: 'US TREASURY PAR YIELD CURVE · %' },
  { id: 'UK', label: 'UNITED KINGDOM', color: '#e05c8a', note: 'UK GILT SPOT · BANK OF ENGLAND · %' },
  { id: 'EU', label: 'EURO AREA',      color: '#7ec8a0', note: 'AAA SOVEREIGN BOND CURVE · ECB · %' },
];

const KEY_TENORS = ['1Y', '2Y', '5Y', '10Y', '30Y'];

function DICurvePanel({ compact = false }) {
  const [all, setAll]             = useState({});
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(null);
  const [updatedAt, setUpdatedAt] = useState('');

  async function load() {
    try {
      setError(null);
      const res = await apiFetch('/api/yield-curves');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setAll(json);
      setUpdatedAt(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    } catch (e) {
      console.warn('[YieldCurve] load error:', e.message);
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

  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      background: 'var(--bg-panel)', height: '100%', overflow: 'hidden',
    }}>

      {/* Panel header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '2px var(--sp-2)', borderBottom: '1px solid var(--border-subtle)',
        background: 'var(--bg-surface)', flexShrink: 0, height: 20,
      }}>
        <span style={{ color: 'var(--text-muted)', fontWeight: 700, fontSize: 'var(--font-sm)', letterSpacing: '0.15em' }}>
          YIELD CURVES
        </span>
        <span style={{ color: 'var(--text-faint)', fontSize: 'var(--font-xs)' }}>
          {loading ? 'LOADING...' : error ? 'ERR' : updatedAt}
        </span>
      </div>

      {/* 4 stacked curve blocks */}
      {CURVES.map((c, idx) => {
        const curve  = all[c.id]?.curve || [];
        const rates  = curve.map(p => p.rate);
        const minR   = rates.length ? Math.floor(Math.min(...rates) - 0.6) : 0;
        const maxR   = rates.length ? Math.ceil(Math.max(...rates)  + 0.6) : 20;
        const keyPts = KEY_TENORS.map(t => curve.find(p => p.tenor === t)).filter(Boolean);

        return (
          <div key={c.id} style={{
            flex: 1, display: 'flex', flexDirection: 'column',
            borderTop: idx > 0 ? '1px solid var(--border-subtle)' : 'none',
            overflow: 'hidden', minHeight: 0,
          }}>

            {/* Country header row */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '1px 6px 0', flexShrink: 0, height: 16, gap: 4,
            }}>
              <span style={{
                color: c.color, fontSize: 'var(--font-xs)', fontWeight: 800,
                letterSpacing: '0.08em', flexShrink: 0,
              }}>
                {c.label}
              </span>

              {!loading && keyPts.length > 0 && (
                <div style={{ display: 'flex', gap: 5, overflow: 'hidden' }}>
                  {keyPts.map(pt => (
                    <span key={pt.tenor} style={{ whiteSpace: 'nowrap', lineHeight: 1 }}>
                      <span style={{ color: 'var(--text-faint)', fontSize: 6, letterSpacing: '0.03em' }}>{pt.tenor} </span>
                      <span style={{ color: 'var(--text-secondary)', fontSize: 7.5, fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                        {pt.rate.toFixed(2)}%
                      </span>
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Chart area */}
            <div style={{ flex: 1, overflow: 'hidden', minHeight: 0 }}>
              {loading ? (
                <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-faint)', fontSize: 'var(--font-xs)' }}>
                  loading...
                </div>
              ) : curve.length === 0 ? (
                <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-faint)', fontSize: 'var(--font-xs)', flexDirection: 'column', gap: 4 }}>
                  <span>DATA UNAVAILABLE</span>
                  <button
                    onClick={load}
                    style={{ background: 'none', border: '1px solid var(--border-default)', color: 'var(--text-faint)', fontSize: 6.5, cursor: 'pointer', padding: '2px 5px', borderRadius: 'var(--radius-sm)', fontFamily: 'inherit' }}
                  >
                    RETRY
                  </button>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={curve} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                    <XAxis
                      dataKey="tenor"
                      tick={{ fill: 'var(--text-muted)', fontSize: 6 }}
                      tickLine={false}
                      axisLine={{ stroke: 'var(--border-subtle)' }}
                    />
                    <YAxis
                      domain={[minR, maxR]}
                      tick={{ fill: 'var(--text-muted)', fontSize: 6 }}
                      tickLine={false}
                      axisLine={false}
                      width={26}
                      tickFormatter={v => v.toFixed(1) + '%'}
                    />
                    <Tooltip
                      contentStyle={{
                        background: 'var(--bg-surface)',
                        border: '1px solid ' + c.color + '44',
                        fontSize: 7, padding: '3px 7px', borderRadius: 2,
                      }}
                      itemStyle={{ color: c.color }}
                      labelStyle={{ color: 'var(--text-muted)', marginBottom: 1 }}
                      formatter={v => [v != null ? v.toFixed(2) + '%' : '—', 'yield']}
                    />
                    <Line
                      type="monotone"
                      dataKey="rate"
                      stroke={c.color}
                      strokeWidth={1.5}
                      dot={{ fill: c.color, r: 2, strokeWidth: 0 }}
                      activeDot={{ r: 3.5, fill: c.color, strokeWidth: 0 }}
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* Source footnote — only on last block */}
            {idx === CURVES.length - 1 && (
              <div style={{ padding: '0 6px 1px', flexShrink: 0 }}>
                <span style={{ color: 'var(--text-faint)', fontSize: 5.5, letterSpacing: '0.04em' }}>
                  {all[c.id]?.source || c.note}
                </span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export { DICurvePanel };
export default memo(DICurvePanel);
