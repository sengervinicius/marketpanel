/**
 * DICurvePanel — BR / US / UK / EU sovereign yield curves.
 *
 * CIO-note (2026-04-20): redesigned from four stacked full-width
 * chart blocks to a Bloomberg-style tabular matrix. The previous
 * layout was chart-heavy and low-information-density — a CIO can't
 * read four mini-charts stacked vertically faster than a table. The
 * new layout:
 *
 *   - Sticky yield matrix: one row per country, columns for
 *     1Y/2Y/5Y/10Y/30Y, then slope and credit-spread analytics.
 *   - 2×2 compact curve grid below the matrix so the shape of each
 *     curve is still visible at a glance, but doesn't dominate.
 *
 * This matches the density of StockPanel / BrazilPanel / WatchlistPanel
 * and fixes the feedback: "essentially nothing changed".
 */
import { useState, useEffect, memo } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { apiFetch } from '../../utils/api';
import IntegrityBadge from '../shared/IntegrityBadge';
import './DICurvePanel.css';

const CURVES = [
  { id: 'BR', label: 'BRAZIL',         color: '#e8a020', note: 'TESOURO PREFIXADO + BCB DI · % P.A.' },
  { id: 'US', label: 'UNITED STATES',  color: '#4d9fec', note: 'US TREASURY PAR YIELD CURVE · %' },
  { id: 'UK', label: 'UNITED KINGDOM', color: '#e05c8a', note: 'UK GILT SPOT · BANK OF ENGLAND · %' },
  { id: 'EU', label: 'EURO AREA',      color: '#7ec8a0', note: 'AAA SOVEREIGN BOND CURVE · ECB · %' },
];

const KEY_TENORS = ['1Y', '2Y', '5Y', '10Y', '30Y'];

// ── Curve analytics helpers ────────────────────────────────────────────
function rateAt(curve, tenor) {
  const p = curve.find(x => x.tenor === tenor);
  return p && Number.isFinite(p.rate) ? p.rate : null;
}

function slopeBps(curve, shortT, longT) {
  const a = rateAt(curve, shortT);
  const b = rateAt(curve, longT);
  if (a == null || b == null) return null;
  return Math.round((b - a) * 100);
}

function spreadVsUsBps(countryCurve, usCurve, tenor) {
  const a = rateAt(countryCurve, tenor);
  const b = rateAt(usCurve, tenor);
  if (a == null || b == null) return null;
  return Math.round((a - b) * 100);
}

function fmtRate(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  return v.toFixed(2);
}

function fmtBps(v) {
  if (v == null) return '—';
  const sign = v > 0 ? '+' : '';
  return `${sign}${v}`;
}

