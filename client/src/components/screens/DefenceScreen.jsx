/**
 * DefenceScreen.jsx — Full-page Sector Screen
 * Comprehensive Defence & Aerospace coverage for the Senger Market Terminal.
 * Integrates FullPageScreenLayout, FundamentalsTable, SectorChartPanel, SectorScatterPlot,
 * MiniFinancials, and InsiderActivity for multi-dimensional sector analysis.
 */
import { memo, useMemo, useCallback, useState } from 'react';
import FullPageScreenLayout from './shared/FullPageScreenLayout';
import { FundamentalsTable } from './shared/FundamentalsTable';
import { SectorChartPanel } from './shared/SectorChartPanel';
import { SectorScatterPlot } from './shared/SectorScatterPlot';
import { MiniFinancials } from './shared/MiniFinancials';
import { InsiderActivity } from './shared/InsiderActivity';
import { TableExportBar } from './shared/TableExportBar';
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
function EnhancedTableRow({ symbol, label, stats, onClick, sectorName = null }) {
  const q = useTickerPrice(symbol);
  const pe = stats?.pe_ratio;
  const mktCap = stats?.market_capitalization;

  return (
    <tr className="ds-row-clickable" onClick={() => onClick(symbol, sectorName)} onTouchEnd={(e) => { e.preventDefault(); onClick(symbol, sectorName); }}>
      <td className="ds-ticker-col" style={{ fontSize: 13 }}>{symbol}</td>
      <td style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{label || LABELS[symbol] || <span className="ds-dash">—</span>}</td>
      <td style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 600, fontVariantNumeric: 'tabular-nums', fontFamily: 'var(--font-mono)' }}>
        {q?.price != null ? fmt(q?.price, 2) : <span className="ds-dash">—</span>}
      </td>
      <td className={q?.changePct != null && q.changePct >= 0 ? 'ds-up' : 'ds-down'} style={{ fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums', fontFamily: 'var(--font-mono)' }}>
        {q?.changePct != null ? fmtPct(q?.changePct) : <span className="ds-dash">—</span>}
      </td>
      <td style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
        {fmtB(mktCap) || <span className="ds-dash">—</span>}
      </td>
      <td style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
        {pe != null ? parseFloat(pe).toFixed(1) + 'x' : <span className="ds-dash">—</span>}
      </td>
    </tr>
  );
}

/* ── Table Row Component ───────────────────────────────────────────────── */
function SectionTableRow({ sym, name, statsMap, onClickRow, withMiniCharts, accentColor, sectorName = null }) {
  const q = useTickerPrice(sym);
  const stats = statsMap.get(sym);

  return (
    <tr className="ds-row-clickable" onClick={() => onClickRow(sym, sectorName)} onTouchEnd={(e) => { e.preventDefault(); onClickRow(sym, sectorName); }} style={{ minHeight: withMiniCharts ? 100 : 44 }}>
      <td className="ds-ticker-col" style={{ fontSize: 13, letterSpacing: '0.5px' }}>{sym}</td>
      <td style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{name || LABELS[sym] || <span className="ds-dash">—</span>}</td>
      <td style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 600, fontVariantNumeric: 'tabular-nums', fontFamily: 'var(--font-mono)' }}>
        {q?.price != null ? '$' + fmt(q.price, 2) : <span className="ds-dash">—</span>}
      </td>
      <td className={q?.changePct != null && q.changePct >= 0 ? 'ds-up' : 'ds-down'}
          style={{ fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums', fontFamily: 'var(--font-mono)' }}>
        {q?.changePct != null ? fmtPct(q?.changePct) : <span className="ds-dash">—</span>}
      </td>
      <td style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
        {fmtB(stats?.market_capitalization) || <span className="ds-dash">—</span>}
      </td>
      <td style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
        {stats?.pe_ratio != null ? parseFloat(stats?.pe_ratio).toFixed(1) + 'x' : <span className="ds-dash">—</span>}
      </td>
      {withMiniCharts && (
        <td style={{ padding: '2px 4px', width: 200, minWidth: 180 }}>
          <MiniFinancials ticker={sym} accentColor={accentColor || '#4a90d9'} onError={() => {}} />
        </td>
      )}
    </tr>
  );
}

