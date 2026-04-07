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
import { memo, useMemo } from 'react';
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

/* ── Helper row components ──────────────────────────────────────────────── */
function CommodityRow({ symbol, label }) {
  const q = useTickerPrice(symbol);
  const openDetail = useOpenDetail();
  return (
    <tr className="ds-row-clickable" onClick={() => openDetail(symbol)}>
      <td className="ds-ticker-col">{label || symbol}</td>
      <td>{fmt(q?.price, 2)}</td>
      <td className={q?.changePct != null && q.changePct >= 0 ? 'ds-up' : 'ds-down'}>
        {fmtPct(q?.changePct)}
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
    <tr className="ds-row-clickable" onClick={() => openDetail(symbol)}>
      <td className="ds-ticker-col">{symbol}</td>
      <td style={{ fontSize: 10 }}>{PRODUCER_LABELS[symbol] || '—'}</td>
      <td>{fmt(q?.price, 2)}</td>
      <td className={q?.changePct != null && q.changePct >= 0 ? 'ds-up' : 'ds-down'}>{fmtPct(q?.changePct)}</td>
      <td style={{ fontFamily: 'monospace', fontSize: 10, color: '#888' }}>{fmtB(mktCap)}</td>
      <td style={{ fontFamily: 'monospace', fontSize: 10, color: '#ccc' }}>{pe != null ? parseFloat(pe).toFixed(1) + 'x' : '—'}</td>
      <td style={{ fontFamily: 'monospace', fontSize: 10, color: '#66bb6a' }}>
        {divYield != null ? (parseFloat(divYield) * 100).toFixed(1) + '%' : '—'}
      </td>
    </tr>
  );
}

/* ── Section components (memoized) ──────────────────────────────────────── */
function SectorChartsSection() {
  return <SectorChartPanel tickers={SECTOR_CHART_TICKERS} height={200} cols={3} />;
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
        <div style={{ fontSize: 10, color: '#ff9800', padding: '6px 4px 2px', borderTop: '1px solid #1a1a1a' }}>
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
    return <div style={{ padding: '10px', color: '#666', fontSize: 10, textAlign: 'center' }}>No futures data</div>;
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
          <XAxis dataKey="name" style={{ fontSize: 8, fill: '#666' }} />
          <YAxis style={{ fontSize: 8, fill: '#666' }} />
          <Tooltip
            contentStyle={{ background: '#0a0a0a', border: '1px solid #1e1e1e', borderRadius: 3 }}
            labelStyle={{ color: '#e0e0e0' }}
          />
          <Line
            type="monotone"
            dataKey="price"
            stroke={isContango ? '#4caf50' : '#ff9800'}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
      <div style={{ fontSize: 9, color: '#ff9800', padding: '6px 4px 2px', borderTop: '1px solid #1a1a1a', textAlign: 'center' }}>
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
              <th style={{ fontSize: 9 }}>Mkt Cap</th><th style={{ fontSize: 9 }}>P/E</th><th style={{ fontSize: 9 }}>Div%</th>
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
              <th style={{ fontSize: 9 }}>Mkt Cap</th><th style={{ fontSize: 9 }}>P/E</th><th style={{ fontSize: 9 }}>Div%</th>
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
          <tr style={{ borderBottom: '1px solid #1a1a1a' }}>
            <td style={{ padding: '6px 0', color: '#aaa' }}>WTI-Brent Spread</td>
            <td style={{ padding: '6px 0', textAlign: 'right', color: wtiSpread != null && wtiSpread > 0 ? '#4caf50' : '#f44336', fontWeight: 500 }}>
              {wtiSpread != null ? `$${wtiSpread.toFixed(2)}/bbl` : '—'}
            </td>
          </tr>
          <tr>
            <td style={{ padding: '6px 0', color: '#aaa' }}>Gold/Silver Ratio</td>
            <td style={{ padding: '6px 0', textAlign: 'right', fontFamily: 'monospace', fontWeight: 500, color: '#e0e0e0' }}>
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
  const openDetail = useOpenDetail();
  return (
    <div style={{ padding: '0 6px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(80px, 1fr))', gap: '1px', background: '#1e1e1e' }}>
      {ETF_SYMBOLS.map(sym => (
        <EtfCell key={sym} sym={sym} onClick={openDetail} />
      ))}
    </div>
  );
});

function CommoditiesScreenImpl() {
  const { data: statsMap, loading: statsLoading, error: statsError, refresh: statsRefresh } = useDeepScreenData(ALL_PRODUCERS);

  const sections = useMemo(() => [
    {
      id: 'sector-charts',
      title: 'Sector Charts',
      component: SectorChartsSection,
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
    >
      <div style={{ padding: '16px 6px' }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: '#e0e0e0', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.5 }}>Fundamentals Comparison</div>
        <FundamentalsTable
          tickers={ALL_PRODUCERS}
          metrics={['pe', 'marketCap', 'ebitda', 'profitMargins', 'returnOnEquity', 'beta']}
          onTickerClick={(ticker) => {
            // Navigation happens via OpenDetailContext in the component
          }}
        />
      </div>

      <div style={{ padding: '16px 6px' }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: '#e0e0e0', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.5 }}>Insider Activity</div>
        <InsiderActivity tickers={INSIDER_TICKERS} limit={5} />
      </div>

      <div style={{ padding: '16px 6px' }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: '#e0e0e0', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.5 }}>Commodity ETFs</div>
        <EtfStripSection />
      </div>
    </FullPageScreenLayout>
  );
}

export default memo(CommoditiesScreenImpl);
