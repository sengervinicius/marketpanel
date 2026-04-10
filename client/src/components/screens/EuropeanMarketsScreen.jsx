/**
 * EuropeanMarketsScreen.jsx — Full-page European Markets Screen
 * Comprehensive coverage of DAX, CAC, FTSE, Nordic, and Southern European equities,
 * FX pairs, sovereign spreads, and macro indicators.
 * Integrates FullPageScreenLayout, FundamentalsTable, SectorChartPanel, InsiderActivity,
 * and custom macro/spread tables for multi-dimensional European market analysis.
 */
import { memo, useMemo, useState } from 'react';
import FullPageScreenLayout from './shared/FullPageScreenLayout';
import { FundamentalsTable, EarningsCalendarStrip, AnalystActionsCard, OwnershipBreakdown, TechnicalSignalsCard, MacroCalendarStrip } from './shared';
import { SectorChartPanel } from './shared/SectorChartPanel';
import { InsiderActivity } from './shared/InsiderActivity';
import { useOpenDetail } from '../../context/OpenDetailContext';
import { useTickerPrice } from '../../context/PriceContext';
import { useDeepScreenData } from '../../hooks/useDeepScreenData';
import { useSectionData } from '../../hooks/useSectionData';
import { useMultiScreenTickers } from '../../hooks/useMultiScreenTickers';
import { apiFetch } from '../../utils/api';
import { DeepSkeleton, DeepError, TickerCell, StatsLoadGate } from './DeepScreenBase';
import { KPIRibbon, heatColor, TickerRibbon } from './shared/SectorUI';

/* ── Formatting utilities ──────────────────────────────────────────────── */
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

/* ── Ticker Universe ───────────────────────────────────────────────────── */
const GERMANY = [
  { symbol: 'SAP', name: 'SAP SE' },
  { symbol: 'SIEGY', name: 'Siemens' },
  { symbol: 'DTEKY', name: 'DT Telekom' },
  { symbol: 'BASFY', name: 'BASF' },
  { symbol: 'BMWYY', name: 'BMW' },
];

const FRANCE = [
  { symbol: 'LVMUY', name: 'LVMH' },
  { symbol: 'TTE', name: 'TotalEnergies' },
  { symbol: 'LRLCY', name: "L'Oreal" },
  { symbol: 'EADSY', name: 'Airbus' },
];

const UNITED_KINGDOM = [
  { symbol: 'AZN', name: 'AstraZeneca' },
  { symbol: 'SHEL', name: 'Shell' },
  { symbol: 'HSBC', name: 'HSBC' },
  { symbol: 'UL', name: 'Unilever' },
  { symbol: 'RIO', name: 'Rio Tinto' },
  { symbol: 'BP', name: 'BP' },
];

const NORDIC = [
  { symbol: 'NVO', name: 'Novo Nordisk' },
  { symbol: 'ERIC', name: 'Ericsson' },
  { symbol: 'SPOT', name: 'Spotify' },
  { symbol: 'VLVLY', name: 'Volvo' },
];

const SOUTHERN_EUROPE = [
  { symbol: 'SAN', name: 'Banco Santander' },
  { symbol: 'ING', name: 'ING Group' },
];

const FX_PAIRS = ['C:EURUSD', 'C:GBPUSD', 'C:EURCHF', 'C:EURSEK'];

const ETFS = ['EZU', 'EWG', 'EWU', 'EWQ', 'VGK'];

const CHART_TICKERS = ['SAP', 'AZN', 'NVO', 'SHEL', 'LVMUY', 'TTE'];

// Static fallback only — dynamic ALL_EQUITIES computed inside component
const STATIC_ALL_EQUITIES = [
  ...GERMANY.map(e => e.symbol),
  ...FRANCE.map(e => e.symbol),
  ...UNITED_KINGDOM.map(e => e.symbol),
  ...NORDIC.map(e => e.symbol),
  ...SOUTHERN_EUROPE.map(e => e.symbol),
];

const INSIDER_TICKERS = ['SAP', 'AZN', 'NVO', 'SHEL', 'LVMUY', 'HSBC'];

// Exchange configs for dynamic ticker resolution
const EXCHANGE_CONFIGS = [
  { exchange: 'XETRA',    limit: 15, fallback: GERMANY.map(e => e.symbol) },
  { exchange: 'LSE',      limit: 15, fallback: UNITED_KINGDOM.map(e => e.symbol) },
  { exchange: 'EURONEXT', limit: 15, fallback: [...FRANCE, ...SOUTHERN_EUROPE].map(e => e.symbol) },
];

