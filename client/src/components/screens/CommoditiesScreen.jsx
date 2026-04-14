/**
 * CommoditiesScreen.jsx — S5.5 (comprehensive full-page)
 * Absorbs Energy screen content. Full-page layout with:
 * - Sector Charts (CL, GC, NG, HG, SI, BZ)
 * - Energy Futures (WTI, Brent, NatGas, RBOB Gasoline)
 * - Precious Metals (Gold, Silver, Copper, Platinum)
 * - Agriculture & Softs (Wheat, Corn, Soy, Coffee, Sugar, Cotton)
 * - Futures Term Structure (via useSectionData)
 * - Energy Majors (XOM, CVX, SHEL, BP, COP, TTE)
 * - Mining Majors (BHP, RIO, FCX, NEM, VALE, GOLD, AA)
 * - Fundamentals Comparison (all producers)
 * - Spread Analysis (WTI-Brent, Gold/Silver ratio)
 * - Commodity ETFs
 */
import { memo, useMemo, useState } from 'react';
import FullPageScreenLayout from './shared/FullPageScreenLayout';
import SectorPulse from './shared/SectorPulse';
import { FundamentalsTable } from './shared/FundamentalsTable';
import { SectorChartPanel } from './shared/SectorChartPanel';
import { useOpenDetail } from '../../context/OpenDetailContext';
import { useTickerPrice } from '../../context/PriceContext';
import { useDeepScreenData } from '../../hooks/useDeepScreenData';
import { DeepSkeleton, DeepError, StatsLoadGate } from './DeepScreenBase';
import { KPIRibbon, TickerRibbon } from './shared/SectorUI';
import { CorrelationMatrix } from './shared/CorrelationMatrix';
import { EarningsCalendarStrip } from './shared/EarningsCalendarStrip';
import { AnalystActionsCard } from './shared/AnalystActionsCard';

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

// Commodity & Energy Futures for charts & tables
const SECTOR_CHART_TICKERS = ['CL=F', 'GC=F', 'NG=F', 'HG=F', 'SI=F', 'BZ=F', 'DX-Y.NYB'];

const ENERGY_FUTURES = [
  { symbol: 'CL=F', label: 'WTI Crude Oil' },
  { symbol: 'BZ=F', label: 'Brent Crude Oil' },
  { symbol: 'NG=F', label: 'Natural Gas' },
  { symbol: 'RB=F', label: 'RBOB Gasoline' },
];

const PRECIOUS_METALS = [
  { symbol: 'GC=F', label: 'Gold' },
  { symbol: 'SI=F', label: 'Silver' },
  { symbol: 'HG=F', label: 'Copper' },
  { symbol: 'PL=F', label: 'Platinum' },
];

const AGRICULTURE_SOFTS = [
  { symbol: 'ZW=F', label: 'Wheat' },
  { symbol: 'ZC=F', label: 'Corn' },
  { symbol: 'ZS=F', label: 'Soybeans' },
  { symbol: 'KC=F', label: 'Coffee' },
  { symbol: 'SB=F', label: 'Sugar' },
  { symbol: 'CT=F', label: 'Cotton' },
];

// Producer equities
const ENERGY_MAJORS = ['XOM', 'CVX', 'SHEL', 'BP', 'COP', 'TTE'];
const MINING_MAJORS = ['BHP', 'RIO', 'FCX', 'NEM', 'VALE', 'GOLD', 'AA'];
const ALL_PRODUCERS = [...ENERGY_MAJORS, ...MINING_MAJORS];

const PRODUCER_LABELS = {
  XOM: 'Exxon Mobil', CVX: 'Chevron', SHEL: 'Shell', BP: 'BP', COP: 'ConocoPhillips', TTE: 'TotalEnergies',
  BHP: 'BHP Group', RIO: 'Rio Tinto', FCX: 'Freeport-McMoRan', NEM: 'Newmont', VALE: 'Vale', GOLD: 'Barrick Gold', AA: 'Alcoa',
};

const ETF_SYMBOLS = ['DBC', 'USO', 'GLD', 'SLV', 'PDBC', 'CPER', 'UNG', 'CORN', 'WEAT', 'SOYB'];

// Data-depth component tickers
const COMMODITY_EARNINGS_TICKERS = ['XOM', 'CVX', 'SHEL', 'BP', 'COP', 'BHP', 'RIO', 'NEM'];
const COMMODITY_OWNERSHIP_TICKERS = ['XOM', 'CVX', 'SHEL', 'BHP', 'RIO', 'FCX'];
const COMMODITY_SIGNALS_TICKERS = ['XOM', 'CVX', 'SHEL', 'BHP', 'RIO', 'FCX', 'NEM', 'VALE'];
const COMMODITY_ANALYST_TICKERS = ['XOM', 'CVX', 'SHEL', 'BHP', 'RIO', 'NEM'];
const SENTIMENT_TICKERS = ['XOM', 'CVX', 'BHP', 'RIO', 'NEM', 'FCX'];

