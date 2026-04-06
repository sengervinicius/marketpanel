/**
 * TechAIScreen.jsx — S5.5 (comprehensive full-page)
 * Tech & AI deep screen — 35+ tickers across mega-caps, semiconductors, AI/cloud.
 * Features: sector charts, fundamentals comparison, revenue growth, valuation scatter,
 * insider activity, mini financials, and ETF coverage.
 */
import { memo, useMemo, useState, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import FullPageScreenLayout from './shared/FullPageScreenLayout';
import { SectorChartPanel, FundamentalsTable, SectorScatterPlot, InsiderActivity, MiniFinancials } from './shared';
import { useOpenDetail } from '../../context/OpenDetailContext';
import { useTickerPrice } from '../../context/PriceContext';
import { useDeepScreenData } from '../../hooks/useDeepScreenData';
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
const CHART_TICKERS = ['NVDA', 'MSFT', 'AAPL', 'GOOGL', 'TSM', 'META'];
const INSIDER_TICKERS = ['AAPL', 'MSFT', 'GOOGL', 'META', 'NVDA', 'AMZN'];
const REVENUE_GROWTH_TICKERS = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META'];
const MINI_FIN_TICKERS = ['AAPL', 'MSFT', 'NVDA'];

const ALL_TICKERS = [...MEGA_CAP, ...SEMIS, ...AI_CLOUD];

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
  if (val < 25) return '#66bb6a';      // green
  if (val < 35) return '#ffeb3b';      // yellow
  if (val < 50) return '#ff9800';      // orange
  return '#ef5350';                    // red
}

