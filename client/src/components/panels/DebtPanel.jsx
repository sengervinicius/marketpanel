/**
 * DebtPanel.jsx
 * Global sovereign yield curves + credit spread indexes.
 *
 * Data sources (live — no API key required):
 *   US  → US Treasury Fiscal Data XML (home.treasury.gov)
 *   EU  → ECB Statistical Data Warehouse (data-api.ecb.europa.eu)
 *   UK  → Bank of England (bankofengland.co.uk)
 *   BR  → Tesouro Direto JSON + BCB SELIC (api.bcb.gov.br)
 *
 * All four fetched server-side by /api/yield-curves (routes/market.js).
 * Other countries fall back to /api/debt/sovereign/:code (estimated).
 *
 * Credit spread indexes remain estimated (Bloomberg/ICE BofA data is paid).
 */

import { useState, useEffect, useCallback, memo } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts';
import { apiFetch } from '../../utils/api';

const ORANGE = '#ff6600';
const GREEN  = '#00cc44';
const RED    = '#cc2200';

// Which countryCode → live curve key in /api/yield-curves response
const LIVE_KEY = { US: 'US', UK: 'UK', GB: 'UK', DE: 'EU', EU: 'EU', BR: 'BR' };

// Country groups for tab navigation
const COUNTRY_GROUPS = [
  { label: 'G10',    codes: ['US', 'EU', 'UK', 'JP', 'CA', 'AU'] },
  { label: 'EM',     codes: ['BR', 'MX', 'ZA', 'KR'] },
  { label: 'Europe', codes: ['EU', 'UK', 'IT', 'FR'] },
  { label: 'LatAm',  codes: ['BR', 'MX', 'ZA'] },
];

function fmtYield(v, bps = false) {
  if (v == null) return '--';
  if (bps) return (v >= 0 ? '+' : '') + v + ' bps';
  return v.toFixed(2) + '%';
}

function SpreadRow({ item }) {
  const chg = item.change ?? 0;
  const color = chg > 0 ? RED : GREEN;
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '5px 0', borderBottom: '1px solid #111',
    }}>
      <div>
        <div style={{ color: '#e0e0e0', fontSize: 10 }}>{item.name}</div>
        <div style={{ color: '#444', fontSize: 8 }}>{item.currency}</div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div style={{ color: '#e0e0e0', fontSize: 11, fontWeight: 'bold', fontVariantNumeric: 'tabular-nums' }}>
          {fmtYield(item.spread, item.spreadBps)}
        </div>
        {item.change != null && (
          <div style={{ color, fontSize: 9, fontVariantNumeric: 'tabular-nums' }}>
            {chg >= 0 ? '+' : ''}{chg}
          </div>
        )}
      </div>
    </div>
  );
}

