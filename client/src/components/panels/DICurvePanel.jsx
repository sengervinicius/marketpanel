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
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { apiFetch } from '../../utils/api';
import { fmtCompactPct } from '../../utils/format';
import IntegrityBadge from '../shared/IntegrityBadge';
import { useIsMobile } from '../../hooks/useIsMobile';
import DesktopOnlyPlaceholder from '../common/DesktopOnlyPlaceholder';
import './DICurvePanel.css';

const CURVES = [
  { id: 'BR', label: 'BRAZIL',         color: '#e8a020', note: 'TESOURO PREFIXADO + BCB DI · % P.A.' },
  { id: 'US', label: 'UNITED STATES',  color: '#4d9fec', note: 'US TREASURY PAR YIELD CURVE · %' },
  { id: 'UK', label: 'UNITED KINGDOM', color: '#e05c8a', note: 'UK GILT SPOT · BANK OF ENGLAND · %' },
  { id: 'EU', label: 'EURO AREA',      color: '#7ec8a0', note: 'AAA SOVEREIGN BOND CURVE · ECB · %' },
  // #225 — Swiss Confederation spot + implied 1Y forward curve (SNB)
  { id: 'CH', label: 'SWITZERLAND',    color: '#d65151', note: 'CONFEDERATION SPOT + IMPLIED 1Y FORWARD · SNB · %' },
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

function DICurvePanelInner() {
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

      {/* ── Compact curve grid (3×2 since #225 added CH) ─────────────── */}
      <div className="dic-grid">
        {CURVES.map(c => {
          const entry    = all[c.id] || {};
          const curve    = entry.curve || [];
          const forwards = entry.forwards || [];  // #225 — CH only, for now
          const isStub   = entry.stub === true;

          // Merge spot + forward points by tenor so both lines share an
          // x-axis. `forward` is left undefined for tenors where we don't
          // have it (so Recharts draws a gap, not a zero baseline).
          const fwdByTenor = new Map(forwards.map(p => [p.tenor, p.rate]));
          const mergedData = curve.map(p => ({
            tenor:   p.tenor,
            rate:    p.rate,
            forward: fwdByTenor.has(p.tenor) ? fwdByTenor.get(p.tenor) : null,
          }));

          const allRates = [
            ...curve.map(p => p.rate),
            ...forwards.map(p => p.rate),
          ].filter(Number.isFinite);
          const minR = allRates.length ? Math.floor(Math.min(...allRates) - 0.5) : 0;
          const maxR = allRates.length ? Math.ceil(Math.max(...allRates)  + 0.5) : 20;

          return (
            <div key={c.id} className="dic-grid-cell">
              <div className="dic-grid-cell-hdr">
                <span className="dic-grid-cell-label" style={{ color: c.color }}>{c.id}</span>
                <span className="dic-grid-cell-note">
                  {c.label}
                  {forwards.length > 0 && <span className="dic-grid-cell-forward-tag"> · SPOT + FORWARD</span>}
                </span>
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
                    <LineChart data={mergedData} margin={{ top: 6, right: 6, bottom: 2, left: 0 }}>
                      <XAxis
                        dataKey="tenor"
                        tick={{ fill: 'var(--text-secondary)', fontSize: 10, fontFamily: 'var(--font-family-mono)' }}
                        tickLine={false}
                        axisLine={{ stroke: 'var(--border-strong)' }}
                        interval="preserveStartEnd"
                        padding={{ left: 2, right: 2 }}
                      />
                      <YAxis
                        domain={[minR, maxR]}
                        tick={{ fill: 'var(--text-secondary)', fontSize: 10, fontFamily: 'var(--font-family-mono)' }}
                        tickLine={false}
                        axisLine={false}
                        width={28}
                        tickFormatter={v => fmtCompactPct(v, 1)}
                      />
                      <Tooltip
                        contentStyle={{
                          background: 'var(--bg-elevated)',
                          border: '1px solid var(--border-strong)',
                          fontSize: 10,
                          fontFamily: 'var(--font-family-mono)',
                          padding: '4px 8px',
                          borderRadius: 3,
                        }}
                        itemStyle={{ color: c.color, fontFamily: 'var(--font-family-mono)' }}
                        labelStyle={{ color: 'var(--color-text-secondary)', marginBottom: 2, fontSize: 10, fontFamily: 'var(--font-family-mono)' }}
                        formatter={(v, name) => [v != null ? v.toFixed(2) + '%' : '—', name === 'forward' ? '1Y fwd' : 'spot']}
                      />
                      <Line
                        type="monotone"
                        dataKey="rate"
                        name="spot"
                        stroke={c.color}
                        strokeWidth={1.5}
                        dot={{ fill: c.color, r: 2.2, strokeWidth: 0 }}
                        activeDot={{ r: 4, fill: c.color, strokeWidth: 0 }}
                        isAnimationActive={false}
                      />
                      {forwards.length > 0 && (
                        <Line
                          type="monotone"
                          dataKey="forward"
                          name="forward"
                          stroke={c.color}
                          strokeWidth={1}
                          strokeDasharray="3 3"
                          dot={{ fill: c.color, r: 1.8, strokeWidth: 0, fillOpacity: 0.7 }}
                          activeDot={{ r: 3.2, fill: c.color, strokeWidth: 0 }}
                          connectNulls={false}
                          isAnimationActive={false}
                        />
                      )}
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

/* ── Mobile wrapper ───────────────────────────────────────────
 * Phase 10.6 — the yield-curve matrix + 2×2 chart grid is designed
 * for a wide desktop viewport. Swap in a branded "open on desktop"
 * placeholder on small screens instead of cramming it. */
function DICurvePanel() {
  const isMobile = useIsMobile();
  if (isMobile) {
    return (
      <DesktopOnlyPlaceholder
        title="Yield Curves"
        subtitle="BR · US · UK · EU · CH sovereign curves side-by-side"
        features={[
          'Full tenor matrix (1Y · 2Y · 5Y · 10Y · 30Y) per country',
          'Slope and credit-spread analytics vs USTs',
          'Swiss Confederation spot + implied 1Y forward overlay',
          '3×2 curve grid to read shape at a glance',
        ]}
      />
    );
  }
  return <DICurvePanelInner />;
}

export { DICurvePanel };
export default memo(DICurvePanel);
