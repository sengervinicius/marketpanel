/**
 * GlobalRetailScreen.jsx — Full-page Sector Screen
 * Comprehensive Global Retail coverage for the Particle Market Terminal.
 * Integrates FullPageScreenLayout, FundamentalsTable, SectorChartPanel, SectorScatterPlot,
 * and InsiderActivity for multi-dimensional retail sector analysis.
 */
import { memo, useMemo, useState } from 'react';
import FullPageScreenLayout from './shared/FullPageScreenLayout';
import SectorPulse from './shared/SectorPulse';
import { FundamentalsTable } from './shared/FundamentalsTable';
import { SectorChartPanel } from './shared/SectorChartPanel';
import { SectorScatterPlot } from './shared/SectorScatterPlot';
import { KPIRibbon, TickerRibbon } from './shared/SectorUI';
import { CorrelationMatrix } from './shared/CorrelationMatrix';
import { EarningsCalendarStrip } from './shared/EarningsCalendarStrip';
import { useOpenDetail } from '../../context/OpenDetailContext';
import { useTickerPrice } from '../../context/PriceContext';
import { useDeepScreenData } from '../../hooks/useDeepScreenData';
import DeepScreenBase, { TickerCell, StatsLoadGate } from './DeepScreenBase';

const fmt = (n, d = 2) =>
  n == null ? '—' : n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtPct = (n) => n == null ? '—' : (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
const fmtB = (n) => {
  if (n == null || isNaN(n)) return '—';
  const v = parseFloat(n);
  if (v >= 1e12) return '$' + (v/1e12).toFixed(1) + 'T';
  if (v >= 1e9)  return '$' + (v/1e9).toFixed(0) + 'B';
  if (v >= 1e6)  return '$' + (v/1e6).toFixed(0) + 'M';
  return '$' + v.toFixed(0);
};

/* ── KPI Ribbon ────────────────────────────────────────────────────────── */
function RetailKPIRibbon() {
  const xly  = useTickerPrice('XLY');
  const amzn = useTickerPrice('AMZN');
  const wmt  = useTickerPrice('WMT');
  const nke  = useTickerPrice('NKE');
  const items = [
    { label: 'CONSUMER DISC', value: xly?.price != null ? '$' + fmt(xly.price) : '—', change: xly?.changePct },
    { label: 'AMAZON',        value: amzn?.price != null ? '$' + fmt(amzn.price) : '—', change: amzn?.changePct },
    { label: 'WALMART',       value: wmt?.price != null ? '$' + fmt(wmt.price) : '—', change: wmt?.changePct },
    { label: 'NIKE',           value: nke?.price != null ? '$' + fmt(nke.price) : '—', change: nke?.changePct },
  ];
  return <KPIRibbon items={items} accentColor="#e91e63" />;
}

/* ── Table Row Component (extracts hook call out of map) ────────────────── */
const TableRow = memo(function TableRow({ sym, name, openDetail, stats }) {
  const priceData = useTickerPrice(sym);
  const mktCap = stats?.market_capitalization ? parseFloat(stats.market_capitalization) : null;
  const pe = stats?.pe_ratio ? parseFloat(stats.pe_ratio) : null;
  return (
    <tr
      key={sym}
      className="ds-row-clickable"
      onClick={() => openDetail(sym, 'Global Retail & Consumer')}
      onTouchEnd={(e) => { e.preventDefault(); openDetail(sym, 'Global Retail & Consumer'); }}
    >
      <td className="ds-ticker-col">{sym}</td>
      <td style={{ color: 'var(--text-secondary)' }}>{name || LABELS[sym] || <span className="ds-dash">—</span>}</td>
      <td style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
        {priceData?.price != null ? fmt(priceData.price, 2) : <span className="ds-dash">—</span>}
      </td>
      <td className={priceData?.changePct != null && priceData.changePct >= 0 ? 'ds-up' : 'ds-down'}>
        {priceData?.changePct != null ? fmtPct(priceData?.changePct) : <span className="ds-dash">—</span>}
      </td>
      <td style={{ color: 'var(--text-secondary)' }}>
        {fmtB(mktCap) || <span className="ds-dash">—</span>}
      </td>
      <td style={{ color: 'var(--text-secondary)' }}>
        {pe != null ? pe.toFixed(1) + 'x' : <span className="ds-dash">—</span>}
      </td>
    </tr>
  );
});

/* ── ETF Cell Component (extracts hook call out of map) ────────────────── */
const EtfCell = memo(function EtfCell({ sym, openDetail }) {
  const priceData = useTickerPrice(sym);
  return (
    <TickerCell
      key={sym}
      symbol={sym}
      price={priceData?.price}
      changePct={priceData?.changePct}
      onClick={openDetail}
    />
  );
});

/* ── Sector Tickers ────────────────────────────────────────────────────── */
const US_DISCRETIONARY = ['AMZN', 'WMT', 'COST', 'TGT', 'HD', 'LOW', 'NKE', 'SBUX', 'MCD', 'TJX'];
const US_STAPLES = ['PG', 'KO', 'PEP', 'CL', 'PM', 'MO', 'KHC', 'GIS', 'SYY'];
const GLOBAL_LUXURY = [
  { symbol: 'LVMUY', name: 'LVMH' },
  { symbol: 'HESAY', name: 'Hermès' },
  { symbol: 'PPRUY', name: 'Kering' },
  { symbol: 'CFRUY', name: 'Richemont' },
];
const ECOMMERCE_FINTECH = ['SHOP', 'MELI', 'SE', 'BABA', 'JD', 'PDD'];
const SPECIALTY_RETAIL = ['LULU', 'DECK', 'ULTA', 'ROST', 'FIVE'];
const RETAIL_ETFS = ['XLY', 'XLP', 'IBUY', 'ONLN', 'RETL'];

const BANNER_TICKERS = [
  { ticker: 'XLY', label: 'DISCRET' },
  { ticker: 'XLP', label: 'STAPLES' },
  { ticker: 'AMZN', label: 'AMZN' },
  { ticker: 'WMT', label: 'WMT' },
  { ticker: 'COST', label: 'COST' },
  { ticker: 'NKE', label: 'NKE' },
  { ticker: 'LVMUY', label: 'LVMH' },
  { ticker: 'MELI', label: 'MELI' },
  { ticker: 'SHOP', label: 'SHOP' },
];

const CHART_TICKERS = ['AMZN', 'WMT', 'COST', 'NKE', 'LVMUY', 'MELI'];

const LABELS = {
  AMZN: 'Amazon', WMT: 'Walmart', COST: 'Costco', TGT: 'Target', HD: 'Home Depot', LOW: 'Lowe\'s',
  NKE: 'Nike', SBUX: 'Starbucks', MCD: 'McDonald\'s', TJX: 'TJX Companies',
  PG: 'Procter & Gamble', KO: 'Coca-Cola', PEP: 'PepsiCo', CL: 'Colgate-Palmolive', PM: 'Philip Morris',
  MO: 'Altria', KHC: 'Kraft Heinz', GIS: 'General Mills', SYY: 'Sysco',
  LVMUY: 'LVMH', HESAY: 'Hermès', PPRUY: 'Kering', CFRUY: 'Richemont',
  SHOP: 'Shopify', MELI: 'Mercado Libre', SE: 'Sea Limited', BABA: 'Alibaba', JD: 'JD.com', PDD: 'Pinduoduo',
  LULU: 'Lululemon', DECK: 'Deckers', ULTA: 'Ulta Beauty', ROST: 'Ross Stores', FIVE: 'Five Below',
  XLY: 'Consumer Discretionary ETF', XLP: 'Consumer Staples ETF', IBUY: 'iBuy ETF', ONLN: 'Online Retail ETF', RETL: 'Retail ETF',
};

const ALL_EQUITIES = [
  ...US_DISCRETIONARY,
  ...US_STAPLES,
  ...GLOBAL_LUXURY.map(e => e.symbol),
  ...ECOMMERCE_FINTECH,
  ...SPECIALTY_RETAIL,
];

/* ── Data-Depth Component Tickers ──────────────────────────────────────── */
const EARNINGS_TICKERS = ['AMZN', 'WMT', 'COST', 'NKE', 'LULU', 'MELI', 'SHOP', 'TGT'];
const OWNERSHIP_TICKERS = ['AMZN', 'WMT', 'COST', 'NKE', 'LULU', 'TGT'];
const SIGNALS_TICKERS = ['AMZN', 'WMT', 'COST', 'NKE', 'LULU', 'MELI', 'SHOP', 'TGT'];

/* ── Wrapper Components for Data-Depth Sections ──────────────────────── */
const EarningsSection = memo(function EarningsSection() {
  return <EarningsCalendarStrip tickers={EARNINGS_TICKERS} accentColor="#e91e63" />;
});

/* ── Section Table Component ───────────────────────────────────────────── */
const SectionTable = memo(function SectionTable({ tickers, statsMap }) {
  const openDetail = useOpenDetail();

  return (
    <div style={{ overflow: 'auto' }}>
      <table className="ds-table">
        <thead>
          <tr>
            <th style={{ textAlign: 'left' }}>Ticker</th>
            <th style={{ textAlign: 'left' }}>Name</th>
            <th>Price</th>
            <th>1D%</th>
            <th>Mkt Cap</th>
            <th>P/E</th>
          </tr>
        </thead>
        <tbody>
          {tickers.map(t => {
            const sym = typeof t === 'string' ? t : t.symbol;
            const name = typeof t === 'string' ? undefined : t.name;
            return <TableRow key={sym} sym={sym} name={name} openDetail={openDetail} stats={statsMap?.get(sym)} />;
          })}
        </tbody>
      </table>
    </div>
  );
});

/* ── ETF Strip Component (replaced with TickerRibbon) ──────────────────── */
const EtfStrip = memo(function EtfStrip() {
  return <TickerRibbon tickers={RETAIL_ETFS} sectorName="Global Retail & Consumer" />;
});


/* ── Main Screen Implementation ────────────────────────────────────────── */
function GlobalRetailScreenImpl() {
  const openDetail = useOpenDetail();
  const { data: statsMap, loading: statsLoading, error: statsError, refresh: statsRefresh } = useDeepScreenData(ALL_EQUITIES);
  const [selectedTicker, setSelectedTicker] = useState(null);

  /* ── Prepare scatter plot data: P/E vs Market Cap ──────────────────── */
  const scatterData = useMemo(() => {
    if (statsMap.size === 0) return [];
    return ALL_EQUITIES
      .filter(sym => statsMap.has(sym))
      .map(sym => {
        const stats = statsMap.get(sym);
        const pe = parseFloat(stats?.pe_ratio) || null;
        const mktCap = parseFloat(stats?.market_capitalization) || null;
        return {
          ticker: sym,
          x: pe || 0,
          y: mktCap ? mktCap / 1e9 : 0,
        };
      })
      .filter(d => d.x > 0 && d.y > 0);
  }, [statsMap]);

  /* ── Build section definitions ─────────────────────────────────────── */
  const sections = useMemo(() => [
    {
      id: 'kpi',
      title: 'KEY METRICS',
      span: 'full',
      component: RetailKPIRibbon,
    },
    {
      id: 'charts',
      title: 'Sector Charts',
      span: 'full',
      component: () => (
        <SectorChartPanel
          tickers={CHART_TICKERS}
          height={200}
          cols={3}
          selectedTicker={selectedTicker}
          onChartClick={setSelectedTicker}
        />
      ),
    },
    {
      id: 'us-discretionary',
      title: 'US Consumer Discretionary',
      component: () => (
        <StatsLoadGate statsMap={statsMap} loading={statsLoading} error={statsError} refresh={statsRefresh}>
          <SectionTable tickers={US_DISCRETIONARY} statsMap={statsMap} />
        </StatsLoadGate>
      ),
    },
    {
      id: 'us-staples',
      title: 'US Consumer Staples',
      component: () => (
        <StatsLoadGate statsMap={statsMap} loading={statsLoading} error={statsError} refresh={statsRefresh}>
          <SectionTable tickers={US_STAPLES} statsMap={statsMap} />
        </StatsLoadGate>
      ),
    },
    {
      id: 'global-luxury',
      title: 'Global Luxury',
      component: () => (
        <StatsLoadGate statsMap={statsMap} loading={statsLoading} error={statsError} refresh={statsRefresh}>
          <SectionTable tickers={GLOBAL_LUXURY} statsMap={statsMap} />
        </StatsLoadGate>
      ),
    },
    {
      id: 'ecommerce-fintech',
      title: 'E-Commerce & FinTech',
      component: () => (
        <StatsLoadGate statsMap={statsMap} loading={statsLoading} error={statsError} refresh={statsRefresh}>
          <SectionTable tickers={ECOMMERCE_FINTECH} statsMap={statsMap} />
        </StatsLoadGate>
      ),
    },
    {
      id: 'specialty-retail',
      title: 'Specialty Retail',
      component: () => (
        <StatsLoadGate statsMap={statsMap} loading={statsLoading} error={statsError} refresh={statsRefresh}>
          <SectionTable tickers={SPECIALTY_RETAIL} statsMap={statsMap} />
        </StatsLoadGate>
      ),
    },
    {
      id: 'fundamentals',
      title: 'Fundamentals Comparison',
      span: 'full',
      component: () => (
        <FundamentalsTable
          tickers={ALL_EQUITIES}
          metrics={['pe', 'marketCap', 'revenue', 'grossMargins', 'profitMargins', 'returnOnEquity']}
          title="All Retail Equities - Key Metrics"
          onTickerClick={(symbol) => openDetail(symbol, 'Global Retail & Consumer')}
          statsMap={statsMap}
        />
      ),
    },
    {
      id: 'valuation',
      title: 'Valuation Scatter (P/E vs Mkt Cap)',
      component: () => (
        <SectorScatterPlot
          data={scatterData}
          xLabel="P/E Ratio"
          yLabel="Market Cap ($ Billions)"
          height={280}
          onDotClick={(symbol) => openDetail(symbol, 'Global Retail & Consumer')}
        />
      ),
    },
    {
      id: 'earnings-calendar',
      title: 'Upcoming Earnings',
      span: 'full',
      component: EarningsSection,
    },
  ], [statsMap, statsLoading, statsError, statsRefresh, scatterData, openDetail]);

  return (
    <FullPageScreenLayout
      title="GLOBAL RETAIL"
      subtitle="Consumer discretionary, staples, luxury, e-commerce, and specialty retail"
      accentColor="#e91e63"
      vaultSector="retail"
      sections={sections}
      tickerBanner={BANNER_TICKERS}
      lastUpdated={new Date()}
      aiType="sector"
      aiContext={{ sector: 'Global Retail & Consumer', tickers: ['WMT', 'COST', 'TGT', 'NKE'] }}
      aiCacheKey="sector:retail"
    >
      <SectorPulse
        etfTicker="XRT"
        etfLabel="XRT"
        accentColor="#e91e63"
      />
    </FullPageScreenLayout>
  );
}

export default memo(GlobalRetailScreenImpl);
