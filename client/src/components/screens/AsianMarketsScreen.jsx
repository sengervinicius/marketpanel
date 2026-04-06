/**
 * AsianMarketsScreen.jsx — Full-page Asian Markets Screen
 * Comprehensive coverage of Japan, China, India, Korea & ASEAN markets.
 * Integrates FullPageScreenLayout, FundamentalsTable, SectorChartPanel, and InsiderActivity.
 */
import { memo, useMemo, useState } from 'react';
import FullPageScreenLayout from './shared/FullPageScreenLayout';
import { FundamentalsTable } from './shared/FundamentalsTable';
import { SectorChartPanel } from './shared/SectorChartPanel';
import { InsiderActivity } from './shared/InsiderActivity';
import { useOpenDetail } from '../../context/OpenDetailContext';
import { useTickerPrice } from '../../context/PriceContext';
import { useDeepScreenData } from '../../hooks/useDeepScreenData';
import { useSectionData } from '../../hooks/useSectionData';
import { apiFetch } from '../../utils/api';
import DeepScreenBase, { TickerCell, DeepSkeleton, DeepError } from './DeepScreenBase';

/* ── Formatting Utilities ──────────────────────────────────────────────────── */
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

/* ── Asian Market Tickers ──────────────────────────────────────────────────── */
const JAPAN = ['TM', 'SONY', 'SFTBY', 'MUFG', 'NTDOY', 'TOELY', 'NMR', 'SMFG'];
const CHINA_HK = ['BABA', 'TCEHY', 'BYDDY', 'JD', 'PDD', 'NIO', 'LI', 'MPNGY'];
const INDIA = ['HDB', 'INFY', 'TTM', 'WIT', 'IBN'];
const KOREA_ASEAN = ['SE', 'GRAB'];
const FX_PAIRS = ['C:USDJPY', 'C:USDCNY', 'C:USDINR', 'C:USDKRW'];
const REGIONAL_ETFS = ['FXI', 'EWJ', 'INDA', 'EWY', 'EWT', 'VWO', 'AAXJ'];

const CHART_TICKERS = ['BABA', 'TM', 'SONY', 'HDB', 'TCEHY', 'NIO'];

const ALL_EQUITIES = [...JAPAN, ...CHINA_HK, ...INDIA, ...KOREA_ASEAN];

/* ── Labels Mapping ────────────────────────────────────────────────────────── */
const LABELS = {
  // Japan
  TM: 'Toyota',
  SONY: 'Sony',
  SFTBY: 'SoftBank',
  MUFG: 'Mitsubishi UFJ',
  NTDOY: 'Nintendo',
  TOELY: 'Tokyo Electron',
  NMR: 'Nomura',
  SMFG: 'Sumitomo Mitsui',
  // China & Hong Kong
  BABA: 'Alibaba',
  TCEHY: 'Tencent',
  BYDDY: 'BYD',
  JD: 'JD.com',
  PDD: 'Pinduoduo',
  NIO: 'NIO',
  LI: 'Li Auto',
  MPNGY: 'Meituan',
  // India
  HDB: 'HDFC Bank',
  INFY: 'Infosys',
  TTM: 'Tata Motors',
  WIT: 'Wipro',
  IBN: 'ICICI Bank',
  // Korea & ASEAN
  SE: 'Sea Ltd',
  GRAB: 'Grab',
  // FX
  'C:USDJPY': 'USD/JPY',
  'C:USDCNY': 'USD/CNY',
  'C:USDINR': 'USD/INR',
  'C:USDKRW': 'USD/KRW',
  // ETFs
  FXI: 'iShares China ETF',
  EWJ: 'iShares Japan ETF',
  INDA: 'iShares India ETF',
  EWY: 'iShares South Korea ETF',
  EWT: 'iShares Taiwan ETF',
  VWO: 'Vanguard Emerging Markets',
  AAXJ: 'iShares ASEAN ETF',
};

