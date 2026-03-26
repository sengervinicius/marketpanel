/**
 * DebtPanel.jsx
 * Sovereign yield curves + credit spread indexes.
 * Uses /api/debt/* endpoints (currently stubbed).
 *
 * Real data providers to wire in production:
 *   1. US Treasury — https://fiscaldata.treasury.gov/api-documentation/ (free)
 *   2. ANBIMA — https://data.anbima.com.br/ (Brazil DI/NTN-B curves)
 *   3. ECB SDW — https://sdw-wsrest.ecb.europa.eu/ (EU sovereign yields)
 *   4. FRED — https://fred.stlouisfed.org/docs/api/fred/ (US macro + yields)
 */

import { useState, useEffect } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { apiFetch } from '../../utils/api';

const ORANGE = '#ff6600';
const GREEN  = '#00cc44';
const RED    = '#cc2200';

const COUNTRIES = [
  { code: 'US', label: 'US Treasuries', currency: 'USD', color: '#4488ff' },
  { code: 'BR', label: 'Brazil (DI/NTN)', currency: 'BRL', color: '#00cc44' },
  { code: 'DE', label: 'Germany (Bund)',  currency: 'EUR', color: '#ffcc00' },
];

function fmtYield(v) {
  if (v == null) return '--';
  return v.toFixed(2) + '%';
}

function SpreadRow({ item }) {
  const color = (item.change ?? 0) >= 0 ? RED : GREEN; // tighter spread = better
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '7px 0', borderBottom: '1px solid #141414',
    }}>
      <div>
        <div style={{ color: '#e0e0e0', fontSize: 10 }}>{item.name}</div>
        <div style={{ color: '#444', fontSize: 8 }}>{item.currency}</div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div style={{ color: '#e0e0e0', fontSize: 12, fontWeight: 'bold' }}>
          {fmtYield(item.spread)}
        </div>
        {item.change != null && (
          <div style={{ color, fontSize: 9 }}>
            {item.change >= 0 ? '+' : ''}{item.change.toFixed(2)}
          </div>
        )}
      </div>
    </div>
  );
}

export default function DebtPanel() {
  const [country,  setCountry]  = useState('US');
  const [curve,    setCurve]    = useState(null);
  const [indexes,  setIndexes]  = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    Promise.all([
      apiFetch(`/api/debt/sovereign/${country}`).then(r => r.json()),
      apiFetch('/api/debt/credit/indexes').then(r => r.json()),
    ]).then(([curveData, indexData]) => {
      setCurve(curveData);
      setIndexes(indexData.indexes || []);
      setLoading(false);
    }).catch(e => {
      setError(e.message);
      setLoading(false);
    });
  }, [country]);

  const countryMeta = COUNTRIES.find(c => c.code === country) || COUNTRIES[0];
  const chartData   = curve?.points || [];

  return (
    <div style={{
      height: '100%', display: 'flex', flexDirection: 'column',
      background: '#0a0a0a', fontFamily: '"Courier New", monospace', color: '#e0e0e0',
    }}>
      {/* Header */}
      <div style={{
        padding: '6px 12px', borderBottom: '1px solid #1e1e1e',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexShrink: 0,
      }}>
        <span style={{ color: ORANGE, fontWeight: 'bold', fontSize: 10, letterSpacing: '0.2em' }}>
          DEBT MARKETS
        </span>
        {/* Country tabs */}
        <div style={{ display: 'flex', gap: 4 }}>
          {COUNTRIES.map(c => (
            <button
              key={c.code}
              onClick={() => setCountry(c.code)}
              style={{
                background: country === c.code ? ORANGE : 'transparent',
                border: `1px solid ${country === c.code ? ORANGE : '#2a2a2a'}`,
                color:  country === c.code ? '#000' : '#555',
                padding: '2px 8px', fontSize: 9, cursor: 'pointer',
                fontFamily: 'inherit', borderRadius: 2, fontWeight: 'bold',
              }}
            >{c.code}</button>
          ))}
        </div>
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

      {!loading && !error && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
          {/* Curve chart */}
          <div style={{ flex: 2, minHeight: 120, padding: '8px 4px 4px' }}>
            <div style={{ color: '#555', fontSize: 8, letterSpacing: '0.15em', padding: '0 8px 4px' }}>
              {countryMeta.label} YIELD CURVE
              {curve?.note && <span style={{ color: '#2a2a2a', marginLeft: 6 }}>(STUB)</span>}
            </div>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 4, right: 10, bottom: 0, left: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#111" />
                <XAxis dataKey="tenor" tick={{ fill: '#333', fontSize: 9 }} axisLine={{ stroke: '#1e1e1e' }} tickLine={false} />
                <YAxis
                  tick={{ fill: '#333', fontSize: 9 }}
                  domain={['auto', 'auto']}
                  tickFormatter={v => v.toFixed(1) + '%'}
                  width={42}
                  axisLine={{ stroke: '#1e1e1e' }}
                />
                <Tooltip
                  contentStyle={{ background: '#0d0d0d', border: '1px solid #2a2a2a', fontSize: 11, borderRadius: 3 }}
                  formatter={v => [v.toFixed(2) + '%', 'Yield']}
                />
                <Line
                  type="monotone" dataKey="yield" name="Yield"
                  stroke={countryMeta.color} strokeWidth={2}
                  dot={{ fill: countryMeta.color, r: 3 }}
                  activeDot={{ r: 4 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Tenor table */}
          <div style={{ flex: 1.2, overflowY: 'auto', borderTop: '1px solid #1a1a1a' }}>
            <div style={{
              display: 'grid', gridTemplateColumns: '1fr 1fr',
              gap: '1px', padding: '8px 12px 0',
            }}>
              {chartData.map(pt => (
                <div key={pt.tenor} style={{
                  display: 'flex', justifyContent: 'space-between',
                  padding: '4px 0', borderBottom: '1px solid #111',
                }}>
                  <span style={{ color: '#444', fontSize: 9 }}>{pt.tenor}</span>
                  <span style={{ color: '#ccc', fontSize: 10, fontVariantNumeric: 'tabular-nums' }}>
                    {fmtYield(pt.yield)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Credit indexes */}
          {indexes.length > 0 && (
            <div style={{ borderTop: '1px solid #1e1e1e', padding: '8px 12px', flexShrink: 0, maxHeight: 180, overflowY: 'auto' }}>
              <div style={{ color: '#555', fontSize: 8, letterSpacing: '0.15em', marginBottom: 6 }}>
                CREDIT SPREADS (OAS, bps)
              </div>
              {indexes.map(idx => <SpreadRow key={idx.id} item={idx} />)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