const BANNER_TICKERS = [
  { ticker: 'BZ=F', label: 'BRENT' },
  { ticker: 'CL=F', label: 'WTI' },
  { ticker: 'GC=F', label: 'GOLD' },
  { ticker: 'SI=F', label: 'SILVER' },
  { ticker: 'NG=F', label: 'NATGAS' },
  { ticker: 'HG=F', label: 'COPPER' },
  { ticker: 'PL=F', label: 'PLATINUM' },
  { ticker: 'DX-Y.NYB', label: 'DXY INDEX' },
  { ticker: 'DBC',  label: 'DBC ETF' },
  { ticker: 'USO',  label: 'USO ETF' },
  { ticker: 'GLD',  label: 'GLD ETF' },
];

/* ── KPI Ribbon ────────────────────────────────────────────────────────── */
function CommodityKPIRibbon() {
  const brent  = useTickerPrice('BZ=F');
  const wti    = useTickerPrice('CL=F');
  const gold   = useTickerPrice('GC=F');
  const silver = useTickerPrice('SI=F');
  const natgas = useTickerPrice('NG=F');

  // Computed spreads and ratios — more useful than raw stock prices
  const brentWtiSpread = (brent?.price != null && wti?.price != null)
    ? (brent.price - wti.price) : null;
  const goldSilverRatio = (gold?.price != null && silver?.price != null && silver.price > 0)
    ? (gold.price / silver.price) : null;

  const items = [
    { label: 'BRENT CRUDE', value: brent?.price != null ? '$' + fmt(brent.price) : '—', change: brent?.changePct },
    { label: 'GOLD',        value: gold?.price != null ? '$' + fmt(gold.price, 0) : '—', change: gold?.changePct },
    { label: 'BRENT-WTI',   value: brentWtiSpread != null ? '$' + brentWtiSpread.toFixed(2) : '—', suffix: '/bbl' },
    { label: 'GOLD/SILVER', value: goldSilverRatio != null ? goldSilverRatio.toFixed(1) + 'x' : '—' },
    { label: 'NAT GAS',     value: natgas?.price != null ? '$' + fmt(natgas.price) : '—', change: natgas?.changePct },
  ];
  return <KPIRibbon items={items} accentColor="#ff9800" />;
}

/* ── Helper row components ──────────────────────────────────────────────── */
function CommodityRow({ symbol, label }) {
  const q = useTickerPrice(symbol);
  const openDetail = useOpenDetail();
  return (
    <tr
      className="ds-row-clickable"
      onClick={() => openDetail(symbol, 'Commodities')}
      onTouchEnd={(e) => { e.preventDefault(); openDetail(symbol, 'Commodities'); }}
    >
      <td className="ds-ticker-col">{label || symbol}</td>
      <td style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
        {q?.price != null ? fmt(q?.price, 2) : <span className="ds-dash">—</span>}
      </td>
      <td className={q?.changePct != null && q.changePct >= 0 ? 'ds-up' : 'ds-down'}>
        {q?.changePct != null ? fmtPct(q?.changePct) : <span className="ds-dash">—</span>}
      </td>
    </tr>
  );
}

function ProducerRow({ symbol, stats }) {
  const q = useTickerPrice(symbol);
  const openDetail = useOpenDetail();
  const pe = stats?.pe_ratio;
  const mktCap = stats?.market_capitalization;
  const divYield = stats?.dividend_yield;
  return (
    <tr
      className="ds-row-clickable"
      onClick={() => openDetail(symbol, 'Commodities')}
      onTouchEnd={(e) => { e.preventDefault(); openDetail(symbol, 'Commodities'); }}
    >
      <td className="ds-ticker-col">{symbol}</td>
      <td>{PRODUCER_LABELS[symbol] || <span className="ds-dash">—</span>}</td>
      <td style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
        {q?.price != null ? fmt(q.price, 2) : <span className="ds-dash">—</span>}
      </td>
      <td className={q?.changePct != null && q.changePct >= 0 ? 'ds-up' : 'ds-down'}>
        {q?.changePct != null ? fmtPct(q?.changePct) : <span className="ds-dash">—</span>}
      </td>
      <td>
        {fmtB(mktCap) || <span className="ds-dash">—</span>}
      </td>
      <td>
        {pe != null ? parseFloat(pe).toFixed(1) + 'x' : <span className="ds-dash">—</span>}
      </td>
      <td>
        {divYield != null ? (parseFloat(divYield) * 100).toFixed(1) + '%' : <span className="ds-dash">—</span>}
      </td>
    </tr>
  );
}