// Enhanced row for stock tables
function EnhancedRow({ symbol, stats, onClick }) {
  const q = useTickerPrice(symbol);
  const pe = stats?.pe_ratio;
  const mktCap = stats?.market_capitalization;

  return (
    <tr className="ds-row-clickable" onClick={() => onClick(symbol)}>
      <td className="ds-ticker-col">{symbol}</td>
      <td>{LABELS[symbol] || '—'}</td>
      <td>{q?.price != null ? fmt(q.price) : '—'}</td>
      <td className={q?.changePct >= 0 ? 'ds-val-pos' : 'ds-val-neg'}>{q?.changePct != null ? fmtPct(q.changePct) : '—'}</td>
      <td style={{ fontFamily: 'monospace', fontSize: 10, color: '#888' }}>{fmtB(mktCap)}</td>
      <td style={{ fontFamily: 'monospace', fontSize: 10, color: getPEColor(pe) }}>
        {pe != null ? parseFloat(pe).toFixed(1) + 'x' : '—'}
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
          <th>Ticker</th><th>Name</th><th>Price</th><th>1D%</th>
          <th style={{ fontSize: 9 }}>Mkt Cap</th>
          <th style={{ fontSize: 9 }}>P/E</th>
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
        background: 'linear-gradient(90deg, #1a1a1a 25%, #222 50%, #1a1a1a 75%)',
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
        color: '#666',
        fontSize: 10,
      }}>
        No revenue data available
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} margin={{ top: 8, right: 16, bottom: 32, left: 40 }}>
        <XAxis dataKey="ticker" style={{ fontSize: 9, fill: '#666' }} />
        <YAxis style={{ fontSize: 9, fill: '#666' }} />
        <Tooltip
          contentStyle={{
            background: '#0a0a0a',
            border: '1px solid #1e1e1e',
            borderRadius: 3,
            fontSize: 9,
            color: '#e0e0e0',
          }}
          formatter={(value) => `${value.toFixed(2)}%`}
        />
        <Bar dataKey="growth" fill="#00bcd4" radius={[2, 2, 0, 0]}>
          {data.map((entry, idx) => (
            <Cell
              key={`bar-${idx}`}
              fill={entry.growth >= 0 ? '#4caf50' : '#f44336'}
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
      onDotClick={openDetail}
    />
  );
}

// Mini Financials Strip
function MiniFinancialsStrip() {
  return (
    <div style={{
      display: 'flex',
      gap: '8px',
      padding: '0 6px',
      overflowX: 'auto',
    }}>
      {MINI_FIN_TICKERS.map(ticker => (
        <div
          key={ticker}
          style={{
            flex: '0 0 calc(33.333% - 6px)',
            minWidth: 200,
            border: '1px solid #1e1e1e',
            borderRadius: 2,
            padding: 8,
            background: '#0a0a0a',
          }}
        >
          <div style={{
            fontSize: 10,
            fontWeight: 600,
            color: '#e0e0e0',
            marginBottom: 8,
          }}>
            {ticker}
          </div>
          <MiniFinancials ticker={ticker} />
        </div>
      ))}
    </div>
  );
}

// ETF Strip
function EtfStripSection() {
  const openDetail = useOpenDetail();
  return (
    <div className="ds-etf-strip" style={{ padding: '0 6px' }}>
      {ETF_SYMBOLS.map(sym => {
        const q = useTickerPrice(sym);
        const isUp = q?.changePct >= 0;
        return (
          <div
            key={sym}
            className="ds-ticker-cell"
            onClick={() => openDetail(sym)}
            style={{
              cursor: 'pointer',
              padding: '8px 12px',
              border: '1px solid #1e1e1e',
              borderRadius: 2,
              textAlign: 'center',
              transition: 'all 0.2s',
            }}
          >
            <div style={{ fontSize: 10, fontWeight: 600, color: '#e0e0e0' }}>
              {sym}
            </div>
            <div style={{ fontSize: 9, color: '#999', marginTop: 2 }}>
              {q?.price != null ? fmt(q.price) : '—'}
            </div>
            <div style={{
              fontSize: 9,
              color: isUp ? '#4caf50' : '#f44336',
              fontWeight: 500,
              marginTop: 2,
            }}>
              {q?.changePct != null ? fmtPct(q.changePct) : '—'}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Main component
function TechAIScreenImpl() {
  const { data: statsMap } = useDeepScreenData(ALL_TICKERS);
  const openDetail = useOpenDetail();

  const sections = useMemo(() => [
    {
      id: 'charts',
      title: 'SECTOR CHARTS',
      span: 'full',
      component: () => <SectorChartPanel tickers={CHART_TICKERS} cols={3} height={180} />,
    },
    {
      id: 'megacap',
      title: 'MEGA-CAP TECH',
      component: () => <SectionTable tickers={MEGA_CAP} statsMap={statsMap} />,
    },
    {
      id: 'semis',
      title: 'SEMICONDUCTORS',
      component: () => <SectionTable tickers={SEMIS} statsMap={statsMap} />,
    },
    {
      id: 'aicloud',
      title: 'AI & CLOUD SOFTWARE',
      component: () => <SectionTable tickers={AI_CLOUD} statsMap={statsMap} />,
    },
    {
      id: 'minifinancials',
      title: 'TOP 3 FINANCIALS',
      span: 'full',
      component: () => <MiniFinancialsStrip />,
    },
    {
      id: 'fundamentals',
      title: 'FUNDAMENTALS COMPARISON',
      span: 'full',
      component: () => (
        <FundamentalsTable
          tickers={ALL_TICKERS}
          metrics={['pe', 'marketCap', 'revenue', 'grossMargins', 'operatingMargins', 'profitMargins', 'returnOnEquity']}
          onTickerClick={openDetail}
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
      id: 'insider',
      title: 'INSIDER ACTIVITY',
      span: 'full',
      component: () => <InsiderActivity tickers={INSIDER_TICKERS} limit={5} onTickerClick={openDetail} />,
    },
    {
      id: 'etfs',
      title: 'TECH & AI ETFs',
      span: 'full',
      component: () => <EtfStripSection />,
    },
  ], [statsMap]);

  return (
    <FullPageScreenLayout
      title="TECHNOLOGY"
      accentColor="#00bcd4"
      subtitle="Mega-cap tech, semiconductors, AI & cloud — valuation and growth analysis"
      sections={sections}
    />
  );
}

export default memo(TechAIScreenImpl);
