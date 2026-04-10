/**
 * TechAIScreen.jsx — S5.5 (comprehensive full-page)
 * Tech & AI deep screen — 35+ tickers across mega-caps, semiconductors, AI/cloud.
 * Features: sector charts, fundamentals comparison, revenue growth, valuation scatter,
 * insider activity, mini financials, and ETF coverage.
 */
import { memo, useMemo, useState, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import FullPageScreenLayout from './shared/FullPageScreenLayout';
import { SectorChartPanel, FundamentalsTable, SectorScatterPlot, InsiderActivity, MiniFinancials, KPIRibbon, heatColor, TickerRibbon, CorrelationMatrix, ComparisonBarChart, ImpliedVolatilityCard, EarningsCalendarStrip, AnalystActionsCard, OwnershipBreakdown, TechnicalSignalsCard, SentimentCard } from './shared';
import { useOpenDetail } from '../../context/OpenDetailContext';
import { useTickerPrice } from '../../context/PriceContext';
import { useDeepScreenData } from '../../hooks/useDeepScreenData';
import { StatsLoadGate } from './DeepScreenBase';
import { apiFetch } from '../../utils/api';

const fmt = (n, d = 2) => n == null ? '—' : n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtPct = (n) => n == null ? '—' : (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
const fmtB = (n) => {
  if (n == null || isNaN(n)) return '—';
  const v = parseFloat(n);
  if (v >= 1e12) return '$' + (v/1e12).toFixed(1) + 'T';
  if (v >= 1e9)  return '$' + (v/1e9).toFixed(0) + 'B';
  if (v >= 1e6)  return '$' + (v/1e6).toFixed(0) + 'M';
  return '$' + v.toFixed(0);
};

// Ticker groups
const MEGA_CAP  = ['AAPL', 'MSFT', 'GOOGL', 'META', 'AMZN', 'TSLA', 'NFLX'];
const SEMIS     = ['NVDA', 'AMD', 'AVGO', 'TSM', 'QCOM', 'MRVL', 'MU', 'AMAT'];
const AI_CLOUD  = ['CRM', 'SNOW', 'PLTR', 'AI', 'PATH', 'NOW', 'DDOG', 'SMCI'];
const ETF_SYMBOLS = ['QQQ', 'XLK', 'SOXX', 'SMH', 'AIQ', 'BOTZ', 'ROBO', 'IGV', 'ARKK'];

const BANNER_TICKERS = [
  { ticker: 'QQQ', label: 'QQQ' },
  { ticker: 'XLK', label: 'XLK' },
  { ticker: 'SOXX', label: 'SOXX' },
  { ticker: 'SMH', label: 'SMH' },
  { ticker: 'NVDA', label: 'NVDA' },
  { ticker: 'AAPL', label: 'AAPL' },
  { ticker: 'MSFT', label: 'MSFT' },
  { ticker: 'GOOGL', label: 'GOOGL' },
  { ticker: 'META', label: 'META' },
  { ticker: 'TSM', label: 'TSM' },
];
const CHART_TICKERS = ['NVDA', 'MSFT', 'AAPL', 'GOOGL', 'TSM', 'META'];
const INSIDER_TICKERS = ['AAPL', 'MSFT', 'GOOGL', 'META', 'NVDA', 'AMZN'];
const REVENUE_GROWTH_TICKERS = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META'];
const MINI_FIN_TICKERS = ['AAPL', 'MSFT', 'NVDA'];

const ALL_TICKERS = [...MEGA_CAP, ...SEMIS, ...AI_CLOUD];

// Module-level constants for stable props
const TECH_EARNINGS_TICKERS = ['AAPL', 'MSFT', 'GOOGL', 'NVDA', 'META', 'AMZN', 'TSM', 'AMD'];
const TECH_OWNERSHIP_TICKERS = ['AAPL', 'MSFT', 'NVDA', 'GOOGL', 'META', 'AMZN'];
const TECH_SIGNALS_TICKERS = ['NVDA', 'AAPL', 'MSFT', 'GOOGL', 'META', 'TSM', 'AMD', 'AVGO'];
const TECH_ANALYST_TICKERS = ['NVDA', 'AAPL', 'MSFT', 'GOOGL', 'META', 'AMZN'];
const SENTIMENT_TICKERS = ['NVDA', 'AAPL', 'MSFT', 'GOOGL', 'META', 'AMZN', 'TSM', 'AMD'];

function TechEarningsSection() {
  return <EarningsCalendarStrip tickers={TECH_EARNINGS_TICKERS} accentColor="#00bcd4" />;
}

function TechAnalystSection() {
  return <AnalystActionsCard tickers={TECH_ANALYST_TICKERS} limit={12} accentColor="#00bcd4" />;
}

function TechOwnershipSection() {
  return <OwnershipBreakdown tickers={TECH_OWNERSHIP_TICKERS} accentColor="#00bcd4" />;
}

function TechSignalsSection() {
  return <TechnicalSignalsCard tickers={TECH_SIGNALS_TICKERS} accentColor="#00bcd4" />;
}

const SentimentSection = memo(function SentimentSection() {
  return <SentimentCard tickers={SENTIMENT_TICKERS} accentColor="#00bcd4" />;
});

/* ── KPI Ribbon ────────────────────────────────────────────────────────── */
function TechKPIRibbon() {
  const qqq  = useTickerPrice('QQQ');
  const xlk  = useTickerPrice('XLK');
  const soxx = useTickerPrice('SOXX');
  const smh  = useTickerPrice('SMH');
  const items = [
    { label: 'NASDAQ 100',  value: qqq?.price != null ? fmt(qqq.price, 0) : '—',  change: qqq?.changePct },
    { label: 'TECH SELECT', value: xlk?.price != null ? '$' + fmt(xlk.price) : '—', change: xlk?.changePct },
    { label: 'SEMIS (SOXX)', value: soxx?.price != null ? '$' + fmt(soxx.price) : '—', change: soxx?.changePct },
    { label: 'SEMIS (SMH)',  value: smh?.price != null ? '$' + fmt(smh.price) : '—', change: smh?.changePct },
  ];
  return <KPIRibbon items={items} accentColor="#00bcd4" />;
}

const LABELS = {
  AAPL: 'Apple', MSFT: 'Microsoft', GOOGL: 'Alphabet', META: 'Meta', AMZN: 'Amazon',
  TSLA: 'Tesla', NFLX: 'Netflix', NVDA: 'NVIDIA', AMD: 'AMD', AVGO: 'Broadcom',
  TSM: 'TSMC', QCOM: 'Qualcomm', MRVL: 'Marvell', MU: 'Micron', AMAT: 'Applied Materials',
  CRM: 'Salesforce', SNOW: 'Snowflake', PLTR: 'Palantir', AI: 'C3.ai', PATH: 'UiPath',
  NOW: 'ServiceNow', DDOG: 'Datadog', SMCI: 'Super Micro',
};

// P/E color intelligence
function getPEColor(pe) {
  if (pe == null) return '#ccc';
  const val = parseFloat(pe);
  if (val < 25) return 'var(--semantic-up)';      // green
  if (val < 35) return 'var(--semantic-warn)';      // yellow
  if (val < 50) return 'var(--semantic-warn)';      // orange
  return 'var(--semantic-down)';                    // red
}

// Enhanced row for stock tables
function EnhancedRow({ symbol, stats, onClick }) {
  const q = useTickerPrice(symbol);
  const pe = stats?.pe_ratio;
  const mktCap = stats?.market_capitalization;

  return (
    <tr
      className="ds-row-clickable"
      onClick={() => onClick(symbol, 'Technology & AI')}
      onTouchEnd={(e) => { e.preventDefault(); onClick(symbol, 'Technology & AI'); }}
    >
      <td className="ds-ticker-col" style={{ fontSize: 13, letterSpacing: '0.5px' }}>{symbol}</td>
      <td style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{LABELS[symbol] || <span className="ds-dash">—</span>}</td>
      <td style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 600, fontVariantNumeric: 'tabular-nums', fontFamily: 'var(--font-mono)' }}>
        {q?.price != null ? '$' + fmt(q.price) : <span className="ds-dash">—</span>}
      </td>
      <td className={q?.changePct >= 0 ? 'ds-val-pos' : 'ds-val-neg'} style={{ fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums', fontFamily: 'var(--font-mono)', background: heatColor(q?.changePct) }}>
        {q?.changePct != null ? fmtPct(q.changePct) : <span className="ds-dash">—</span>}
      </td>
      <td style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
        {fmtB(mktCap) || <span className="ds-dash">—</span>}
      </td>
      <td style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: getPEColor(pe), fontVariantNumeric: 'tabular-nums' }}>
        {pe != null ? parseFloat(pe).toFixed(1) + 'x' : <span className="ds-dash">—</span>}
      </td>
    </tr>
  );
}

