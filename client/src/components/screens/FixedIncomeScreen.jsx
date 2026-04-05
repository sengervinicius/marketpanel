/**
 * FixedIncomeScreen.jsx — Phase D2
 * Bloomberg-style Fixed Income deep screen.
 *
 * 5 data sections in a 2x2 grid + full-width ETF strip:
 *   Top-left:     Sovereign Yield Grid (16 countries)
 *   Top-right:    IG Corporate Bonds (top 50)
 *   Bottom-left:  Spreads & Curves (vs US 10Y)
 *   Bottom-right: HY Corporate Bonds (top 50)
 *   Full-width:   Bond ETF Strip
 *
 * Uses ONLY existing backend endpoints — no new routes.
 * Per-section independent loading/error states.
 */

import { useState, useEffect, useCallback, memo, useMemo } from 'react';
import SectorChartStrip from './SectorChartStrip';
import DataUnavailable from '../common/DataUnavailable';
import { useTickerPrice } from '../../context/PriceContext';
import { useOpenDetail } from '../../context/OpenDetailContext';
import { apiFetch } from '../../utils/api';
import './FixedIncomeScreen.css';

/* ═══════════════════════════════════════════════════════════════════════════
   CONSTANTS
   ═══════════════════════════════════════════════════════════════════════════ */

const CHART_TICKERS = ['TLT', 'IEF', 'AGG', 'LQD', 'HYG', 'EMB', 'TIP', 'SHY'];

const SOVEREIGN_COUNTRIES = [
  'US', 'DE', 'GB', 'FR', 'IT', 'ES', 'PT', 'NL',
  'JP', 'AU', 'BR', 'MX', 'IN', 'ZA', 'TR', 'CA',
];

const SPREAD_COMPARISONS = ['DE', 'GB', 'JP', 'BR', 'MX', 'IT', 'AU', 'CA', 'IN', 'ZA', 'TR', 'FR'];

const COUNTRY_LABELS = {
  US: 'United States', DE: 'Germany', GB: 'United Kingdom', FR: 'France',
  IT: 'Italy', ES: 'Spain', PT: 'Portugal', NL: 'Netherlands',
  JP: 'Japan', AU: 'Australia', BR: 'Brazil', MX: 'Mexico',
  IN: 'India', ZA: 'South Africa', TR: 'Turkey', CA: 'Canada',
};

const BOND_ETFS = ['AGG', 'BND', 'TLT', 'IEF', 'SHY', 'LQD', 'HYG', 'EMB', 'TIP', 'MUB'];

const TENORS = ['2Y', '5Y', '10Y', '30Y'];

const REFRESH_INTERVAL = 120_000; // 2 minutes

/* ═══════════════════════════════════════════════════════════════════════════
   HOOKS
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Generic data-fetching hook with loading/error/data states.
 * Auto-refreshes on interval with timeout handling.
 */
function useSectionData(fetchFn, deps = []) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    // Create a timeout promise that rejects after 15 seconds
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Data fetch timeout')), 15000)
    );

    try {
      const result = await Promise.race([fetchFn(), timeoutPromise]);
      setData(result);
    } catch (e) {
      setError(e.message || 'Failed to load data');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    setLoading(true);
    load();
    const id = setInterval(load, REFRESH_INTERVAL);
    return () => clearInterval(id);
  }, [load]);

  return { data, loading, error, refresh: load };
}

/* ═══════════════════════════════════════════════════════════════════════════
   DATA FETCHERS
   ═══════════════════════════════════════════════════════════════════════════ */

async function fetchSovereignData() {
  const [curvesRes, macroRes] = await Promise.all([
    apiFetch(`/api/bonds/yield-curves?countries=${SOVEREIGN_COUNTRIES.join(',')}`),
    apiFetch(`/api/macro/compare?countries=${SOVEREIGN_COUNTRIES.join(',')}&indicators=policyRate,cpiYoY`),
  ]);

  const curvesJson = curvesRes.ok ? await curvesRes.json() : { curves: [] };
  const macroJson = macroRes.ok ? await macroRes.json() : { ok: false };

  // Index curves by country
  const curveMap = {};
  for (const c of curvesJson.curves || []) {
    curveMap[c.country] = c;
  }

  // Index macro by country
  const macroMap = {};
  if (macroJson.ok && macroJson.data?.countries) {
    for (const row of macroJson.data.countries) {
      macroMap[row.country] = row;
    }
  }

  return SOVEREIGN_COUNTRIES.map(code => {
    const curve = curveMap[code];
    const macro = macroMap[code];
    const yields = {};

    // Extract yields by tenor from curve data
    if (curve?.curve && Array.isArray(curve.curve)) {
      for (const pt of curve.curve) {
        const t = pt.tenor || pt.maturity || pt.term;
        if (t && pt.yield != null) yields[t] = pt.yield;
      }
    }

    return {
      country: code,
      name: COUNTRY_LABELS[code] || code,
      yields,
      policyRate: macro?.policyRate ?? null,
      cpiYoY: macro?.cpiYoY ?? null,
      source: curve?.source || 'unavailable',
    };
  });
}

