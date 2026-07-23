/**
 * DebtPanel.jsx — RATES & CREDIT board (Design v1, approved mockup
 * particle-home-design-review.html, section 2).
 *
 * Layout:
 *   · Header: RATES & CREDIT + region chips US | DI·BR | EU | UK | ALL
 *     (chips switch the MAIN CURVE only; the right board stays global).
 *   · Tape: 4 cells — US 10Y (level+Δbp), 2s10s (+regime word),
 *     10Y REAL, HY OAS. GET /api/debt/rates-tape (FRED, 30 min cache).
 *   · Main curve: accent line w1.6 + gradient fill, plus 1-month-ago
 *     ghost curve (grey dashed, "– – 1M AGO") — additive `ghost` field
 *     on /api/yield-curves (US only today; others degrade to no ghost).
 *   · Right column: GLOBAL 10Y rows (UST / DI·BR / BUND·EU / GILT) with
 *     54×16 mini-curves from the already-loaded /api/yield-curves shapes;
 *     click row swaps the main curve. Then CREDIT & INFLATION rows.
 *
 * Data sources (all pre-existing endpoints):
 *   /api/yield-curves        — US/EU/UK/BR curves (+ additive US ghost)
 *   /api/debt/rates-tape     — FRED tape series (now incl. DGS10/T10Y2Y/IG)
 *   /api/debt/yields/global  — Yahoo 10Y Δbp for the global rows
 */