// Regional snapshot: horizontal bar chart of N-tenor yields across countries
function RegionalSnapshot({ data }) {
  if (!data || data.length === 0) return null;
  const max = Math.max(...data.map(d => Math.abs(d.yield)));
  return (
    <div style={{ overflowY: 'auto', padding: '0 8px 8px' }}>
      {data.map(item => (
        <div key={item.country} style={{
          display: 'grid',
          gridTemplateColumns: '36px 1fr 60px',
          alignItems: 'center',
          gap: 6, padding: '5px 0',
          borderBottom: '1px solid #111',
        }}>
          <span style={{ color: '#888', fontSize: 9, fontWeight: 700 }}>{item.country}</span>
          <div style={{ position: 'relative', height: 8, background: '#1a1a1a', borderRadius: 2 }}>
            <div style={{
              position: 'absolute', left: 0, top: 0, bottom: 0,
              width: `${max > 0 ? Math.abs(item.yield) / max * 100 : 0}%`,
              background: item.color || ORANGE,
              borderRadius: 2, opacity: 0.8,
            }} />
          </div>
          <div style={{ textAlign: 'right' }}>
            <span style={{ color: '#ccc', fontSize: 10, fontVariantNumeric: 'tabular-nums' }}>
              {item.yield.toFixed(2)}%
            </span>
            {item.live && (
              <span style={{ color: GREEN, fontSize: 7, marginLeft: 4 }}>●</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// Country color palette (distinct, readable on dark bg)
const COUNTRY_COLORS = {
  US: '#4488ff', EU: '#ffcc00', UK: '#cc88ff', BR: '#00cc44',
  JP: '#ff8844', CA: '#ff6644', AU: '#ffee44', IT: '#66ccff',
  FR: '#88ddff', MX: '#44ff88', KR: '#88ffcc', ZA: '#ffaa44',
};

function DebtPanel() {
  const [availableCountries, setAvailableCountries] = useState([]);
  const [selectedCountry, setSelectedCountry]       = useState('US');
  const [view, setView]                             = useState('curve'); // 'curve' | 'regional'
  const [regionalTenor, setRegionalTenor]           = useState('10Y');
  const [curve, setCurve]                           = useState(null);
  const [curveSource, setCurveSource]               = useState(null);
  const [regional, setRegional]                     = useState(null);
  const [indexes, setIndexes]                       = useState([]);
  const [loading, setLoading]                       = useState(true);
  const [error, setError]                           = useState(null);
  const [countryGroup, setCountryGroup]             = useState('G10');
  // Live data from /api/yield-curves (US, UK, EU, BR)
  const [liveData, setLiveData]                     = useState(null);

  // Load live yield curves + available country list on mount
  useEffect(() => {
    Promise.allSettled([
      apiFetch('/api/yield-curves').then(r => r.ok ? r.json() : null),
      apiFetch('/api/debt/countries').then(r => r.json()),
    ]).then(([liveRes, countriesRes]) => {
      if (liveRes.status === 'fulfilled' && liveRes.value) {
        setLiveData(liveRes.value);
      }
      if (countriesRes.status === 'fulfilled') {
        // Merge live countries (EU / UK / US / BR) with stub list
        const stubList = countriesRes.value?.countries || [];
        // Replace DE with EU label if live EU data available
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
    });
  }, []);

  // Helper: extract live curve points for a country code
  const getLiveCurve = useCallback((code) => {
    if (!liveData) return null;
    const key = LIVE_KEY[code];
    if (!key || !liveData[key]?.curve?.length) return null;
    return {
      points: liveData[key].curve.map(p => ({ tenor: p.tenor, yield: p.rate })),
      source: liveData[key].source,
      live: true,
    };
  }, [liveData]);

  // Load curve when country or view changes
  useEffect(() => {
    if (view !== 'curve') return;
    setLoading(true);
    setError(null);

    const live = getLiveCurve(selectedCountry);
    if (live) {
      setCurve({ points: live.points });
      setCurveSource(live.source);
      // Still load credit indexes
      apiFetch('/api/debt/credit/indexes')
        .then(r => r.json())
        .then(d => setIndexes(d.indexes || []))
        .catch(e => {
          setError('Failed to load credit indexes: ' + (e?.message || 'Unknown error'));
        })
        .finally(() => setLoading(false));
      return;
    }

    // Fallback: use stub endpoint for countries not in live data
    Promise.all([
      apiFetch(`/api/debt/sovereign/${selectedCountry}`).then(r => r.json()),
      apiFetch('/api/debt/credit/indexes').then(r => r.json()),
    ]).then(([curveData, indexData]) => {
      setCurve(curveData);
      setCurveSource('Estimated');
      setIndexes(indexData.indexes || []);
      setLoading(false);
    }).catch(e => {
      setError('Failed to load yield curve: ' + (e?.message || 'Unknown error'));
      setLoading(false);
    });
  }, [selectedCountry, view, getLiveCurve]);

  // Load regional snapshot
  useEffect(() => {
    if (view !== 'regional') return;
    setLoading(true);
    setError(null);

    const group = COUNTRY_GROUPS.find(g => g.label === countryGroup);
    const codes = group?.codes || COUNTRY_GROUPS[0].codes;

    // Build regional snapshot from live data + stub fallback
    const buildRegional = async () => {
      const snapshot = [];
      // First try to get stub regional data as a base
      let stubRegion = {};
      try {
        const region = countryGroup.toLowerCase();
        const d = await apiFetch(`/api/debt/sovereign/region?region=${region}&tenor=${regionalTenor}`)
          .then(r => r.json());
        (d.snapshot || []).forEach(item => {
          stubRegion[item.country] = item;
        });
      } catch {}

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
        // Fall back to stub
        if (stubRegion[code]) {
          snapshot.push({ ...stubRegion[code], color: COUNTRY_COLORS[code] || '#888', live: false });
        }
      }

      snapshot.sort((a, b) => b.yield - a.yield);
      setRegional(snapshot);

      // Load credit indexes
      try {
        const d = await apiFetch('/api/debt/credit/indexes').then(r => r.json());
        setIndexes(d.indexes || []);
      } catch (e) {
        setError('Failed to load credit indexes: ' + (e?.message || 'Unknown error'));
      }
    };

    buildRegional()
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [view, countryGroup, regionalTenor, getLiveCurve, availableCountries]);

  const countryMeta = availableCountries.find(c => c.code === selectedCountry);
  const chartData   = curve?.points || [];
  const lineColor   = countryMeta?.color || COUNTRY_COLORS[selectedCountry] || '#4488ff';
  const isLive      = countryMeta?.live && LIVE_KEY[selectedCountry] && liveData?.[LIVE_KEY[selectedCountry]]?.curve?.length > 0;

  const TENORS = ['2Y', '5Y', '10Y', '30Y'];

  return (
    <div style={{
      height: '100%', display: 'flex', flexDirection: 'column',
      background: '#0a0a0a', fontFamily: '"Courier New", monospace', color: '#e0e0e0',
    }}>
      {/* Header */}
      <div style={{
        padding: '6px 10px', borderBottom: '1px solid #1e1e1e',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexShrink: 0, gap: 6,
      }}>
        <span style={{ color: ORANGE, fontWeight: 'bold', fontSize: 10, letterSpacing: '0.15em', flexShrink: 0 }}>
          DEBT
        </span>

        {/* View toggle */}
        <div style={{ display: 'flex', gap: 3 }}>
          {[['curve','CURVE'],['regional','REGION']].map(([v, lbl]) => (
            <button key={v} onClick={() => setView(v)} style={{
              background: view === v ? ORANGE : 'transparent',
              border: `1px solid ${view === v ? ORANGE : '#2a2a2a'}`,
              color:  view === v ? '#000' : '#555',
              padding: '1px 6px', fontSize: 8, cursor: 'pointer',
              fontFamily: 'inherit', borderRadius: 2, fontWeight: 'bold',
            }}>{lbl}</button>
          ))}
        </div>

        {/* Country selector (curve view) */}
        {view === 'curve' && (
          <select
            value={selectedCountry}
            onChange={e => setSelectedCountry(e.target.value)}
            style={{
              background: '#111', border: '1px solid #2a2a2a', color: '#ccc',
              fontSize: 9, padding: '2px 4px', borderRadius: 2,
              fontFamily: 'inherit', cursor: 'pointer', flex: 1, minWidth: 0,
            }}
          >
            {availableCountries.map(c => (
              <option key={c.code} value={c.code}>
                {c.code} — {c.name}
              </option>
            ))}
          </select>
        )}

        {/* Group + tenor selectors (regional view) */}
        {view === 'regional' && (
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <select
              value={countryGroup}
              onChange={e => setCountryGroup(e.target.value)}
              style={{
                background: '#111', border: '1px solid #2a2a2a', color: '#ccc',
                fontSize: 9, padding: '2px 4px', borderRadius: 2, fontFamily: 'inherit',
              }}
            >
              {COUNTRY_GROUPS.map(g => <option key={g.label} value={g.label}>{g.label}</option>)}
            </select>
            <select
              value={regionalTenor}
              onChange={e => setRegionalTenor(e.target.value)}
              style={{
                background: '#111', border: '1px solid #2a2a2a', color: '#ccc',
                fontSize: 9, padding: '2px 4px', borderRadius: 2, fontFamily: 'inherit',
              }}
            >
              {TENORS.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        )}
      </div>

      {loading && (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#2a2a2a', fontSize: 11, fontFamily: "'Courier New', monospace" }}>
          LOADING…
        </div>
      )}

      {error && !loading && (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#cc2200', fontSize: 10 }}>
          {error}
        </div>
      )}

      {/* ─── Curve view ───────────────────────────────────────────────── */}
      {!loading && !error && view === 'curve' && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
          {/* Source attribution */}
          <div style={{
            padding: '3px 10px 2px',
            display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0,
          }}>
            <span style={{ color: '#333', fontSize: 8, letterSpacing: '0.1em' }}>
              {countryMeta?.name?.toUpperCase() || selectedCountry} YIELD CURVE
            </span>
            {curveSource && (
              <span style={{ fontSize: 7, color: isLive ? GREEN : '#555' }}>
                {isLive ? '● ' : '○ '}{curveSource}
              </span>
            )}
          </div>

          {/* Chart */}
          <div style={{ flex: 2, minHeight: 100, padding: '2px 4px' }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 2, right: 8, bottom: 0, left: 2 }}>
                <CartesianGrid strokeDasharray="2 4" stroke="#111" />
                <XAxis dataKey="tenor" tick={{ fill: '#2a2a2a', fontSize: 8 }} axisLine={{ stroke: '#1e1e1e' }} tickLine={false} />
                <YAxis
                  tick={{ fill: '#2a2a2a', fontSize: 8 }}
                  domain={['auto', 'auto']}
                  tickFormatter={v => v.toFixed(1) + '%'}
                  width={36}
                  axisLine={{ stroke: '#1e1e1e' }}
                />
                <Tooltip
                  contentStyle={{ background: '#0d0d0d', border: '1px solid #2a2a2a', fontSize: 10, borderRadius: 3 }}
                  formatter={v => [v.toFixed(2) + '%', 'Yield']}
                />
                <Line
                  type="monotone" dataKey="yield" name="Yield"
                  stroke={lineColor} strokeWidth={2}
                  dot={{ fill: lineColor, r: 3 }}
                  activeDot={{ r: 4 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Tenor table — 2 columns */}
          <div style={{ borderTop: '1px solid #1a1a1a', padding: '6px 10px 0', overflowY: 'auto' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1px' }}>
              {chartData.map(pt => (
                <div key={pt.tenor} style={{
                  display: 'flex', justifyContent: 'space-between',
                  padding: '3px 0', borderBottom: '1px solid #111',
                }}>
                  <span style={{ color: '#333', fontSize: 8 }}>{pt.tenor}</span>
                  <span style={{ color: '#ccc', fontSize: 10, fontVariantNumeric: 'tabular-nums' }}>
                    {pt.yield.toFixed(2)}%
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Credit spreads */}
          {indexes.length > 0 && (
            <div style={{ borderTop: '1px solid #1e1e1e', padding: '6px 10px', flexShrink: 0, maxHeight: 170, overflowY: 'auto' }}>
              <div style={{ color: '#333', fontSize: 8, letterSpacing: '0.1em', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                CREDIT SPREADS (bps)
                <span style={{ color: '#444', fontSize: 7 }}>○ ESTIMATED</span>
              </div>
              {indexes.map(idx => <SpreadRow key={idx.id} item={idx} />)}
            </div>
          )}
        </div>
      )}

      {/* ─── Regional view ───────────────────────────────────────────── */}
      {!loading && !error && view === 'regional' && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div style={{ padding: '4px 10px 2px', color: '#333', fontSize: 8, letterSpacing: '0.1em', flexShrink: 0, display: 'flex', gap: 6 }}>
            <span>{countryGroup} — {regionalTenor} YIELDS</span>
            <span style={{ color: '#444', fontSize: 7 }}>
              ● live  ○ est.
            </span>
          </div>
          <div style={{ flex: 1, overflowY: 'auto' }}>
            <RegionalSnapshot data={regional} />
          </div>

          {/* Credit spreads */}
          {indexes.length > 0 && (
            <div style={{ borderTop: '1px solid #1e1e1e', padding: '6px 10px', flexShrink: 0, maxHeight: 150, overflowY: 'auto' }}>
              <div style={{ color: '#333', fontSize: 8, letterSpacing: '0.1em', marginBottom: 4 }}>
                CREDIT SPREADS (bps) <span style={{ color: '#444', fontSize: 7 }}>○ ESTIMATED</span>
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
