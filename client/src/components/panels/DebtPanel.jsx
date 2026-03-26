/**
 * DebtPanel.jsx
 * Global sovereign yield curves + credit spread indexes.
 * Uses /api/debt/* endpoints.
 *
 * Real data providers to wire in production:
 *   1. US Treasury Fiscal Data API — https://fiscaldata.treasury.gov/api-documentation/ (free)
 *   2. ANBIMA — https://data.anbima.com.br/ (Brazil DI/NTN-B curves)
 *   3. ECB SDW — https://sdw-wsrest.ecb.europa.eu/ (EU sovereign yields)
 *   4. FRED — https://fred.stlouisfed.org/docs/api/fred/ (US macro + yields)
 *   5. Fin2Dev / Finnworlds — paid, global coverage (50+ countries)
 *   6. TradingEconomics — paid, 100+ countries
 */

import { useState, useEffect, useCallback } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, BarChart, Bar, Cell,
} from 'recharts';
import { apiFetch } from '../../utils/api';

const ORANGE = '#ff6600';
const GREEN  = '#00cc44';
const RED    = '#cc2200';

// Country groups for tab navigation
const COUNTRY_GROUPS = [
  { label: 'G10',    codes: ['US','DE','GB','JP','CA','AU','FR'] },
  { label: 'EM',     codes: ['BR','MX','ZA','KR'] },
  { label: 'Europe', codes: ['DE','GB','FR','IT'] },
  { label: 'LatAm',  codes: ['BR','MX','ZA'] },
];

function fmtYield(v, bps = false) {
  if (v == null) return '--';
  if (bps) return (v >= 0 ? '+' : '') + v + ' bps';
  return (v >= 0 ? '' : '') + v.toFixed(2) + '%';
}

function SpreadRow({ item }) {
  const chg = item.change ?? 0;
  // Wider spread = worse (red for credit, but for yield spreads it's nuanced)
  const color = chg > 0 ? RED : GREEN;
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '5px 0', borderBottom: '1px solid #111',
    }}>
      <div>
        <div style={{ color: '#e0e0e0', fontSize: 10 }}>{item.name}</div>
        <div style={{ color: '#333', fontSize: 8 }}>{item.currency}</div>
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

