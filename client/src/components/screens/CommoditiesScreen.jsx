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
 * - Insider Activity (top 6 producers)
 * - Commodity ETFs
 */
import { memo, useMemo, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import FullPageScreenLayout from './shared/FullPageScreenLayout';
import { FundamentalsTable } from './shared/FundamentalsTable';
import { SectorChartPanel } from './shared/SectorChartPanel';
import { InsiderActivity } from './shared/InsiderActivity';
import { useOpenDetail } from '../../context/OpenDetailContext';
import { useTickerPrice } from '../../context/PriceContext';
import { useDeepScreenData } from '../../hooks/useDeepScreenData';
import { useSectionData } from '../../hooks/useSectionData';
import { apiFetch } from '../../utils/api';
import { DeepSkeleton, DeepError, StatsLoadGate, TickerCell } from './DeepScreenBase';
import { KPIRibbon, heatColor, TickerRibbon } from './shared/SectorUI';

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
const SECTOR_CHART_TICKERS = ['CL=F', 'GC=F', 'NG=F', 'HG=F', 'SI=F', 'BZ=F'];

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

const INSIDER_TICKERS = ['XOM', 'CVX', 'BHP', 'RIO', 'FCX', 'NEM'];
const ETF_SYMBOLS = ['DBC', 'USO', 'GLD', 'SLV', 'PDBC', 'CPER', 'UNG', 'CORN', 'WEAT', 'SOYB'];

/* ── KPI Ribbon ────────────────────────────────────────────────────────── */
function CommodityKPIRibbon() {
  const wti   = useTickerPrice('CL=F');
  const gold  = useTickerPrice('GC=F');
  const natgas = useTickerPrice('NG=F');
  const xom   = useTickerPrice('XOM');
  const items = [
    { label: 'WTI CRUDE', value: wti?.price != null ? '$' + fmt(wti.price) : '—', change: wti?.changePct },
    { label: 'GOLD',      value: gold?.price != null ? '$' + fmt(gold.price) : '—', change: gold?.changePct },
    { label: 'NAT GAS',   value: natgas?.price != null ? '$' + fmt(natgas.price) : '—', change: natgas?.changePct },
    { label: 'EXXON',     value: xom?.price != null ? '$' + fmt(xom.price) : '—', change: xom?.changePct },
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
      <td className="ds-ticker-col" style={{ fontSize: 13 }}>{label || symbol}</td>
      <td style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 600, fontVariantNumeric: 'tabular-nums', fontFamily: 'var(--font-mono)' }}>
        {q?.price != null ? fmt(q?.price, 2) : <span className="ds-dash">—</span>}
      </td>
      <td className={q?.changePct != null && q.changePct >= 0 ? 'ds-up' : 'ds-down'} style={{ fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums', fontFamily: 'var(--font-mono)', background: heatColor(q?.changePct) }}>
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
      <td className="ds-ticker-col" style={{ fontSize: 13, letterSpacing: '0.5px' }}>{symbol}</td>
      <td style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{PRODUCER_LABELS[symbol] || <span className="ds-dash">—</span>}</td>
      <td style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 600, fontVariantNumeric: 'tabular-nums', fontFamily: 'var(--font-mono)' }}>
        {q?.price != null ? '$' + fmt(q.price, 2) : <span className="ds-dash">—</span>}
      </td>
      <td className={q?.changePct != null && q.changePct >= 0 ? 'ds-up' : 'ds-down'} style={{ fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums', fontFamily: 'var(--font-mono)', background: heatColor(q?.changePct) }}>
        {q?.changePct != null ? fmtPct(q?.changePct) : <span className="ds-dash">—</span>}
      </td>
      <td style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
        {fmtB(mktCap) || <span className="ds-dash">—</span>}
      </td>
      <td style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
        {pe != null ? parseFloat(pe).toFixed(1) + 'x' : <span className="ds-dash">—</span>}
      </td>
      <td style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--price-up, #4caf50)', fontVariantNumeric: 'tabular-nums' }}>
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
  const { data: clData, loading: clLoading, error: clError } = useSectionData({
    cacheKey: 'futures:cl-term-structure',
    fetcher: async () => {
      const res = await apiFetch('/api/derivatives/futures/CL');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    refreshMs: 300000, // 5 min
  });

  if (clLoading) return <DeepSkeleton rows={6} />;
  if (clError) return <DeepError message={`Error: ${clError}`} />;
  if (!clData || !Array.isArray(clData)) {
    return <div style={{ padding: '10px', color: 'var(--text-muted)', fontSize: 10, textAlign: 'center' }}>No futures data</div>;
  }

  // Prepare chart data from futures contracts
  const chartData = clData.slice(0, 12).map((contract, idx) => ({
    name: contract.expiry || `M${idx + 1}`,
    price: parseFloat(contract.price) || 0,
  }));

  const firstPrice = chartData[0]?.price || 0;
  const lastPrice = chartData[chartData.length - 1]?.price || 0;
  const isContango = lastPrice > firstPrice;

  return (
    <div style={{ padding: '0 6px', overflow: 'auto' }}>
      <ResponsiveContainer width="100%" height={250}>
        <LineChart data={chartData} margin={{ top: 5, right: 30, left: 0, bottom: 30 }}>
          <XAxis dataKey="name" style={{ fontSize: 8, fill: 'var(--text-muted)' }} />
          <YAxis style={{ fontSize: 8, fill: 'var(--text-muted)' }} />
          <Tooltip
            contentStyle={{ background: 'var(--bg-panel)', border: '1px solid var(--border-default)', borderRadius: 3 }}
            labelStyle={{ color: 'var(--text-primary)' }}
          />
          <Line
            type="monotone"
            dataKey="price"
            stroke={isContango ? 'var(--semantic-up)' : 'var(--semantic-warn)'}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
      <div style={{ fontSize: 9, color: 'var(--semantic-warn)', padding: '6px 4px 2px', borderTop: '1px solid var(--border-subtle)', textAlign: 'center' }}>
        {isContango ? 'CONTANGO' : 'BACKWARDATION'}
      </div>
    </div>
  );
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
    <div style={{ padding: '8px 6px', fontSize: 10 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <tbody>
          <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
            <td style={{ padding: '6px 0', color: 'var(--text-secondary)' }}>WTI-Brent Spread</td>
            <td style={{ padding: '6px 0', textAlign: 'right', color: wtiSpread != null && wtiSpread > 0 ? 'var(--semantic-up)' : 'var(--semantic-down)', fontWeight: 500 }}>
              {wtiSpread != null ? `$${wtiSpread.toFixed(2)}/bbl` : '—'}
            </td>
          </tr>
          <tr>
            <td style={{ padding: '6px 0', color: 'var(--text-secondary)' }}>Gold/Silver Ratio</td>
            <td style={{ padding: '6px 0', textAlign: 'right', fontFamily: 'monospace', fontWeight: 500, color: 'var(--text-primary)' }}>
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
      id: 'kpi',
      title: 'KEY METRICS',
      span: 'full',
      component: CommodityKPIRibbon,
    },
    {
      id: 'sector-charts',
      title: 'Sector Charts',
      component: () => <SectorChartsSection selectedTicker={selectedTicker} onChartClick={setSelectedTicker} />,
      span: 'full',
    },
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
      id: 'futures-term-structure',
      title: 'Futures Term Structure',
      component: FuturesTermStructureSection,
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
      id: 'spread-analysis',
      title: 'Spread Analysis',
      component: SpreadAnalysisSection,
    },
  ], [statsMap, statsLoading, statsError, statsRefresh]);

  return (
    <FullPageScreenLayout
      title="COMMODITIES"
      subtitle="Energy, metals, agriculture — futures, producers, and supply chain"
      accentColor="#ff9800"
      sections={sections}
      aiType="commodity"
      aiContext={{ sector: 'Commodities', tickers: ['GLD', 'SLV', 'USO', 'CPER'] }}
      aiCacheKey="commodity:overview"
    >
      <div style={{ padding: '16px 6px' }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.5 }}>Fundamentals Comparison</div>
        <FundamentalsTable
          tickers={ALL_PRODUCERS}
          metrics={['pe', 'marketCap', 'ebitda', 'profitMargins', 'returnOnEquity', 'beta']}
          onTickerClick={(ticker) => {
            // Navigation happens via OpenDetailContext in the component
          }}
          statsMap={statsMap}
        />
      </div>

      <div style={{ padding: '16px 6px' }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.5 }}>Insider Activity</div>
        <InsiderActivity tickers={INSIDER_TICKERS} limit={5} />
      </div>

      <div style={{ padding: '16px 6px' }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.5 }}>Commodity ETFs</div>
        <EtfStripSection />
      </div>
    </FullPageScreenLayout>
  );
}

export default memo(CommoditiesScreenImpl);