const BANNER_TICKERS = [
  { ticker: 'VGK', label: 'EUROPE ETF' },
  { ticker: 'EZU', label: 'EUROZONE ETF' },
  { ticker: 'EWG', label: 'GERMANY ETF' },
  { ticker: 'EWU', label: 'UK ETF' },
  { ticker: 'EWQ', label: 'FRANCE ETF' },
  { ticker: 'SAP', label: 'SAP' },
  { ticker: 'AZN', label: 'ASTRAZENECA' },
  { ticker: 'SHEL', label: 'SHELL' },
  { ticker: 'NVO', label: 'NOVO NORDISK' },
  { ticker: 'TTE', label: 'TOTALENERGIES' },
];

const LABELS = {
  SAP: 'SAP SE', SIEGY: 'Siemens', DTEKY: 'DT Telekom', BASFY: 'BASF', BMWYY: 'BMW',
  LVMUY: 'LVMH', TTE: 'TotalEnergies', LRLCY: "L'Oreal", EADSY: 'Airbus',
  AZN: 'AstraZeneca', SHEL: 'Shell', HSBC: 'HSBC', UL: 'Unilever', RIO: 'Rio Tinto', BP: 'BP',
  NVO: 'Novo Nordisk', ERIC: 'Ericsson', SPOT: 'Spotify', VLVLY: 'Volvo',
  SAN: 'Banco Santander', ING: 'ING Group',
};

/* ── Phase 1 Deep Data Components ──────────────────────────────────── */
const EARNINGS_TICKERS = ['SAP', 'AZN', 'NVO', 'SHEL', 'LVMUY', 'TTE', 'HSBC', 'UL'];
const OWNERSHIP_TICKERS = ['SAP', 'AZN', 'NVO', 'SHEL', 'HSBC', 'UL'];
const SIGNALS_TICKERS = ['SAP', 'AZN', 'NVO', 'SHEL', 'LVMUY', 'TTE', 'HSBC', 'UL'];
const ANALYST_TICKERS = ['SAP', 'AZN', 'NVO', 'SHEL', 'TTE', 'HSBC'];

const TechnicalSignalsSection = memo(function TechnicalSignalsSection() {
  return <TechnicalSignalsCard tickers={SIGNALS_TICKERS} accentColor="#3f51b5" />;
});

const EarningsSection = memo(function EarningsSection() {
  return <EarningsCalendarStrip tickers={EARNINGS_TICKERS} accentColor="#3f51b5" />;
});

const AnalystSection = memo(function AnalystSection() {
  return <AnalystActionsCard tickers={ANALYST_TICKERS} accentColor="#3f51b5" />;
});

const OwnershipSection = memo(function OwnershipSection() {
  return <OwnershipBreakdown tickers={OWNERSHIP_TICKERS} accentColor="#3f51b5" />;
});

const MacroCalendarSection = memo(function MacroCalendarSection() {
  return <MacroCalendarStrip countries={['EU', 'DE', 'GB', 'FR', 'IT', 'CH']} limit={12} accentColor="#3f51b5" />;
});

/* ── Table Row Component ───────────────────────────────────────────────── */
const TableRow = memo(function TableRow({ ticker, name, statsMap, openDetail }) {
  const sym = typeof ticker === 'string' ? ticker : ticker.symbol;
  const displayName = typeof ticker === 'string' ? name : ticker.name;
  const q = useTickerPrice(sym);

  return (
    <tr
      className="ds-row-clickable"
      onClick={() => openDetail(sym, 'European Markets')}
      onTouchEnd={(e) => { e.preventDefault(); openDetail(sym, 'European Markets'); }}
    >
      <td className="ds-ticker-col" style={{ fontSize: 13, letterSpacing: '0.5px' }}>{sym}</td>
      <td style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{displayName || LABELS[sym] || <span className="ds-dash">—</span>}</td>
      <td style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 600, fontVariantNumeric: 'tabular-nums', fontFamily: 'var(--font-mono)' }}>
        {q?.price != null ? '$' + fmt(q.price, 2) : <span className="ds-dash">—</span>}
      </td>
      <td className={q?.changePct != null && q.changePct >= 0 ? 'ds-up' : 'ds-down'} style={{ fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums', fontFamily: 'var(--font-mono)', background: heatColor(q?.changePct) }}>
        {q?.changePct != null ? fmtPct(q?.changePct) : <span className="ds-dash">—</span>}
      </td>
      <td style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
        {fmtB(statsMap.get(sym)?.market_capitalization) || <span className="ds-dash">—</span>}
      </td>
      <td style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
        {statsMap.get(sym)?.pe_ratio != null ? parseFloat(statsMap.get(sym)?.pe_ratio).toFixed(1) + 'x' : <span className="ds-dash">—</span>}
      </td>
    </tr>
  );
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
          {tickers.map(t => (
            <TableRow key={typeof t === 'string' ? t : t.symbol} ticker={t} statsMap={statsMap} openDetail={openDetail} />
          ))}
        </tbody>
      </table>
    </div>
  );
});

