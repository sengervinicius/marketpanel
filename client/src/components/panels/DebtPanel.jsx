/**
 * DebtPanel.jsx
 * Global sovereign yield curves + credit spread indexes.
 *
 * Data sources (live -- no API key required):
 *   US  -> US Treasury Fiscal Data XML (home.treasury.gov)
 *   EU  -> ECB Statistical Data Warehouse (data-api.ecb.europa.eu)
 *   UK  -> Bank of England (bankofengland.co.uk)
 *   BR  -> Tesouro Direto JSON + BCB SELIC (api.bcb.gov.br)
 *
 * All four fetched server-side by /api/yield-curves (routes/market.js).
 * Other countries fall back to /api/debt/sovereign/:code (estimated).
 *
 * Credit spread indexes remain estimated (Bloomberg/ICE BofA data is paid).
 */

import { useState, useEffect, useCallback, useRef, useMemo, memo } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts';
import { apiFetch } from '../../utils/api';
import { fmtCompactPct } from '../../utils/format';
import { swallow } from '../../utils/swallow';
import IntegrityBadge from '../shared/IntegrityBadge';
import { PanelHeader } from './_shared';
import './DebtPanel.css';

// Which countryCode -> live curve key in /api/yield-curves response
const LIVE_KEY = { US: 'US', UK: 'UK', GB: 'UK', DE: 'EU', EU: 'EU', BR: 'BR' };

// Country groups for tab navigation
const COUNTRY_GROUPS = [
  { label: 'G10',    codes: ['US', 'EU', 'UK', 'JP', 'CA', 'AU'] },
  { label: 'EM',     codes: ['BR', 'MX', 'ZA', 'KR'] },
  { label: 'Europe', codes: ['EU', 'UK', 'IT', 'FR'] },
  { label: 'LatAm',  codes: ['BR', 'MX', 'ZA'] },
];

// Country color palette (distinct, readable on dark bg)
const COUNTRY_COLORS = {
  US: '#4488ff', EU: '#ffcc00', UK: '#cc88ff', BR: '#00cc44',
  JP: '#ff8844', CA: '#ff6644', AU: '#ffee44', IT: '#66ccff',
  FR: '#88ddff', MX: '#44ff88', KR: '#88ffcc', ZA: '#ffaa44',
};

function fmtYield(v, bps = false) {
  if (v == null) return '--';
  if (bps) return (v >= 0 ? '+' : '') + v + ' bps';
  return v.toFixed(2) + '%';
}

/* ---- Curve regime analytics (Phase 8.4) ----
 *
 * Classifies a yield curve into one of:
 *   INVERTED           — long end < short end (2s10s < 0)
 *   BEAR STEEPENING    — long end rising faster than short (spread widening, levels up)
 *   BULL STEEPENING    — short end falling faster (spread widening, levels down)
 *   BEAR FLATTENING    — short end rising faster than long (spread narrowing, levels up)
 *   BULL FLATTENING    — long end falling faster than short (spread narrowing, levels down)
 *   NORMAL             — insufficient info to classify; positive slope, stable
 */
function findTenor(points, tenor) {
  if (!points) return null;
  return points.find(p => p.tenor === tenor);
}

function spreadBps(a, b) {
  if (a?.yield == null || b?.yield == null) return null;
  return Math.round((a.yield - b.yield) * 100);
}

