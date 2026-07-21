/**
 * RatesOverlay — the Deep Rates room (Phase S design review §4 note 2).
 *
 * CURVES:  all sovereign curves from /api/yield-curves rendered large,
 *          multi-select country chips, US 1M ghost where available
 *          (the server only stores US curve history today — FRED).
 * SPREADS: client-side matrix from the same curves payload — per-country
 *          2s10s / 10s30s + cross-market 10Y spreads (BR−UST, BUND−UST,
 *          GILT−UST, CONF−UST).
 * CREDIT:  HY/IG OAS + breakevens/real from /api/debt/rates-tape,
 *          rendered as tape primitives (latest + Δ1d). fred.js exposes
 *          latest+Δ1d (fetchLatestPair) and a single N-days-back point
 *          (fetchValueTradingDaysBack) — no observation-series helper is
 *          exported, so a 90d sparkline would need new server surface;
 *          honest tape cells instead, noted inline.
 */
import { useState, useEffect } from 'react';
import { apiFetch } from '../../utils/api';
import { swallow } from '../../utils/swallow';
import { normalizeCurvePayload } from '../../utils/curveShape';
import CurveChart from './CurveChart';

// Same palette as DICurvePanel so the terminal speaks one color language.
const COUNTRIES = [
  { id: 'BR', label: 'BRAZIL',      color: '#e8a020' },
  { id: 'US', label: 'UNITED ST.',  color: '#4d9fec' },
  { id: 'UK', label: 'UK',          color: '#e05c8a' },
  { id: 'EU', label: 'EURO AREA',   color: '#7ec8a0' },
  { id: 'CH', label: 'SWITZERLAND', color: '#d65151' },
];

const rateAt = (curve, tenor) => {
  const p = (curve || []).find(x => x.tenor === tenor);
  return p && Number.isFinite(p.rate) ? p.rate : null;
};
const slopeBps = (curve, a, b) => {
  const ra = rateAt(curve, a);
  const rb = rateAt(curve, b);
  return ra == null || rb == null ? null : Math.round((rb - ra) * 100);
};
const fmtBps = (v) => (v == null ? '—' : `${v > 0 ? '+' : ''}${v}`);
const fmtR = (v, dp = 2) => (v == null || !Number.isFinite(v) ? '—' : v.toFixed(dp));

/* ── CURVES ─────────────────────────────────────────────────────────── */

function CurvesTab({ curves }) {
  const [selected, setSelected] = useState(() => new Set(COUNTRIES.map(c => c.id)));
  const toggle = (id) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(id)) { if (next.size > 1) next.delete(id); } // keep ≥1 selected
    else next.add(id);
    return next;
  });

  if (!curves) return <div className="ol-placeholder">LOADING CURVES…</div>;

  const series = [];
  for (const c of COUNTRIES) {
    if (!selected.has(c.id)) continue;
    const entry = curves[c.id];
    if (!entry?.curve?.length) continue;
    series.push({ id: c.id, label: c.label, color: c.color, points: entry.curve });
    // 1M-ago ghost — server ships it for US only (FRED history).
    if (c.id === 'US' && Array.isArray(entry.ghost) && entry.ghost.length) {
      series.push({ id: 'US-ghost', label: 'US · 1M AGO', color: c.color, points: entry.ghost, dashed: true });
    }
  }

  return (
    <div>
      <div className="ol-ctry-chips">
        {COUNTRIES.map(c => {
          const on = selected.has(c.id);
          const avail = Boolean(curves[c.id]?.curve?.length);
          return (
            <button
              key={c.id}
              type="button"
              className={`ol-chip${on ? ' ol-chip--on' : ''}`}
              style={on ? { color: c.color, borderColor: c.color } : undefined}
              disabled={!avail}
              title={avail ? `${c.label} · ${curves[c.id]?.source || ''}` : `${c.label} — unavailable`}
              onClick={() => toggle(c.id)}
            >{c.label}</button>
          );
        })}
      </div>
      <CurveChart height={300} series={series} />
      <div className="ol-placeholder">
        — — dashed = US curve 1M ago (FRED). Other markets have no stored curve history yet.
        Sources: {COUNTRIES.filter(c => curves[c.id]?.source).map(c => `${c.id} ${curves[c.id].source}`).join(' · ')}
      </div>
    </div>
  );
}

/* ── SPREADS ────────────────────────────────────────────────────────── */

