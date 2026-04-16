/**
 * AsianMarketsScreen.jsx — Full-page Asian Markets Screen
 * Comprehensive coverage of Japan, China, India, Korea & ASEAN markets.
 * Integrates FullPageScreenLayout, FundamentalsTable, SectorChartPanel, and InsiderActivity.
 */
import { memo, useEffect, useMemo, useState } from 'react';
import FullPageScreenLayout from './shared/FullPageScreenLayout';
import SectorPulse from './shared/SectorPulse';
import { FundamentalsTable, EarningsCalendarStrip, MacroCalendarStrip } from './shared';
import { SectorChartPanel } from './shared/SectorChartPanel';
import { KPIRibbon, heatColor, TickerRibbon } from './shared/SectorUI';
import { useOpenDetail } from '../../context/OpenDetailContext';
import { useTickerPrice } from '../../context/PriceContext';
import { useDeepScreenData } from '../../hooks/useDeepScreenData';
import { useSectionData } from '../../hooks/useSectionData';
import { apiFetch } from '../../utils/api';
import { useMultiScreenTickers } from '../../hooks/useMultiScreenTickers';
import DeepScreenBase, { TickerCell, DeepSkeleton, DeepError, StatsLoadGate } from './DeepScreenBase';

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
const KOREA = ['005930.KS', '000660.KS', '035420.KS', '051910.KS', '005380.KS', 'SE'];
const TAIWAN = ['TSM', '2330.TW', '2317.TW'];
const ASEAN = ['GRAB'];
const FX_PAIRS = ['C:USDJPY', 'C:USDCNY', 'C:USDINR', 'C:USDKRW', 'C:USDSGD', 'C:USDTHB', 'C:USDIDR', 'C:USDPHP'];
const REGIONAL_ETFS = ['FXI', 'EWJ', 'INDA', 'EWY', 'EWT', 'VWO', 'AAXJ'];

const CHART_TICKERS = ['BABA', 'TM', 'SONY', 'HDB', 'TSM', '005930.KS'];

// Static fallback only — dynamic ALL_EQUITIES computed inside component
const STATIC_ALL_EQUITIES = [...JAPAN, ...CHINA_HK, ...INDIA, ...KOREA, ...TAIWAN, ...ASEAN];

const BANNER_TICKERS = [
  { ticker: 'EWJ', label: 'JAPAN ETF' },
  { ticker: 'FXI', label: 'CHINA ETF' },
  { ticker: 'INDA', label: 'INDIA ETF' },
  { ticker: 'EWY', label: 'KOREA ETF' },
  { ticker: 'EWT', label: 'TAIWAN ETF' },
  { ticker: 'TSM', label: 'TSMC ADR' },
  { ticker: 'TM', label: 'TOYOTA' },
  { ticker: 'BABA', label: 'ALIBABA' },
  { ticker: 'HDB', label: 'HDFC BANK' },
  { ticker: 'VWO', label: 'EM EQUITY' },
];

// Exchange configs for dynamic ticker resolution
const EXCHANGE_CONFIGS = [
  { exchange: 'TSE',  limit: 15, fallback: JAPAN },
  { exchange: 'KRX',  limit: 10, fallback: KOREA },
  { exchange: 'TWSE', limit: 10, fallback: TAIWAN },
  { exchange: 'HKEX', limit: 15, fallback: CHINA_HK },
];

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
  // Korea
  '005930.KS': 'Samsung',
  '000660.KS': 'SK Hynix',
  '035420.KS': 'NAVER',
  '051910.KS': 'LG Chem',
  '005380.KS': 'Hyundai Motor',
  SE: 'Sea Ltd',
  // Taiwan
  TSM: 'TSMC (ADR)',
  '2330.TW': 'TSMC',
  '2317.TW': 'Hon Hai',
  // ASEAN
  GRAB: 'Grab',
  // FX
  'C:USDJPY': 'USD/JPY',
  'C:USDCNY': 'USD/CNY',
  'C:USDINR': 'USD/INR',
  'C:USDKRW': 'USD/KRW',
  'C:USDSGD': 'USD/SGD',
  'C:USDTHB': 'USD/THB',
  'C:USDIDR': 'USD/IDR',
  'C:USDPHP': 'USD/PHP',
  // ETFs
  FXI: 'iShares China ETF',
  EWJ: 'iShares Japan ETF',
  INDA: 'iShares India ETF',
  EWY: 'iShares South Korea ETF',
  EWT: 'iShares Taiwan ETF',
  VWO: 'Vanguard Emerging Markets',
  AAXJ: 'iShares ASEAN ETF',
};

