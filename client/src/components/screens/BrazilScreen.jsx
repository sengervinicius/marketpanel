/**
 * BrazilScreen.jsx — Full-page Brazil & Emerging Markets screen
 * Comprehensive view of B3 equities, ADR arbitrage, DI curve, LatAm macro, and EM risk
 */
import { memo, useState, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import FullPageScreenLayout from './shared/FullPageScreenLayout';
import { FundamentalsTable, SectorChartPanel } from './shared';
import { DeepSkeleton, DeepError } from './DeepScreenBase';
import useSectionData from '../../hooks/useSectionData';
import { useOpenDetail } from '../../context/OpenDetailContext';
import { useTickerPrice } from '../../context/PriceContext';
import { useScreenTickers } from '../../hooks/useScreenTickers';
import { apiFetch } from '../../utils/api';

const fmt = (n, d = 2) => n == null ? '—' : n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtPct = (n) => n == null ? '—' : (n >= 0 ? '+' : '') + n.toFixed(2) + '%';

// Primary tickers for sector charts
const SECTOR_CHART_TICKERS = ['PETR4.SA', 'VALE3.SA', 'ITUB4.SA', 'WEGE3.SA', 'EWZ', 'C:USDBRL'];

// B3 Blue Chips
const BLUE_CHIPS = ['PETR4.SA', 'VALE3.SA', 'ITUB4.SA', 'BBDC4.SA', 'BBAS3.SA', 'ABEV3.SA', 'WEGE3.SA', 'RENT3.SA', 'SUZB3.SA', 'EMBR3.SA'];
const NAMES = {
  'PETR4.SA': 'Petrobras', 'VALE3.SA': 'Vale', 'ITUB4.SA': 'Itaú', 'BBDC4.SA': 'Bradesco',
  'BBAS3.SA': 'Banco Brasil', 'ABEV3.SA': 'Ambev', 'WEGE3.SA': 'WEG', 'RENT3.SA': 'Localiza',
  'SUZB3.SA': 'Suzano', 'EMBR3.SA': 'Embraer',
};

// ADR pairs
const ADR_PAIRS = [
  { b3: 'PETR4.SA', adr: 'PBR', name: 'Petrobras' },
  { b3: 'VALE3.SA', adr: 'VALE', name: 'Vale' },
  { b3: 'ITUB4.SA', adr: 'ITUB', name: 'Itaú' },
  { b3: 'BBDC4.SA', adr: 'BBD', name: 'Bradesco' },
  { b3: 'EMBR3.SA', adr: 'ERJ', name: 'Embraer' },
];

// EM FX pairs
const EM_FX_PAIRS = ['C:USDBRL', 'C:USDMXN', 'C:USDZAR', 'C:USDTRY', 'C:USDINR'];

// EM Equity Benchmarks
const EM_EQUITY_ETFS = ['EWZ', 'EWW', 'INDA', 'FXI', 'EEM', 'VWO'];

// Brazil ETFs
const BRAZIL_ETFS = ['EWZ', 'FLBR', 'EWW', 'ARGT', 'INDA', 'FXI', 'EEM'];

/* ── Sector Chart Panel ────────────────────────────────────────────────── */
const SectorChartsComponent = memo(function SectorChartsComponent() {
  return <SectorChartPanel tickers={SECTOR_CHART_TICKERS} height={180} cols={3} />;
});

/* ── B3 Blue Chips (dynamic: resolves top 40 B3 stocks, falls back to static) ── */
const BlueChipsComponent = memo(function BlueChipsComponent() {
  const openDetail = useOpenDetail();
  const { tickers: dynamicTickers, loading: tickersLoading } = useScreenTickers({
    exchange: 'BOVESPA',
    limit: 40,
    fallback: BLUE_CHIPS,
  });
  if (tickersLoading && dynamicTickers.length <= BLUE_CHIPS.length) {
    return <DeepSkeleton rows={6} />;
  }
  return <FundamentalsTable tickers={dynamicTickers} title="B3 Blue Chips" onTickerClick={openDetail} />;
});

/* ── ADR Cross-Reference ───────────────────────────────────────────────── */
const AdrCrossRefComponent = memo(function AdrCrossRefComponent() {
  const openDetail = useOpenDetail();

  return (
    <div style={{ padding: '0 6px', overflow: 'auto' }}>
      <table className="ds-table">
        <thead>
          <tr>
            <th>Company</th>
            <th>B3</th>
            <th>B3 Price</th>
            <th>ADR</th>
            <th>ADR Price</th>
          </tr>
        </thead>
        <tbody>
          {ADR_PAIRS.map(({ b3, adr, name }) => (
            <AdrPairRow key={b3} b3={b3} adr={adr} name={name} openDetail={openDetail} />
          ))}
        </tbody>
      </table>
    </div>
  );
});

function AdrPairRow({ b3, adr, name, openDetail }) {
  const qB3 = useTickerPrice(b3);
  const qAdr = useTickerPrice(adr);
  return (
    <tr className="ds-row-clickable">
      <td>{name}</td>
      <td onClick={() => openDetail(b3)} style={{ cursor: 'pointer', fontWeight: 600 }}>
        {b3.replace('.SA', '')}
      </td>
      <td>{qB3?.price != null ? fmt(qB3.price) : '—'}</td>
      <td onClick={() => openDetail(adr)} style={{ cursor: 'pointer', fontWeight: 600 }}>
        {adr}
      </td>
      <td>{qAdr?.price != null ? fmt(qAdr.price) : '—'}</td>
    </tr>
  );
}

/* ── DI Futures Curve ──────────────────────────────────────────────────── */
const DiCurveComponent = memo(function DiCurveComponent() {
  const [chartData, setChartData] = useState([]);
  const { data, loading, error } = useSectionData({
    cacheKey: 'brazil-di-curve',
    fetcher: async () => {
      const res = await apiFetch('/api/di-curve');
      return res.ok ? await res.json() : null;
    },
    refreshMs: 120000,
  });

  useEffect(() => {
    if (data) {
      const curve = data?.curve || data?.data || [];
      const transformed = curve.slice(0, 12).map((point, i) => ({
        label: point.tenor || point.label || `DI${i + 1}`,
        rate: parseFloat(point.rate || point.value) || 0,
      }));
      setChartData(transformed);
    }
  }, [data]);

  if (loading) return <DeepSkeleton rows={6} />;
  if (error) return <DeepError message={error} />;
  if (chartData.length === 0) return <div style={{ padding: '10px', color: '#666', fontSize: 10 }}>DI curve data unavailable</div>;

  return (
    <div style={{ padding: '8px', height: '240px' }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 24, left: 40 }}>
          <XAxis dataKey="label" style={{ fontSize: 8, fill: '#666' }} />
          <YAxis style={{ fontSize: 8, fill: '#666' }} />
          <Tooltip
            contentStyle={{ background: '#0a0a0a', border: '1px solid #1e1e1e', borderRadius: 3 }}
            labelStyle={{ color: '#e0e0e0', fontSize: 9 }}
          />
          <Line type="monotone" dataKey="rate" stroke="#4caf50" strokeWidth={2} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
});

/* ── FX & Rates ────────────────────────────────────────────────────────── */
function FxRateRow({ sym, openDetail }) {
  const q = useTickerPrice(sym);
  const label = sym === 'C:USDBRL' ? 'USD/BRL' : 'EUR/BRL';
  return (
    <tr key={sym} className="ds-row-clickable" onClick={() => openDetail(sym)}>
      <td>{label}</td>
      <td>{q?.price != null ? fmt(q.price) : '—'}</td>
      <td className={q?.changePct >= 0 ? 'ds-val-pos' : 'ds-val-neg'}>
        {q?.changePct != null ? fmtPct(q.changePct) : '—'}
      </td>
    </tr>
  );
}

const FxRatesComponent = memo(function FxRatesComponent() {
  const openDetail = useOpenDetail();
  const { data: macroData, loading } = useSectionData({
    cacheKey: 'brazil-macro',
    fetcher: async () => {
      const res = await apiFetch('/api/macro/compare?countries=BR');
      return res.ok ? await res.json() : null;
    },
  });

  // API returns {data: {countries: [...]}} — extract the countries array safely
  const countriesArr = Array.isArray(macroData?.data?.countries) ? macroData.data.countries
                     : Array.isArray(macroData?.data) ? macroData.data : [];
  const brData = countriesArr.find(row => row.country === 'BR') || {};

  return (
    <div style={{ padding: '0 6px', overflow: 'auto' }}>
      <table className="ds-table">
        <thead>
          <tr>
            <th>Pair</th>
            <th>Price</th>
            <th>1D%</th>
          </tr>
        </thead>
        <tbody>
          {['C:USDBRL', 'C:EURBRL'].map(sym => (
            <FxRateRow key={sym} sym={sym} openDetail={openDetail} />
          ))}
          <tr style={{ borderTop: '1px solid #1e1e1e', background: '#0d0d0d' }}>
            <td style={{ fontWeight: 600, color: '#999' }}>Selic Rate</td>
            <td colSpan="2">{brData.policyRate != null ? fmtPct(brData.policyRate) : loading ? '...' : '—'}</td>
          </tr>
          <tr style={{ background: '#0d0d0d' }}>
            <td style={{ fontWeight: 600, color: '#999' }}>CPI YoY</td>
            <td colSpan="2">{brData.cpiYoY != null ? fmtPct(brData.cpiYoY) : loading ? '...' : '—'}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
});

/* ── LatAm Macro Comparison ────────────────────────────────────────────── */
const LatAmMacroComponent = memo(function LatAmMacroComponent() {
  const { data, loading, error } = useSectionData({
    cacheKey: 'latam-macro-comparison',
    fetcher: async () => {
      const res = await apiFetch('/api/macro/compare?countries=BR,MX,AR,CL,CO,PE');
      return res.ok ? await res.json() : null;
    },
    refreshMs: 600000,
  });

  if (loading) return <DeepSkeleton rows={8} />;
  if (error) return <DeepError message={error} />;

  // API returns {data: {countries: [...]}} — extract the countries array safely
  const countries = Array.isArray(data?.data?.countries) ? data.data.countries
                  : Array.isArray(data?.data) ? data.data : [];
  if (countries.length === 0) return <div style={{ padding: '10px', color: '#666', fontSize: 10 }}>No data available</div>;

  return (
    <div style={{ padding: '0 6px', overflow: 'auto' }}>
      <table className="ds-table">
        <thead>
          <tr>
            <th>Country</th>
            <th>Policy Rate</th>
            <th>CPI YoY</th>
            <th>GDP Growth</th>
            <th>Unemployment</th>
          </tr>
        </thead>
        <tbody>
          {countries.map(row => (
            <tr key={row.country}>
              <td style={{ fontWeight: 600 }}>{row.country}</td>
              <td>{row.policyRate != null ? fmtPct(row.policyRate) : '—'}</td>
              <td>{row.cpiYoY != null ? fmtPct(row.cpiYoY) : '—'}</td>
              <td>{row.gdpGrowth != null ? fmtPct(row.gdpGrowth) : '—'}</td>
              <td>{row.unemployment != null ? fmtPct(row.unemployment) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
});

/* ── EM FX Monitor ─────────────────────────────────────────────────────── */
function EmFxRow({ sym, openDetail }) {
  const q = useTickerPrice(sym);
  const label = sym.replace('C:', '').replace('USD', '');
  return (
    <tr key={sym} className="ds-row-clickable" onClick={() => openDetail(sym)}>
      <td>{label}</td>
      <td>{q?.price != null ? fmt(q.price) : '—'}</td>
      <td className={q?.changePct >= 0 ? 'ds-val-pos' : 'ds-val-neg'}>
        {q?.changePct != null ? fmtPct(q.changePct) : '—'}
      </td>
    </tr>
  );
}

const EmFxMonitorComponent = memo(function EmFxMonitorComponent() {
  const openDetail = useOpenDetail();

  return (
    <div style={{ padding: '0 6px', overflow: 'auto' }}>
      <table className="ds-table">
        <thead>
          <tr>
            <th>Pair</th>
            <th>Price</th>
            <th>1D%</th>
          </tr>
        </thead>
        <tbody>
          {EM_FX_PAIRS.map(sym => (
            <EmFxRow key={sym} sym={sym} openDetail={openDetail} />
          ))}
        </tbody>
      </table>
    </div>
  );
});

/* ── EM Equity Benchmarks ──────────────────────────────────────────────── */
const EM_EQUITY_NAMES = { 'EWZ': 'Brazil', 'EWW': 'Mexico', 'INDA': 'India', 'FXI': 'China', 'EEM': 'EM', 'VWO': 'Dev EM' };

function EmEtfCell({ sym, openDetail }) {
  const q = useTickerPrice(sym);
  return (
    <tr key={sym} className="ds-row-clickable" onClick={() => openDetail(sym)}>
      <td style={{ fontWeight: 600 }}>{sym}</td>
      <td>{q?.price != null ? fmt(q.price) : '—'}</td>
      <td className={q?.changePct >= 0 ? 'ds-val-pos' : 'ds-val-neg'}>
        {q?.changePct != null ? fmtPct(q.changePct) : '—'}
      </td>
      <td style={{ fontSize: 11, color: '#999' }}>{EM_EQUITY_NAMES[sym]}</td>
    </tr>
  );
}

const EmEquityBenchmarksComponent = memo(function EmEquityBenchmarksComponent() {
  const openDetail = useOpenDetail();

  return (
    <div style={{ padding: '0 6px', overflow: 'auto' }}>
      <table className="ds-table">
        <thead>
          <tr>
            <th>ETF</th>
            <th>Price</th>
            <th>1D%</th>
            <th>Name</th>
          </tr>
        </thead>
        <tbody>
          {EM_EQUITY_ETFS.map(sym => (
            <EmEtfCell key={sym} sym={sym} openDetail={openDetail} />
          ))}
        </tbody>
      </table>
    </div>
  );
});

/* ── Fundamentals Comparison ───────────────────────────────────────────── */
const FundamentalsComponent = memo(function FundamentalsComponent() {
  const openDetail = useOpenDetail();
  return <FundamentalsTable tickers={BLUE_CHIPS} onTickerClick={openDetail} />;
});

/* ── Brazil ETF Cell ───────────────────────────────────────────────── */
function BrazilEtfCell({ sym, openDetail }) {
  const q = useTickerPrice(sym);
  return (
    <div
      key={sym}
      onClick={() => openDetail(sym)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        padding: '6px 10px',
        background: '#111',
        border: '1px solid #1e1e1e',
        borderRadius: '3px',
        cursor: 'pointer',
        fontSize: 10,
        fontWeight: 600,
        color: '#e0e0e0',
        transition: 'background 0.15s',
      }}
      onMouseEnter={(e) => e.target.parentElement.style.background = '#1a1a1a'}
      onMouseLeave={(e) => e.target.parentElement.style.background = '#111'}
    >
      <span>{sym}</span>
      {q?.price != null && <span style={{ color: '#999', fontSize: 9 }}>${fmt(q.price)}</span>}
      {q?.changePct != null && (
        <span style={{ color: q.changePct >= 0 ? '#4caf50' : '#f44336', fontSize: 9 }}>
          {q.changePct >= 0 ? '+' : ''}{q.changePct.toFixed(2)}%
        </span>
      )}
    </div>
  );
}

/* ── Main Component ────────────────────────────────────────────────────── */
function BrazilScreenImpl() {
  const openDetail = useOpenDetail();
  const [lastUpdated, setLastUpdated] = useState(new Date());

  useEffect(() => {
    const interval = setInterval(() => setLastUpdated(new Date()), 30000);
    return () => clearInterval(interval);
  }, []);

  const sections = [
    {
      id: 'sector-charts',
      title: 'SECTOR CHARTS',
      component: SectorChartsComponent,
      span: 'full',
    },
    {
      id: 'bluechips',
      title: 'B3 BLUE CHIPS',
      component: BlueChipsComponent,
    },
    {
      id: 'adr-cross',
      title: 'ADR CROSS-REFERENCE',
      component: AdrCrossRefComponent,
    },
    {
      id: 'di-curve',
      title: 'DI FUTURES CURVE',
      component: DiCurveComponent,
    },
    {
      id: 'fx-rates',
      title: 'FX & RATES',
      component: FxRatesComponent,
    },
    {
      id: 'latam-macro',
      title: 'LATAM MACRO',
      component: LatAmMacroComponent,
      span: 'full',
    },
    {
      id: 'em-fx',
      title: 'EM FX MONITOR',
      component: EmFxMonitorComponent,
    },
    {
      id: 'em-equity',
      title: 'EM EQUITY BENCHMARKS',
      component: EmEquityBenchmarksComponent,
    },
    {
      id: 'fundamentals',
      title: 'FUNDAMENTALS COMPARISON',
      component: FundamentalsComponent,
      span: 'full',
    },
  ];

  return (
    <FullPageScreenLayout
      title="BRAZIL & EMERGING MARKETS"
      accentColor="#4caf50"
      subtitle="B3 equities, ADR arbitrage, DI curve, LatAm macro, and EM risk"
      lastUpdated={lastUpdated}
      onBack={() => window.history.back()}
      sections={sections}
    >
      {/* Brazil & EM ETFs strip */}
      <div style={{ padding: '12px 16px' }}>
        <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: 1, color: '#999', textTransform: 'uppercase', marginBottom: 8 }}>
          Brazil & EM ETFs
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
          {BRAZIL_ETFS.map(sym => (
            <BrazilEtfCell key={sym} sym={sym} openDetail={openDetail} />
          ))}
        </div>
      </div>
    </FullPageScreenLayout>
  );
}

export default memo(BrazilScreenImpl);
