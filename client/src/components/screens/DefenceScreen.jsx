/**
 * DefenceScreen.jsx — Full-page Sector Screen
 * Comprehensive Defence & Aerospace coverage for the Senger Market Terminal.
 * Integrates FullPageScreenLayout, FundamentalsTable, SectorChartPanel, SectorScatterPlot,
 * MiniFinancials, and InsiderActivity for multi-dimensional sector analysis.
 */
import { memo, useMemo, useState } from 'react';
import FullPageScreenLayout from './shared/FullPageScreenLayout';
import { FundamentalsTable } from './shared/FundamentalsTable';
import { SectorChartPanel } from './shared/SectorChartPanel';
import { SectorScatterPlot } from './shared/SectorScatterPlot';
import { MiniFinancials } from './shared/MiniFinancials';
import { InsiderActivity } from './shared/InsiderActivity';
import { useOpenDetail } from '../../context/OpenDetailContext';
import { useTickerPrice } from '../../context/PriceContext';
import { useDeepScreenData } from '../../hooks/useDeepScreenData';
import DeepScreenBase, { TickerCell } from './DeepScreenBase';

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

/* ── Sector Tickers ────────────────────────────────────────────────────── */
const US_PRIMES   = ['LMT', 'NOC', 'RTX', 'BA', 'GD', 'LHX'];
const EU_DEFENCE  = [
  { symbol: 'BAESY', name: 'BAE Systems' },
  { symbol: 'RNMBY', name: 'Rheinmetall' },
  { symbol: 'EADSY', name: 'Airbus Defence' },
  { symbol: 'SAABF', name: 'Saab' },
  { symbol: 'FINMY', name: 'Leonardo' },
  { symbol: 'THLEF', name: 'Thales' },
];
const SUPPLY_CHAIN = ['LDOS', 'BWXT', 'HII', 'MRCY', 'AXON', 'TDG'];
const SPACE_CYBER  = ['RKLB', 'PLTR', 'KTOS', 'SPR', 'IRDM'];
const ETFS         = ['ITA', 'XAR', 'PPA', 'DFEN', 'UFO'];

const CHART_TICKERS = ['LMT', 'RTX', 'BA', 'NOC', 'GD', 'BAESY'];
const TOP_PRIMES_FOR_CHARTS = ['LMT', 'RTX', 'BA'];

const LABELS = {
  LMT: 'Lockheed Martin', NOC: 'Northrop Grumman', RTX: 'RTX Corp', BA: 'Boeing', GD: 'General Dynamics', LHX: 'L3Harris',
  LDOS: 'Leidos', BWXT: 'BWX Tech', HII: 'Huntington Ingalls', MRCY: 'Mercury Systems', AXON: 'Axon Enterprise', TDG: 'TransDigm',
  RKLB: 'Rocket Lab', PLTR: 'Palantir', KTOS: 'Kratos Defense', SPR: 'Spirit Aero', IRDM: 'Iridium',
};

const ALL_EQUITIES = [
  ...US_PRIMES,
  ...EU_DEFENCE.map(e => e.symbol),
  ...SUPPLY_CHAIN,
  ...SPACE_CYBER
];

/* ── Enhanced Table Row Component ──────────────────────────────────────── */
function EnhancedTableRow({ symbol, label, stats, onClick }) {
  const q = useTickerPrice(symbol);
  const pe = stats?.pe_ratio;
  const mktCap = stats?.market_capitalization;

  return (
    <tr className="ds-row-clickable" onClick={() => onClick(symbol)}>
      <td className="ds-ticker-col">{symbol}</td>
      <td>{label || LABELS[symbol] || '—'}</td>
      <td>{fmt(q?.price, 2)}</td>
      <td className={q?.changePct != null && q.changePct >= 0 ? 'ds-up' : 'ds-down'}>
        {fmtPct(q?.changePct)}
      </td>
      <td style={{ fontFamily: 'monospace', fontSize: 10, color: '#888' }}>
        {fmtB(mktCap)}
      </td>
      <td style={{ fontFamily: 'monospace', fontSize: 10, color: '#ccc' }}>
        {pe != null ? parseFloat(pe).toFixed(1) + 'x' : '—'}
      </td>
    </tr>
  );
}