// Regional snapshot: horizontal bar chart of 10Y yields across countries
function RegionalSnapshot({ data }) {
  if (!data || data.length === 0) return null;
  const max = Math.max(...data.map(d => Math.abs(d.yield)));
  return (
    <div style={{ overflowY: 'auto', padding: '0 8px 8px' }}>
      {data.map(item => (
        <div key={item.country} style={{
          display: 'grid',
          gridTemplateColumns: '36px 1fr 52px',
          alignItems: 'center',
          gap: 6,
          padding: '5px 0',
          borderBottom: '1px solid #111',
          cursor: 'default',
        }}>
          <span style={{ color: '#888', fontSize: 9, fontWeight: 700 }}>{item.country}</span>
          <div style={{ position: 'relative', height: 8, background: '#1a1a1a', borderRadius: 2 }}>
            <div style={{
              position: 'absolute', left: 0, top: 0, bottom: 0,
              width: `${Math.abs(item.yield) / max * 100}%`,
              background: item.color || ORANGE,
              borderRadius: 2,
              opacity: 0.8,
            }} />
          </div>
          <span style={{ color: '#ccc', fontSize: 10, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
            {item.yield.toFixed(2)}%
          </span>
        </div>
      ))}
    </div>
  );
}

export default function DebtPanel() {
  const [availableCountries, setAvailableCountries] = useState([]);
  const [selectedCountry, setSelectedCountry]       = useState('US');
  const [view, setView]                             = useState('curve'); // 'curve' | 'regional'
  const [regionalTenor, setRegionalTenor]           = useState('10Y');
  const [curve, setCurve]                           = useState(null);
  const [regional, setRegional]                     = useState(null);
  const [indexes, setIndexes]                       = useState([]);
  const [loading, setLoading]                       = useState(true);
  const [error, setError]                           = useState(null);
  const [countryGroup, setCountryGroup]             = useState('G10');

  // Load countries list on mount
  useEffect(() => {
    apiFetch('/api/debt/countries')
      .then(r => r.json())
      .then(d => setAvailableCountries(d.countries || []))
      .catch(() => {});
  }, []);

  // Load curve + credit indexes when country changes
  useEffect(() => {
    if (view !== 'curve') return;
    setLoading(true);
    setError(null);
    Promise.all([
      apiFetch(`/api/debt/sovereign/${selectedCountry}`).then(r => r.json()),
      apiFetch('/api/debt/credit/indexes').then(r => r.json()),
    ]).then(([curveData, indexData]) => {
      setCurve(curveData);
      setIndexes(indexData.indexes || []);
      setLoading(false);
    }).catch(e => {
      setError(e.message);
      setLoading(false);
    });
  }, [selectedCountry, view]);

  // Load regional snapshot when region view changes
  useEffect(() => {
    if (view !== 'regional') return;
    setLoading(true);
    setError(null);
    const group = COUNTRY_GROUPS.find(g => g.label === countryGroup);
    const region = countryGroup.toLowerCase();
    Promise.all([
      apiFetch(`/api/debt/sovereign/region?region=${region}&tenor=${regionalTenor}`).then(r => r.json()),
      apiFetch('/api/debt/credit/indexes').then(r => r.json()),
    ]).then(([regData, indexData]) => {
      setRegional(regData.snapshot || []);
      setIndexes(indexData.indexes || []);
      setLoading(false);
    }).catch(e => {
      setError(e.message);
      setLoading(false);
    });
  }, [view, countryGroup, regionalTenor]);

  const countryMeta = availableCountries.find(c => c.code === selectedCountry);
  const chartData   = curve?.points || [];
  const lineColor   = countryMeta?.color || '#4488ff';

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
              fontFamily: 'inherit', cursor: 'pointer',
            }}
          >
            {availableCountries.map(c => (
              <option key={c.code} value={c.code}>{c.code} — {c.name}</option>
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
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#2a2a2a', fontSize: 11 }}>
          Loading…
        </div>
      )}

      {error && !loading && (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#cc2200', fontSize: 10 }}>
          {error}
        </div>
      )}

      {/* ─── Curve view ─────────────────────────────────────────────────── */}
      {!loading && !error && view === 'curve' && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
          {/* Chart */}
          <div style={{ flex: 2, minHeight: 100, padding: '6px 4px 2px' }}>
            <div style={{ color: '#333', fontSize: 8, letterSpacing: '0.1em', padding: '0 6px 3px' }}>
              {curve?.name?.toUpperCase()} YIELD CURVE
              {curve?.stub && <span style={{ color: '#1e1e1e', marginLeft: 6 }}>STUB</span>}
            </div>
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
              <div style={{ color: '#333', fontSize: 8, letterSpacing: '0.1em', marginBottom: 4 }}>
                CREDIT SPREADS (bps)
                <span style={{ color: '#1a1a1a', marginLeft: 6 }}>STUB</span>
              </div>
              {indexes.map(idx => <SpreadRow key={idx.id} item={idx} />)}
            </div>
          )}
        </div>
      )}

      {/* ─── Regional view ──────────────────────────────────────────────── */}
      {!loading && !error && view === 'regional' && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div style={{ padding: '4px 10px 2px', color: '#333', fontSize: 8, letterSpacing: '0.1em', flexShrink: 0 }}>
            {countryGroup} — {regionalTenor} YIELDS
            <span style={{ color: '#1a1a1a', marginLeft: 6 }}>STUB</span>
          </div>
          <div style={{ flex: 1, overflowY: 'auto' }}>
            <RegionalSnapshot data={regional} />
          </div>

          {/* Credit spreads */}
          {indexes.length > 0 && (
            <div style={{ borderTop: '1px solid #1e1e1e', padding: '6px 10px', flexShrink: 0, maxHeight: 150, overflowY: 'auto' }}>
              <div style={{ color: '#333', fontSize: 8, letterSpacing: '0.1em', marginBottom: 4 }}>
                CREDIT SPREADS (bps)
              </div>
              {indexes.map(idx => <SpreadRow key={idx.id} item={idx} />)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