/* ── Phase 1 Deep Data Components ──────────────────────────────────── */
const EARNINGS_TICKERS = ['BABA', 'TM', 'SONY', 'HDB', 'INFY', 'TSM', 'TCEHY', 'NIO'];
const OWNERSHIP_TICKERS = ['BABA', 'TM', 'SONY', 'HDB', 'TSM', 'TCEHY'];
const SIGNALS_TICKERS = ['BABA', 'TM', 'SONY', 'HDB', 'INFY', 'TSM', 'TCEHY', 'NIO'];

const EarningsSection = memo(function EarningsSection() {
  return <EarningsCalendarStrip tickers={EARNINGS_TICKERS} accentColor="#ff5722" />;
});

const MacroCalendarSection = memo(function MacroCalendarSection() {
  return <MacroCalendarStrip countries={['JP', 'CN', 'IN', 'KR', 'AU']} limit={12} accentColor="#ff5722" />;
});

/* ── Macro Dashboard Component ─────────────────────────────────────────────── */
function MacroDashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchMacro = async () => {
      try {
        setLoading(true);
        setError(null);
        const res = await apiFetch('/api/macro/compare?countries=JP,CN,IN,KR&indicators=policyRate,cpiYoY,gdpGrowth');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        // Extract countries array from the nested response structure
        const countries = json?.data?.countries || json?.countries || [];
        setData(Array.isArray(countries) ? countries : []);
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
      <div style={{ padding: '10px', color: 'var(--text-muted)', fontSize: 10, textAlign: 'center' }}>
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
          {Array.isArray(data) ? data.map((row, idx) => (
            <tr key={idx}>
              <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{row.country || '—'}</td>
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
          )) : null}
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
      onClick={() => openDetail(pair, 'Asian Markets')}
      onTouchEnd={(e) => { e.preventDefault(); openDetail(pair, 'Asian Markets'); }}
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
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '1px', background: 'var(--border-default)', padding: '1px' }}>
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
    <tr
      className="ds-row-clickable"
      onClick={() => openDetail(sym, 'Asian Markets')}
      onTouchEnd={(e) => { e.preventDefault(); openDetail(sym, 'Asian Markets'); }}
    >
      <td className="ds-ticker-col">{sym}</td>
      <td style={{ color: 'var(--text-secondary)' }}>{name || LABELS[sym] || <span className="ds-dash">—</span>}</td>
      <td style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
        {q?.price != null ? fmt(q.price, 2) : <span className="ds-dash">—</span>}
      </td>
      <td className={q?.changePct != null && q.changePct >= 0 ? 'ds-up' : 'ds-down'}>
        {q?.changePct != null ? fmtPct(q?.changePct) : <span className="ds-dash">—</span>}
      </td>
      <td style={{ color: 'var(--text-secondary)' }}>
        {fmtB(statsMap.get(sym)?.market_capitalization) || <span className="ds-dash">—</span>}
      </td>
      <td style={{ color: 'var(--text-secondary)' }}>
        {statsMap.get(sym)?.pe_ratio != null ? parseFloat(statsMap.get(sym)?.pe_ratio).toFixed(1) + 'x' : <span className="ds-dash">—</span>}
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

/* ── ETF Strip Component (replaced with TickerRibbon) ────────────────────── */
const EtfStrip = memo(function EtfStrip() {
  return <TickerRibbon tickers={REGIONAL_ETFS} sectorName="Asian Markets" />;
});

