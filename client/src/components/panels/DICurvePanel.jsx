/**
 * YieldCurvePanel — BR / US / UK / EU sovereign yield curves
 * Layout: 4 stacked chart blocks filling the full panel height — no tabs
 */
import { useState, useEffect, memo } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { apiFetch } from '../../utils/api';
import './DICurvePanel.css';

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
    <div className="dic-container">

      {/* Panel header */}
      <div className="dic-header">
        <span className="dic-header-title">
          YIELD CURVES
        </span>
        <span className="dic-header-status">
          {loading ? 'LOADING...' : error ? 'ERR' : updatedAt}
        </span>
      </div>

      {/* 4 stacked curve blocks */}
      {CURVES.map((c, idx) => {
        const entry  = all[c.id] || {};
        const curve  = entry.curve || [];
        const isStub = entry.stub === true;
        const rates  = curve.map(p => p.rate);
        const minR   = rates.length ? Math.floor(Math.min(...rates) - 0.6) : 0;
        const maxR   = rates.length ? Math.ceil(Math.max(...rates)  + 0.6) : 20;
        const keyPts = KEY_TENORS.map(t => curve.find(p => p.tenor === t)).filter(Boolean);

        return (
          <div key={c.id} className={`dic-block ${idx > 0 ? 'dic-block-bordered' : ''}`}>

            {/* Country header row */}
            <div className="dic-block-header">
              <span className="dic-block-label" style={{ color: c.color }}>
                {c.label}
              </span>

              {!loading && keyPts.length > 0 && (
                <div className="dic-key-points">
                  {keyPts.map(pt => (
                    <span key={pt.tenor} className="dic-key-point">
                      <span className="dic-key-point-tenor">{pt.tenor} </span>
                      <span className="dic-key-point-rate">
                        {pt.rate.toFixed(2)}%
                      </span>
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Chart area */}
            <div className="dic-chart-area">
              {loading ? (
                <div className="dic-chart-loading">
                  loading...
                </div>
              ) : curve.length === 0 ? (
                <div className="dic-chart-error">
                  <span>DATA UNAVAILABLE</span>
                  <button className="dic-retry-btn"
                    onClick={load}
                  >
                    RETRY
                  </button>
                </div>
              ) : isStub ? (
                <div className="dic-chart-error">
                  <span>INCOMPLETE DATA ({curve.length} point{curve.length !== 1 ? 's' : ''})</span>
                  <span style={{ fontSize: 5.5, color: 'var(--text-faint)', maxWidth: 120, textAlign: 'center' }}>
                    Live sources returned insufficient data. Synthetic points disabled.
                  </span>
                  <button className="dic-retry-btn" onClick={load}>RETRY</button>
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
                        fontSize: 7, padding: '3px 7px', }}
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
              <div className="dic-source">
                <span className="dic-source-text">
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