/* ── Section Table Component ───────────────────────────────────────────── */
const SectionTable = memo(function SectionTable({ tickers, statsMap, labels, withMiniCharts }) {
  const openDetail = useOpenDetail();

  return (
    <div style={{ overflow: 'auto' }}>
      <table className="ds-table">
        <thead>
          <tr>
            <th>Ticker</th>
            <th>Name</th>
            <th>Price</th>
            <th>1D%</th>
            <th style={{ fontSize: 9 }}>Mkt Cap</th>
            <th style={{ fontSize: 9 }}>P/E</th>
            {withMiniCharts && <th style={{ fontSize: 9 }}>3-Year Financials</th>}
          </tr>
        </thead>
        <tbody>
          {tickers.map(t => {
            const sym = typeof t === 'string' ? t : t.symbol;
            const name = typeof t === 'string' ? undefined : t.name;
            return (
              <tr key={sym} className="ds-row-clickable" onClick={() => openDetail(sym)}>
                <td className="ds-ticker-col">{sym}</td>
                <td>{name || LABELS[sym] || '—'}</td>
                <td>{fmt(useTickerPrice(sym)?.price, 2)}</td>
                <td className={useTickerPrice(sym)?.changePct != null && useTickerPrice(sym)?.changePct >= 0 ? 'ds-up' : 'ds-down'}>
                  {fmtPct(useTickerPrice(sym)?.changePct)}
                </td>
                <td style={{ fontFamily: 'monospace', fontSize: 10, color: '#888' }}>
                  {fmtB(statsMap.get(sym)?.market_capitalization)}
                </td>
                <td style={{ fontFamily: 'monospace', fontSize: 10, color: '#ccc' }}>
                  {statsMap.get(sym)?.pe_ratio != null ? parseFloat(statsMap.get(sym)?.pe_ratio).toFixed(1) + 'x' : '—'}
                </td>
                {withMiniCharts && (
                  <td style={{ padding: '4px', maxWidth: 200 }}>
                    <MiniFinancials ticker={sym} onError={() => {}} />
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
});

/* ── ETF Strip Component ───────────────────────────────────────────────── */
const EtfStrip = memo(function EtfStrip() {
  const openDetail = useOpenDetail();
  return (
    <div className="ds-strip" style={{ display: 'flex', gap: 0, borderTop: '1px solid #1e1e1e' }}>
      {ETFS.map(sym => (
        <TickerCell
          key={sym}
          symbol={sym}
          price={useTickerPrice(sym)?.price}
          changePct={useTickerPrice(sym)?.changePct}
          onClick={openDetail}
        />
      ))}
    </div>
  );
});

/* ── Main Screen Implementation ────────────────────────────────────────── */
function DefenceScreenImpl() {
  const openDetail = useOpenDetail();
  const { data: statsMap } = useDeepScreenData(ALL_EQUITIES);
  const [selectedScatterTicker, setSelectedScatterTicker] = useState(null);

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
      id: 'charts',
      title: 'Sector Charts',
      span: 'full',
      component: () => (
        <SectorChartPanel
          tickers={CHART_TICKERS}
          height={200}
          cols={2}
        />
      ),
    },
    {
      id: 'us-primes',
      title: 'US Defence Primes',
      component: () => (
        <SectionTable tickers={US_PRIMES} statsMap={statsMap} withMiniCharts={true} />
      ),
    },
    {
      id: 'eu-defence',
      title: 'EU Defence (ADRs)',
      component: () => (
        <SectionTable tickers={EU_DEFENCE} statsMap={statsMap} />
      ),
    },
    {
      id: 'fundamentals',
      title: 'Fundamentals Comparison',
      span: 'full',
      component: () => (
        <FundamentalsTable
          tickers={ALL_EQUITIES}
          metrics={['pe', 'marketCap', 'revenue', 'grossMargins', 'operatingMargins', 'returnOnEquity']}
          title="All Equities - Key Metrics"
          onTickerClick={openDetail}
        />
      ),
    },
    {
      id: 'supply-chain',
      title: 'Supply Chain & Tech',
      component: () => (
        <SectionTable tickers={SUPPLY_CHAIN} statsMap={statsMap} />
      ),
    },
    {
      id: 'space-cyber',
      title: 'Space & Cyber',
      component: () => (
        <SectionTable tickers={SPACE_CYBER} statsMap={statsMap} />
      ),
    },
    {
      id: 'insider',
      title: 'Insider Activity',
      span: 'full',
      component: () => (
        <InsiderActivity
          tickers={US_PRIMES}
          limit={10}
          onTickerClick={openDetail}
        />
      ),
    },
    {
      id: 'valuation',
      title: 'Valuation Scatter (P/E vs Mkt Cap)',
      span: 'full',
      component: () => (
        <SectorScatterPlot
          data={scatterData}
          xLabel="P/E Ratio"
          yLabel="Market Cap ($ Billions)"
          height={280}
          onDotClick={openDetail}
        />
      ),
    },
  ], [statsMap, scatterData, openDetail]);

  return (
    <FullPageScreenLayout
      title="DEFENCE & AEROSPACE"
      subtitle="Global defense primes, aerospace supply chain, and geopolitical risk"
      accentColor="#ef5350"
      sections={sections}
      lastUpdated={new Date()}
    >
      <div style={{ padding: '12px', borderTop: '1px solid #1e1e1e' }}>
        <div style={{ fontSize: 10, fontWeight: 600, color: '#aaa', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          SECTOR ETFs
        </div>
        <EtfStrip />
      </div>
    </FullPageScreenLayout>
  );
}

export default memo(DefenceScreenImpl);
