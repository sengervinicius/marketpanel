/**
 * BrazilScreen.jsx — Full-page Brazil & Emerging Markets screen
 * Comprehensive view of B3 equities, ADR arbitrage, DI curve, LatAm macro, and EM risk
 */
import { memo, useState, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import FullPageScreenLayout from './shared/FullPageScreenLayout';
import SectorPulse from './shared/SectorPulse';
import { FundamentalsTable, SectorChartPanel } from './shared';
import { KPIRibbon, heatColor, TickerRibbon } from './shared/SectorUI';
import { DeepSkeleton, DeepError } from './DeepScreenBase';
import EarningsCalendarStrip from './shared/EarningsCalendarStrip';
import MacroCalendarStrip from './shared/MacroCalendarStrip';
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
const EM_FX_PAIRS = [
  'C:USDBRL', 'C:GBPBRL', 'C:EURBRL', 'C:JPYBRL',
  'C:USDMXN', 'C:USDARS', 'C:USDCLP', 'C:USDCOP',
  'C:USDZAR', 'C:USDTRY', 'C:USDINR',
];

const EM_FX_NAMES = {
  'C:USDBRL': 'USD/BRL', 'C:GBPBRL': 'GBP/BRL', 'C:EURBRL': 'EUR/BRL', 'C:JPYBRL': 'JPY/BRL',
  'C:USDMXN': 'USD/MXN', 'C:USDARS': 'USD/ARS', 'C:USDCLP': 'USD/CLP', 'C:USDCOP': 'USD/COP',
  'C:USDZAR': 'USD/ZAR', 'C:USDTRY': 'USD/TRY', 'C:USDINR': 'USD/INR',
};

// EM Equity Benchmarks
const EM_EQUITY_ETFS = ['EWZ', 'EWW', 'INDA', 'FXI', 'EEM', 'VWO'];

// Brazil ETFs
const BRAZIL_ETFS = ['EWZ', 'FLBR', 'EWW', 'ARGT', 'INDA', 'FXI', 'EEM'];

// ADR tickers for deep-data components
const EARNINGS_TICKERS = ['PBR', 'VALE', 'ITUB', 'BBD', 'ERJ', 'ABEV', 'SBS'];
const OWNERSHIP_TICKERS = ['PBR', 'VALE', 'ITUB', 'BBD', 'ERJ'];
const SIGNALS_TICKERS = ['PBR', 'VALE', 'ITUB', 'BBD', 'ERJ', 'ABEV', 'SBS'];

const BANNER_TICKERS = [
  { ticker: 'EWZ', label: 'BRAZIL ETF' },
  { ticker: 'PETR4.SA', label: 'PETR4' },
  { ticker: 'VALE3.SA', label: 'VALE3' },
  { ticker: 'ITUB4.SA', label: 'ITUB4' },
  { ticker: 'BBD', label: 'BRADESCO' },
  { ticker: 'PBR', label: 'PETROBRAS' },
  { ticker: 'VALE', label: 'VALE ADR' },
  { ticker: 'C:USDBRL', label: 'USD/BRL' },
  { ticker: 'EEM', label: 'EM EQUITY' },
  { ticker: 'ARGT', label: 'ARGT ETF' },
];

/* ── KPI Ribbon ───────────────────────────────────────────────────────── */
const BrazilKPIRibbon = memo(function BrazilKPIRibbon() {
  const ewz = useTickerPrice('EWZ');
  const usdbrl = useTickerPrice('C:USDBRL');
  const petr4 = useTickerPrice('PETR4.SA');
  const vale3 = useTickerPrice('VALE3.SA');

  const items = [
    { label: 'EWZ', value: ewz?.price != null ? `$${fmt(ewz.price)}` : '—', change: ewz?.changePct },
    { label: 'USD/BRL', value: usdbrl?.price != null ? fmt(usdbrl.price, 4) : '—', change: usdbrl?.changePct },
    { label: 'PETR4', value: petr4?.price != null ? `R$${fmt(petr4.price)}` : '—', change: petr4?.changePct },
    { label: 'VALE3', value: vale3?.price != null ? `R$${fmt(vale3.price)}` : '—', change: vale3?.changePct },
  ];

  return <KPIRibbon items={items} accentColor="#2196f3" />;
});

/* ── Sector Chart Panel ────────────────────────────────────────────────── */
const SectorChartsComponent = memo(function SectorChartsComponent({ selectedTicker, onChartClick }) {
  return <SectorChartPanel tickers={SECTOR_CHART_TICKERS} height={180} cols={3} selectedTicker={selectedTicker} onChartClick={onChartClick} />;
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
    <tr className="ds-row-clickable" onClick={() => openDetail(b3, 'Brazil & EM')} onTouchEnd={(e) => { e.preventDefault(); openDetail(b3, 'Brazil & EM'); }}>
      <td>{name}</td>
      <td onClick={() => openDetail(b3, 'Brazil & EM')} style={{ cursor: 'pointer', fontWeight: 600 }}>
        {b3.replace('.SA', '')}
      </td>
      <td style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
        {qB3?.price != null ? fmt(qB3.price) : <span className="ds-dash">—</span>}
      </td>
      <td onClick={() => openDetail(adr, 'Brazil & EM')} style={{ cursor: 'pointer', fontWeight: 600 }}>
        {adr}
      </td>
      <td style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
        {qAdr?.price != null ? fmt(qAdr.price) : <span className="ds-dash">—</span>}
      </td>
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
  if (chartData.length === 0) return <div style={{ padding: '12px', color: 'var(--text-muted)', fontSize: 12 }}>DI curve data unavailable</div>;

  return (
    <div style={{ padding: '12px', height: '260px' }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData} margin={{ top: 12, right: 20, bottom: 40, left: 48 }}>
          <defs>
            <linearGradient id="diCurveGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--semantic-up)" stopOpacity={0.3} />
              <stop offset="100%" stopColor="var(--semantic-up)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="label"
            tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
            angle={-35}
            textAnchor="end"
            height={50}
            tickLine={{ stroke: 'var(--border-subtle)' }}
            axisLine={{ stroke: 'var(--border-subtle)' }}
          />
          <YAxis
            tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
            tickFormatter={(v) => `${v.toFixed(1)}%`}
            width={50}
            tickLine={{ stroke: 'var(--border-subtle)' }}
            axisLine={{ stroke: 'var(--border-subtle)' }}
          />
          <Tooltip
            contentStyle={{ background: 'var(--bg-panel)', border: '1px solid var(--border-default)', borderRadius: 6, padding: '8px 12px' }}
            labelStyle={{ color: 'var(--text-primary)', fontSize: 12, fontWeight: 600, marginBottom: 4 }}
            itemStyle={{ color: 'var(--text-secondary)', fontSize: 12 }}
            formatter={(val) => [`${Number(val).toFixed(2)}%`, 'Rate']}
          />
          <Line
            type="monotone"
            dataKey="rate"
            stroke="var(--semantic-up)"
            strokeWidth={2.5}
            dot={{ r: 3, fill: 'var(--semantic-up)', strokeWidth: 0 }}
            activeDot={{ r: 5, fill: 'var(--semantic-up)', stroke: 'rgba(255,255,255,0.3)', strokeWidth: 2 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
});

/* ── FX & Rates ────────────────────────────────────────────────────────── */
function FxRateRow({ sym, openDetail }) {
  const q = useTickerPrice(sym);
  const label = EM_FX_NAMES[sym] || sym.replace('C:', '');
  return (
    <tr
      key={sym}
      className="ds-row-clickable"
      onClick={() => openDetail(sym, 'Brazil & EM')}
      onTouchEnd={(e) => { e.preventDefault(); openDetail(sym, 'Brazil & EM'); }}
    >
      <td>{label}</td>
      <td style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
        {q?.price != null ? fmt(q.price) : <span className="ds-dash">—</span>}
      </td>
      <td className={q?.changePct >= 0 ? 'ds-up' : 'ds-down'}>
        {q?.changePct != null ? fmtPct(q.changePct) : <span className="ds-dash">—</span>}
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
          {['C:USDBRL', 'C:GBPBRL', 'C:EURBRL', 'C:JPYBRL'].map(sym => (
            <FxRateRow key={sym} sym={sym} openDetail={openDetail} />
          ))}
          <tr style={{ borderTop: '1px solid var(--border-default)', background: 'var(--bg-surface)' }}>
            <td style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>Selic Rate</td>
            <td colSpan="2">{brData.policyRate != null ? fmtPct(brData.policyRate) : loading ? '...' : '—'}</td>
          </tr>
          <tr style={{ background: 'var(--bg-surface)' }}>
            <td style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>CPI YoY</td>
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
  if (countries.length === 0) return <div style={{ padding: '10px', color: 'var(--text-muted)', fontSize: 10 }}>No data available</div>;

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
  const label = EM_FX_NAMES[sym] || sym.replace('C:', '');
  return (
    <tr
      key={sym}
      className="ds-row-clickable"
      onClick={() => openDetail(sym, 'Brazil & EM')}
      onTouchEnd={(e) => { e.preventDefault(); openDetail(sym, 'Brazil & EM'); }}
    >
      <td>{label}</td>
      <td>{q?.price != null ? fmt(q.price) : '—'}</td>
      <td className={q?.changePct >= 0 ? 'ds-up' : 'ds-down'}>
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
    <tr
      key={sym}
      className="ds-row-clickable"
      onClick={() => openDetail(sym, 'Brazil & EM')}
      onTouchEnd={(e) => { e.preventDefault(); openDetail(sym, 'Brazil & EM'); }}
    >
      <td className="ds-ticker-col">{sym}</td>
      <td>{q?.price != null ? fmt(q.price) : '—'}</td>
      <td className={q?.changePct >= 0 ? 'ds-up' : 'ds-down'}>
        {q?.changePct != null ? fmtPct(q.changePct) : '—'}
      </td>
      <td>{EM_EQUITY_NAMES[sym]}</td>
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
  return <FundamentalsTable tickers={BLUE_CHIPS} onTickerClick={(symbol) => openDetail(symbol, 'Brazil & EM')} />;
});

/* ── Deep-Data Component Wrappers ──────────────────────────────────────── */
const EarningsSection = memo(function EarningsSection() {
  return <EarningsCalendarStrip tickers={EARNINGS_TICKERS} accentColor="#4caf50" />;
});

const MacroCalendarSection = memo(function MacroCalendarSection() {
  return <MacroCalendarStrip countries={['BR', 'US']} limit={12} accentColor="#4caf50" />;
});

/* ── Brazil ETF Cell ───────────────────────────────────────────────── */
function BrazilEtfCell({ sym, openDetail }) {
  const q = useTickerPrice(sym);
  return (
    <div
      key={sym}
      onClick={() => openDetail(sym, 'Brazil & EM')}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        padding: '6px 10px',
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border-default)',
        borderRadius: '3px',
        cursor: 'pointer',
        fontSize: 10,
        fontWeight: 600,
        color: 'var(--text-primary)',
        transition: 'background 0.15s',
      }}
      onMouseEnter={(e) => e.target.parentElement.style.background = 'var(--bg-hover)'}
      onMouseLeave={(e) => e.target.parentElement.style.background = 'var(--bg-elevated)'}
    >
      <span>{sym}</span>
      {q?.price != null && <span style={{ color: 'var(--text-secondary)', fontSize: 9 }}>${fmt(q.price)}</span>}
      {q?.changePct != null && (
        <span style={{ color: q.changePct >= 0 ? 'var(--semantic-up)' : 'var(--semantic-down)', fontSize: 9 }}>
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
  const [selectedTicker, setSelectedTicker] = useState(null);

  useEffect(() => {
    const interval = setInterval(() => setLastUpdated(new Date()), 30000);
    return () => clearInterval(interval);
  }, []);

  const sections = [
    {
      id: 'kpi',
      title: 'KEY METRICS',
      span: 'full',
      component: BrazilKPIRibbon,
    },
    {
      id: 'fundamentals',
      title: 'CONSTITUENTS',
      span: 'full',
      component: FundamentalsComponent,
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
      id: 'latam-macro',
      title: 'LATAM MACRO',
      component: LatAmMacroComponent,
      span: 'full',
    },
    {
      id: 'earnings',
      title: 'EARNINGS CALENDAR',
      span: 'full',
      component: EarningsSection,
    },
  ];

  return (
    <FullPageScreenLayout
      title="BRAZIL & EMERGING MARKETS"
      accentColor="#4caf50"
      subtitle="B3 equities, ADR arbitrage, DI curve, LatAm macro, and EM risk"
      lastUpdated={lastUpdated}
      onBack={() => window.history.back()}
      vaultSector="brazil"
      sections={sections}
      tickerBanner={BANNER_TICKERS}
      aiType="em-country"
      aiContext={{ country: 'Brazil', tickers: ['EWZ', 'VALE3.SA', 'PETR4.SA', 'ITUB4.SA'] }}
      aiCacheKey="em-country:brazil"
    >
      <SectorPulse
        etfTicker="EWZ"
        etfLabel="EWZ"
        accentColor="#4caf50"
      />
    </FullPageScreenLayout>
  );
}

export default memo(BrazilScreenImpl);