// Reusable section table
const SectionTable = memo(function SectionTable({ tickers, statsMap }) {
  const openDetail = useOpenDetail();
  return (
    <table className="ds-table">
      <thead>
        <tr>
          <th style={{ textAlign: 'left' }}>Ticker</th><th style={{ textAlign: 'left' }}>Name</th><th>Price</th><th>1D%</th>
          <th>Mkt Cap</th>
          <th>P/E</th>
        </tr>
      </thead>
      <tbody>
        {tickers.map(sym => (
          <EnhancedRow key={sym} symbol={sym} stats={statsMap.get(sym)} onClick={openDetail} />
        ))}
      </tbody>
    </table>
  );
});

// Revenue Growth Chart
function RevenueGrowthChart() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchRevenueGrowth = async () => {
      try {
        setLoading(true);
        const promises = REVENUE_GROWTH_TICKERS.map(ticker =>
          apiFetch(`/api/market/td/financials/${ticker}?period=annual`)
            .then(res => res.ok ? res.json() : null)
            .catch(() => null)
        );

        const results = await Promise.all(promises);
        const chartData = [];

        results.forEach((result, idx) => {
          const ticker = REVENUE_GROWTH_TICKERS[idx];
          if (result?.statements) {
            const incomeStmt = result.statements.find(s => s.type === 'income');
            if (incomeStmt?.results?.length >= 2) {
              const current = incomeStmt.results[0]?.revenue;
              const prior = incomeStmt.results[1]?.revenue;

              if (current && prior) {
                const yoyGrowth = ((current - prior) / prior) * 100;
                chartData.push({
                  ticker,
                  growth: parseFloat(yoyGrowth.toFixed(2)),
                });
              }
            }
          }
        });

        setData(chartData);
      } catch (err) {
        console.error('[RevenueGrowthChart] Error:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchRevenueGrowth();
  }, []);

  if (loading) {
    return (
      <div style={{
        height: 200,
        background: 'linear-gradient(90deg, var(--bg-hover) 25%, var(--bg-active) 50%, var(--bg-hover) 75%)',
        backgroundSize: '200% 100%',
        animation: 'ds-shimmer 1.5s infinite',
        borderRadius: 2,
      }} />
    );
  }

  if (!data || data.length === 0) {
    return (
      <div style={{
        height: 200,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--text-muted)',
        fontSize: 10,
      }}>
        No revenue data available
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} margin={{ top: 8, right: 16, bottom: 32, left: 40 }}>
        <XAxis dataKey="ticker" style={{ fontSize: 9, fill: 'var(--text-muted)' }} />
        <YAxis style={{ fontSize: 9, fill: 'var(--text-muted)' }} />
        <Tooltip
          contentStyle={{
            background: 'var(--bg-panel)',
            border: '1px solid var(--border-default)',
            borderRadius: 3,
            fontSize: 9,
            color: 'var(--text-primary)',
          }}
          formatter={(value) => `${value.toFixed(2)}%`}
        />
        <Bar dataKey="growth" fill="#00bcd4" radius={[2, 2, 0, 0]}>
          {data.map((entry, idx) => (
            <Cell
              key={`bar-${idx}`}
              fill={entry.growth >= 0 ? 'var(--semantic-up)' : 'var(--semantic-down)'}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// Valuation Scatter Plot component
function ValuationScatterComponent() {
  const { data: statsMap } = useDeepScreenData(ALL_TICKERS);
  const openDetail = useOpenDetail();

  const scatterData = useMemo(() => {
    return ALL_TICKERS
      .map(ticker => {
        const stats = statsMap?.get(ticker);
        if (!stats) return null;

        const pe = parseFloat(stats.pe_ratio);
        const mktCap = parseFloat(stats.market_capitalization);

        if (isNaN(pe) || isNaN(mktCap) || mktCap <= 0) return null;

        return {
          ticker,
          x: mktCap / 1e9, // Convert to billions
          y: pe,
        };
      })
      .filter(Boolean);
  }, [statsMap]);

  return (
    <SectorScatterPlot
      data={scatterData}
      xLabel="Market Cap ($B)"
      yLabel="P/E Ratio (x)"
      height={280}
      onDotClick={(symbol) => openDetail(symbol, 'Technology & AI')}
    />
  );
}

// Mini Financials Strip
function MiniFinancialsStrip({ statsMap }) {
  return (
    <div style={{
      display: 'flex',
      gap: '12px',
      padding: '4px 12px',
      overflowX: 'auto',
    }}>
      {MINI_FIN_TICKERS.map(ticker => (
        <div
          key={ticker}
          style={{
            flex: '0 0 auto',
            width: 220,
            minWidth: 200,
            border: '1px solid var(--border-default)',
            borderRadius: 6,
            padding: '10px 12px',
            background: 'var(--bg-panel)',
            boxSizing: 'border-box',
          }}
        >
          <div style={{
            fontSize: 12,
            fontWeight: 600,
            color: 'var(--text-primary)',
            marginBottom: 8,
          }}>
            {ticker}
          </div>
          <MiniFinancials
            ticker={ticker}
            accentColor="#00bcd4"
            statsData={statsMap.get(ticker)}
          />
        </div>
      ))}
    </div>
  );
}

// ETF Cell — extracted so useTickerPrice is called at top level of a component
function EtfCell({ sym, onClick }) {
  const q = useTickerPrice(sym);
  const isUp = q?.changePct >= 0;
  return (
    <div
      className="ds-ticker-cell"
      onClick={() => onClick(sym, 'Technology & AI')}
      style={{
        cursor: 'pointer',
        padding: '8px 12px',
        border: '1px solid var(--border-default)',
        borderRadius: 2,
        textAlign: 'center',
        transition: 'all 0.2s',
      }}
    >
      <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-primary)' }}>
        {sym}
      </div>
      <div style={{ fontSize: 9, color: 'var(--text-secondary)', marginTop: 2 }}>
        {q?.price != null ? fmt(q.price) : '—'}
      </div>
      <div style={{
        fontSize: 9,
        color: isUp ? 'var(--semantic-up)' : 'var(--semantic-down)',
        fontWeight: 500,
        marginTop: 2,
      }}>
        {q?.changePct != null ? fmtPct(q.changePct) : '—'}
      </div>
    </div>
  );
}

// ETF Strip
function EtfStripSection() {
  return <TickerRibbon tickers={ETF_SYMBOLS} sectorName="Technology & AI" />;
}

// Main component
function TechAIScreenImpl() {
  const { data: statsMap, loading: statsLoading, error: statsError, refresh: statsRefresh } = useDeepScreenData(ALL_TICKERS);
  const openDetail = useOpenDetail();
  const [selectedTicker, setSelectedTicker] = useState(null);

  const sections = useMemo(() => [
    {
      id: 'kpi',
      title: 'KEY METRICS',
      span: 'full',
      component: TechKPIRibbon,
    },
    {
      id: 'charts',
      title: 'SECTOR CHARTS',
      span: 'full',
      component: () => <SectorChartPanel tickers={CHART_TICKERS} cols={3} height={180} selectedTicker={selectedTicker} onChartClick={setSelectedTicker} />,
    },
    {
      id: 'megacap',
      title: 'MEGA-CAP TECH',
      component: () => <StatsLoadGate statsMap={statsMap} loading={statsLoading} error={statsError} refresh={statsRefresh}><SectionTable tickers={MEGA_CAP} statsMap={statsMap} /></StatsLoadGate>,
    },
    {
      id: 'semis',
      title: 'SEMICONDUCTORS',
      component: () => <StatsLoadGate statsMap={statsMap} loading={statsLoading} error={statsError} refresh={statsRefresh}><SectionTable tickers={SEMIS} statsMap={statsMap} /></StatsLoadGate>,
    },
    {
      id: 'aicloud',
      title: 'AI & CLOUD SOFTWARE',
      component: () => <StatsLoadGate statsMap={statsMap} loading={statsLoading} error={statsError} refresh={statsRefresh}><SectionTable tickers={AI_CLOUD} statsMap={statsMap} /></StatsLoadGate>,
    },
    {
      id: 'minifinancials',
      title: 'TOP 3 FINANCIALS',
      span: 'full',
      component: () => <MiniFinancialsStrip statsMap={statsMap} />,
    },
    {
      id: 'fundamentals',
      title: 'FUNDAMENTALS COMPARISON',
      span: 'full',
      component: () => (
        <FundamentalsTable
          tickers={ALL_TICKERS}
          metrics={['pe', 'marketCap', 'revenue', 'grossMargins', 'operatingMargins', 'profitMargins', 'returnOnEquity']}
          onTickerClick={(symbol) => openDetail(symbol, 'Technology & AI')}
          statsMap={statsMap}
        />
      ),
    },
    {
      id: 'revenue-growth',
      title: 'REVENUE GROWTH (YoY %)',
      span: 'full',
      component: () => <RevenueGrowthChart />,
    },
    {
      id: 'valuation',
      title: 'VALUATION SCATTER',
      span: 'full',
      component: () => <ValuationScatterComponent />,
    },
    {
      id: 'correlation',
      title: 'CORRELATION MATRIX (90D)',
      span: 'full',
      component: () => (
        <CorrelationMatrix
          tickers={['NVDA', 'AAPL', 'MSFT', 'GOOGL', 'META', 'AMZN', 'TSM', 'AMD', 'AVGO']}
          title="Tech & AI 90-Day Return Correlations"
          accentColor="#00bcd4"
          days={90}
        />
      ),
    },
    {
      id: 'tech-signals',
      title: 'Technical Signals',
      component: TechSignalsSection,
    },
    {
      id: 'earnings-calendar',
      title: 'Upcoming Earnings',
      span: 'full',
      component: TechEarningsSection,
    },
    {
      id: 'analyst-actions',
      title: 'Analyst Actions',
      component: TechAnalystSection,
    },
    {
      id: 'ownership',
      title: 'Ownership Structure',
      component: TechOwnershipSection,
    },
    {
      id: 'sentiment',
      title: 'News Sentiment',
      component: SentimentSection,
    },
    /* IV Monitor removed — no options data feed available */
    {
      id: 'insider',
      title: 'INSIDER ACTIVITY',
      span: 'full',
      component: () => <InsiderActivity tickers={INSIDER_TICKERS} limit={5} onTickerClick={(symbol) => openDetail(symbol, 'Technology & AI')} />,
    },
    {
      id: 'etfs',
      title: 'TECH & AI ETFs',
      span: 'full',
      component: () => <EtfStripSection />,
    },
  ], [statsMap, statsLoading, statsError, statsRefresh]);

  const allTickers = [
    ...MEGA_CAP,
    ...SEMIS,
    ...AI_CLOUD,
  ];

  return (
    <FullPageScreenLayout
      title="TECHNOLOGY"
      accentColor="#00bcd4"
      subtitle="Mega-cap tech, semiconductors, AI & cloud — valuation and growth analysis"
      sections={sections}
      tickerBanner={BANNER_TICKERS}
      screenKey="technology"
      visibleTickers={allTickers}
      aiType="sector"
      aiContext={{ sector: 'Technology & AI', tickers: ['NVDA', 'MSFT', 'AAPL', 'GOOGL', 'META'] }}
      aiCacheKey="sector:tech"
    />
  );
}

export default memo(TechAIScreenImpl);
