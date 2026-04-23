/**
 * FixedIncomeScreen.jsx — Wave 3 Full-Page Fixed Income Screen
 *
 * Comprehensive fixed income dashboard with:
 * 1. Bond ETF Sector Charts (6 tickers, 2x3 grid)
 * 2. US Treasury Yield Curve with 2s10s spread & inversion warning
 * 3. Multi-country Yield Curves (US, DE, JP, GB overlay)
 * 4. Sovereign Yield Grid (10+ countries, 2Y/5Y/10Y/30Y tenors)
 * 5. IG Corporate Bonds table
 * 6. HY Corporate Bonds table
 * 7. Credit Spreads Dashboard (IG OAS, HY OAS, EM spread)
 * 8. Bond ETF Comparison Grid (live prices)
 * 9. Duration Risk Calculator (interactive sliders)
 *
 * ~550 lines, using FullPageScreenLayout + Recharts + useSectionData
 */

import { useState, useCallback, memo, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { useSectionData } from '../../hooks/useSectionData';
import { useOpenDetail } from '../../context/OpenDetailContext';
import { useTickerPrice } from '../../context/PriceContext';
import { apiFetch } from '../../utils/api';
import { FullPageScreenLayout, SectorChartPanel, KPIRibbon } from './shared';
import DataUnavailable from '../common/DataUnavailable';
import { tapStart, tapMove, tapEnd } from '../../utils/tapHandlers';
import './FixedIncomeScreen.css';

/* ═══════════════════════════════════════════════════════════════════════════
   CONSTANTS
   ═══════════════════════════════════════════════════════════════════════════ */

const SECTOR_CHART_TICKERS = ['TLT', 'HYG', 'LQD', 'EMB', 'SHY', 'IEF'];
const BOND_ETF_TICKERS = ['TLT', 'IEF', 'SHY', 'AGG', 'BND', 'BNDX', 'LQD', 'HYG', 'EMB', 'TIP'];
const EUR_BOND_ETFS = ['IEAC.L', 'IHYG.L', 'EUNT.DE', 'XG7S.DE', 'XBLC.DE'];

const COUNTRY_LABELS = {
  US: 'United States',
  DE: 'Germany',
  JP: 'Japan',
  GB: 'United Kingdom',
  FR: 'France',
  IT: 'Italy',
  ES: 'Spain',
  BR: 'Brazil',
  MX: 'Mexico',
  CA: 'Canada',
  AU: 'Australia',
  IN: 'India',
};

const CURVE_COLORS = {
  US: '#4488ff',
  DE: '#ff9800',
  JP: '#ef5350',
  GB: '#4caf50',
};

const TENORS_SORT = ['2Y', '5Y', '10Y', '30Y'];

const BANNER_TICKERS = [
  { ticker: 'TLT', label: 'TLT 20Y' },
  { ticker: 'IEF', label: 'IEF 7Y' },
  { ticker: 'SHY', label: 'SHY 1-3Y' },
  { ticker: 'AGG', label: 'AGG TOTAL' },
  { ticker: 'LQD', label: 'LQD IG CORP' },
  { ticker: 'HYG', label: 'HYG HY CORP' },
  { ticker: 'EMB', label: 'EMB EM BONDS' },
  { ticker: 'BND', label: 'BND TOTAL' },
  { ticker: 'BNDX', label: 'BNDX INTL' },
  { ticker: 'TIP', label: 'TIP TIPS' },
];

/* ═══════════════════════════════════════════════════════════════════════════
   DATA FETCHERS
   ═══════════════════════════════════════════════════════════════════════════ */

async function fetchYieldCurves(countries) {
  const res = await apiFetch(`/api/bonds/yield-curves?countries=${countries.join(',')}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  return json.curves || [];
}

async function fetchCorporateBonds(rating, limit = 15) {
  const res = await apiFetch(`/api/bonds/corporate?rating=${rating}&limit=${limit}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  return json.bonds || [];
}

async function fetchSpreads(base = 'US', comparisons = [], tenor = '10Y') {
  const res = await apiFetch(
    `/api/bonds/spreads?base=${base}&comparisons=${comparisons.join(',')}&tenor=${tenor}`
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/* ═══════════════════════════════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════════════════════════════ */

function fmtYield(val) {
  if (val == null) return '—';
  // FRED/Treasury return yields as percentages (e.g., 4.35 = 4.35%)
  return val.toFixed(2) + '%';
}

function yieldClass(val) {
  if (val == null) return 'fi-yield';
  if (val > 8) return 'fi-yield fi-yield--vhigh';
  if (val > 5) return 'fi-yield fi-yield--high';
  return 'fi-yield';
}

function parseYieldCurve(curve) {
  if (!curve || !curve.curve || !Array.isArray(curve.curve)) return [];
  return curve.curve.map(pt => {
    const tenor = pt.tenor || pt.maturity || pt.term || '?';
    return {
      tenor,
      yield: pt.yield != null ? parseFloat(pt.yield) : null,
      price: pt.price,
      change: pt.change,
    };
  }).sort((a, b) => {
    const orderA = TENORS_SORT.indexOf(a.tenor);
    const orderB = TENORS_SORT.indexOf(b.tenor);
    if (orderA !== -1 && orderB !== -1) return orderA - orderB;
    return a.tenor.localeCompare(b.tenor);
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   COMPONENT: Skeleton
   ═══════════════════════════════════════════════════════════════════════════ */

function FISkeleton({ rows = 6 }) {
  return (
    <div className="fi-skeleton">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="fi-skeleton-row" style={{ width: `${90 - i * 5}%` }} />
      ))}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 1: Sector Chart Panel
   ═══════════════════════════════════════════════════════════════════════════ */

function SectorChartsSection() {
  return (
    <SectorChartPanel
      tickers={SECTOR_CHART_TICKERS}
      height={180}
      cols={3}
    />
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 2: US Treasury Yield Curve with 2s10s & Inversion Warning
   ═══════════════════════════════════════════════════════════════════════════ */

function USTreasuryCurveSection() {
  const { data: curves, loading, error, refresh } = useSectionData({
    cacheKey: 'fi-ustreasury-curve',
    fetcher: () => fetchYieldCurves(['US']),
  });

  if (loading) return <FISkeleton rows={5} />;
  if (error) return <DataUnavailable reason={error} onRetry={refresh} />;

  const usCurve = curves && curves[0];
  if (!usCurve) return <DataUnavailable reason="No US curve data" onRetry={refresh} />;

  const parsed = parseYieldCurve(usCurve);
  if (parsed.length === 0) return <DataUnavailable reason="Empty curve" onRetry={refresh} />;

  // Find 2Y and 10Y for spread calculation
  const y2 = parsed.find(p => p.tenor === '2Y')?.yield;
  const y10 = parsed.find(p => p.tenor === '10Y')?.yield;
  const spread2s10s = (y10 != null && y2 != null) ? (y10 - y2) * 100 : null;
  const isInverted = spread2s10s != null && spread2s10s < 0;

  // Chart data
  const chartData = (Array.isArray(parsed) ? parsed : []).map(p => ({
    tenor: p.tenor,
    yield: p.yield,
  })).filter(d => d.yield != null);

  return (
    <div style={{ padding: '0 10px' }}>
      {isInverted && (
        <div style={{
          background: 'rgba(239, 83, 80, 0.1)',
          border: '1px solid rgba(239, 83, 80, 0.3)',
          color: 'var(--semantic-down)',
          padding: '6px 8px',
          marginBottom: '8px',
          borderRadius: '3px',
          fontSize: '9px',
          fontWeight: 600,
        }}>
          INVERSION WARNING: 2s10s spread = {spread2s10s.toFixed(2)} bps
        </div>
      )}
      <div style={{ fontSize: '9px', color: 'var(--text-secondary)', marginBottom: '6px' }}>
        2s10s Spread: <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
          {spread2s10s != null ? spread2s10s.toFixed(2) + ' bps' : '—'}
        </span>
      </div>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={chartData} margin={{ top: 5, right: 20, bottom: 20, left: 50 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-default)" />
          <XAxis dataKey="tenor" stroke="var(--text-muted)" style={{ fontSize: 9 }} />
          <YAxis stroke="var(--text-muted)" style={{ fontSize: 9 }} />
          <Tooltip
            contentStyle={{
              background: 'var(--bg-panel)',
              border: '1px solid var(--border-default)',
              borderRadius: 3,
            }}
            formatter={(val) => fmtYield(val)}
            labelStyle={{ color: 'var(--text-primary)' }}
          />
          <Line
            type="monotone"
            dataKey="yield"
            stroke="var(--semantic-info)"
            strokeWidth={2}
            dot={{ r: 3 }}
            activeDot={{ r: 5 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 3: Multi-Country Yield Curves
   ═══════════════════════════════════════════════════════════════════════════ */

function MultiCountryCurvesSection() {
  const { data: curves, loading, error, refresh } = useSectionData({
    cacheKey: 'fi-multi-curves',
    fetcher: () => fetchYieldCurves(['US', 'DE', 'JP', 'GB']),
  });

  if (loading) return <FISkeleton rows={5} />;
  if (error) return <DataUnavailable reason={error} onRetry={refresh} />;
  if (!curves || curves.length === 0) return <DataUnavailable reason="No curve data" onRetry={refresh} />;

  // Parse all curves
  const curveMap = {};
  for (const c of curves) {
    curveMap[c.country] = parseYieldCurve(c);
  }

  // Build dataset for overlay chart
  // Find all unique tenors
  const allTenors = new Set();
  for (const pts of Object.values(curveMap)) {
    for (const p of pts) {
      allTenors.add(p.tenor);
    }
  }
  const tenorList = Array.from(allTenors).sort((a, b) => {
    const oa = TENORS_SORT.indexOf(a);
    const ob = TENORS_SORT.indexOf(b);
    if (oa !== -1 && ob !== -1) return oa - ob;
    return a.localeCompare(b);
  });

  const chartData = (Array.isArray(tenorList) ? tenorList : []).map(tenor => {
    const row = { tenor };
    for (const country of ['US', 'DE', 'JP', 'GB']) {
      const pt = curveMap[country]?.find(p => p.tenor === tenor);
      row[country] = pt?.yield ?? null;
    }
    return row;
  });

  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={chartData} margin={{ top: 5, right: 20, bottom: 20, left: 50 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border-default)" />
        <XAxis dataKey="tenor" stroke="var(--text-muted)" style={{ fontSize: 9 }} />
        <YAxis stroke="var(--text-muted)" style={{ fontSize: 9 }} />
        <Tooltip
          contentStyle={{
            background: 'var(--bg-panel)',
            border: '1px solid var(--border-default)',
            borderRadius: 3,
          }}
          formatter={(val) => fmtYield(val)}
          labelStyle={{ color: 'var(--text-primary)' }}
        />
        <Legend wrapperStyle={{ fontSize: 9, color: 'var(--text-secondary)' }} />
        <Line type="monotone" dataKey="US" stroke={CURVE_COLORS.US} strokeWidth={2} dot={{ r: 2 }} />
        <Line type="monotone" dataKey="DE" stroke={CURVE_COLORS.DE} strokeWidth={2} dot={{ r: 2 }} />
        <Line type="monotone" dataKey="JP" stroke={CURVE_COLORS.JP} strokeWidth={2} dot={{ r: 2 }} />
        <Line type="monotone" dataKey="GB" stroke={CURVE_COLORS.GB} strokeWidth={2} dot={{ r: 2 }} />
      </LineChart>
    </ResponsiveContainer>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 4: Sovereign Yield Grid
   ═══════════════════════════════════════════════════════════════════════════ */

function SovereignYieldGridSection() {
  const countries = ['US', 'DE', 'GB', 'FR', 'IT', 'ES', 'JP', 'AU', 'BR', 'MX', 'CA', 'IN'];

  const { data: curves, loading, error, refresh } = useSectionData({
    cacheKey: 'fi-sovereign-grid',
    fetcher: () => fetchYieldCurves(countries),
  });

  if (loading) return <FISkeleton rows={8} />;
  if (error) return <DataUnavailable reason={error} onRetry={refresh} />;
  if (!curves || curves.length === 0) return <DataUnavailable reason="No sovereign data" onRetry={refresh} />;

  // Build grid
  const curveMap = {};
  for (const c of curves) {
    curveMap[c.country] = parseYieldCurve(c);
  }

  return (
    <table className="fi-table">
      <thead>
        <tr>
          <th>Country</th>
          {TENORS_SORT.map(t => <th key={t}>{t}</th>)}
        </tr>
      </thead>
      <tbody>
        {(Array.isArray(countries) ? countries : []).map(country => {
          const curve = curveMap[country] || [];
          return (
            <tr key={country}>
              <td title={COUNTRY_LABELS[country]}>{country}</td>
              {(Array.isArray(TENORS_SORT) ? TENORS_SORT : []).map(tenor => {
                const pt = curve.find(p => p.tenor === tenor);
                const val = pt?.yield;
                return (
                  <td key={tenor} className={yieldClass(val)}>
                    {fmtYield(val)}
                  </td>
                );
              })}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 5: IG Corporate Bonds
   ═══════════════════════════════════════════════════════════════════════════ */

function IGCorporateSection() {
  const { data: bonds, loading, error, refresh } = useSectionData({
    cacheKey: 'fi-corp-ig',
    fetcher: () => fetchCorporateBonds('IG', 15),
  });

  if (loading) return <FISkeleton rows={8} />;
  if (error) return <DataUnavailable reason={error} onRetry={refresh} />;
  if (!bonds || bonds.length === 0) return <DataUnavailable reason="No IG bonds" onRetry={refresh} />;

  return (
    <table className="fi-table">
      <thead>
        <tr>
          <th>Issuer</th>
          <th>Coupon</th>
          <th>Maturity</th>
          <th>Yield</th>
          <th>Rating</th>
        </tr>
      </thead>
      <tbody>
        {(Array.isArray(bonds) ? bonds : []).map((bond, i) => {
          const coupon = bond.coupon != null
            ? (typeof bond.coupon === 'number' && bond.coupon < 1
                ? (bond.coupon * 100).toFixed(2)
                : parseFloat(bond.coupon).toFixed(2))
            : '—';
          return (
            <tr key={bond.isin || i}>
              <td title={bond.issuer}>{(bond.issuer || '—').slice(0, 20)}</td>
              <td>{coupon}%</td>
              <td>{bond.maturity || '—'}</td>
              <td className={yieldClass(bond.yield)}>{fmtYield(bond.yield)}</td>
              <td><span className="fi-rating fi-rating--ig">{bond.rating || 'IG'}</span></td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 6: HY Corporate Bonds
   ═══════════════════════════════════════════════════════════════════════════ */

function HYCorporateSection() {
  const { data: bonds, loading, error, refresh } = useSectionData({
    cacheKey: 'fi-corp-hy',
    fetcher: () => fetchCorporateBonds('HY', 15),
  });

  if (loading) return <FISkeleton rows={8} />;
  if (error) return <DataUnavailable reason={error} onRetry={refresh} />;
  if (!bonds || bonds.length === 0) return <DataUnavailable reason="No HY bonds" onRetry={refresh} />;

  return (
    <table className="fi-table">
      <thead>
        <tr>
          <th>Issuer</th>
          <th>Coupon</th>
          <th>Maturity</th>
          <th>Yield</th>
          <th>Rating</th>
        </tr>
      </thead>
      <tbody>
        {(Array.isArray(bonds) ? bonds : []).map((bond, i) => {
          const coupon = bond.coupon != null
            ? (typeof bond.coupon === 'number' && bond.coupon < 1
                ? (bond.coupon * 100).toFixed(2)
                : parseFloat(bond.coupon).toFixed(2))
            : '—';
          return (
            <tr key={bond.isin || i}>
              <td title={bond.issuer}>{(bond.issuer || '—').slice(0, 20)}</td>
              <td>{coupon}%</td>
              <td>{bond.maturity || '—'}</td>
              <td className={yieldClass(bond.yield)}>{fmtYield(bond.yield)}</td>
              <td><span className="fi-rating fi-rating--hy">{bond.rating || 'HY'}</span></td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 7: Spread Dashboard
   ═══════════════════════════════════════════════════════════════════════════ */

function SpreadDashboardSection() {
  const comps = ['DE', 'GB', 'JP', 'BR', 'MX', 'IT', 'AU'];
  const { data: spreadsData, loading, error, refresh } = useSectionData({
    cacheKey: 'fi-spreads',
    fetcher: () => fetchSpreads('US', comps, '10Y'),
  });

  if (loading) return <FISkeleton rows={4} />;
  if (error) return <DataUnavailable reason={error} onRetry={refresh} />;
  if (!spreadsData) return <DataUnavailable reason="No spreads" onRetry={refresh} />;

  const spreads = spreadsData.spreads || [];

  return (
    <div className="fi-spreads-grid">
      {(Array.isArray(spreads) ? spreads : []).slice(0, 6).map(s => {
        const spreadCls = s.spread > 0 ? 'fi-spread--pos' : 'fi-spread--neg';
        return (
          <div key={s.country} className="fi-spread-card">
            <div className="fi-spread-card-country">{s.country}</div>
            <div className="fi-spread-card-yield">{fmtYield(s.yield)}</div>
            <div className={`fi-spread-card-bps fi-spread ${spreadCls}`}>
              {s.spread != null ? (s.spread > 0 ? '+' : '') + s.spread.toFixed(0) + ' bps' : '—'}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 8: Bond ETF Comparison Grid
   ═══════════════════════════════════════════════════════════════════════════ */

const ETFTickerCell = memo(function ETFTickerCell({ symbol, onClick }) {
  const quote = useTickerPrice(symbol);
  const price = quote?.price;
  const changePct = quote?.changePct;

  return (
    <div
      className="ds-ticker-cell"
      onClick={() => onClick?.(symbol)}
      title={symbol}
      style={{ cursor: 'pointer' }}
    >
      <span className="ds-ticker-sym">{symbol}</span>
      {price != null && (
        <span className="ds-ticker-price">
          {price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </span>
      )}
      {changePct != null && (
        <span className={`ds-ticker-chg ${changePct >= 0 ? 'up' : 'down'}`}>
          {changePct >= 0 ? '+' : ''}{changePct.toFixed(2)}%
        </span>
      )}
    </div>
  );
});

function BondETFGridSection() {
  const openDetail = useOpenDetail();
  const handleClick = useCallback((sym) => {
    if (openDetail) openDetail(sym, 'Fixed Income');
  }, [openDetail]);

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))',
      gap: '8px',
      padding: '0 10px',
    }}>
      {BOND_ETF_TICKERS.map(sym => (
        <ETFTickerCell
          key={sym}
          symbol={sym}
          onClick={handleClick}
        />
      ))}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 9: Duration Risk Calculator
   ═══════════════════════════════════════════════════════════════════════════ */

function DurationRiskCalculator() {
  const [shortPct, setShortPct] = useState(20);
  const [midPct, setMidPct] = useState(50);
  const [longPct, setLongPct] = useState(30);

  const shortDuration = 2;  // 2-year
  const midDuration = 5;    // 5-year
  const longDuration = 20;  // 20-year

  const portfolioDuration = (
    (shortPct / 100) * shortDuration +
    (midPct / 100) * midDuration +
    (longPct / 100) * longDuration
  );

  // P&L scenarios for 25bp, 50bp, 100bp moves
  const pnl25 = -portfolioDuration * 0.25;
  const pnl50 = -portfolioDuration * 0.50;
  const pnl100 = -portfolioDuration * 1.00;

  const handleShortChange = (e) => {
    const val = parseInt(e.target.value, 10);
    setShortPct(val);
    const remaining = 100 - val;
    const midVal = Math.round(remaining * 0.625);
    setMidPct(midVal);
    setLongPct(remaining - midVal);
  };

  const handleMidChange = (e) => {
    const val = parseInt(e.target.value, 10);
    setMidPct(val);
    const remaining = 100 - val;
    const longVal = Math.round(remaining * 0.6);
    setLongPct(longVal);
    setShortPct(remaining - longVal);
  };

  const handleLongChange = (e) => {
    const val = parseInt(e.target.value, 10);
    setLongPct(val);
    const remaining = 100 - val;
    const shortVal = Math.round(remaining * 0.4);
    setShortPct(shortVal);
    setMidPct(remaining - shortVal);
  };

  return (
    <div style={{ padding: '0 10px' }}>
      <div style={{ marginBottom: '12px' }}>
        <div style={{ fontSize: '9px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
          Short (2Y): {shortPct}%
        </div>
        <input
          type="range"
          min="0"
          max="100"
          value={shortPct}
          onChange={handleShortChange}
          style={{ width: '100%' }}
        />
      </div>

      <div style={{ marginBottom: '12px' }}>
        <div style={{ fontSize: '9px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
          Mid (5Y): {midPct}%
        </div>
        <input
          type="range"
          min="0"
          max="100"
          value={midPct}
          onChange={handleMidChange}
          style={{ width: '100%' }}
        />
      </div>

      <div style={{ marginBottom: '12px' }}>
        <div style={{ fontSize: '9px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
          Long (20Y): {longPct}%
        </div>
        <input
          type="range"
          min="0"
          max="100"
          value={longPct}
          onChange={handleLongChange}
          style={{ width: '100%' }}
        />
      </div>

      <div style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-default)',
        borderRadius: '3px',
        padding: '8px',
        marginBottom: '8px',
      }}>
        <div style={{ fontSize: '9px', color: 'var(--text-secondary)', marginBottom: '2px' }}>
          Portfolio Duration
        </div>
        <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--semantic-info)' }}>
          {portfolioDuration.toFixed(2)} years
        </div>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: '6px',
      }}>
        <div style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-default)',
          borderRadius: '3px',
          padding: '6px',
        }}>
          <div style={{ fontSize: '8px', color: 'var(--text-secondary)' }}>+25bp</div>
          <div style={{
            fontSize: '11px',
            fontWeight: 600,
            color: pnl25 < 0 ? 'var(--semantic-down)' : 'var(--semantic-up)',
          }}>
            {pnl25.toFixed(3)}%
          </div>
        </div>
        <div style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-default)',
          borderRadius: '3px',
          padding: '6px',
        }}>
          <div style={{ fontSize: '8px', color: 'var(--text-secondary)' }}>+50bp</div>
          <div style={{
            fontSize: '11px',
            fontWeight: 600,
            color: pnl50 < 0 ? 'var(--semantic-down)' : 'var(--semantic-up)',
          }}>
            {pnl50.toFixed(3)}%
          </div>
        </div>
        <div style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-default)',
          borderRadius: '3px',
          padding: '6px',
        }}>
          <div style={{ fontSize: '8px', color: 'var(--text-secondary)' }}>+100bp</div>
          <div style={{
            fontSize: '11px',
            fontWeight: 600,
            color: pnl100 < 0 ? 'var(--semantic-down)' : 'var(--semantic-up)',
          }}>
            {pnl100.toFixed(3)}%
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 10: Central Bank Rates
   ═══════════════════════════════════════════════════════════════════════════ */

const CB_RATES_TEMPLATE = [
  { bank: 'Federal Reserve', tenor: 'Fed Funds', fredId: 'FEDFUNDS', flag: '🇺🇸', key: 'fed' },
  { bank: 'ECB', tenor: 'Main Refi', flag: '🇪🇺', key: 'ecb' },
  { bank: 'Bank of England', tenor: 'Base Rate', flag: '🇬🇧', key: 'boe' },
  { bank: 'Bank of Japan', tenor: 'Policy Rate', flag: '🇯🇵', key: 'boj' },
  { bank: 'PBOC', tenor: 'LPR 1Y', flag: '🇨🇳', key: 'pboc' },
  { bank: 'BCB (Brazil)', tenor: 'Selic', flag: '🇧🇷', key: 'bcb' },
];

function CentralBankRatesSection() {
  const [rates, setRates] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchRates = async () => {
      try {
        setLoading(true);
        setError(null);
        const res = await apiFetch('/api/snapshot/rates');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setRates(data);
      } catch (err) {
        console.error('Failed to fetch central bank rates:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchRates();
    // Refresh every 10 minutes
    const interval = setInterval(fetchRates, 600000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div style={{ padding: '0 10px' }}>
      <table className="ds-table" style={{ width: '100%' }}>
        <thead>
          <tr>
            <th>Central Bank</th>
            <th>Rate</th>
            <th>Type</th>
            <th>As Of</th>
          </tr>
        </thead>
        <tbody>
          {CB_RATES_TEMPLATE.map((cb, idx) => {
            const rateData = rates[cb.key];
            const rate = rateData?.rate;
            const date = rateData?.date;

            return (
              <tr key={idx}>
                <td style={{ fontWeight: 500, color: 'var(--text-primary)' }}>
                  <span style={{ marginRight: 4 }}>{cb.flag}</span>{cb.bank}
                </td>
                <td style={{ color: 'var(--semantic-info)', fontWeight: 600 }}>
                  {loading ? 'Loading...' : (rate != null ? rate.toFixed(2) + '%' : '—')}
                </td>
                <td style={{ fontSize: 9, color: 'var(--text-secondary)' }}>{cb.tenor}</td>
                <td style={{ fontSize: 9, color: 'var(--text-muted)' }}>{date || '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div style={{ fontSize: 8, color: 'var(--text-muted)', marginTop: 6, textAlign: 'right' }}>
        {error
          ? <span style={{ color: 'var(--semantic-down)' }}>Live policy rates unavailable — retrying shortly.</span>
          : 'Policy rates fetched from central bank feeds.'}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 11: EUR Bond ETFs
   ═══════════════════════════════════════════════════════════════════════════ */

function EurBondETFCell({ ticker }) {
  const p = useTickerPrice(ticker);
  const openDetail = useOpenDetail();
  const label = {
    'IEAC.L': 'iShares EUR Corp',
    'IHYG.L': 'iShares EUR HY',
    'EUNT.DE': 'iShares EUR Govt',
    'XG7S.DE': 'Xtrackers EUR Govt',
    'XBLC.DE': 'Xtrackers EUR Corp',
  }[ticker] || ticker;

  return (
    <div
      onClick={() => openDetail(ticker, 'Fixed Income')}
      onTouchStart={tapStart}
      onTouchMove={tapMove}
      onTouchEnd={(e) => tapEnd(e, () => openDetail(ticker, 'Fixed Income'))}
      style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-default)',
        borderRadius: 3,
        padding: '8px',
        cursor: 'pointer',
        transition: 'border-color 0.15s',
      }}
    >
      <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 2 }}>{ticker}</div>
      <div style={{ fontSize: 8, color: 'var(--text-secondary)', marginBottom: 4 }}>{label}</div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ fontSize: 11, color: 'var(--text-primary)', fontWeight: 500 }}>
          {p?.price ? p.price.toFixed(2) : '—'}
        </span>
        <span style={{
          fontSize: 9,
          color: (p?.change_pct ?? 0) >= 0 ? 'var(--semantic-up)' : 'var(--semantic-down)',
          fontWeight: 500,
        }}>
          {p?.change_pct != null ? (p.change_pct >= 0 ? '+' : '') + p.change_pct.toFixed(2) + '%' : '—'}
        </span>
      </div>
    </div>
  );
}

function EurBondETFSection() {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
      gap: 6,
      padding: '0 10px',
    }}>
      {EUR_BOND_ETFS.map(t => <EurBondETFCell key={t} ticker={t} />)}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   KPI RIBBON
   ═══════════════════════════════════════════════════════════════════════════ */

function FixedIncomeKPIRibbon() {
  const tlt = useTickerPrice('TLT');
  const agg = useTickerPrice('AGG');
  const hyg = useTickerPrice('HYG');
  const lqd = useTickerPrice('LQD');
  const f = (n) => n == null ? '—' : '$' + n.toFixed(2);
  const items = [
    { label: 'US 20Y+ BOND', value: tlt?.price != null ? f(tlt.price) : '—', change: tlt?.changePct },
    { label: 'AGG (TOTAL)',   value: agg?.price != null ? f(agg.price) : '—', change: agg?.changePct },
    { label: 'HIGH YIELD',    value: hyg?.price != null ? f(hyg.price) : '—', change: hyg?.changePct },
    { label: 'IG CORPORATE',  value: lqd?.price != null ? f(lqd.price) : '—', change: lqd?.changePct },
  ];
  return <KPIRibbon items={items} accentColor="#2196f3" />;
}

/* ═══════════════════════════════════════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════════════════════════════════════ */

function FixedIncomeScreenImpl({ onBack }) {
  const sections = [
    {
      id: 'kpi',
      title: 'KEY METRICS',
      span: 'full',
      component: FixedIncomeKPIRibbon,
    },
    {
      id: 'sector-charts',
      title: 'Bond ETF Sector Charts',
      span: 'full',
      component: SectorChartsSection,
      badge: '6 ETFs',
    },
    {
      id: 'us-curve',
      title: 'US Treasury Curve',
      component: USTreasuryCurveSection,
      badge: '2s10s',
    },
    {
      id: 'multi-curves',
      title: 'Multi-Country Curves',
      component: MultiCountryCurvesSection,
      badge: '4 Countries',
    },
    {
      id: 'sovereign-grid',
      title: 'Sovereign Yield Grid',
      span: 'full',
      component: SovereignYieldGridSection,
      badge: '12 Countries',
    },
    {
      id: 'ig-corp',
      title: 'Investment Grade Bonds',
      component: IGCorporateSection,
      badge: 'IG',
    },
    {
      id: 'hy-corp',
      title: 'High Yield Bonds',
      component: HYCorporateSection,
      badge: 'HY',
    },
    {
      id: 'spreads',
      title: 'Spread Dashboard',
      span: 'full',
      component: SpreadDashboardSection,
      badge: 'vs US 10Y',
    },
    {
      id: 'cb-rates',
      title: 'Central Bank Rates',
      component: CentralBankRatesSection,
      badge: '6 Banks',
    },
    {
      id: 'etf-grid',
      title: 'Bond ETF Comparison',
      span: 'full',
      component: BondETFGridSection,
      badge: '10 ETFs',
    },
    {
      id: 'eur-etfs',
      title: 'EUR Bond ETFs',
      component: EurBondETFSection,
      badge: '5 ETFs',
    },
    {
      id: 'duration',
      title: 'Duration Risk Calculator',
      span: 'full',
      component: DurationRiskCalculator,
      badge: 'Interactive',
    },
  ];

  return (
    <FullPageScreenLayout
      title="FIXED INCOME"
      subtitle="Treasury curves, credit spreads, corporate bonds, and duration analysis"
      accentColor="#2196f3"
      vaultSector="fixed-income"
      onBack={onBack}
      sections={sections}
      tickerBanner={BANNER_TICKERS}
      aiType="yield-curve"
      aiContext={{ scope: 'Fixed Income & Rates' }}
      aiCacheKey="yield-curve:overview"
    />
  );
}

export default memo(FixedIncomeScreenImpl);