import { useState, useEffect, useCallback, useRef, useMemo, memo } from 'react';
import {
  ComposedChart, Line, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts';
import { TOKEN_HEX } from '../../utils/tokenHex';
import { normalizeCurvePayload } from '../../utils/curveShape';
import {
  slopeRegimeWord, isCountryTape, countryTapeCells,
} from '../../utils/curveTape';
import { apiFetch } from '../../utils/api';
import { fmtCompactPct } from '../../utils/format';
import { swallow } from '../../utils/swallow';
import IntegrityBadge from '../shared/IntegrityBadge';
import PanelChrome from '../common/PanelChrome';
import Tape from '../common/Tape';
import BoardRow, { BoardSectionLabel } from '../common/BoardRow';
import { PriceRow } from '../common/PriceRow';
import { COLS_STANDARD } from '../../utils/panelColumns';
import { openDetailWindow } from '../../utils/detailWindow';
import ViewChips from '../common/ViewChips';
import { useOverlay } from '../overlay/OverlayContext';
import './DebtPanel.css';

// Region chips — switch the main curve only.
const REGIONS = [
  { code: 'US',  label: 'US' },
  { code: 'BR',  label: 'DI·BR' },
  { code: 'EU',  label: 'EU' },
  { code: 'UK',  label: 'UK' },
  { code: 'ALL', label: 'ALL' },
];

// Global 10Y board rows (right column) — mockup order, DI second.
const GLOBAL_ROWS = [
  { code: 'US', flag: '🇺🇸', label: 'UST' },
  { code: 'BR', flag: '🇧🇷', label: 'DI·BR' },
  { code: 'EU', flag: '🇩🇪', label: 'BUND·EU' },
  { code: 'UK', flag: '🇬🇧', label: 'GILT' },
  // CH ships a full SNB curve in the same /api/yield-curves payload — it was
  // simply never listed on the board (fix/bug-wave3 BUG 1b).
  { code: 'CH', flag: '🇨🇭', label: 'CONF·CH' },
];

// Monthly 10Y-only sovereigns (FRED OECD long-term rates) — flag lookup for
// the additive `global10y` block on /api/debt/rates-tape.
const MONTHLY_FLAGS = { JP: '🇯🇵', MX: '🇲🇽', AU: '🇦🇺', NO: '🇳🇴', SE: '🇸🇪' };

// /api/debt/yields/global country codes for Δbp lookup.
const GLOBAL_CHG_KEY = { US: 'US', EU: 'DE', UK: 'GB' }; // BR: no Yahoo ticker → no Δ

// Region chip → monthly OECD long-term-rate country on /api/debt/rates-tape's
// global10y block, used for the country tape's 10Y Δ1M cell. EU=Bund→DE,
// UK=Gilt→GB, BR direct. CH has no OECD monthly series here → Δ1M renders "—".
const MONTHLY_CHG_KEY = { EU: 'DE', UK: 'GB', BR: 'BR' };

// SVG stroke hexes (SVG can't resolve CSS vars): accent/up from TOKEN_HEX,
// EU/UK from the panel's long-standing country palette.
const REGION_HEX = { US: TOKEN_HEX.accent, BR: TOKEN_HEX.up, EU: '#ffcc00', UK: '#cc88ff', CH: '#d65151' };

// Tenor → months, for sorting/anchoring (DI = overnight).
function tenorMonths(t) {
  if (t == null) return null;
  const s = String(t).toUpperCase();
  if (s === 'DI') return 0.5;
  const m = s.match(/^(\d+(?:\.\d+)?)(M|Y)$/);
  if (!m) return null;
  return m[2] === 'M' ? parseFloat(m[1]) : parseFloat(m[1]) * 12;
}

// Nearest point to a target tenor (months) — BR has no literal "10Y".
function nearestPoint(points, targetMonths = 120) {
  if (!points || points.length === 0) return null;
  let best = null, bestDist = Infinity;
  for (const p of points) {
    const m = tenorMonths(p.tenor);
    if (m == null) continue;
    const d = Math.abs(m - targetMonths);
    if (d < bestDist) { best = p; bestDist = d; }
  }
  return best;
}

function fmtBp(v, dp = 1) {
  if (v == null) return null;
  const sign = v > 0 ? '+' : v < 0 ? '−' : '';
  return `${sign}${Math.abs(v).toFixed(dp)}bp`;
}

/* ── Tape (4 cells, shared Tape primitive) ─────────────────────────────────
 * FULLY COUNTRY-AWARE (fix/rates-earnings-popout item 1): the whole tape
 * follows the selected curve — no mixed US/country provenance.
 *   US / ALL  → [US 10Y +Δ1d | 2s10s +regime | 10Y REAL | HY OAS]  (FRED).
 *   BR/EU/UK/CH → [<CTY> 10Y | <CTY> 2s10s | <CTY> 10Y Δ1M | <CTY> vs UST 10Y].
 * 2s10s + vs-UST spread compute client-side from /api/yield-curves (curveTape
 * util); 10Y Δ1M reads the FRED OECD monthly global10y block's prior print.
 * Each cell degrades to "—" (missing tenors, missing monthly series). */

function RatesTape({ tape, regionCell }) {
  const byId = useMemo(
    () => Object.fromEntries((tape || []).map(t => [t.id, t])),
    [tape]
  );
  const us10 = byId.us10y, s210 = byId.spread2s10s, real = byId.real10y, hy = byId.hyOas;

  // 2s10s regime word: INVERTED (level < 0) beats direction; otherwise the
  // 1-day slope change reads STEEPENING / FLATTENING.
  let regimeWord = null, regimeColor = null;
  if (s210?.value != null) {
    if (s210.value < 0)             { regimeWord = 'INVERTED';   regimeColor = 'var(--color-down)'; }
    else if (s210.change1d > 0)     { regimeWord = 'STEEPENING'; regimeColor = 'var(--color-up)'; }
    else if (s210.change1d < 0)     { regimeWord = 'FLATTENING'; regimeColor = 'var(--color-down)'; }
    else                            { regimeWord = s210.value > 50 ? 'STEEP' : 'FLAT'; regimeColor = 'var(--text-muted)'; }
  }

  const pct = t => (t?.value != null ? `${t.value.toFixed(2)}%` : null);
  const bp  = t => (t?.value != null ? `${Math.round(t.value)}bp` : null);
  // Δ for %-series is expressed in bp (×100). Yields up = red; OAS wider = red.
  const dPct = t => (t?.change1d != null ? fmtBp(t.change1d * 100) : null);
  const dBp  = t => (t?.change1d != null ? fmtBp(t.change1d, 0) : null);
  const riskColor = chg => (chg > 0 ? 'var(--color-down)' : chg < 0 ? 'var(--color-up)' : 'var(--text-faint)');

  // ── Country tape (BR/EU/UK/CH): ALL FOUR cells become that country ──
  if (regionCell) {
    const code  = regionCell.code;
    const rWord = slopeRegimeWord(regionCell.slopeBps);
    return (
      <Tape
        title={`${code} curve (/api/yield-curves) · 10Y Δ1M from FRED OECD monthly · vs UST computed client-side`}
        cells={[
          {
            key: 'r10y', label: `${code} 10Y`,
            value: regionCell.y10 != null ? `${regionCell.y10.toFixed(2)}%` : null,
            delta: regionCell.chgBps != null ? fmtBp(regionCell.chgBps) : null,
            deltaColor: regionCell.chgBps != null ? riskColor(regionCell.chgBps) : null,
          },
          {
            key: 'r2s10s', label: `${code} 2s10s`,
            value: regionCell.slopeBps != null
              ? `${regionCell.slopeBps > 0 ? '+' : ''}${regionCell.slopeBps}bp` : null,
            delta: rWord,
            deltaColor: rWord === 'INVERTED' ? 'var(--color-down)' : 'var(--text-muted)',
          },
          {
            key: 'r10yD1m', label: `${code} 10Y Δ1M`,
            value: regionCell.delta1mBps != null ? fmtBp(regionCell.delta1mBps, 0) : null,
            deltaColor: regionCell.delta1mBps != null ? riskColor(regionCell.delta1mBps) : null,
            delta: 'MoM',
          },
          {
            key: 'rVsUst', label: `${code} vs UST`,
            value: regionCell.vsUstBps != null
              ? `${regionCell.vsUstBps > 0 ? '+' : ''}${regionCell.vsUstBps}bp` : null,
            delta: '10Y',
            deltaColor: 'var(--text-muted)',
          },
        ]}
      />
    );
  }

  // ── US / ALL: the FRED tape (unchanged) ──
  return (
    <Tape
      title="FRED — 30 min server cache"
      cells={[
        {
          key: 'us10y', label: 'US 10Y', value: pct(us10), delta: dPct(us10),
          deltaColor: us10?.change1d != null ? riskColor(us10.change1d) : null,
        },
        {
          key: 's2s10s', label: '2s10s',
          value: s210?.value != null ? `${s210.value > 0 ? '+' : ''}${Math.round(s210.value)}bp` : null,
          delta: regimeWord, deltaColor: regimeColor,
        },
        { key: 'real10y', label: '10Y REAL', value: pct(real), delta: dPct(real),
          deltaColor: real?.change1d != null ? riskColor(real.change1d) : null },
        { key: 'hyOas', label: 'HY OAS', value: bp(hy), delta: dBp(hy),
          deltaColor: hy?.change1d != null ? riskColor(hy.change1d) : null },
      ]}
    />
  );
}

/* ── 54×16 mini-curve (right board rows) ────────────────────────────
 * Plain SVG path from the already-loaded curve shape — no recharts,
 * mockup-exact footprint. Stroke: accent when the row drives the main
 * curve; else green when the day's 10Y Δ is negative, grey otherwise. */
function MiniCurveSvg({ points, stroke }) {
  const d = useMemo(() => {
    const pts = (points || [])
      .map(p => ({ m: tenorMonths(p.tenor), y: p.yield }))
      .filter(p => p.m != null && p.y != null)
      .sort((a, b) => a.m - b.m);
    if (pts.length < 2) return null;
    const ys = pts.map(p => p.y);
    const min = Math.min(...ys), max = Math.max(...ys);
    const span = max - min || 1;
    return pts.map((p, i) => {
      const x = 1 + (i / (pts.length - 1)) * 52;
      const y = 13.5 - ((p.y - min) / span) * 11;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
  }, [points]);

  if (!d) return <svg viewBox="0 0 54 16" aria-hidden="true" />;
  return (
    <svg viewBox="0 0 54 16" aria-hidden="true">
      <path d={d} fill="none" stroke={stroke} strokeWidth="1.2" />
    </svg>
  );
}

/* ── Main panel ─────────────────────────────────────────────────── */
// ── Bonds subbox (under the curve) ───────────────────────────────────────────
// Shows issue-level corporate bonds from /api/market/bonds/corporate when the
// Eulerpool key is configured; until then falls back to liquid bond/credit
// ETFs priced live via a direct snapshot fetch — so the box is always useful and
// upgrades automatically the moment the key is set.
const CORP_FALLBACK_ETFS = [
  { sym: 'LQD', name: 'IG Corp' },
  { sym: 'HYG', name: 'High Yield' },
  { sym: 'EMB', name: 'EM Sovereign' },
  { sym: 'TLT', name: '20+Y Treasury' },
  { sym: 'IEF', name: '7-10Y Treasury' },
  { sym: 'AGG', name: 'US Aggregate' },
];

function fmtBondYield(y) {
  if (y == null || isNaN(y)) return '\u2014';
  const v = Number(y);
  const pct = Math.abs(v) < 1 ? v * 100 : v;
  return pct.toFixed(2) + '%';
}

function DpBonds() {
  const [corp, setCorp] = useState(null);   // Eulerpool corp bonds (null=loading)
  const [px, setPx] = useState({});          // ETF fallback live prices

  // Corp bonds (Eulerpool) — populates only when the key is configured.
  useEffect(() => {
    let alive = true;
    apiFetch('/api/market/bonds/corporate?limit=6')
      .then(r => (r.ok ? r.json() : null))
      .then(j => { if (alive) setCorp(Array.isArray(j?.data) ? j.data : []); })
      .catch(() => { if (alive) setCorp([]); });
    return () => { alive = false; };
  }, []);

  const hasCorp = Array.isArray(corp) && corp.length > 0;

  // ETF fallback — direct snapshot fetch (self-contained, refreshes on cycle).
  useEffect(() => {
    if (hasCorp) return undefined;
    let alive = true;
    const syms = CORP_FALLBACK_ETFS.map(e => e.sym).join(',');
    const load = () => apiFetch(`/api/snapshot/tickers?symbols=${syms}`)
      .then(r => (r.ok ? r.json() : null))
      .then(j => {
        if (!alive || !j) return;
        const res = j.results || j;
        const next = {};
        for (const e of CORP_FALLBACK_ETFS) {
          const t = res?.[e.sym]?.ticker || res?.[e.sym];
          if (t) next[e.sym] = { price: t.min?.c ?? t.day?.c ?? t.lastTrade?.p ?? null, chg: t.todaysChangePerc ?? null };
        }
        setPx(next);
      })
      .catch(() => {});
    load();
    const id = setInterval(load, 60000);
    return () => { alive = false; clearInterval(id); };
  }, [hasCorp]);

  return (
    <div className="dp-corp">
      <div className="dp-corp-head">
        <span>CORPORATE BONDS</span>
        <span className="dp-corp-src">{hasCorp ? 'EULERPOOL' : 'ETF PROXY \u00b7 double-click for detail'}</span>
      </div>
      <div className="dp-corp-list">
        {hasCorp
          ? corp.map((b, i) => (
              <PriceRow
                key={b.isin || b.ticker || i}
                symbol={b.ticker || (b.isin || '\u2014').slice(0, 6)}
                name={`${(b.issuer || '\u2014').slice(0, 28)}${b.maturity ? ' \u00b7 ' + b.maturity : ''}`}
                price={b.yield != null ? Number(Math.abs(b.yield) < 1 ? b.yield * 100 : b.yield) : null}
                changePct={null}
                decimals={2}
                columns={COLS_STANDARD}
              />
            ))
          : CORP_FALLBACK_ETFS.map(e => {
              const q = px[e.sym];
              return (
                <PriceRow
                  key={e.sym}
                  symbol={e.sym}
                  name={e.name}
                  price={q?.price != null ? Number(q.price) : null}
                  changePct={q?.chg ?? null}
                  decimals={2}
                  columns={COLS_STANDARD}
                  onDoubleClick={() => openDetailWindow(e.sym, 'Rates & Credit')}
                />
              );
            })}
      </div>
    </div>
  );
}

function DebtPanel() {
  // Phase S §4 — title click opens the Rates deep-view overlay.
  const { open: openOverlay } = useOverlay();
  const [region, setRegion]           = useState('US');
  // Which curves overlay in ALL mode (the "+" curve toggle). Default = all
  // curves that actually have data (US/BR/EU/UK/CH); SONIA/others have none.
  const [overlayCurves, setOverlayCurves] = useState(() => new Set(GLOBAL_ROWS.map(r => r.code)));
  const [curveMenuOpen, setCurveMenuOpen] = useState(false);
  const [liveReady, setLiveReady]     = useState(false);
  const [error, setError]             = useState(null);
  const [tape, setTape]               = useState(null);
  const [global10y, setGlobal10y]     = useState([]);   // monthly FRED OECD 10Y rows
  const [globalChg, setGlobalChg]     = useState({});   // { US: bp, DE: bp, GB: bp }
  const [lastUpdated, setLastUpdated] = useState(null);
  const [reloadKey, setReloadKey]     = useState(0);
  const liveDataRef = useRef(null);

  // ── Rates tape (FRED; server caches 30 min) ──
  useEffect(() => {
    let alive = true;
    apiFetch('/api/debt/rates-tape')
      .then(r => (r.ok ? r.json() : null))
      .then(j => {
        if (!alive || !j?.ok) return;
        if (Array.isArray(j.tape)) setTape(j.tape);
        if (Array.isArray(j.global10y)) setGlobal10y(j.global10y);
      })
      .catch(e => swallow(e, 'panel.debt.rates_tape'));
    return () => { alive = false; };
  }, [reloadKey]);

  // ── Global 10Y Δbp (Yahoo; server caches 5 min) — additive, non-fatal ──
  useEffect(() => {
    let alive = true;
    apiFetch('/api/debt/yields/global')
      .then(r => (r.ok ? r.json() : null))
      .then(j => {
        if (!alive || !j?.ok || !Array.isArray(j.yields)) return;
        const map = {};
        j.yields.forEach(y => { if (y.changeBps != null) map[y.country] = y.changeBps; });
        setGlobalChg(map);
      })
      .catch(e => swallow(e, 'panel.debt.global_10y_chg'));
    return () => { alive = false; };
  }, [reloadKey]);

  // ── Curves (US/EU/UK/BR + additive US ghost) — one fetch ──
  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    setLiveReady(false);
    setError(null);

    apiFetch('/api/yield-curves', { signal: controller.signal })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(async (json) => {
        // Fail-open (fix/us-curve-regression): if the aggregate payload
        // ships an empty US entry (Treasury XML down + FRED fallback
        // rate-limited server-side), heal it from /api/debt/sovereign/US
        // (FRED -> Yahoo) so the main chart AND the UST board row — which
        // both read this same payload via getCurve('US') — stay populated.
        // The old panel had this as its "Step 2" fallback; Design v1
        // dropped it, which made the empty entry user-fatal.
        // fix/us-curve-shape: the heal is shape-tolerant — sovereign/US
        // ships { points: [{ tenor, yield }] } while this panel (and the
        // aggregate payload) speak { curve: [{ tenor, months?, rate }] }.
        // normalizeCurvePayload accepts BOTH (and bare arrays), so a
        // healthy fallback response can never again "heal" to 0 points.
        if (!Array.isArray(json?.US?.curve) || json.US.curve.length === 0) {
          try {
            const r2 = await apiFetch('/api/debt/sovereign/US', { signal: controller.signal });
            const j2 = r2.ok ? await r2.json() : null;
            const healed = normalizeCurvePayload(j2);
            if (healed.length > 0) {
              json.US = {
                curve: healed,
                source: j2.source === 'fred' ? 'FRED' : (j2.source || 'fallback'),
                updatedAt: new Date().toISOString(),
                // no ghost — fallback source has no 1M-ago history
              };
            }
          } catch (e) { swallow(e, 'panel.debt.us_curve_fallback'); }
        }
        liveDataRef.current = json;
        setLastUpdated(new Date());
      })
      .catch(e => {
        if (e.name !== 'AbortError') setError('Yield data unavailable — click RETRY');
      })
      .finally(() => {
        clearTimeout(timeout);
        setLiveReady(true);
      });

    return () => { clearTimeout(timeout); controller.abort(); };
  }, [reloadKey]);

  const getCurve = useCallback((code) => {
    const entry = liveDataRef.current?.[code];
    if (!entry?.curve?.length) return null;
    return {
      points: entry.curve.map(p => ({ tenor: p.tenor, yield: p.rate })),
      ghost: Array.isArray(entry.ghost)
        ? entry.ghost.map(p => ({ tenor: p.tenor, yield: p.rate }))
        : null,
      ghostAsOf: entry.ghostAsOf || null,
      source: entry.source || code,
    };
    // liveReady gates callers; ref itself is stable.
  }, []);

  // ── Main chart data ──
  const single = region !== 'ALL' ? (liveReady ? getCurve(region) : null) : null;

  const chartData = useMemo(() => {
    if (!liveReady) return [];
    if (region !== 'ALL') {
      if (!single) return [];
      const ghostByTenor = Object.fromEntries((single.ghost || []).map(p => [p.tenor, p.yield]));
      return single.points
        .map(p => ({ tenor: p.tenor, m: tenorMonths(p.tenor), yield: p.yield, ghost: ghostByTenor[p.tenor] ?? null }))
        .filter(p => p.m != null || p.tenor === 'DI')
        .sort((a, b) => (a.m ?? 0) - (b.m ?? 0));
    }
    // ALL — overlay the four curves on a shared (union) tenor axis.
    const rows = new Map();
    for (const { code } of GLOBAL_ROWS) {
      const c = getCurve(code);
      if (!c) continue;
      for (const p of c.points) {
        const m = tenorMonths(p.tenor);
        if (m == null) continue;
        if (!rows.has(p.tenor)) rows.set(p.tenor, { tenor: p.tenor, m });
        rows.get(p.tenor)[code] = p.yield;
      }
    }
    return [...rows.values()].sort((a, b) => a.m - b.m);
  }, [liveReady, region, single, getCurve]);

  const hasGhost = region !== 'ALL' && chartData.some(p => p.ghost != null);

  // ── Right board rows ──
  const boardRows = useMemo(() => {
    if (!liveReady) return [];
    return GLOBAL_ROWS.map(row => {
      const c = getCurve(row.code);
      const pt = c ? nearestPoint(c.points, 120) : null;
      const chg = GLOBAL_CHG_KEY[row.code] != null ? (globalChg[GLOBAL_CHG_KEY[row.code]] ?? null) : null;
      return { ...row, points: c?.points || null, val: pt?.yield ?? null, chg };
    });
  }, [liveReady, getCurve, globalChg]);

  const tapeById = useMemo(
    () => Object.fromEntries((tape || []).map(t => [t.id, t])),
    [tape]
  );

  // ── Tape follows the selected curve (BUG 1a) ──
  // Non-US regions derive 10Y + 2s10s client-side from the curves payload;
  // US/ALL keep the FRED tape cells. `liveReady` gates the ref read.
  const regionCell = useMemo(() => {
    if (!isCountryTape(region) || !liveReady) return null;
    const c    = getCurve(region);
    const usC  = getCurve('US');
    const chgKey = GLOBAL_CHG_KEY[region];

    // <CTY> 10Y Δ1M from the FRED OECD monthly block — change1m is in %-pts,
    // convert to bps. CH (no monthly series) → null → tape renders "—".
    const monKey = MONTHLY_CHG_KEY[region];
    const monRow = monKey ? global10y.find(r => r.country === monKey) : null;
    const delta1mBps = monRow && monRow.change1m != null
      ? Math.round(monRow.change1m * 100) : null;

    // y10, 2s10s and vs-UST spread all derive from the curves payload.
    const cells = countryTapeCells({
      code: region,
      regionPoints: c?.points || null,
      usPoints: usC?.points || null,
      delta1mBps,
    });
    return {
      ...cells,
      // Intraday Δbp (Yahoo) for the headline 10Y cell where a ticker exists.
      chgBps: chgKey != null ? (globalChg[chgKey] ?? null) : null,
    };
  }, [region, liveReady, getCurve, globalChg, global10y]);

  // CREDIT & INFLATION rows. IPCA IMPL. (NTN-B): the server does not yet
  // derive BR real-vs-nominal (no NTN-B real yields in routes/debt.js) —
  // render "—" honestly rather than estimate.
  const creditRows = [
    { key: 'ig', label: 'US IG OAS',
      val: tapeById.igOas?.value != null ? `${Math.round(tapeById.igOas.value)}bp` : '—',
      chg: tapeById.igOas?.change1d != null ? fmtBp(tapeById.igOas.change1d, 0) : null,
      chgColor: tapeById.igOas?.change1d > 0 ? 'var(--color-down)' : tapeById.igOas?.change1d < 0 ? 'var(--color-up)' : null },
    { key: 'be', label: '10Y BREAKEVEN',
      val: tapeById.breakeven10y?.value != null ? `${tapeById.breakeven10y.value.toFixed(2)}%` : '—',
      chg: tapeById.breakeven10y?.change1d != null ? fmtBp(tapeById.breakeven10y.change1d * 100) : null,
      chgColor: tapeById.breakeven10y?.change1d > 0 ? 'var(--color-down)' : tapeById.breakeven10y?.change1d < 0 ? 'var(--color-up)' : null },
    { key: 'ipca', label: 'IPCA IMPL. (NTN-B)', val: '—', chg: null, chgColor: null },
  ];

  const handleRetry = useCallback(() => setReloadKey(k => k + 1), []);

  const regionMeta = REGIONS.find(r => r.code === region);
  const sourceLabel = region === 'ALL' ? 'Multi-source' : (single?.source || 'Multi-source');

  return (
    <div className="dp-panel">
      <PanelChrome
        title="RATES & CREDIT"
        onTitleClick={() => openOverlay('rates')}
        subtitle={region === 'ALL' ? 'US · BR · EU · UK · CH CURVES' : `${regionMeta?.label || region} CURVE${single?.source ? ` · ${single.source.toUpperCase()}` : ''}`}
        badge={<IntegrityBadge domain="yield-curves" />}
        updatedAt={lastUpdated}
        source={sourceLabel}
        actions={(
          <ViewChips
            options={REGIONS.map(r => ({
              key: r.code,
              label: r.label,
              title: r.code === 'ALL' ? 'Overlay all curves' : `${r.label} curve`,
            }))}
            value={region}
            onChange={setRegion}
            ariaLabel="Curve region"
          />
        )}
      />

      <RatesTape tape={tape} regionCell={regionCell} />

      <div className="dp-board">
        {/* ── Left: main curve + 1M-ago ghost ── */}
        <div className="dp-board-left">
          {!liveReady ? (
            <div className="dp-state dp-state--loading">
              <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', gap: 6, padding: '12px 8px' }}>
                {[80, 60, 90, 70, 85].map((w, i) => (
                  <div key={i} className="shimmer-bar" style={{ width: `${w}%`, height: 8, borderRadius: 3, background: 'var(--color-surface-3)' }} />
                ))}
              </div>
            </div>
          ) : error ? (
            <div className="dp-state dp-state--error">
              <span>FAILED TO LOAD YIELD CURVES</span>
              <span className="dp-state-detail">{error}</span>
              <button className="dp-retry-btn" onClick={handleRetry}>RETRY</button>
            </div>
          ) : chartData.length === 0 ? (
            <div className="dp-state dp-state--empty">
              <span>NO CURVE DATA FOR {regionMeta?.label || region}</span>
              <button className="dp-retry-btn" onClick={handleRetry}>RETRY</button>
            </div>
          ) : (
            <div className="dp-chart-wrap">
              {hasGhost && <span className="dp-ghost-legend">– – 1M AGO</span>}
              {region === 'ALL' && (
                <div className="dp-curve-toggle">
                  <button
                    type="button"
                    className="dp-curve-btn"
                    onClick={() => setCurveMenuOpen(o => !o)}
                    title="Choose which curves to overlay"
                  >+ CURVES</button>
                  {curveMenuOpen && (
                    <div className="dp-curve-menu">
                      {GLOBAL_ROWS.map(r => (
                        <label key={r.code} className="dp-curve-item">
                          <input
                            type="checkbox"
                            checked={overlayCurves.has(r.code)}
                            onChange={() => setOverlayCurves(prev => {
                              const n = new Set(prev);
                              if (n.has(r.code)) n.delete(r.code); else n.add(r.code);
                              return n;
                            })}
                          />
                          <span>{r.flag} {r.label}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 6, right: 8, bottom: 2, left: 0 }}>
                  <defs>
                    <linearGradient id="dpCurveFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={TOKEN_HEX.accent} stopOpacity={0.16} />
                      <stop offset="100%" stopColor={TOKEN_HEX.accent} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={TOKEN_HEX.borderSubtle} vertical={false} />
                  <XAxis
                    dataKey="tenor"
                    tick={{ fill: TOKEN_HEX.textFaint, fontSize: 8.5, fontFamily: 'var(--font-mono)' }}
                    axisLine={false}
                    tickLine={false}
                    height={14}
                    minTickGap={10}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    tick={{ fill: TOKEN_HEX.textFaint, fontSize: 8.5, fontFamily: 'var(--font-mono)' }}
                    domain={['auto', 'auto']}
                    tickFormatter={v => fmtCompactPct(v, 1)}
                    width={32}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    contentStyle={{
                      background: TOKEN_HEX.bgTooltip,
                      border: '1px solid var(--border-strong)',
                      borderRadius: 3,
                      fontSize: 10,
                      fontFamily: 'var(--font-mono)',
                      padding: '4px 8px',
                    }}
                    labelStyle={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}
                    cursor={{ stroke: 'var(--border-strong)', strokeDasharray: '2 4' }}
                    formatter={(v, name) => [v != null ? Number(v).toFixed(2) + '%' : '--', name]}
                  />
                  {region !== 'ALL' ? (
                    <>
                      <Area
                        type="monotone" dataKey="yield"
                        stroke="none" fill="url(#dpCurveFill)"
                        isAnimationActive={false}
                        activeDot={false}
                        tooltipType="none"
                      />
                      {hasGhost && (
                        <Line
                          type="monotone" dataKey="ghost" name="1M ago"
                          stroke={TOKEN_HEX.textMuted || '#5a5a5a'} strokeWidth={1}
                          strokeDasharray="4 3"
                          dot={false} connectNulls
                          isAnimationActive={false}
                        />
                      )}
                      <Line
                        type="monotone" dataKey="yield" name="Yield"
                        stroke={TOKEN_HEX.accent} strokeWidth={1.6}
                        dot={false}
                        activeDot={{ r: 2.5, fill: TOKEN_HEX.accent, strokeWidth: 0 }}
                        isAnimationActive={false}
                      />
                    </>
                  ) : (
                    GLOBAL_ROWS.filter(r => overlayCurves.has(r.code)).map(r => (
                      <Line
                        key={r.code}
                        type="monotone" dataKey={r.code} name={r.label}
                        stroke={REGION_HEX[r.code]} strokeWidth={1.2}
                        dot={false} connectNulls
                        isAnimationActive={false}
                      />
                    ))
                  )}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* ── Right: global 10Y + credit & inflation board ── */}
        <div className="dp-board-right">
          <BoardSectionLabel>GLOBAL 10Y</BoardSectionLabel>
          {boardRows.map(row => {
            const active = region === row.code;
            const stroke = active
              ? TOKEN_HEX.accent
              : row.chg != null && row.chg < 0 ? TOKEN_HEX.up : TOKEN_HEX.textSecondary;
            return (
              <BoardRow
                key={row.code}
                active={active}
                onClick={() => setRegion(row.code)}
                title={`Load ${row.label} curve`}
                label={<>{row.flag} {row.label}</>}
                mini={<MiniCurveSvg points={row.points} stroke={stroke} />}
                value={row.val != null ? row.val.toFixed(2) : '—'}
                delta={row.chg != null ? `${row.chg > 0 ? '+' : ''}${row.chg.toFixed(1)}` : '—'}
                deltaColor={row.chg == null ? 'var(--text-faint)' : row.chg > 0 ? 'var(--color-down)' : row.chg < 0 ? 'var(--color-up)' : 'var(--text-faint)'}
              />
            );
          })}

          {/* Monthly FRED OECD 10Y-only sovereigns (BUG 1b) — no mini-curve,
              value + 'M' staleness badge; same BoardRow footprint, the column
              scrolls (overflow-y:auto) so the layout is unchanged. */}
          {global10y.filter(row => row.board !== false).map(row => (
            <BoardRow
              key={row.country}
              label={<>{MONTHLY_FLAGS[row.country] || ''} {row.label}</>}
              title={`FRED ${row.seriesId} — OECD long-term rate, monthly${row.asOfDate ? ` (as of ${row.asOfDate})` : ''}`}
              value={row.value != null ? row.value.toFixed(2) : '—'}
              delta="M"
              deltaColor="var(--text-faint)"
            />
          ))}

          <BoardSectionLabel>CREDIT &amp; INFLATION</BoardSectionLabel>
          {creditRows.map(row => (
            <BoardRow
              key={row.key}
              labelSans
              label={row.label}
              value={row.val}
              delta={row.chg ?? '—'}
              deltaColor={row.chgColor || 'var(--text-faint)'}
            />
          ))}
        </div>
      </div>
      <DpBonds />
    </div>
  );
}

export default memo(DebtPanel);