/* ── FX Pair Row Component ─────────────────────────────────────────────── */
const FxPairRow = memo(function FxPairRow({ pair, openDetail }) {
  const q = useTickerPrice(pair);
  const display = pair.replace(/^C:/, '');

  return (
    <tr
      className="ds-row-clickable"
      onClick={() => openDetail(pair, 'European Markets')}
      onTouchEnd={(e) => { e.preventDefault(); openDetail(pair, 'European Markets'); }}
    >
      <td className="ds-ticker-col" style={{ fontSize: 13 }}>{display}</td>
      <td style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 600, fontVariantNumeric: 'tabular-nums', fontFamily: 'var(--font-mono)' }}>
        {q?.price != null ? fmt(q?.price, 4) : <span className="ds-dash">—</span>}
      </td>
      <td className={q?.changePct != null && q.changePct >= 0 ? 'ds-up' : 'ds-down'} style={{ fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums', fontFamily: 'var(--font-mono)' }}>
        {q?.changePct != null ? fmtPct(q?.changePct) : <span className="ds-dash">—</span>}
      </td>
    </tr>
  );
});

/* ── FX Pairs Component ────────────────────────────────────────────────── */
const FxPairsTable = memo(function FxPairsTable() {
  const openDetail = useOpenDetail();

  return (
    <div style={{ overflow: 'auto' }}>
      <table className="ds-table">
        <thead>
          <tr>
            <th>Pair</th>
            <th>Rate</th>
            <th>1D%</th>
          </tr>
        </thead>
        <tbody>
          {FX_PAIRS.map(pair => (
            <FxPairRow key={pair} pair={pair} openDetail={openDetail} />
          ))}
        </tbody>
      </table>
    </div>
  );
});