function classifyRegime(current, previous) {
  if (!current || current.length < 2) return { label: 'NO DATA', posture: 'neutral' };

  const t2 = findTenor(current, '2Y');
  const t10 = findTenor(current, '10Y');
  const t30 = findTenor(current, '30Y');

  const s210 = spreadBps(t10, t2);

  // Inversion overrides everything
  if (s210 != null && s210 < 0) {
    return {
      label: 'INVERTED',
      posture: 'bear',
      detail: `2s10s ${s210}bp`,
    };
  }

  // Need previous for change classification
  if (previous && previous.length >= 2) {
    const p2 = findTenor(previous, '2Y');
    const p10 = findTenor(previous, '10Y');
    const prevS210 = spreadBps(p10, p2);

    if (s210 != null && prevS210 != null && t2 && p2) {
      const spreadChg = s210 - prevS210;                   // bp
      const shortChg = (t2.yield - p2.yield) * 100;         // bp
      const steepening = spreadChg > 3;
      const flattening = spreadChg < -3;
      const levelsUp = shortChg > 1;
      const levelsDown = shortChg < -1;

      if (steepening && levelsUp)   return { label: 'BEAR STEEPENING', posture: 'bear',    detail: `2s10s +${Math.round(spreadChg)}bp` };
      if (steepening && levelsDown) return { label: 'BULL STEEPENING', posture: 'bull',    detail: `2s10s +${Math.round(spreadChg)}bp` };
      if (flattening && levelsUp)   return { label: 'BEAR FLATTENING', posture: 'bear',    detail: `2s10s ${Math.round(spreadChg)}bp` };
      if (flattening && levelsDown) return { label: 'BULL FLATTENING', posture: 'bull',    detail: `2s10s ${Math.round(spreadChg)}bp` };
    }
  }

  // No classification possible — return level read
  if (s210 != null) {
    return {
      label: s210 > 50 ? 'STEEP' : s210 > 10 ? 'NORMAL' : 'FLAT',
      posture: 'neutral',
      detail: `2s10s ${s210 > 0 ? '+' : ''}${s210}bp`,
    };
  }

  return { label: 'NORMAL', posture: 'neutral' };
}

/* ---- RegimeRibbon component (Phase 8.4) ---- */
function RegimeRibbon({ regime, spreads }) {
  const postureCls = `dp-regime--${regime.posture || 'neutral'}`;
  return (
    <div className={`dp-regime ${postureCls}`}>
      <span className="dp-regime-label">REGIME</span>
      <span className="dp-regime-verdict">{regime.label}</span>
      {regime.detail && <span className="dp-regime-detail">{regime.detail}</span>}
      <span className="dp-regime-flex" />
      {spreads?.map(s => (
        <span key={s.name} className="dp-regime-spread" title={`${s.name}: ${s.bps}bp`}>
          <span className="dp-regime-spread-name">{s.name}</span>
          <span className={`dp-regime-spread-val ${s.bps < 0 ? 'dp-regime-spread-val--neg' : s.bps < 25 ? 'dp-regime-spread-val--tight' : ''}`}>
            {s.bps > 0 ? '+' : ''}{s.bps}
          </span>
        </span>
      ))}
    </div>
  );
}

/* ---- SpreadRow ---- */
function SpreadRow({ item }) {
  const chg = item.change ?? 0;
  const color = chg > 0 ? 'var(--price-down)' : 'var(--price-up)';
  return (
    <div className="dp-spread-row">
      <div className="dp-spread-left">
        <span className="dp-spread-name">{item.name}</span>
        <span className="dp-spread-currency">{item.currency}</span>
      </div>
      <div className="dp-spread-right">
        <span className="dp-spread-value">
          {fmtYield(item.spread, item.spreadBps)}
        </span>
        {item.change != null && (
          <span className="dp-spread-chg" style={{ color }}>
            {chg >= 0 ? '+' : ''}{chg}
          </span>
        )}
        <span className="dp-spread-bps-label">bps</span>
      </div>
    </div>
  );
}

