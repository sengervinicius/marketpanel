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
import './DebtPanel.css';

// Which countryCode → live curve key in /api/yield-curves response
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

function SpreadRow({ item }) {
  const chg = item.change ?? 0;
  const color = chg > 0 ? 'var(--price-down)' : 'var(--price-up)';
  return (
    <div className="dp-spread-row">
      <div>
        <div className="dp-spread-name">{item.name}</div>
        <div className="dp-spread-currency">{item.currency}</div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div className="dp-spread-value">
          {fmtYield(item.spread, item.spreadBps)}
        </div>
        {item.change != null && (
          <div className="dp-spread-chg" style={{ color }}>
            {chg >= 0 ? '+' : ''}{chg}
          </div>
        )}
      </div>
    </div>
  );
}

function RegionalSnapshot({ data }) {
  if (!data || data.length === 0) return null;
  const max = Math.max(...data.map(d => Math.abs(d.yield)));
  return (
    <div style={{ overflowY: 'auto', padding: '0 8px 8px' }}>
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
            {item.live && <span className="dp-snapshot-live" style={{ color: 'var(--price-up)' }}>●</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

function DebtPanel() {
  const [availableCountries, setAvailableCountries] = useState([]);
  const [selectedCountry, setSelectedCountry]       = useState('US');
  const [view, setView]                             = useState('curve');
  const [regionalTenor, setRegionalTenor]           = useState('10Y');
  const [curve, setCurve]                           = useState(null);
  const [curveSource, setCurveSource]               = useState(null);
  const [regional, setRegional]                     = useState(null);
  const [indexes, setIndexes]                       = useState([]);
  const [loading, setLoading]                       = useState(true);
  const [error, setError]                           = useState(null);
  const [countryGroup, setCountryGroup]             = useState('G10');
  const [liveData, setLiveData]                     = useState(null);

  useEffect(() => {
    Promise.allSettled([
      apiFetch('/api/yield-curves').then(r => r.ok ? r.json() : null),
      apiFetch('/api/debt/countries').then(r => r.json()),
    ]).then(([liveRes, countriesRes]) => {
      if (liveRes.status === 'fulfilled' && liveRes.value) {
        setLiveData(liveRes.value);
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
    });
  }, []);

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

  useEffect(() => {
    if (view !== 'curve') return;
    setLoading(true);
    setError(null);

    const live = getLiveCurve(selectedCountry);
    if (live) {
      setCurve({ points: live.points });
      setCurveSource(live.source);
      apiFetch('/api/debt/credit/indexes')
        .then(r => r.json())
        .then(d => setIndexes(d.indexes || []))
        .catch(e => {
          setError('Failed to load credit indexes: ' + (e?.message || 'Unknown error'));
        })
        .finally(() => setLoading(false));
      return;
    }

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

  useEffect(() => {
    if (view !== 'regional') return;
    setLoading(true);
    setError(null);

    const group = COUNTRY_GROUPS.find(g => g.label === countryGroup);
    const codes = group?.codes || COUNTRY_GROUPS[0].codes;

    const buildRegional = async () => {
      const snapshot = [];
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
        if (stubRegion[code]) {
          snapshot.push({ ...stubRegion[code], color: COUNTRY_COLORS[code] || '#888', live: false });
        }
      }

      snapshot.sort((a, b) => b.yield - a.yield);
      setRegional(snapshot);

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
    <div className="dp-panel">
      {/* Header */}
      <div className="dp-header">
        <span className="dp-title">DEBT</span>

        {/* View toggle */}
        <div style={{ display: 'flex', gap: 3 }}>
          {[['curve','CURVE'],['regional','REGION']].map(([v, lbl]) => (
            <button className={`btn dp-view-btn${view === v ? ' dp-view-btn--active' : ''}`} key={v} onClick={() => setView(v)}>{lbl}</button>
          ))}
        </div>

        {/* Country selector (curve view) */}
        {view === 'curve' && (
          <select
            value={selectedCountry}
            onChange={e => setSelectedCountry(e.target.value)}
            className="dp-select dp-select--flex"
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
            <select value={countryGroup} onChange={e => setCountryGroup(e.target.value)} className="dp-select">
              {COUNTRY_GROUPS.map(g => <option key={g.label} value={g.label}>{g.label}</option>)}
            </select>
            <select value={regionalTenor} onChange={e => setRegionalTenor(e.target.value)} className="dp-select">
              {TENORS.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        )}
      </div>

      {loading && <div className="dp-msg dp-msg--loading">LOADING...</div>}

      {error && !loading && <div className="dp-msg dp-msg--error">{error}</div>}

      {/* Curve view */}
      {!loading && !error && view === 'curve' && (
        <div className="dp-curve">
          <div className="dp-source-row">
            <span className="dp-source-label">
              {countryMeta?.name?.toUpperCase() || selectedCountry} YIELD CURVE
            </span>
            {curveSource && (
              <span className="dp-source-badge" style={{ color: isLive ? 'var(--price-up)' : 'var(--text-muted)' }}>
                {isLive ? '● ' : '○ '}{curveSource}
              </span>
            )}
          </div>

          <div className="dp-chart-container">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 2, right: 8, bottom: 0, left: 2 }}>
                <CartesianGrid strokeDasharray="2 4" stroke="var(--border-subtle)" />
                <XAxis dataKey="tenor" tick={{ fill: 'var(--text-faint)', fontSize: 8 }} axisLine={{ stroke: 'var(--border-default)' }} tickLine={false} />
                <YAxis
                  tick={{ fill: 'var(--text-faint)', fontSize: 8 }}
                  domain={['auto', 'auto']}
                  tickFormatter={v => v.toFixed(1) + '%'}
                  width={36}
                  axisLine={{ stroke: 'var(--border-default)' }}
                />
                <Tooltip
                  contentStyle={{ background: 'var(--bg-surface)', border: '1px solid var(--border-strong)', borderRadius: 3 }}
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

          {indexes.length > 0 && (
            <div className="dp-spreads">
              <div className="dp-spreads-title">
                CREDIT SPREADS (bps)
                <span className="dp-spreads-note">○ ESTIMATED</span>
              </div>
              {indexes.map(idx => <SpreadRow key={idx.id} item={idx} />)}
            </div>
          )}
        </div>
      )}

      {/* Regional view */}
      {!loading && !error && view === 'regional' && (
        <div className="dp-regional">
          <div className="dp-regional-header">
            <span>{countryGroup} — {regionalTenor} YIELDS</span>
            <span className="dp-regional-legend">● live  ○ est.</span>
          </div>
          <div style={{ flex: 1, overflowY: 'auto' }}>
            <RegionalSnapshot data={regional} />
          </div>

          {indexes.length > 0 && (
            <div className="dp-spreads" style={{ maxHeight: 150 }}>
              <div className="dp-spreads-title">
                CREDIT SPREADS (bps) <span className="dp-spreads-note">○ ESTIMATED</span>
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