/* ── Section components (memoized) ──────────────────────────────────────── */
function SectorChartsSection({ selectedTicker, onChartClick }) {
  return <SectorChartPanel tickers={SECTOR_CHART_TICKERS} height={200} cols={3} selectedTicker={selectedTicker} onChartClick={onChartClick} />;
}

function EnergyFuturesSection() {
  return (
    <div style={{ padding: '0 6px', overflow: 'auto' }}>
      <table className="ds-table">
        <thead><tr><th>Contract</th><th>Price</th><th>1D%</th></tr></thead>
        <tbody>
          {ENERGY_FUTURES.map(({ symbol, label }) => (
            <CommodityRow key={symbol} symbol={symbol} label={label} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PreciousMetalsSection() {
  const gold = useTickerPrice('GC=F');
  const silver = useTickerPrice('SI=F');
  const gsRatio = (gold?.price != null && silver?.price != null && silver.price > 0)
    ? (gold.price / silver.price)
    : null;

  return (
    <div style={{ padding: '0 6px', overflow: 'auto' }}>
      <table className="ds-table">
        <thead><tr><th>Metal</th><th>Price</th><th>1D%</th></tr></thead>
        <tbody>
          {PRECIOUS_METALS.map(({ symbol, label }) => (
            <CommodityRow key={symbol} symbol={symbol} label={label} />
          ))}
        </tbody>
      </table>
      {gsRatio != null && (
        <div style={{ fontSize: 10, color: 'var(--semantic-warn)', padding: '6px 4px 2px', borderTop: '1px solid var(--border-subtle)' }}>
          Gold/Silver Ratio: {gsRatio.toFixed(2)}x
        </div>
      )}
    </div>
  );
}

function AgricultureSoftsSection() {
  return (
    <div style={{ padding: '0 6px', overflow: 'auto' }}>
      <table className="ds-table">
        <thead><tr><th>Commodity</th><th>Price</th><th>1D%</th></tr></thead>
        <tbody>
          {AGRICULTURE_SOFTS.map(({ symbol, label }) => (
            <CommodityRow key={symbol} symbol={symbol} label={label} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FuturesTermStructureSection() {
  return (
    <div>
      <FuturesCurveChart symbol="BZ" title="Brent Crude Oil Futures Curve" accentColor="#ff9800" height={220} />
    </div>
  );
}

function GoldFuturesCurveSection() {
  return (
    <div>
      <FuturesCurveChart symbol="GC" title="Gold Futures Curve" accentColor="#ffd700" height={220} />
    </div>
  );
}

function CommodityCorrelationSection() {
  return (
    <CorrelationMatrix
      tickers={['CL=F', 'BZ=F', 'GC=F', 'SI=F', 'NG=F', 'HG=F', 'XOM', 'CVX', 'BHP']}
      labels={{ 'CL=F': 'WTI', 'BZ=F': 'Brent', 'GC=F': 'Gold', 'SI=F': 'Silver', 'NG=F': 'NatGas', 'HG=F': 'Copper' }}
      title="Commodity Correlation Matrix"
      accentColor="#ff9800"
      days={60}
    />
  );
}

function CommodityEarningsSection() {
  return <EarningsCalendarStrip tickers={COMMODITY_EARNINGS_TICKERS} accentColor="#ff9800" />;
}

function CommodityAnalystSection() {
  return <AnalystActionsCard tickers={COMMODITY_ANALYST_TICKERS} limit={10} accentColor="#ff9800" />;
}

const EnergyMajorsSection = memo(function EnergyMajorsSection({ statsMap, loading, error, refresh }) {
  return (
    <StatsLoadGate statsMap={statsMap} loading={loading} error={error} refresh={refresh} rows={6}>
      <div style={{ padding: '0 6px', overflow: 'auto' }}>
        <table className="ds-table">
          <thead>
            <tr>
              <th>Ticker</th><th>Company</th><th>Price</th><th>1D%</th>
              <th>Mkt Cap</th><th>P/E</th><th>Div%</th>
            </tr>
          </thead>
          <tbody>
            {ENERGY_MAJORS.map(sym => <ProducerRow key={sym} symbol={sym} stats={statsMap.get(sym)} />)}
          </tbody>
        </table>
      </div>
    </StatsLoadGate>
  );
});

const MiningMajorsSection = memo(function MiningMajorsSection({ statsMap, loading, error, refresh }) {
  return (
    <StatsLoadGate statsMap={statsMap} loading={loading} error={error} refresh={refresh} rows={7}>
      <div style={{ padding: '0 6px', overflow: 'auto' }}>
        <table className="ds-table">
          <thead>
            <tr>
              <th>Ticker</th><th>Company</th><th>Price</th><th>1D%</th>
              <th>Mkt Cap</th><th>P/E</th><th>Div%</th>
            </tr>
          </thead>
          <tbody>
            {MINING_MAJORS.map(sym => <ProducerRow key={sym} symbol={sym} stats={statsMap.get(sym)} />)}
          </tbody>
        </table>
      </div>
    </StatsLoadGate>
  );
});

function SpreadAnalysisSection() {
  const wti = useTickerPrice('CL=F');
  const brent = useTickerPrice('BZ=F');
  const gold = useTickerPrice('GC=F');
  const silver = useTickerPrice('SI=F');

  const wtiSpread = (brent?.price != null && wti?.price != null) ? (brent.price - wti.price) : null;
  const gsRatio = (gold?.price != null && silver?.price != null && silver.price > 0)
    ? (gold.price / silver.price)
    : null;

  return (
    <div style={{ padding: '12px', fontSize: 13 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <tbody>
          <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
            <td style={{ padding: '10px 8px', color: 'var(--text-secondary)', fontSize: 13, width: '50%' }}>WTI-Brent Spread</td>
            <td style={{ padding: '10px 8px', textAlign: 'right', color: wtiSpread != null && wtiSpread > 0 ? 'var(--semantic-up)' : 'var(--semantic-down)', fontWeight: 600, fontSize: 14, fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}>
              {wtiSpread != null ? `$${wtiSpread.toFixed(2)}/bbl` : '—'}
            </td>
          </tr>
          <tr>
            <td style={{ padding: '10px 8px', color: 'var(--text-secondary)', fontSize: 13, width: '50%' }}>Gold/Silver Ratio</td>
            <td style={{ padding: '10px 8px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 14, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
              {gsRatio != null ? `${gsRatio.toFixed(2)}x` : '—'}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function EtfCell({ sym, onClick }) {
  const q = useTickerPrice(sym);
  return (
    <TickerCell
      symbol={sym}
      price={q?.price}
      changePct={q?.changePct}
      onClick={onClick}
    />
  );
}

const EtfStripSection = memo(function EtfStripSection() {
  return <TickerRibbon tickers={ETF_SYMBOLS} sectorName="Commodities" />;
});

function CommoditiesScreenImpl() {
  const { data: statsMap, loading: statsLoading, error: statsError, refresh: statsRefresh } = useDeepScreenData(ALL_PRODUCERS);
  const [selectedTicker, setSelectedTicker] = useState(null);

  const sections = useMemo(() => [
    {
      id: 'energy-futures',
      title: 'Energy Futures',
      component: EnergyFuturesSection,
    },
    {
      id: 'precious-metals',
      title: 'Precious Metals',
      component: PreciousMetalsSection,
    },
    {
      id: 'agriculture',
      title: 'Agriculture & Softs',
      component: AgricultureSoftsSection,
      span: 'full',
    },
    {
      id: 'energy-majors',
      title: 'Energy Majors',
      component: () => <EnergyMajorsSection statsMap={statsMap} loading={statsLoading} error={statsError} refresh={statsRefresh} />,
    },
    {
      id: 'mining-majors',
      title: 'Mining Majors',
      component: () => <MiningMajorsSection statsMap={statsMap} loading={statsLoading} error={statsError} refresh={statsRefresh} />,
    },
    {
      id: 'correlation',
      title: 'Commodity Correlations',
      span: 'full',
      component: CommodityCorrelationSection,
    },
    {
      id: 'earnings-calendar',
      title: 'Upcoming Earnings',
      span: 'full',
      component: CommodityEarningsSection,
    },
    {
      id: 'analyst-actions',
      title: 'Analyst Actions',
      component: CommodityAnalystSection,
    },
  ], [statsMap, statsLoading, statsError, statsRefresh]);

  return (
    <FullPageScreenLayout
      title="COMMODITIES"
      subtitle="Energy, metals, agriculture — futures, producers, and supply chain"
      accentColor="#ff9800"
      vaultSector="commodities"
      sections={sections}
      tickerBanner={BANNER_TICKERS}
      aiType="commodity"
      aiContext={{ sector: 'Commodities', tickers: ['GLD', 'SLV', 'USO', 'CPER'] }}
      aiCacheKey="commodity:overview"
    >
      <SectorPulse
        etfTicker="DJP"
        etfLabel="DJP"
        accentColor="#ff9800"
      />
      <div style={{ padding: '16px 6px' }}>
        <div className="section-header">Fundamentals Comparison</div>
        <FundamentalsTable
          tickers={ALL_PRODUCERS}
          metrics={['pe', 'marketCap', 'ebitda', 'profitMargins', 'returnOnEquity', 'beta']}
          onTickerClick={(ticker) => {
            // Navigation happens via OpenDetailContext in the component
          }}
          statsMap={statsMap}
        />
      </div>
    </FullPageScreenLayout>
  );
}

export default memo(CommoditiesScreenImpl);