/* ── Macro Indicators Table Component ───────────────────────────────────── */
const MacroTable = memo(function MacroTable({ data, loading, error }) {
  if (loading) return <DeepSkeleton rows={6} />;
  if (error) return <DeepError message={`Error: ${error}`} />;
  if (!data || data.length === 0) {
    return <div style={{ padding: '10px', color: 'var(--text-muted)', fontSize: 10 }}>No data available</div>;
  }

  return (
    <div style={{ overflow: 'auto' }}>
      <table className="ds-table">
        <thead>
          <tr>
            <th>Region</th>
            <th>Policy Rate (%)</th>
            <th>CPI YoY (%)</th>
            <th>GDP Growth (%)</th>
            <th>Unemployment (%)</th>
          </tr>
        </thead>
        <tbody>
          {data.map((row, idx) => (
            <tr key={idx}>
              <td style={{ fontWeight: 500 }}>{row.country || '—'}</td>
              <td>{row.policyRate != null ? row.policyRate.toFixed(2) : '—'}</td>
              <td className={row.cpiYoY != null && row.cpiYoY >= 0 ? 'ds-up' : 'ds-down'}>
                {row.cpiYoY != null ? row.cpiYoY.toFixed(2) : '—'}
              </td>
              <td className={row.gdpGrowth != null && row.gdpGrowth >= 0 ? 'ds-up' : 'ds-down'}>
                {row.gdpGrowth != null ? row.gdpGrowth.toFixed(2) : '—'}
              </td>
              <td>{row.unemploymentRate != null ? row.unemploymentRate.toFixed(2) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
});

/* ── Bund Spread Monitor Component ──────────────────────────────────────── */
const BundSpreadMonitor = memo(function BundSpreadMonitor({ data, loading, error }) {
  if (loading) return <DeepSkeleton rows={5} />;
  if (error) return <DeepError message={`Error: ${error}`} />;
  if (!data || data.length === 0) {
    return <div style={{ padding: '10px', color: 'var(--text-muted)', fontSize: 10 }}>No data available</div>;
  }

  const getSpreadColor = (bps) => {
    if (bps < 50) return 'var(--semantic-up)'; // Tight spread (green)
    if (bps < 150) return 'var(--semantic-warn)'; // Wide-ish (orange)
    return 'var(--semantic-down)'; // Very wide (red)
  };

  return (
    <div style={{ overflow: 'auto' }}>
      <table className="ds-table">
        <thead>
          <tr>
            <th>Country</th>
            <th>10Y Spread (bps)</th>
            <th style={{ fontSize: 8, color: 'var(--text-muted)' }}>vs German Bunds</th>
          </tr>
        </thead>
        <tbody>
          {data.map((row, idx) => (
            <tr key={idx}>
              <td style={{ fontWeight: 500 }}>{row.country || '—'}</td>
              <td style={{ color: getSpreadColor(row.spreadBps), fontWeight: 500 }}>
                {row.spreadBps != null ? row.spreadBps.toFixed(1) : '—'}
              </td>
              <td style={{ fontSize: 8, color: 'var(--text-muted)' }}>
                {row.tenor || '10Y'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
});

/* ── ETF Cell Component ────────────────────────────────────────────────── */
const EtfCell = memo(function EtfCell({ symbol, openDetail }) {
  const q = useTickerPrice(symbol);

  return (
    <TickerCell
      symbol={symbol}
      price={q?.price}
      changePct={q?.changePct}
      onClick={openDetail}
    />
  );
});

/* ── ETF Strip Component (replaced with TickerRibbon) ──────────────────── */
const EtfStrip = memo(function EtfStrip() {
  return <TickerRibbon tickers={ETFS} sectorName="European Markets" />;
});

/* ── Main Screen Implementation ────────────────────────────────────────── */
function EuropeanMarketsScreenImpl() {
  const openDetail = useOpenDetail();
  const [selectedTicker, setSelectedTicker] = useState(null);

  // ── Dynamic ticker resolution for XETRA, LSE, EURONEXT ──
  const {
    tickersByExchange,
    nameMap,
    allEquities: dynamicEquities,
    loading: tickersLoading,
  } = useMultiScreenTickers(EXCHANGE_CONFIGS);

  // Merge dynamic exchange tickers with static Nordic (ADR-only)
  const allEquities = useMemo(
    () => [...dynamicEquities, ...NORDIC.map(e => e.symbol)],
    [dynamicEquities],
  );

  const { data: statsMap, loading: statsLoading, error: statsError, refresh: statsRefresh } = useDeepScreenData(allEquities);

  // Helper: build ticker objects with names from dynamic nameMap + static LABELS
  const withNames = (syms) =>
    syms.map(s => ({ symbol: s, name: nameMap.get(s) || LABELS[s] || s }));

  // Per-section resolved tickers
  const germanyTickers  = withNames(tickersByExchange['XETRA']    || GERMANY.map(e => e.symbol));
  const ukTickers       = withNames(tickersByExchange['LSE']      || UNITED_KINGDOM.map(e => e.symbol));
  const euronextTickers = withNames(tickersByExchange['EURONEXT'] || [...FRANCE, ...SOUTHERN_EUROPE].map(e => e.symbol));

  /* ── Fetch macro data ────────────────────────────────────────────────── */
  const { data: macroData, loading: macroLoading, error: macroError } = useSectionData({
    cacheKey: 'euro-macro',
    fetcher: async () => {
      const res = await apiFetch('/api/macro/compare?countries=EU,DE,FR,IT,GB&indicators=policyRate,cpiYoY,gdpGrowth,unemploymentRate');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    refreshMs: 300000, // 5 min
  });

  /* ── Fetch bond spreads data ─────────────────────────────────────────── */
  const { data: spreadData, loading: spreadLoading, error: spreadError } = useSectionData({
    cacheKey: 'euro-spreads',
    fetcher: async () => {
      const res = await apiFetch('/api/bonds/spreads?base=DE&comparisons=IT,ES,FR&tenor=10Y');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    refreshMs: 300000, // 5 min
  });

  /* ── KPI Ribbon ────────────────────────────────────────────────────────── */
  function EuropeKPIRibbon() {
    const vgk = useTickerPrice('VGK');
    const ezu = useTickerPrice('EZU');
    const ewg = useTickerPrice('EWG');
    const ewu = useTickerPrice('EWU');
    const items = [
      { label: 'EUROPE',   value: vgk?.price != null ? '$' + fmt(vgk.price) : '—', change: vgk?.changePct },
      { label: 'EUROZONE', value: ezu?.price != null ? '$' + fmt(ezu.price) : '—', change: ezu?.changePct },
      { label: 'GERMANY',  value: ewg?.price != null ? '$' + fmt(ewg.price) : '—', change: ewg?.changePct },
      { label: 'UK',       value: ewu?.price != null ? '$' + fmt(ewu.price) : '—', change: ewu?.changePct },
    ];
    return <KPIRibbon items={items} accentColor="#3f51b5" />;
  }

  /* ── Build section definitions ─────────────────────────────────────── */
  const sections = useMemo(() => [
    {
      id: 'kpi',
      title: 'KEY METRICS',
      span: 'full',
      component: EuropeKPIRibbon,
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
      id: 'germany',
      title: `Germany (DAX)${germanyTickers.length > GERMANY.length ? ` — ${germanyTickers.length}` : ''}`,
      component: () => (
        <StatsLoadGate statsMap={statsMap} loading={statsLoading || tickersLoading} error={statsError} refresh={statsRefresh}>
          <SectionTable tickers={germanyTickers} statsMap={statsMap} />
        </StatsLoadGate>
      ),
    },
    {
      id: 'france-south',
      title: `France & Southern Europe${euronextTickers.length > (FRANCE.length + SOUTHERN_EUROPE.length) ? ` — ${euronextTickers.length}` : ''}`,
      component: () => (
        <StatsLoadGate statsMap={statsMap} loading={statsLoading || tickersLoading} error={statsError} refresh={statsRefresh}>
          <SectionTable tickers={euronextTickers} statsMap={statsMap} />
        </StatsLoadGate>
      ),
    },
    {
      id: 'uk',
      title: `United Kingdom (FTSE)${ukTickers.length > UNITED_KINGDOM.length ? ` — ${ukTickers.length}` : ''}`,
      component: () => (
        <StatsLoadGate statsMap={statsMap} loading={statsLoading || tickersLoading} error={statsError} refresh={statsRefresh}>
          <SectionTable tickers={ukTickers} statsMap={statsMap} />
        </StatsLoadGate>
      ),
    },
    {
      id: 'nordic',
      title: 'Nordic',
      component: () => (
        <StatsLoadGate statsMap={statsMap} loading={statsLoading} error={statsError} refresh={statsRefresh}>
          <SectionTable tickers={NORDIC} statsMap={statsMap} />
        </StatsLoadGate>
      ),
    },
    {
      id: 'fx',
      title: 'European FX',
      component: () => (
        <FxPairsTable />
      ),
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
      title: 'Euro Area Macro Indicators',
      span: 'full',
      component: () => (
        <MacroTable
          data={Array.isArray(macroData) ? macroData : macroData?.data?.countries || macroData?.data || []}
          loading={macroLoading}
          error={macroError}
        />
      ),
    },
    {
      id: 'spreads',
      title: 'Bund Spread Monitor (10Y)',
      span: 'full',
      component: () => (
        <BundSpreadMonitor
          data={Array.isArray(spreadData) ? spreadData : spreadData?.data || []}
          loading={spreadLoading}
          error={spreadError}
        />
      ),
    },
    {
      id: 'tech-signals',
      title: 'Technical Signals',
      component: TechnicalSignalsSection,
    },
    {
      id: 'earnings-calendar',
      title: 'Upcoming Earnings',
      span: 'full',
      component: EarningsSection,
    },
    {
      id: 'analyst-actions',
      title: 'Analyst Actions',
      component: AnalystSection,
    },
    {
      id: 'ownership',
      title: 'Ownership Structure',
      component: OwnershipSection,
    },
    {
      id: 'macro-calendar',
      title: 'Macro Calendar',
      span: 'full',
      component: MacroCalendarSection,
    },
    {
      id: 'insider',
      title: 'Insider Activity',
      span: 'full',
      component: () => (
        <InsiderActivity
          tickers={INSIDER_TICKERS}
          limit={10}
          onTickerClick={openDetail}
        />
      ),
    },
  ], [statsMap, statsLoading, statsError, statsRefresh, macroData, macroLoading, macroError, spreadData, spreadLoading, spreadError, openDetail, tickersLoading, germanyTickers, ukTickers, euronextTickers, allEquities]);

  return (
    <FullPageScreenLayout
      title="EUROPEAN MARKETS"
      subtitle="DAX, CAC, FTSE, Nordic & Southern Europe — equities, FX, and sovereign spreads"
      accentColor="#3f51b5"
      sections={sections}
      tickerBanner={BANNER_TICKERS}
      lastUpdated={new Date()}
      aiType="macro"
      aiContext={{ region: 'Europe', tickers: ['VGK', 'EWG', 'EWQ'] }}
      aiCacheKey="macro:european"
    >
      <div style={{ padding: '12px', borderTop: '1px solid var(--border-default)' }}>
        <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          European ETFs
        </div>
        <EtfStrip />
      </div>
    </FullPageScreenLayout>
  );
}

export default memo(EuropeanMarketsScreenImpl);