async function fetchCorporateData(rating) {
  const res = await apiFetch(`/api/bonds/corporate?rating=${rating}&limit=50`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  return json.bonds || [];
}

async function fetchSpreadsData() {
  const res = await apiFetch(
    `/api/bonds/spreads?base=US&comparisons=${SPREAD_COMPARISONS.join(',')}&tenor=10Y`
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchEtfData() {
  const res = await apiFetch('/api/bonds/etfs');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  return json.etfs || [];
}

/* ═══════════════════════════════════════════════════════════════════════════
   SUB-COMPONENTS
   ═══════════════════════════════════════════════════════════════════════════ */

/* ── Skeleton loader ─────────────────────────────────────────────────────── */
function SectionSkeleton({ rows = 6 }) {
  return (
    <div className="fi-skeleton">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="fi-skeleton-row" style={{ width: `${90 - i * 5}%` }} />
      ))}
    </div>
  );
}

/* ── Error banner ────────────────────────────────────────────────────────── */
function SectionError({ message }) {
  return <div className="fi-error">{message}</div>;
}

/* ── Yield display helper ────────────────────────────────────────────────── */
function yieldClass(val) {
  if (val == null) return 'fi-yield';
  if (val > 0.08) return 'fi-yield fi-yield--vhigh';
  if (val > 0.05) return 'fi-yield fi-yield--high';
  return 'fi-yield';
}

function fmtYield(val) {
  if (val == null) return '—';
  // If value looks like a decimal fraction (0.05 = 5%), display as percentage
  if (Math.abs(val) < 1) return (val * 100).toFixed(2) + '%';
  // Otherwise assume it's already in percentage terms
  return val.toFixed(2) + '%';
}

function fmtPct(val) {
  if (val == null) return '—';
  if (Math.abs(val) < 1) return (val * 100).toFixed(1) + '%';
  return val.toFixed(1) + '%';
}

