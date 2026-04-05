/**
 * GlobalMacroScreen.jsx — S4.2 + S4.8
 * Deep Bloomberg-style Global Macro coverage screen.
 * Sections: Global Snapshot, Volatility & Risk, FX & Yield Linkage, Key Indexes
 * S4.8: Added VIX/MOVE, 2s10s spread, PMI data
 */
import { memo } from 'react';
import DeepScreenBase, { DeepSection, DeepSkeleton, DeepError, TickerCell } from './DeepScreenBase';
import SectorChartStrip from './SectorChartStrip';
import useSectionData from '../../hooks/useSectionData';
import { useOpenDetail } from '../../context/OpenDetailContext';
import { useTickerPrice } from '../../context/PriceContext';
import { apiFetch } from '../../utils/api';

const CHART_TICKERS = ['SPY', 'EEM', 'EWZ', 'FXI', 'C:EURUSD', 'C:USDJPY', 'GC=F', 'TLT'];

const fmt = (n, d = 2) =>
  n == null ? '—' : n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtPct = (n) => n == null ? '—' : (n >= 0 ? '+' : '') + n.toFixed(2) + '%';

/* ─────────────────────────────────────────────────────────────────────── */
/* GLOBAL SNAPSHOT */
/* ─────────────────────────────────────────────────────────────────────── */
function GlobalSnapshot() {
  const openDetail = useOpenDetail();
  const { data, loading, error } = useSectionData({
    cacheKey: 'screen:macro:snapshot',
    fetcher: async () => {
      const res = await apiFetch('/api/macro/compare?countries=US,EU,DE,FR,IT,GB,JP,CN,BR,MX,IN,ZA&indicators=policyRate,cpiYoY,gdpGrowth,unemploymentRate');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
  });

  if (loading) return <DeepSkeleton rows={8} />;
  if (error) return <DeepError message={error} />;
  if (!data || !Array.isArray(data)) return <DeepError message="No data" />;

  const getCpiColor = (val) => {
    if (val == null) return '';
    if (val > 4) return '#d32f2f';
    if (val > 3) return '#f57c00';
    if (val > 2) return '#388e3c';
    return '';
  };

  const getUneColor = (val) => {
    if (val == null) return '';
    if (val < 3.5) return '#388e3c';
    if (val < 4.5) return '#f57c00';
    return '#d32f2f';
  };

  return (
    <table className="ds-table">
      <thead>
        <tr>
          <th>Country</th>
          <th title="Central Bank Policy Rate">Rate (%)</th>
          <th title="Consumer Price Index YoY">CPI YoY (%)</th>
          <th title="GDP Growth">GDP Gr. (%)</th>
          <th title="Unemployment Rate">Unemp. (%)</th>
        </tr>
      </thead>
      <tbody>
        {data.map((row) => (
          <tr key={row.country || row.code}>
            <td className="ds-ticker-col" onClick={() => openDetail(row.country)}>
              {row.country || row.code}
            </td>
            <td>{fmt(row.policyRate, 2)}</td>
            <td style={{ color: getCpiColor(row.cpiYoY) }}>{fmt(row.cpiYoY, 2)}</td>
            <td>{fmt(row.gdpGrowth, 2)}</td>
            <td style={{ color: getUneColor(row.unemploymentRate) }}>{fmt(row.unemploymentRate, 2)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ─────────────────────────────────────────────────────────────────────── */
/* S4.8.A — VOLATILITY & RISK */
/* ─────────────────────────────────────────────────────────────────────── */
const VOL_TICKERS = [
  { symbol: 'VIX',   label: 'CBOE VIX',      thresholds: [15, 25] },
  { symbol: 'VVIX',  label: 'VIX of VIX',    thresholds: [80, 120] },
  { symbol: 'GVZ',   label: 'Gold Vol',       thresholds: [15, 25] },
];

function VolatilitySection() {
  const openDetail = useOpenDetail();

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {VOL_TICKERS.map(({ symbol, label, thresholds }) => (
        <VolCard key={symbol} symbol={symbol} label={label} thresholds={thresholds} openDetail={openDetail} />
      ))}
      {/* TLT as MOVE proxy */}
      <VolCard symbol="TLT" label="TLT (MOVE proxy)" thresholds={[85, 100]} openDetail={openDetail} />
    </div>
  );
}

function VolCard({ symbol, label, thresholds, openDetail }) {
  const q = useTickerPrice(symbol);
  const level = q?.price;
  const color = level == null ? '#888' : level < thresholds[0] ? '#388e3c' : level < thresholds[1] ? '#f57c00' : '#d32f2f';

  return (
    <div
      onClick={() => openDetail(symbol)}
      style={{
        background: '#0a0a1a', border: `1px solid ${color}44`, borderRadius: 6,
        padding: '10px 14px', minWidth: 120, cursor: 'pointer', flex: '1 1 120px',
      }}
    >
      <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color }}>{level != null ? fmt(level, 1) : '—'}</div>
      <div style={{ fontSize: 11, color: q?.changePct >= 0 ? '#66bb6a' : '#ef5350' }}>
        {q?.changePct != null ? fmtPct(q.changePct) : '—'}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────── */
/* FX & YIELD LINKAGE + S4.8.B 2s10s spread */
/* ─────────────────────────────────────────────────────────────────────── */
function FxYieldSection() {
  const openDetail = useOpenDetail();
  const fxPairs = ['C:EURUSD', 'C:USDJPY', 'C:GBPUSD', 'C:USDCNY', 'C:USDBRL', 'C:USDINR', 'C:USDZAR'];

  // Fetch yield data for 2s10s spread
  const { data: yieldData } = useSectionData({
    cacheKey: 'macro:yields-2s10s',
    fetcher: async () => {
      const res = await apiFetch('/api/bonds/yield-curves?countries=US');
      return res.ok ? await res.json() : null;
    },
    refreshMs: 300000,
  });

  // Calculate 2s10s spread from yield data
  let spread2s10s = null;
  if (yieldData) {
    const usData = yieldData?.US || yieldData?.data?.US || yieldData;
    if (Array.isArray(usData)) {
      const y2  = usData.find(p => p.tenor === '2Y' || p.maturity === '2Y');
      const y10 = usData.find(p => p.tenor === '10Y' || p.maturity === '10Y');
      if (y2?.yield != null && y10?.yield != null) {
        spread2s10s = ((y10.yield - y2.yield) * 100).toFixed(0); // in bp
      }
    }
  }

  return (
    <>
      {spread2s10s != null && (
        <div style={{
          background: spread2s10s < 0 ? '#2a000a' : '#0a1a0a',
          border: `1px solid ${spread2s10s < 0 ? '#ef535044' : '#66bb6a44'}`,
          borderRadius: 6, padding: '8px 12px', marginBottom: 8, fontSize: 13,
          color: spread2s10s < 0 ? '#ef5350' : '#66bb6a',
        }}>
          2s10s: {spread2s10s > 0 ? '+' : ''}{spread2s10s}bp {spread2s10s < 0 ? '(inverted)' : '(steepening)'}
        </div>
      )}
      <table className="ds-table">
        <thead>
          <tr><th>Pair</th><th>Spot</th><th>1D %</th></tr>
        </thead>
        <tbody>
          {fxPairs.map((pair) => (
            <FxRow key={pair} pair={pair} openDetail={openDetail} />
          ))}
        </tbody>
      </table>
    </>
  );
}

function FxRow({ pair, openDetail }) {
  const q = useTickerPrice(pair);
  const displayPair = pair.replace(/^C:/, '');
  return (
    <tr onClick={() => openDetail(pair)}>
      <td className="ds-ticker-col">{displayPair}</td>
      <td>{q?.price != null ? fmt(q.price, 4) : '—'}</td>
      <td className={q?.changePct != null && q.changePct >= 0 ? 'ds-up' : 'ds-down'}>
        {fmtPct(q?.changePct)}
      </td>
    </tr>
  );
}

/* ─────────────────────────────────────────────────────────────────────── */
/* EUROPEAN MARKETS — S6 (leveraging /api/snapshot/european endpoint) */
/* ─────────────────────────────────────────────────────────────────────── */
function EuropeanMarkets() {
  const openDetail = useOpenDetail();
  const { data, loading, error } = useSectionData({
    cacheKey: 'screen:macro:european',
    fetcher: async () => {
      const res = await apiFetch('/api/snapshot/european');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    refreshMs: 120000,
  });

  if (loading) return <DeepSkeleton rows={6} />;
  if (error) return <DeepError message={error} />;
  if (!data?.stocks) return <DeepError message="No European data" />;

  const stocks = Object.entries(data.stocks)
    .filter(([, v]) => v?.price != null)
    .sort((a, b) => Math.abs(b[1].changePct || 0) - Math.abs(a[1].changePct || 0))
    .slice(0, 12);

  return (
    <table className="ds-table">
      <thead>
        <tr><th>Ticker</th><th>Name</th><th>Price</th><th>1D %</th><th style={{ fontSize: 9 }}>CCY</th></tr>
      </thead>
      <tbody>
        {stocks.map(([sym, d]) => (
          <tr key={sym} className="ds-row-clickable" onClick={() => openDetail(sym)}>
            <td className="ds-ticker-col">{sym.replace('.L','').replace('.DE','').replace('.PA','')}</td>
            <td>{(d.name || sym).slice(0, 18)}</td>
            <td>{fmt(d.price)}</td>
            <td className={d.changePct != null && d.changePct >= 0 ? 'ds-up' : 'ds-down'}>
              {fmtPct(d.changePct)}
            </td>
            <td style={{ color: '#666', fontSize: 9 }}>{d.currency || '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ─────────────────────────────────────────────────────────────────────── */
/* KEY INDEXES */
/* ─────────────────────────────────────────────────────────────────────── */
function KeyIndexes() {
  const openDetail = useOpenDetail();
  const indexes = ['SPY', 'QQQ', 'DIA', 'IWM', 'EWZ', 'EEM', 'EFA', 'FXI'];

  return (
    <div className="ds-strip">
      {indexes.map((symbol) => {
        const q = useTickerPrice(symbol);
        return <TickerCell key={symbol} symbol={symbol} price={q?.price} changePct={q?.changePct} onClick={openDetail} />;
      })}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────── */
/* MAIN SCREEN */
/* ─────────────────────────────────────────────────────────────────────── */
function GlobalMacroScreenImpl() {
  const sections = [
    { id: 'snapshot',   title: 'Global Snapshot',      component: GlobalSnapshot },
    { id: 'volatility', title: 'Volatility & Risk',    component: VolatilitySection },
    { id: 'fx',         title: 'FX & Yield Linkage',   component: FxYieldSection },
    { id: 'european',   title: 'European Markets',     component: EuropeanMarkets },
  ];

  return (
    <DeepScreenBase
      title="Global Macro"
      accentColor="#4fc3f7"
      sections={sections}
      aiType="macro"
      aiContext={{
        countries: ['US', 'EU', 'JP', 'CN', 'BR'],
        indicators: ['policyRate', 'cpiYoY', 'gdpGrowth', 'VIX'],
      }}
      aiCacheKey="macro:global"
    >
      <SectorChartStrip tickers={CHART_TICKERS} title="GLOBAL MACRO CHARTS" />
      <DeepSection title="Key Indexes">
        <KeyIndexes />
      </DeepSection>
    </DeepScreenBase>
  );
}

export default memo(GlobalMacroScreenImpl);