/* ── Macro Dashboard Component ─────────────────────────────────────────────── */
function MacroDashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useMemo(() => {
    const fetchMacro = async () => {
      try {
        setLoading(true);
        setError(null);
        const res = await apiFetch('/api/macro/compare?countries=JP,CN,IN,KR&indicators=policyRate,cpiYoY,gdpGrowth');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        setData(json.data || json || []);
      } catch (err) {
        setError(err.message);
        setData([]);
      } finally {
        setLoading(false);
      }
    };
    fetchMacro();
  }, []);

  if (loading) return <DeepSkeleton rows={6} />;
  if (error) return <DeepError message={`Error: ${error}`} />;
  if (!data || data.length === 0) {
    return (
      <div style={{ padding: '10px', color: '#666', fontSize: 10, textAlign: 'center' }}>
        No macro data available
      </div>
    );
  }

  const getCellColor = (metric, value) => {
    if (value == null) return {};
    const num = parseFloat(value);
    if (metric === 'cpiYoY') {
      if (num < 2) return { color: '#4caf50' };
      if (num > 5) return { color: '#f44336' };
      return { color: '#ff9800' };
    } else if (metric === 'gdpGrowth') {
      if (num > 4) return { color: '#4caf50' };
      if (num < 1) return { color: '#f44336' };
      return { color: '#ff9800' };
    } else if (metric === 'policyRate') {
      if (num >= 4 && num <= 5) return { color: '#4caf50' };
      if (num > 7) return { color: '#f44336' };
      return { color: '#ff9800' };
    }
    return {};
  };

  return (
    <div style={{ padding: '0 6px', overflow: 'auto' }}>
      <table className="ds-table">
        <thead>
          <tr>
            <th>Country</th>
            <th>Policy Rate (%)</th>
            <th>CPI YoY (%)</th>
            <th>GDP Growth (%)</th>
          </tr>
        </thead>
        <tbody>
          {data.map((row, idx) => (
            <tr key={idx}>
              <td style={{ fontWeight: 600, color: '#e0e0e0' }}>{row.country || '—'}</td>
              <td style={getCellColor('policyRate', row.policyRate)}>
                {row.policyRate != null ? row.policyRate.toFixed(2) : '—'}
              </td>
              <td style={getCellColor('cpiYoY', row.cpiYoY)}>
                {row.cpiYoY != null ? row.cpiYoY.toFixed(2) : '—'}
              </td>
              <td style={getCellColor('gdpGrowth', row.gdpGrowth)}>
                {row.gdpGrowth != null ? row.gdpGrowth.toFixed(2) : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── FX Cell Component ─────────────────────────────────────────────────────── */
const FxCell = memo(function FxCell({ pair }) {
  const openDetail = useOpenDetail();
  const q = useTickerPrice(pair);
  const displaySym = pair.replace('C:', '');

  return (
    <div
      className="ds-ticker-cell"
      onClick={() => openDetail(pair)}
      style={{ cursor: 'pointer' }}
      title={LABELS[pair] || pair}
    >
      <span className="ds-ticker-sym">{displaySym}</span>
      {q?.price != null && (
        <span className="ds-ticker-price">
          {q.price.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}
        </span>
      )}
      {q?.changePct != null && (
        <span className={`ds-ticker-chg ${q.changePct >= 0 ? 'up' : 'down'}`}>
          {q.changePct >= 0 ? '+' : ''}{q.changePct.toFixed(2)}%
        </span>
      )}
    </div>
  );
});

/* ── FX Monitor Component ──────────────────────────────────────────────────── */
function FxMonitor() {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '1px', background: '#1e1e1e', padding: '1px' }}>
      {FX_PAIRS.map(pair => (
        <FxCell key={pair} pair={pair} />
      ))}
    </div>
  );
}

/* ── Table Row Component ───────────────────────────────────────────────────── */
const TableRow = memo(function TableRow({ ticker, statsMap }) {
  const openDetail = useOpenDetail();
  const sym = typeof ticker === 'string' ? ticker : ticker.symbol;
  const name = typeof ticker === 'string' ? undefined : ticker.name;
  const q = useTickerPrice(sym);

  return (
    <tr className="ds-row-clickable" onClick={() => openDetail(sym)}>
      <td className="ds-ticker-col">{sym}</td>
      <td>{name || LABELS[sym] || '—'}</td>
      <td>{fmt(q?.price, 2)}</td>
      <td className={q?.changePct != null && q.changePct >= 0 ? 'ds-up' : 'ds-down'}>
        {fmtPct(q?.changePct)}
      </td>
      <td style={{ fontFamily: 'monospace', fontSize: 10, color: '#888' }}>
        {fmtB(statsMap.get(sym)?.market_capitalization)}
      </td>
      <td style={{ fontFamily: 'monospace', fontSize: 10, color: '#ccc' }}>
        {statsMap.get(sym)?.pe_ratio != null ? parseFloat(statsMap.get(sym)?.pe_ratio).toFixed(1) + 'x' : '—'}
      </td>
    </tr>
  );
});

/* ── Section Table Component ───────────────────────────────────────────────── */
const SectionTable = memo(function SectionTable({ tickers, statsMap }) {
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
          </tr>
        </thead>
        <tbody>
          {tickers.map(t => {
            const sym = typeof t === 'string' ? t : t.symbol;
            return (
              <TableRow key={sym} ticker={t} statsMap={statsMap} />
            );
          })}
        </tbody>
      </table>
    </div>
  );
});

/* ── ETF Cell Component ────────────────────────────────────────────────────── */
const EtfCell = memo(function EtfCell({ symbol }) {
  const openDetail = useOpenDetail();
  const q = useTickerPrice(symbol);

  return (
    <TickerCell
      symbol={symbol}
      label={LABELS[symbol]}
      price={q?.price}
      changePct={q?.changePct}
      onClick={openDetail}
    />
  );
});

/* ── ETF Strip Component ───────────────────────────────────────────────────── */
const EtfStrip = memo(function EtfStrip() {
  return (
    <div className="ds-strip" style={{ display: 'flex', gap: 0, borderTop: '1px solid #1e1e1e' }}>
      {REGIONAL_ETFS.map(sym => (
        <EtfCell key={sym} symbol={sym} />
      ))}
    </div>
  );
});

/* ── Main Screen Implementation ────────────────────────────────────────────── */
function AsianMarketsScreenImpl() {
  const openDetail = useOpenDetail();
  const { data: statsMap } = useDeepScreenData(ALL_EQUITIES);

  /* ── Build section definitions ─────────────────────────────────────────── */
  const sections = useMemo(() => [
    {
      id: 'charts',
      title: 'Sector Charts',
      span: 'full',
      component: () => (
        <SectorChartPanel
          tickers={CHART_TICKERS}
          height={200}
          cols={3}
        />
      ),
    },
    {
      id: 'japan',
      title: 'Japan',
      component: () => (
        <SectionTable tickers={JAPAN} statsMap={statsMap} />
      ),
    },
    {
      id: 'china-hk',
      title: 'China & Hong Kong',
      component: () => (
        <SectionTable tickers={CHINA_HK} statsMap={statsMap} />
      ),
    },
    {
      id: 'india',
      title: 'India',
      component: () => (
        <SectionTable tickers={INDIA} statsMap={statsMap} />
      ),
    },
    {
      id: 'korea-asean',
      title: 'Korea & ASEAN',
      component: () => (
        <SectionTable tickers={KOREA_ASEAN} statsMap={statsMap} />
      ),
    },
    {
      id: 'fx-monitor',
      title: 'Asian FX Monitor',
      component: FxMonitor,
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
      id: 'macro',
      title: 'Asian Macro Dashboard',
      span: 'full',
      component: MacroDashboard,
    },
    {
      id: 'insider',
      title: 'Insider Activity',
      span: 'full',
      component: () => (
        <InsiderActivity
          tickers={['BABA', 'TM', 'SONY', 'HDB', 'TCEHY', 'INFY']}
          limit={10}
          onTickerClick={openDetail}
        />
      ),
    },
  ], [statsMap, openDetail]);

  return (
    <FullPageScreenLayout
      title="ASIAN MARKETS"
      subtitle="Japan, China, India, Korea & ASEAN — ADRs, FX, and regional macro"
      accentColor="#ff5722"
      sections={sections}
      lastUpdated={new Date()}
    >
      <div style={{ padding: '12px', borderTop: '1px solid #1e1e1e' }}>
        <div style={{ fontSize: 10, fontWeight: 600, color: '#aaa', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          REGIONAL INDEX ETFs
        </div>
        <EtfStrip />
      </div>
    </FullPageScreenLayout>
  );
}

export default memo(AsianMarketsScreenImpl);