/* ── Sovereign Grid Table ────────────────────────────────────────────────── */
const SovereignGridTable = memo(function SovereignGridTable({ data, loading, error, onRetry }) {
  if (loading) return <SectionSkeleton rows={8} />;
  if (error) return <DataUnavailable reason={error} onRetry={onRetry} />;
  if (!data || data.length === 0) return <DataUnavailable reason="No sovereign data available" onRetry={onRetry} />;

  return (
    <table className="fi-table">
      <thead>
        <tr>
          <th>Country</th>
          {TENORS.map(t => <th key={t}>{t}</th>)}
          <th>Policy</th>
          <th>CPI YoY</th>
        </tr>
      </thead>
      <tbody>
        {data.map(row => (
          <tr key={row.country}>
            <td title={row.name}>{row.country}</td>
            {TENORS.map(t => (
              <td key={t} className={yieldClass(row.yields[t])}>
                {fmtYield(row.yields[t])}
              </td>
            ))}
            <td className={yieldClass(row.policyRate)}>{fmtPct(row.policyRate)}</td>
            <td>{fmtPct(row.cpiYoY)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
});

/* ── Corporate Bond Table ────────────────────────────────────────────────── */
const CorporateTable = memo(function CorporateTable({ data, loading, error, ratingType, onRetry }) {
  if (loading) return <SectionSkeleton rows={8} />;
  if (error) return <DataUnavailable reason={error} onRetry={onRetry} />;
  if (!data || data.length === 0) return <DataUnavailable reason={`No ${ratingType} bonds available`} onRetry={onRetry} />;

  return (
    <table className="fi-table">
      <thead>
        <tr>
          <th>Issuer</th>
          <th>Coupon</th>
          <th>Maturity</th>
          <th>Yield</th>
          <th>Spread</th>
          <th>Rating</th>
        </tr>
      </thead>
      <tbody>
        {data.map((bond, i) => {
          const key = bond.isin || bond.id || `${ratingType}-${i}`;
          const ratingCls = ratingType === 'IG' ? 'fi-rating fi-rating--ig' : 'fi-rating fi-rating--hy';
          return (
            <tr key={key}>
              <td title={bond.issuer || bond.name}>{(bond.issuer || bond.name || '—').slice(0, 20)}</td>
              <td>{bond.coupon != null ? (typeof bond.coupon === 'number' && bond.coupon < 1 ? (bond.coupon * 100).toFixed(2) : bond.coupon.toFixed?.(2) ?? bond.coupon) + '%' : '—'}</td>
              <td>{bond.maturity || bond.maturityDate || '—'}</td>
              <td className={yieldClass(bond.yield)}>{fmtYield(bond.yield)}</td>
              <td>{bond.spread != null ? bond.spread + ' bps' : '—'}</td>
              <td><span className={ratingCls}>{bond.rating || '—'}</span></td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
});

/* ── Spreads & Curves Panel ──────────────────────────────────────────────── */
const SpreadsPanel = memo(function SpreadsPanel({ data, loading, error, onRetry }) {
  if (loading) return <SectionSkeleton rows={6} />;
  if (error) return <DataUnavailable reason={error} onRetry={onRetry} />;
  if (!data) return <DataUnavailable reason="No spread data available" onRetry={onRetry} />;

  const base = data.base;
  const spreads = data.spreads || [];

  return (
    <div>
      {base && (
        <div className="fi-base-label">
          BASE: {base.country} {base.tenor} — {base.yield != null ? fmtYield(base.yield) : 'N/A'}
        </div>
      )}
      {spreads.length > 0 ? (
        <div className="fi-spreads-grid">
          {spreads.map(s => {
            const spreadCls = s.spread > 0 ? 'fi-spread--pos' : s.spread < 0 ? 'fi-spread--neg' : 'fi-spread--flat';
            return (
              <div key={s.country} className="fi-spread-card">
                <div className="fi-spread-card-country">
                  {s.country}
                  <span style={{ fontWeight: 400, opacity: 0.6, marginLeft: 4, fontSize: 8 }}>
                    {COUNTRY_LABELS[s.country] || ''}
                  </span>
                </div>
                <div className="fi-spread-card-yield">{fmtYield(s.yield)}</div>
                <div className={`fi-spread-card-bps fi-spread ${spreadCls}`}>
                  {s.spread != null ? (s.spread > 0 ? '+' : '') + s.spread.toFixed(1) + ' bps' : '—'}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <DataUnavailable reason="No spread comparisons available" onRetry={onRetry} />
      )}
    </div>
  );
});

/* ── Bond ETF Card (uses live price) ─────────────────────────────────────── */
const EtfCard = memo(function EtfCard({ symbol, etfData, onClick }) {
  const quote = useTickerPrice(symbol);
  const price = quote?.price ?? etfData?.price ?? etfData?.last ?? null;
  const pct = quote?.changePct ?? etfData?.changePct ?? null;

  return (
    <div className="fi-etf-card" onClick={() => onClick?.(symbol)}>
      <span className="fi-etf-sym">{symbol}</span>
      {price != null && (
        <span className="fi-etf-price">
          {price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </span>
      )}
      {pct != null && (
        <span className={`fi-etf-chg ${pct >= 0 ? 'up' : 'down'}`}>
          {pct >= 0 ? '+' : ''}{pct.toFixed(2)}%
        </span>
      )}
    </div>
  );
});

/* ── Bond ETF Strip ──────────────────────────────────────────────────────── */
const BondEtfStrip = memo(function BondEtfStrip({ data, loading, error, onTickerClick, onRetry }) {
  // Merge API data with live prices
  const etfMap = useMemo(() => {
    const m = {};
    if (data && Array.isArray(data)) {
      for (const e of data) m[e.symbol] = e;
    }
    return m;
  }, [data]);

  if (error) {
    return (
      <div className="fi-etf-strip-wrap">
        <div className="fi-etf-strip-head">
          <span className="fi-section-title">Bond ETFs</span>
        </div>
        <div className="fi-etf-strip">
          <DataUnavailable reason={error} onRetry={onRetry} />
        </div>
      </div>
    );
  }

  return (
    <div className="fi-etf-strip-wrap">
      <div className="fi-etf-strip-head">
        <span className="fi-section-title">Bond ETFs</span>
        {loading && <span className="fi-section-badge">Loading...</span>}
      </div>
      <div className="fi-etf-strip">
        {BOND_ETFS.map(sym => (
          <EtfCard
            key={sym}
            symbol={sym}
            etfData={etfMap[sym]}
            onClick={onTickerClick}
          />
        ))}
      </div>
    </div>
  );
});

/* ═══════════════════════════════════════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════════════════════════════════════ */

function FixedIncomeScreen({ onTickerClick }) {
  const openDetail = useOpenDetail();
  const [lastUpdated, setLastUpdated] = useState(null);

  // Independent data for each section
  const sovereign = useSectionData(fetchSovereignData, []);
  const igCorp = useSectionData(() => fetchCorporateData('IG'), []);
  const hyCorp = useSectionData(() => fetchCorporateData('HY'), []);
  const spreads = useSectionData(fetchSpreadsData, []);
  const etfs = useSectionData(fetchEtfData, []);

  // Update timestamp whenever any section finishes loading
  useEffect(() => {
    const anyLoaded = !sovereign.loading || !igCorp.loading || !hyCorp.loading || !spreads.loading;
    if (anyLoaded) {
      setLastUpdated(new Date());
    }
  }, [sovereign.loading, igCorp.loading, hyCorp.loading, spreads.loading]);

  const handleClick = openDetail || onTickerClick;

  return (
    <div className="fi-screen">
      {/* Minimal header */}
      <div className="fi-header">
        <div className="fi-header-accent" />
        <div className="fi-header-title">Fixed Income & Credit</div>
        {lastUpdated && (
          <div className="fi-header-updated">
            Last updated: {lastUpdated.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}
          </div>
        )}
      </div>

      {/* 2x2 Grid */}
      <div className="fi-grid">
        {/* Top-left: Sovereign Grid */}
        <div className="fi-section">
          <div className="fi-section-head">
            <span className="fi-section-title">Sovereign Yields</span>
            <span className="fi-section-badge">{SOVEREIGN_COUNTRIES.length} countries</span>
          </div>
          <div className="fi-section-body">
            <SovereignGridTable
              data={sovereign.data}
              loading={sovereign.loading}
              error={sovereign.error}
              onRetry={sovereign.refresh}
            />
          </div>
        </div>

        {/* Top-right: IG Corporate */}
        <div className="fi-section">
          <div className="fi-section-head">
            <span className="fi-section-title">Investment Grade</span>
            <span className="fi-section-badge">IG</span>
          </div>
          <div className="fi-section-body">
            <CorporateTable
              data={igCorp.data}
              loading={igCorp.loading}
              error={igCorp.error}
              ratingType="IG"
              onRetry={igCorp.refresh}
            />
          </div>
        </div>

        {/* Bottom-left: Spreads & Curves */}
        <div className="fi-section">
          <div className="fi-section-head">
            <span className="fi-section-title">Yield Spreads vs US 10Y</span>
            <span className="fi-section-badge">bps</span>
          </div>
          <div className="fi-section-body">
            <SpreadsPanel
              data={spreads.data}
              loading={spreads.loading}
              error={spreads.error}
              onRetry={spreads.refresh}
            />
          </div>
        </div>

        {/* Bottom-right: HY Corporate */}
        <div className="fi-section">
          <div className="fi-section-head">
            <span className="fi-section-title">High Yield</span>
            <span className="fi-section-badge">HY</span>
          </div>
          <div className="fi-section-body">
            <CorporateTable
              data={hyCorp.data}
              loading={hyCorp.loading}
              error={hyCorp.error}
              ratingType="HY"
              onRetry={hyCorp.refresh}
            />
          </div>
        </div>
      </div>

      {/* Sector Chart Strip */}
      <SectorChartStrip tickers={CHART_TICKERS} title="FIXED INCOME CHARTS" />

      {/* Full-width ETF Strip */}
      <BondEtfStrip
        data={etfs.data}
        loading={etfs.loading}
        error={etfs.error}
        onTickerClick={handleClick}
        onRetry={etfs.refresh}
      />
    </div>
  );
}

export default memo(FixedIncomeScreen);