/* ── Main Screen Implementation ────────────────────────────────────────────── */
function AsianMarketsScreenImpl() {
  const openDetail = useOpenDetail();
  const [selectedTicker, setSelectedTicker] = useState(null);

  // ── Dynamic ticker resolution for TSE, KRX, TWSE, HKEX ──
  const {
    tickersByExchange,
    nameMap,
    allEquities: dynamicEquities,
    loading: tickersLoading,
  } = useMultiScreenTickers(EXCHANGE_CONFIGS);

  // Merge dynamic exchange tickers with static India/ASEAN (ADR-only markets)
  const allEquities = useMemo(
    () => [...dynamicEquities, ...INDIA, ...ASEAN],
    [dynamicEquities],
  );

  const { data: statsMap, loading: statsLoading, error: statsError, refresh: statsRefresh } = useDeepScreenData(allEquities);

  // Helper: build ticker objects with names from dynamic nameMap + static LABELS
  const withNames = (syms) =>
    syms.map(s => ({ symbol: s, name: nameMap.get(s) || LABELS[s] || s }));

  // Per-section resolved tickers
  const japanTickers  = withNames(tickersByExchange['TSE']  || JAPAN);
  const koreaTickers  = withNames(tickersByExchange['KRX']  || KOREA);
  const taiwanTickers = withNames(tickersByExchange['TWSE'] || TAIWAN);
  const hkTickers     = withNames(tickersByExchange['HKEX'] || CHINA_HK);

  /* ── KPI Ribbon ────────────────────────────────────────────────────────── */
  function AsianKPIRibbon() {
    const ewj  = useTickerPrice('EWJ');
    const fxi  = useTickerPrice('FXI');
    const inda = useTickerPrice('INDA');
    const ewy  = useTickerPrice('EWY');
    const items = [
      { label: 'JAPAN',   value: ewj?.price != null ? '$' + fmt(ewj.price) : '—', change: ewj?.changePct },
      { label: 'CHINA',   value: fxi?.price != null ? '$' + fmt(fxi.price) : '—', change: fxi?.changePct },
      { label: 'INDIA',   value: inda?.price != null ? '$' + fmt(inda.price) : '—', change: inda?.changePct },
      { label: 'KOREA',   value: ewy?.price != null ? '$' + fmt(ewy.price) : '—', change: ewy?.changePct },
    ];
    return <KPIRibbon items={items} accentColor="#ff5722" />;
  }

  /* ── Build section definitions ─────────────────────────────────────────── */
  const sections = useMemo(() => [
    {
      id: 'kpi',
      title: 'KEY METRICS',
      span: 'full',
      component: AsianKPIRibbon,
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
      id: 'japan',
      title: `Japan${tickersByExchange['TSE']?.length ? ` (${tickersByExchange['TSE'].length})` : ''}`,
      component: () => (
        <StatsLoadGate statsMap={statsMap} loading={statsLoading || tickersLoading} error={statsError} refresh={statsRefresh}>
          <SectionTable tickers={japanTickers} statsMap={statsMap} />
        </StatsLoadGate>
      ),
    },
    {
      id: 'china-hk',
      title: `China & Hong Kong${hkTickers.length > CHINA_HK.length ? ` (${hkTickers.length})` : ''}`,
      component: () => (
        <StatsLoadGate statsMap={statsMap} loading={statsLoading || tickersLoading} error={statsError} refresh={statsRefresh}>
          <SectionTable tickers={hkTickers} statsMap={statsMap} />
        </StatsLoadGate>
      ),
    },
    {
      id: 'india',
      title: 'India',
      component: () => (
        <StatsLoadGate statsMap={statsMap} loading={statsLoading} error={statsError} refresh={statsRefresh}>
          <SectionTable tickers={INDIA} statsMap={statsMap} />
        </StatsLoadGate>
      ),
    },
    {
      id: 'korea',
      title: `Korea${koreaTickers.length > KOREA.length ? ` (${koreaTickers.length})` : ''}`,
      component: () => (
        <StatsLoadGate statsMap={statsMap} loading={statsLoading || tickersLoading} error={statsError} refresh={statsRefresh}>
          <SectionTable tickers={koreaTickers} statsMap={statsMap} />
        </StatsLoadGate>
      ),
    },
    {
      id: 'taiwan-asean',
      title: `Taiwan & ASEAN${taiwanTickers.length > TAIWAN.length ? ` (${taiwanTickers.length})` : ''}`,
      component: () => (
        <StatsLoadGate statsMap={statsMap} loading={statsLoading || tickersLoading} error={statsError} refresh={statsRefresh}>
          <SectionTable tickers={[...taiwanTickers, ...ASEAN.map(s => ({ symbol: s, name: LABELS[s] || s }))]} statsMap={statsMap} />
        </StatsLoadGate>
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
          tickers={allEquities}
          metrics={['pe', 'marketCap', 'revenue', 'grossMargins', 'operatingMargins', 'returnOnEquity']}
          title="All Equities - Key Metrics"
          onTickerClick={openDetail}
          statsMap={statsMap}
        />
      ),
    },
    {
      id: 'macro',
      title: 'Asian Macro Dashboard',
      component: MacroDashboard,
    },
    {
      id: 'earnings-calendar',
      title: 'Upcoming Earnings',
      component: EarningsSection,
    },
    {
      id: 'macro-calendar',
      title: 'Macro Calendar',
      span: 'full',
      component: MacroCalendarSection,
    },
  ], [statsMap, statsLoading, statsError, statsRefresh, openDetail, tickersLoading, tickersByExchange, japanTickers, hkTickers, koreaTickers, taiwanTickers, allEquities, nameMap]);

  return (
    <FullPageScreenLayout
      title="ASIAN MARKETS"
      subtitle="Japan, China, India, Korea & ASEAN — ADRs, FX, and regional macro"
      accentColor="#ff5722"
      vaultSector="asia"
      sections={sections}
      tickerBanner={BANNER_TICKERS}
      lastUpdated={new Date()}
      aiType="macro"
      aiContext={{ region: 'Asia-Pacific', tickers: ['EWJ', 'FXI', '2800.HK'] }}
      aiCacheKey="macro:asian"
    >
      <SectorPulse
        etfTicker="EWJ"
        etfLabel="EWJ"
        accentColor="#ff5722"
      />
    </FullPageScreenLayout>
  );
}

export default memo(AsianMarketsScreenImpl);