function SpreadsTab({ curves }) {
  if (!curves) return <div className="ol-placeholder">LOADING CURVES…</div>;
  const us10 = rateAt(curves.US?.curve, '10Y');

  const cross = [
    { label: 'BR − UST 10Y',   note: 'Tesouro prefixado vs UST',        a: rateAt(curves.BR?.curve, '10Y'), b: us10 },
    { label: 'BUND − UST 10Y', note: 'EU AAA sovereign curve (≈ Bund)', a: rateAt(curves.EU?.curve, '10Y'), b: us10 },
    { label: 'GILT − UST 10Y', note: 'BoE gilt spot',                   a: rateAt(curves.UK?.curve, '10Y'), b: us10 },
    { label: 'CONF − UST 10Y', note: 'SNB Confederation spot',          a: rateAt(curves.CH?.curve, '10Y'), b: us10 },
  ];

  return (
    <div>
      <div className="ol-sechead">SLOPE MATRIX · COMPUTED FROM LIVE CURVES</div>
      <table className="ol-table" style={{ maxWidth: 720 }}>
        <thead>
          <tr><th>COUNTRY</th><th>2Y</th><th>10Y</th><th>30Y</th><th>2s10s BP</th><th>10s30s BP</th><th>vs UST 10Y BP</th></tr>
        </thead>
        <tbody>
          {COUNTRIES.map(c => {
            const curve = curves[c.id]?.curve || [];
            if (!curve.length) return null;
            const r10 = rateAt(curve, '10Y');
            const vsUs = c.id === 'US' || r10 == null || us10 == null ? null : Math.round((r10 - us10) * 100);
            return (
              <tr key={c.id}>
                <td className="strong" style={{ color: c.color }}>{c.label}</td>
                <td>{fmtR(rateAt(curve, '2Y'))}</td>
                <td className="strong">{fmtR(r10)}</td>
                <td>{fmtR(rateAt(curve, '30Y'))}</td>
                <td>{fmtBps(slopeBps(curve, '2Y', '10Y'))}</td>
                <td>{fmtBps(slopeBps(curve, '10Y', '30Y'))}</td>
                <td>{c.id === 'US' ? '·' : fmtBps(vsUs)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="ol-sechead">CROSS-MARKET 10Y SPREADS</div>
      <table className="ol-table" style={{ maxWidth: 480 }}>
        <tbody>
          {cross.map(x => (
            <tr key={x.label}>
              <td className="strong">{x.label}</td>
              <td style={{ textAlign: 'left', color: 'var(--text-muted)' }}>{x.note}</td>
              <td className="strong">{x.a == null || x.b == null ? '—' : `${fmtBps(Math.round((x.a - x.b) * 100))} bp`}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="ol-placeholder">Missing tenors render "—" — spreads are only shown when both legs are live.</div>
    </div>
  );
}

/* ── CREDIT ─────────────────────────────────────────────────────────── */

const chgColor = (t) => {
  if (t?.change1d == null) return 'var(--text-muted)';
  // Wider spreads / higher yields = red, tighter/lower = green (risk lens).
  return t.change1d > 0 ? 'var(--color-down)' : 'var(--color-up)';
};

function CreditTab() {
  const [tape, setTape] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    apiFetch('/api/debt/rates-tape')
      .then(r => (r.ok ? r.json() : null))
      .then(j => { if (alive) { if (j?.ok) setTape(j.tape); else setFailed(true); } })
      .catch(e => { swallow(e, 'overlay.rates.tape'); if (alive) setFailed(true); });
    return () => { alive = false; };
  }, []);

  if (failed) return <div className="ol-placeholder">— rates tape unavailable (FRED)</div>;
  if (!tape) return <div className="ol-placeholder">LOADING TAPE…</div>;

  const fmtVal = (t) => t.value == null ? '—' : t.unit === 'bp' ? `${Math.round(t.value)}bp` : `${t.value.toFixed(2)}%`;
  const fmtChg = (t) => t.change1d == null ? '' : `${t.change1d > 0 ? '+' : ''}${t.unit === 'bp' ? Math.round(t.change1d) : t.change1d.toFixed(2)}`;

  return (
    <div>
      <div className="ol-sechead">CREDIT & INFLATION · FRED · LATEST + Δ1D</div>
      <div className="ol-grid">
        {tape.map(t => (
          <div key={t.id} className="ol-cell" style={{ minHeight: 72 }}>
            <div className="ol-cell-h">{t.label}<span className="ol-cell-note">· {t.seriesId}</span></div>
            <div className="ol-mini">
              <span className="num" style={{ fontSize: 18, fontWeight: 700 }}>{fmtVal(t)}</span>{' '}
              <span style={{ color: chgColor(t) }}>{fmtChg(t)}</span>
              {t.asOfDate ? <span className="ol-dim" style={{ marginLeft: 8, fontSize: 9 }}>{t.asOfDate}</span> : null}
            </div>
          </div>
        ))}
      </div>
      <div className="ol-placeholder">
        90d history sparklines n/a — the FRED helper (fred.js) exports latest+Δ1d and a single
        N-days-back point only; an observation-series endpoint is future server surface.
      </div>
    </div>
  );
}

export default function RatesOverlay({ tab }) {
  const [curves, setCurves] = useState(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await apiFetch('/api/yield-curves');
        const j = r.ok ? await r.json() : null;
        if (!j || j.error) return;
        // fix/us-curve-shape: shape-tolerant ingest — each country entry
        // (whatever point shape the server ships) is normalized to the
        // internal { tenor, months?, rate } shape CurveChart/rateAt read.
        for (const c of COUNTRIES) {
          const entry = j[c.id];
          if (!entry) continue;
          entry.curve = normalizeCurvePayload(entry);
          if (Array.isArray(entry.ghost)) entry.ghost = normalizeCurvePayload(entry.ghost);
        }
        // Same fail-open US heal as DebtPanel: if the aggregate payload
        // ships an empty US entry, recover it from /api/debt/sovereign/US
        // ({ points: [{ tenor, yield }] } — the normalizer handles it).
        if (!j.US?.curve?.length) {
          try {
            const r2 = await apiFetch('/api/debt/sovereign/US');
            const j2 = r2.ok ? await r2.json() : null;
            const healed = normalizeCurvePayload(j2);
            if (healed.length > 0) {
              j.US = {
                curve: healed,
                source: j2.source === 'fred' ? 'FRED' : (j2.source || 'fallback'),
              };
            }
          } catch (e) { swallow(e, 'overlay.rates.us_curve_fallback'); }
        }
        if (alive) setCurves(j);
      } catch (e) { swallow(e, 'overlay.rates.curves'); }
    })();
    return () => { alive = false; };
  }, []);

  if (tab === 'SPREADS') return <SpreadsTab curves={curves} />;
  if (tab === 'CREDIT')  return <CreditTab />;
  return <CurvesTab curves={curves} />;
}