function DICurvePanel() {
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

  const usCurve = all.US?.curve || [];
  const source = all[CURVES[0].id]?.source || CURVES[0].note;

  return (
    <div className="dic-container">

      {/* Panel header */}
      <div className="dic-header">
        <span className="dic-header-title">YIELD CURVES</span>
        <span className="dic-header-status">
          <IntegrityBadge domain="yield-curves" />
          {loading ? 'LOADING...' : error ? 'ERR' : updatedAt}
        </span>
      </div>

      {/* ── Matrix table ────────────────────────────────────────────── */}
      <div className="dic-matrix">
        <div className="dic-matrix-head">
          <span className="dic-col-country">COUNTRY</span>
          {KEY_TENORS.map(t => (
            <span key={t} className="dic-col-rate">{t}</span>
          ))}
          <span className="dic-col-metric">2s10s</span>
          <span className="dic-col-metric">10s30s</span>
          <span className="dic-col-metric">vs US 10Y</span>
        </div>

        {CURVES.map(c => {
          const entry = all[c.id] || {};
          const curve = entry.curve || [];
          const s2s10   = slopeBps(curve, '2Y', '10Y');
          const s10s30  = slopeBps(curve, '10Y', '30Y');
          const spread  = c.id === 'US' ? null : spreadVsUsBps(curve, usCurve, '10Y');
          const isEmpty = !loading && curve.length === 0;

          return (
            <div key={c.id} className="dic-matrix-row" title={isEmpty ? 'Data unavailable' : undefined}>
              <span className="dic-col-country" style={{ color: c.color }}>{c.label}</span>
              {KEY_TENORS.map(t => (
                <span key={t} className="dic-col-rate dic-col-rate-val">
                  {loading ? '…' : fmtRate(rateAt(curve, t))}
                </span>
              ))}
              <span className={`dic-col-metric ${s2s10 == null ? '' : s2s10 >= 0 ? 'pos' : 'neg'}`}>
                {loading ? '…' : fmtBps(s2s10)}
              </span>
              <span className={`dic-col-metric ${s10s30 == null ? '' : s10s30 >= 0 ? 'pos' : 'neg'}`}>
                {loading ? '…' : fmtBps(s10s30)}
              </span>
              <span className={`dic-col-metric ${spread == null ? '' : spread >= 0 ? 'pos' : 'neg'}`}>
                {c.id === 'US' ? '—' : loading ? '…' : fmtBps(spread)}
              </span>
            </div>
          );
        })}
        <div className="dic-matrix-note">
          <span>BPS · TENORS IN % P.A. · SLOPE = LONG − SHORT · SPREAD = (COUNTRY − US) 10Y</span>
        </div>
      </div>

      {/* ── 2×2 compact curve grid ──────────────────────────────────── */}
      <div className="dic-grid">
        {CURVES.map(c => {
          const entry   = all[c.id] || {};
          const curve   = entry.curve || [];
          const isStub  = entry.stub === true;
          const rates   = curve.map(p => p.rate).filter(Number.isFinite);
          const minR    = rates.length ? Math.floor(Math.min(...rates) - 0.5) : 0;
          const maxR    = rates.length ? Math.ceil(Math.max(...rates)  + 0.5) : 20;

          return (
            <div key={c.id} className="dic-grid-cell">
              <div className="dic-grid-cell-hdr">
                <span className="dic-grid-cell-label" style={{ color: c.color }}>{c.id}</span>
                <span className="dic-grid-cell-note">{c.label}</span>
              </div>
              <div className="dic-grid-cell-chart">
                {loading ? (
                  <div className="dic-chart-loading">…</div>
                ) : curve.length === 0 ? (
                  <div className="dic-chart-error">
                    <span>NO DATA</span>
                    <button className="dic-retry-btn" onClick={load}>RETRY</button>
                  </div>
                ) : isStub ? (
                  <div className="dic-chart-error">
                    <span>PARTIAL ({curve.length})</span>
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={curve} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                      <XAxis
                        dataKey="tenor"
                        tick={{ fill: 'var(--text-faint)', fontSize: 8 }}
                        tickLine={false}
                        axisLine={{ stroke: 'var(--border-subtle)' }}
                        interval="preserveStartEnd"
                        padding={{ left: 2, right: 2 }}
                      />
                      <YAxis
                        domain={[minR, maxR]}
                        tick={{ fill: 'var(--text-faint)', fontSize: 8 }}
                        tickLine={false}
                        axisLine={false}
                        width={24}
                        tickFormatter={v => v.toFixed(1)}
                      />
                      <Tooltip
                        contentStyle={{
                          background: 'var(--bg-surface)',
                          border: '1px solid ' + c.color + '44',
                          fontSize: 10, padding: '4px 8px',
                          borderRadius: 3,
                        }}
                        itemStyle={{ color: c.color }}
                        labelStyle={{ color: 'var(--text-muted)', marginBottom: 1, fontSize: 9 }}
                        formatter={v => [v != null ? v.toFixed(2) + '%' : '—', 'yield']}
                      />
                      <Line
                        type="monotone"
                        dataKey="rate"
                        stroke={c.color}
                        strokeWidth={1.5}
                        dot={{ fill: c.color, r: 1.8, strokeWidth: 0 }}
                        activeDot={{ r: 3.5, fill: c.color, strokeWidth: 0 }}
                        isAnimationActive={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="dic-source">
        <span className="dic-source-text">{source}</span>
      </div>
    </div>
  );
}

export { DICurvePanel };
export default memo(DICurvePanel);