/* ── Section Table Component ───────────────────────────────────────────── */
const SectionTable = memo(function SectionTable({ tickers, statsMap, labels, withMiniCharts, accentColor, sectionName = null }) {
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
            {withMiniCharts && <th style={{ minWidth: 180 }}>3-Year Financials</th>}
          </tr>
        </thead>
        <tbody>
          {tickers.map(t => {
            const sym = typeof t === 'string' ? t : t.symbol;
            const name = typeof t === 'string' ? undefined : t.name;
            return (
              <SectionTableRow
                key={sym}
                sym={sym}
                name={name}
                statsMap={statsMap}
                onClickRow={openDetail}
                withMiniCharts={withMiniCharts}
                accentColor={accentColor}
                sectorName={sectionName}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
});

/* ── ETF Ticker Cell Component ────────────────────────────────────────── */
function EtfTickerCell({ sym, onClickCell }) {
  const q = useTickerPrice(sym);
  return (
    <TickerCell
      symbol={sym}
      price={q?.price}
      changePct={q?.changePct}
      onClick={onClickCell}
    />
  );
}

/* ── ETF Strip Component ───────────────────────────────────────────────── */
const EtfStrip = memo(function EtfStrip() {
  const openDetail = useOpenDetail();
  return (
    <div className="ds-strip" style={{ display: 'flex', gap: 0, borderTop: '1px solid var(--border-default)' }}>
      {ETFS.map(sym => (
        <EtfTickerCell
          key={sym}
          sym={sym}
          onClickCell={openDetail}
        />
      ))}
    </div>
  );
});

/* ── Main Screen Implementation ────────────────────────────────────────── */
function DefenceScreenImpl() {
  const openDetail = useOpenDetail();
  const { data: statsMap, loading: statsLoading, error: statsError, refresh: statsRefresh } = useDeepScreenData(ALL_EQUITIES);
  const [selectedTicker, setSelectedTicker] = useState(null);

  // Wrapper to pass sector context when opening details from this screen
  const openDetailWithContext = useCallback((symbol) => {
    openDetail(symbol, 'Defence & Aerospace');
  }, [openDetail]);

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
          selectedTicker={selectedTicker}
          onChartClick={setSelectedTicker}
        />
      ),
    },
    {
      id: 'us-primes',
      title: 'US Defence Primes',
      component: () => (
        <StatsLoadGate statsMap={statsMap} loading={statsLoading} error={statsError} refresh={statsRefresh}>
          <div>
            <TableExportBar
              columns={[
                { label: 'Ticker', key: 'symbol' },
                { label: 'Name', key: 'name' },
                { label: 'Price', key: 'price' },
                { label: '1D%', key: 'changePct' },
                { label: 'Mkt Cap', key: 'mktCap' },
                { label: 'P/E', key: 'pe' },
              ]}
              getData={() => {
                const priceContext = {};
                US_PRIMES.forEach(sym => {
                  // Note: This is a simplified approach; in production you'd use useTickerPrice hook
                  priceContext[sym] = { price: null, changePct: null };
                });
                return US_PRIMES.map(sym => {
                  const stats = statsMap.get(sym);
                  return {
                    symbol: sym,
                    name: LABELS[sym] || sym,
                    price: stats ? `$${(stats.price || 0).toFixed(2)}` : '—',
                    changePct: stats ? `${(stats.changePct || 0).toFixed(2)}%` : '—',
                    mktCap: stats?.market_capitalization ? `$${(stats.market_capitalization / 1e9).toFixed(1)}B` : '—',
                    pe: stats?.pe_ratio ? `${parseFloat(stats.pe_ratio).toFixed(1)}x` : '—',
                  };
                });
              }}
            />
            <SectionTable tickers={US_PRIMES} statsMap={statsMap} withMiniCharts={true} accentColor="#ef5350" sectionName="Defence & Aerospace" />
          </div>
        </StatsLoadGate>
      ),
    },
    {
      id: 'eu-defence',
      title: 'EU Defence (ADRs)',
      component: () => (
        <StatsLoadGate statsMap={statsMap} loading={statsLoading} error={statsError} refresh={statsRefresh}>
          <SectionTable tickers={EU_DEFENCE} statsMap={statsMap} sectionName="Defence & Aerospace" />
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
          metrics={['pe', 'marketCap', 'revenue', 'grossMargins', 'operatingMargins', 'returnOnEquity']}
          title="All Equities - Key Metrics"
          onTickerClick={openDetailWithContext}
          statsMap={statsMap}
        />
      ),
    },
    {
      id: 'supply-chain',
      title: 'Supply Chain & Tech',
      component: () => (
        <StatsLoadGate statsMap={statsMap} loading={statsLoading} error={statsError} refresh={statsRefresh}>
          <SectionTable tickers={SUPPLY_CHAIN} statsMap={statsMap} sectionName="Defence & Aerospace" />
        </StatsLoadGate>
      ),
    },
    {
      id: 'space-cyber',
      title: 'Space & Cyber',
      component: () => (
        <StatsLoadGate statsMap={statsMap} loading={statsLoading} error={statsError} refresh={statsRefresh}>
          <SectionTable tickers={SPACE_CYBER} statsMap={statsMap} sectionName="Defence & Aerospace" />
        </StatsLoadGate>
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
  ], [statsMap, statsLoading, statsError, statsRefresh, scatterData, openDetail]);

  return (
    <FullPageScreenLayout
      title="DEFENCE & AEROSPACE"
      subtitle="Global defense primes, aerospace supply chain, and geopolitical risk"
      accentColor="#ef5350"
      sections={sections}
      lastUpdated={new Date()}
      screenKey="defence"
      visibleTickers={ALL_EQUITIES}
    >
      <div style={{ padding: '12px', borderTop: '1px solid var(--border-default)' }}>
        <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          SECTOR ETFs
        </div>
        <EtfStrip />
      </div>
    </FullPageScreenLayout>
  );
}

export default memo(DefenceScreenImpl);