/* ---- RegionalSnapshot ---- */
function RegionalSnapshot({ data, loading }) {
  if (loading) {
    return <div className="dp-state dp-state--loading">LOADING REGIONAL DATA...</div>;
  }
  if (!data || data.length === 0) {
    return <div className="dp-state dp-state--empty">NO REGIONAL DATA AVAILABLE</div>;
  }
  const max = Math.max(...data.map(d => Math.abs(d.yield)));
  return (
    <div className="dp-snapshot-list">
      {data.map(item => (
        <div key={item.country} className="dp-snapshot-row">
          <span className="dp-snapshot-code">{item.country}</span>
          <div className="dp-snapshot-bar">
            <div className="dp-snapshot-fill" style={{
              width: `${max > 0 ? Math.abs(item.yield) / max * 100 : 0}%`,
              background: item.color || 'var(--accent)',
            }} />
          </div>
          <div className="dp-snapshot-value">
            <span className="dp-snapshot-yield">{item.yield.toFixed(2)}%</span>
            <span className={`dp-snapshot-badge ${item.live ? 'dp-badge--live' : 'dp-badge--est'}`}>
              {item.live ? 'LIVE' : 'EST.'}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ---- Main panel ---- */
function DebtPanel() {
  const [availableCountries, setAvailableCountries] = useState([]);
  const [selectedCountry, setSelectedCountry]       = useState('US');
  const [view, setView]                             = useState('curve');
  const [regionalTenor, setRegionalTenor]           = useState('10Y');
  const [curve, setCurve]                           = useState(null);
  const [curveSource, setCurveSource]               = useState(null);
  const [curveLive, setCurveLive]                   = useState(false);
  const [curveStub, setCurveStub]                   = useState(false);
  const [regional, setRegional]                     = useState(null);
  const [indexes, setIndexes]                       = useState([]);
  const [indexSource, setIndexSource]               = useState(null);
  const [loading, setLoading]                       = useState(true);
  const [error, setError]                           = useState(null);
  const [countryGroup, setCountryGroup]             = useState('G10');
  const [liveReady, setLiveReady]                   = useState(false);
  const [lastUpdated, setLastUpdated]               = useState(null);

  // Persistent ref for live data (no re-render race)
  const liveDataRef   = useRef(null);

  // ---- Load live yield-curve data + country list (once) ----
  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000); // 20s client-side timeout

    Promise.allSettled([
      apiFetch('/api/yield-curves', { signal: controller.signal }).then(r => r.ok ? r.json() : null),
      apiFetch('/api/debt/countries', { signal: controller.signal }).then(r => r.json()),
    ]).then(([liveRes, countriesRes]) => {
      clearTimeout(timeout);

      if (liveRes.status === 'fulfilled' && liveRes.value) {
        liveDataRef.current = liveRes.value;
      }

      if (countriesRes.status === 'fulfilled') {
        const stubList = countriesRes.value?.countries || [];
        const merged = [
          { code: 'US', name: 'United States (Treasury)', color: COUNTRY_COLORS.US, live: true },
          { code: 'EU', name: 'Euro Area (ECB)',          color: COUNTRY_COLORS.EU, live: true },
          { code: 'UK', name: 'United Kingdom (Gilts)',   color: COUNTRY_COLORS.UK, live: true },
          { code: 'BR', name: 'Brazil (DI/Tesouro)',      color: COUNTRY_COLORS.BR, live: true },
          ...stubList
            .filter(c => !['US','DE','GB','UK','EU','BR'].includes(c.code))
            .map(c => ({ ...c, color: COUNTRY_COLORS[c.code] || '#888', live: false })),
        ];
        setAvailableCountries(merged);
      }

      // Check if BOTH fetches failed (no data available)
      if (liveRes.status === 'rejected' && countriesRes.status === 'rejected') {
        setLoading(false);
        setError('Yield data unavailable — click RETRY');
      }

      // Signal that live data is ready for loadCurve effect
      setLiveReady(true);
    }).catch(() => {
      // This catches network errors or abort signals
      clearTimeout(timeout);
      setLiveReady(true);
      setLoading(false);
      setError('Yield data request failed — click RETRY');
    });

    return () => { clearTimeout(timeout); controller.abort(); };
  }, []);

  // ---- Extract live curve for a given country code ----
  const getLiveCurve = useCallback((code) => {
    const ld = liveDataRef.current;
    if (!ld) return null;
    const key = LIVE_KEY[code];
    if (!key || !ld[key]?.curve?.length) return null;
    const entry = ld[key];
    return {
      points: entry.curve.map(p => ({ tenor: p.tenor, yield: p.rate })),
      source: entry.source || key,
      live: true,
      stub: entry.stub === true,
    };
  }, []);

  // ---- Load curve for selected country (curve view) ----
  const loadCurve = useCallback(async () => {
    if (!liveReady) return; // wait for init to complete
    setLoading(true);
    setError(null);
    // Clear previous country's data immediately to prevent stale display
    setCurve(null);
    setCurveSource(null);
    setCurveLive(false);
    setCurveStub(false);

    try {
      // Step 1: Try live data from /api/yield-curves
      const live = getLiveCurve(selectedCountry);
      if (live && live.points.length > 0 && !live.stub) {
        setCurve({ points: live.points });
        setCurveSource(live.source);
        setCurveLive(true);
        setCurveStub(false);
      } else if (live && live.stub) {
        // Live source returned but marked as stub (incomplete data)
        setCurve({ points: live.points });
        setCurveSource(live.source);
        setCurveLive(false);
        setCurveStub(true);
      } else {
        // Step 2: Fall back to /api/debt/sovereign/:code
        const resp = await apiFetch(`/api/debt/sovereign/${selectedCountry}`);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        if (data.error) throw new Error(data.error);
        setCurve(data);
        setCurveSource(data.source || 'Estimated');
        setCurveLive(data.source && !['stub', 'stub_fallback', 'bcb_stub', 'bcb_partial', 'unavailable'].includes(data.source));
        setCurveStub(data.stub === true);
      }

      // Load credit indexes in parallel
      try {
        const idxResp = await apiFetch('/api/debt/credit/indexes');
        const idxData = await idxResp.json();
        setIndexes(idxData.indexes || []);
        setIndexSource(idxData.source || null);
      } catch (_) {
        // Non-fatal: credit indexes are secondary
      }
      setLastUpdated(new Date());
    } catch (e) {
      setError(e.message || 'Failed to load yield curve');
      setCurve(null);
      setCurveSource(null);
      setCurveLive(false);
      setCurveStub(false);
    } finally {
      setLoading(false);
    }
  }, [selectedCountry, getLiveCurve, liveReady]);

  // Trigger curve load when view is 'curve'
  useEffect(() => {
    if (view !== 'curve') return;
    loadCurve();
  }, [view, selectedCountry, loadCurve]);

  // Also re-trigger when liveLoadedRef flips (via the forced re-render in init effect)
  // The loadCurve dependency on getLiveCurve handles this.

  // ---- Load regional snapshot ----
  const loadRegional = useCallback(async () => {
    if (!liveReady) return;
    setLoading(true);
    setError(null);

    try {
      const group = COUNTRY_GROUPS.find(g => g.label === countryGroup);
      const codes = group?.codes || COUNTRY_GROUPS[0].codes;

      const snapshot = [];
      let stubRegion = {};

      // Fetch from regional endpoint
      try {
        const region = countryGroup.toLowerCase();
        const d = await apiFetch(`/api/debt/sovereign/region?region=${region}&tenor=${regionalTenor}`)
          .then(r => r.json());
        (d.snapshot || []).forEach(item => {
          stubRegion[item.country] = item;
        });
      } catch (e) { swallow(e, 'panel.debt.region_snapshot'); }

      for (const code of codes) {
        const live = getLiveCurve(code);
        if (live) {
          const pt = live.points.find(p => p.tenor === regionalTenor);
          if (pt) {
            snapshot.push({
              country: code,
              name: availableCountries.find(c => c.code === code)?.name || code,
              color: COUNTRY_COLORS[code] || '#888',
              tenor: regionalTenor,
              yield: pt.yield,
              live: true,
            });
            continue;
          }
        }
        if (stubRegion[code]) {
          snapshot.push({ ...stubRegion[code], color: COUNTRY_COLORS[code] || '#888', live: false });
        }
      }

      snapshot.sort((a, b) => b.yield - a.yield);
      setRegional(snapshot);
      setLastUpdated(new Date());

      // Credit indexes
      try {
        const d = await apiFetch('/api/debt/credit/indexes').then(r => r.json());
        setIndexes(d.indexes || []);
        setIndexSource(d.source || null);
      } catch (e) { swallow(e, 'panel.debt.credit_indexes'); }
    } catch (e) {
      setError(e.message || 'Failed to load regional data');
    } finally {
      setLoading(false);
    }
  }, [countryGroup, regionalTenor, getLiveCurve, availableCountries, liveReady]);

  useEffect(() => {
    if (view !== 'regional') return;
    loadRegional();
  }, [view, countryGroup, regionalTenor, loadRegional]);

  // ---- Derived values ----
  const countryMeta = availableCountries.find(c => c.code === selectedCountry);
  const chartData   = curve?.points || [];
  const lineColor   = countryMeta?.color || COUNTRY_COLORS[selectedCountry] || '#4488ff';
  const TENORS      = ['2Y', '5Y', '10Y', '30Y'];

  // ---- Regime & key spreads (Phase 8.4) ----
  // Compare to previous session snapshot to classify regime movement.
  // sessionStorage key: dp_prev_curve:<country>
  const [prevCurve, setPrevCurve] = useState(null);
  useEffect(() => {
    if (!chartData || chartData.length === 0) return;
    try {
      const key = `dp_prev_curve:${selectedCountry}`;
      const stored = sessionStorage.getItem(key);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed?.points && Array.isArray(parsed.points)) {
          setPrevCurve(parsed.points);
        }
      }
      // Cache current for next load
      sessionStorage.setItem(key, JSON.stringify({ points: chartData, ts: Date.now() }));
    } catch (_) {
      // sessionStorage unavailable — skip
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCountry, loading]); // recompute when curve changes

  const regime = useMemo(
    () => classifyRegime(chartData, prevCurve),
    [chartData, prevCurve]
  );

  const keySpreads = useMemo(() => {
    if (!chartData || chartData.length < 2) return [];
    const t2 = findTenor(chartData, '2Y');
    const t5 = findTenor(chartData, '5Y');
    const t10 = findTenor(chartData, '10Y');
    const t30 = findTenor(chartData, '30Y');
    const out = [];
    const s210 = spreadBps(t10, t2); if (s210 != null) out.push({ name: '2s10s', bps: s210 });
    const s510 = spreadBps(t10, t5); if (s510 != null) out.push({ name: '5s10s', bps: s510 });
    const s230 = spreadBps(t30, t2); if (s230 != null) out.push({ name: '2s30s', bps: s230 });
    return out;
  }, [chartData]);

  // ---- Retry handler ----
  const handleRetry = useCallback(() => {
    if (view === 'curve') loadCurve();
    else loadRegional();
  }, [view, loadCurve, loadRegional]);

  // ---- Source label for badge ----
  // Sanity: if source doesn't match selected country, suppress it
  const rawSource = curveSource
    ? curveSource.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
    : null;
  const COUNTRY_SOURCES = {
    BR: ['Tesouro Direto', 'Tesouro', 'Bcb Partial', 'Bcb Synthetic', 'Bcb+Synthetic'],
    US: ['Us Treasury', 'Fred', 'FRED', 'Yahoo Fallback'],
    UK: ['Bank Of England', 'Boe+Synthetic'],
    EU: ['Ecb', 'Ecb+Synthetic'],
  };
  const validSources = COUNTRY_SOURCES[selectedCountry];
  const sourceBadge = rawSource && (!validSources || validSources.some(s => rawSource.toLowerCase().includes(s.toLowerCase())))
    ? rawSource
    : rawSource; // still show it but fix curveLive for mismatches
  // If source is clearly wrong for this country (e.g., FRED for BR), mark as not live
  const isMismatch = rawSource && validSources && !validSources.some(s => rawSource.toLowerCase().includes(s.toLowerCase()));
  const effectiveCurveLive = isMismatch ? false : curveLive;

  return (
    <div className="dp-panel">
      <PanelHeader
        title="YIELDS"
        updatedAt={lastUpdated}
        source={curveSource || 'Multi-source'}
        actions={(
          <>
            {/* View toggle */}
            <div className="dp-view-group">
              {[['curve','CURVE'],['regional','REGION']].map(([v, lbl]) => (
                <button
                  className={`dp-view-btn${view === v ? ' dp-view-btn--active' : ''}`}
                  key={v}
                  onClick={() => setView(v)}
                >
                  {lbl}
                </button>
              ))}
            </div>

            {/* Country selector (curve view) */}
            {view === 'curve' && (
              <select
                value={selectedCountry}
                onChange={e => setSelectedCountry(e.target.value)}
                className="dp-select"
              >
                {availableCountries.map(c => (
                  <option key={c.code} value={c.code}>
                    {c.code} -- {c.name}
                  </option>
                ))}
              </select>
            )}

            {/* Group + tenor selectors (regional view) */}
            {view === 'regional' && (
              <div className="dp-header-selectors">
                <select value={countryGroup} onChange={e => setCountryGroup(e.target.value)} className="dp-select">
                  {COUNTRY_GROUPS.map(g => <option key={g.label} value={g.label}>{g.label}</option>)}
                </select>
                <select value={regionalTenor} onChange={e => setRegionalTenor(e.target.value)} className="dp-select">
                  {TENORS.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            )}
          </>
        )}
      />

      {/* ---- Curve view ---- */}
      {view === 'curve' && (
        <div className="dp-curve">
          {/* Source row - always visible */}
          <div className="dp-source-row">
            <span className="dp-source-label">
              {countryMeta?.name?.toUpperCase() || selectedCountry} YIELD CURVE
            </span>
            {!loading && sourceBadge && (
              <span className={`dp-source-badge ${effectiveCurveLive ? 'dp-badge--live' : 'dp-badge--est'}`}>
                {effectiveCurveLive ? 'LIVE' : 'EST.'} {sourceBadge}
              </span>
            )}
            <IntegrityBadge domain="yield-curves" />
          </div>

          {/* Regime ribbon — Phase 8.4 */}
          {!loading && !error && chartData.length >= 2 && (
            <RegimeRibbon regime={regime} spreads={keySpreads} />
          )}

          {/* Chart area with explicit states */}
          <div className="dp-chart-container">
            {loading ? (
              <div className="dp-state dp-state--loading">
                <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', gap: 6, padding: '12px 8px' }}>
                  {[80, 60, 90, 70, 85, 50].map((w, i) => (
                    <div key={i} className="shimmer-bar" style={{ width: `${w}%`, height: 8, borderRadius: 3, background: '#1a1a1a' }} />
                  ))}
                </div>
              </div>
            ) : error ? (
              <div className="dp-state dp-state--error">
                <span>FAILED TO LOAD YIELD CURVE</span>
                <span className="dp-state-detail">{error}</span>
                <button className="dp-retry-btn" onClick={handleRetry}>RETRY</button>
              </div>
            ) : curveStub ? (
              <div className="dp-state dp-state--empty">
                <span>INCOMPLETE DATA FOR {countryMeta?.name?.toUpperCase() || selectedCountry}</span>
                <span className="dp-state-detail">
                  Live sources returned {chartData.length} point{chartData.length !== 1 ? 's' : ''}. Synthetic points disabled.
                </span>
                <button className="dp-retry-btn" onClick={handleRetry}>RETRY</button>
              </div>
            ) : chartData.length === 0 ? (
              <div className="dp-state dp-state--empty">
                <span>Loading data for {countryMeta?.name || selectedCountry}...</span>
                <button className="dp-retry-btn" onClick={handleRetry}>RETRY</button>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="2 4" stroke="var(--border-subtle)" />
                  <XAxis
                    dataKey="tenor"
                    tick={{ fill: 'var(--text-faint)', fontSize: 8, fontFamily: 'var(--font-ui)', angle: -45, textAnchor: 'end' }}
                    axisLine={{ stroke: 'var(--border-default)' }}
                    tickLine={false}
                    height={30}
                  />
                  <YAxis
                    tick={{ fill: 'var(--text-faint)', fontSize: 8, fontFamily: 'var(--font-mono)' }}
                    domain={['auto', 'auto']}
                    tickFormatter={v => fmtCompactPct(v, 1)}
                    width={36}
                    axisLine={{ stroke: 'var(--border-default)' }}
                  />
                  <Tooltip
                    contentStyle={{
                      background: 'var(--bg-surface)',
                      border: '1px solid var(--border-strong)',
                      borderRadius: 3,
                      fontSize: 10,
                      fontFamily: 'var(--font-mono)',
                    }}
                    formatter={v => [v != null ? v.toFixed(2) + '%' : '--', 'Yield']}
                  />
                  <Line
                    type="monotone" dataKey="yield" name="Yield"
                    stroke={lineColor} strokeWidth={2}
                    dot={{ fill: lineColor, r: 3 }}
                    activeDot={{ r: 4 }}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Tenor table - only when data present */}
          {!loading && !error && chartData.length > 0 && (
            <div className="dp-tenor-table">
              <div className="dp-tenor-grid">
                {chartData.map(pt => (
                  <div key={pt.tenor} className="dp-tenor-row">
                    <span className="dp-tenor-label">{pt.tenor}</span>
                    <span className="dp-tenor-value">{pt.yield.toFixed(2)}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Credit spreads */}
          {!loading && indexes.length > 0 && (
            <div className="dp-spreads">
              <div className="dp-spreads-header">
                <span className="dp-spreads-title">CREDIT SPREADS (bps)</span>
                <span className={`dp-spreads-tag ${indexSource === 'fred' ? 'dp-badge--live' : 'dp-badge--est'}`}>
                  {indexSource === 'fred' ? 'LIVE' : 'ESTIMATED'}
                </span>
              </div>
              {indexes.map(idx => <SpreadRow key={idx.id} item={idx} />)}
            </div>
          )}
          {!loading && !error && indexes.length === 0 && (
            <div className="dp-spreads">
              <div className="dp-spreads-header">
                <span className="dp-spreads-title">CREDIT SPREADS</span>
              </div>
              <div className="dp-state dp-state--empty dp-state--inline">NO CREDIT INDEX DATA</div>
            </div>
          )}
        </div>
      )}

      {/* ---- Regional view ---- */}
      {view === 'regional' && (
        <div className="dp-regional">
          <div className="dp-regional-header">
            <span>{countryGroup} -- {regionalTenor} YIELDS</span>
            <span className="dp-regional-legend">LIVE / EST.</span>
          </div>

          {error && !loading ? (
            <div className="dp-state dp-state--error">
              <span>{error}</span>
              <button className="dp-retry-btn" onClick={handleRetry}>RETRY</button>
            </div>
          ) : (
            <div className="dp-regional-body">
              <RegionalSnapshot data={regional} loading={loading} />
            </div>
          )}

          {!loading && indexes.length > 0 && (
            <div className="dp-spreads dp-spreads--bottom">
              <div className="dp-spreads-header">
                <span className="dp-spreads-title">CREDIT SPREADS (bps)</span>
                <span className={`dp-spreads-tag ${indexSource === 'fred' ? 'dp-badge--live' : 'dp-badge--est'}`}>
                  {indexSource === 'fred' ? 'LIVE' : 'ESTIMATED'}
                </span>
              </div>
              {indexes.map(idx => <SpreadRow key={idx.id} item={idx} />)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default memo(DebtPanel);
