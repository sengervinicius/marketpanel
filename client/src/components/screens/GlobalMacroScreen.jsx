/**
 * GlobalMacroScreen.jsx — Bloomberg Economics Equivalent
 * Comprehensive full-page global macro screen using FullPageScreenLayout.
 * Sections: Charts, Global Snapshot, Volatility, FX Heatmap, Yield Curves,
 *           Central Bank Rates, Risk Appetite, European Markets, Equity Indexes, Macro Calendar
 */
import { memo } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import FullPageScreenLayout from './shared/FullPageScreenLayout';
import { SectorChartPanel } from './shared/SectorChartPanel';
import DataUnavailable from '../common/DataUnavailable';
import useSectionData from '../../hooks/useSectionData';
import { useOpenDetail } from '../../context/OpenDetailContext';
import { useTickerPrice } from '../../context/PriceContext';
import { apiFetch } from '../../utils/api';
import { DeepSkeleton, DeepError, TickerCell } from './DeepScreenBase';

const fmt = (n, d = 2) =>
  n == null ? '—' : n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtPct = (n) => n == null ? '—' : (n >= 0 ? '+' : '') + n.toFixed(2) + '%';

/* ─────────────────────────────────────────────────────────────────────── */
/* 2. GLOBAL MACRO SNAPSHOT */
/* ─────────────────────────────────────────────────────────────────────── */
function GlobalSnapshot() {
  const openDetail = useOpenDetail();
  const { data, loading, error } = useSectionData({
    cacheKey: 'screen:macro:snapshot',
    fetcher: async () => {
      const res = await apiFetch('/api/macro/compare?countries=US,EU,DE,FR,IT,GB,JP,CN,BR,MX,IN,ZA&indicators=policyRate,cpiYoY,gdpGrowth,unemploymentRate');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
  });

  if (loading) return <DeepSkeleton rows={8} />;
  if (error) return <DataUnavailable reason={error} />;
  if (!data || !Array.isArray(data)) return <DataUnavailable reason="No snapshot data" />;

  const getCpiColor = (val) => {
    if (val == null) return '';
    if (val > 4) return '#d32f2f';
    if (val > 3) return '#f57c00';
    if (val > 2) return '#388e3c';
    return '';
  };

  const getUneColor = (val) => {
    if (val == null) return '';
    if (val < 3.5) return '#388e3c';
    if (val < 4.5) return '#f57c00';
    return '#d32f2f';
  };

  return (
    <table className="ds-table">
      <thead>
        <tr>
          <th>Country</th>
          <th title="Central Bank Policy Rate">Rate (%)</th>
          <th title="Consumer Price Index YoY">CPI YoY (%)</th>
          <th title="GDP Growth">GDP Gr. (%)</th>
          <th title="Unemployment Rate">Unemp. (%)</th>
        </tr>
      </thead>
      <tbody>
        {data.map((row) => (
          <tr key={row.country || row.code} className="ds-row-clickable" onClick={() => openDetail(row.country)}>
            <td className="ds-ticker-col">{row.country || row.code}</td>
            <td>{fmt(row.policyRate, 2)}</td>
            <td style={{ color: getCpiColor(row.cpiYoY) }}>{fmt(row.cpiYoY, 2)}</td>
            <td>{fmt(row.gdpGrowth, 2)}</td>
            <td style={{ color: getUneColor(row.unemploymentRate) }}>{fmt(row.unemploymentRate, 2)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ─────────────────────────────────────────────────────────────────────── */
/* 3. VOLATILITY DASHBOARD */
/* ─────────────────────────────────────────────────────────────────────── */
const VOL_TICKERS = [
  { symbol: 'VIX',   label: 'CBOE VIX',        thresholds: [15, 25] },
  { symbol: 'VVIX',  label: 'VIX of VIX',      thresholds: [80, 120] },
  { symbol: 'GVZ',   label: 'Gold Vol',        thresholds: [15, 25] },
  { symbol: 'TLT',   label: 'Bond Vol (TLT)',  thresholds: [85, 100] },
  { symbol: 'HYG',   label: 'Credit (HYG)',    thresholds: [95, 90] },
];

function VolatilityDashboard() {
  const openDetail = useOpenDetail();

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
      {VOL_TICKERS.map(({ symbol, label, thresholds }) => (
        <VolCard key={symbol} symbol={symbol} label={label} thresholds={thresholds} openDetail={openDetail} />
      ))}
    </div>
  );
}

function VolCard({ symbol, label, thresholds, openDetail }) {
  const q = useTickerPrice(symbol);
  const level = q?.price;

  let color = '#888';
  if (level != null) {
    // For HYG, inverted logic (higher prices = safer)
    if (symbol === 'HYG') {
      color = level > thresholds[0] ? '#388e3c' : level > thresholds[1] ? '#f57c00' : '#d32f2f';
    } else {
      color = level < thresholds[0] ? '#388e3c' : level < thresholds[1] ? '#f57c00' : '#d32f2f';
    }
  }

  return (
    <div
      onClick={() => openDetail(symbol)}
      style={{
        background: '#0a0a1a',
        border: `2px solid ${color}`,
        borderRadius: 6,
        padding: '12px 14px',
        cursor: 'pointer',
        transition: 'all 0.2s',
      }}
    >
      <div style={{ fontSize: 10, color: '#888', marginBottom: 4, fontWeight: 500 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color, marginBottom: 4 }}>{level != null ? fmt(level, 1) : '—'}</div>
      <div style={{ fontSize: 10, color: q?.changePct >= 0 ? '#66bb6a' : '#ef5350' }}>
        {q?.changePct != null ? fmtPct(q.changePct) : '—'}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────── */
/* 4. FX HEATMAP */
/* ─────────────────────────────────────────────────────────────────────── */
function FxHeatmap() {
  const openDetail = useOpenDetail();
  const fxPairs = ['C:EURUSD', 'C:USDJPY', 'C:GBPUSD', 'C:USDCHF', 'C:AUDUSD', 'C:USDCAD', 'C:USDBRL', 'C:USDMXN'];

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
      {fxPairs.map((pair) => (
        <FxCell key={pair} pair={pair} openDetail={openDetail} />
      ))}
    </div>
  );
}

function FxCell({ pair, openDetail }) {
  const q = useTickerPrice(pair);
  const displayPair = pair.replace(/^C:/, '');
  const changePct = q?.changePct || 0;
  const color = changePct >= 0 ? '#4caf50' : '#ef5350';

  return (
    <div
      onClick={() => openDetail(pair)}
      style={{
        background: '#0a0a1a',
        border: `1px solid ${color}44`,
        borderRadius: 6,
        padding: '10px 12px',
        cursor: 'pointer',
        textAlign: 'center',
      }}
    >
      <div style={{ fontSize: 10, fontWeight: 600, color: '#e0e0e0', marginBottom: 6 }}>{displayPair}</div>
      <div style={{ fontSize: 14, fontWeight: 600, color: '#e0e0e0', marginBottom: 4 }}>{q?.price != null ? fmt(q.price, 4) : '—'}</div>
      <div style={{ fontSize: 10, fontWeight: 500, color }}>{fmtPct(changePct)}</div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────── */
/* 5. YIELD CURVE ANALYSIS */
/* ─────────────────────────────────────────────────────────────────────── */
function YieldCurveAnalysis() {
  const { data: yieldData, loading, error } = useSectionData({
    cacheKey: 'macro:yield-curves',
    fetcher: async () => {
      const res = await apiFetch('/api/bonds/yield-curves?countries=US');
      return res.ok ? await res.json() : null;
    },
    refreshMs: 300000,
  });

  if (loading) return <DeepSkeleton rows={4} />;
  if (error) return <DataUnavailable reason={error} />;

  let chartData = [];
  let spread2s10s = null;

  if (yieldData) {
    const usData = yieldData?.curves?.[0]?.curve || yieldData?.US || yieldData;
    if (Array.isArray(usData)) {
      // Map tenor to numeric order for sorting
      const tenorOrder = { '2Y': 2, '3Y': 3, '5Y': 5, '7Y': 7, '10Y': 10, '20Y': 20, '30Y': 30 };

      chartData = usData
        .filter(p => p.yield != null)
        .sort((a, b) => {
          const aOrder = tenorOrder[a.tenor] || tenorOrder[a.maturity] || 999;
          const bOrder = tenorOrder[b.tenor] || tenorOrder[b.maturity] || 999;
          return aOrder - bOrder;
        })
        .map(p => ({
          tenor: p.tenor || p.maturity,
          yield: parseFloat(p.yield),
        }));

      const y2  = usData.find(p => p.tenor === '2Y' || p.maturity === '2Y');
      const y10 = usData.find(p => p.tenor === '10Y' || p.maturity === '10Y');
      if (y2?.yield != null && y10?.yield != null) {
        spread2s10s = y10.yield - y2.yield;
      }
    }
  }

  const isInverted = spread2s10s != null && spread2s10s < 0;

  return (
    <>
      {spread2s10s != null && (
        <div style={{
          background: isInverted ? '#2a000a' : '#0a1a0a',
          border: `1px solid ${isInverted ? '#ef535044' : '#66bb6a44'}`,
          borderRadius: 6,
          padding: '8px 12px',
          marginBottom: 12,
          fontSize: 12,
          color: isInverted ? '#ef5350' : '#66bb6a',
          fontWeight: 500,
        }}>
          2s10s Spread: {spread2s10s > 0 ? '+' : ''}{(spread2s10s * 100).toFixed(0)}bp {isInverted ? '— INVERTED' : '— Steepening'}
        </div>
      )}
      {chartData.length > 0 ? (
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={chartData}>
            <XAxis dataKey="tenor" style={{ fontSize: 10, fill: '#666' }} />
            <YAxis style={{ fontSize: 10, fill: '#666' }} label={{ value: 'Yield (%)', angle: -90, position: 'insideLeft' }} />
            <Tooltip
              contentStyle={{ background: '#0a0a0a', border: '1px solid #1e1e1e', borderRadius: 3, fontSize: 10 }}
              formatter={(value) => value.toFixed(3)}
            />
            <Line
              type="monotone"
              dataKey="yield"
              stroke={isInverted ? '#ef5350' : '#66bb6a'}
              dot={{ fill: '#9c27b0', r: 4 }}
              activeDot={{ r: 6 }}
              strokeWidth={2}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      ) : (
        <DataUnavailable reason="No yield curve data" />
      )}
    </>
  );
}

/* ─────────────────────────────────────────────────────────────────────── */
/* 6. CENTRAL BANK RATES */
/* ─────────────────────────────────────────────────────────────────────── */
function CentralBankRates() {
  const { data, loading, error } = useSectionData({
    cacheKey: 'screen:macro:snapshot',
    fetcher: async () => {
      const res = await apiFetch('/api/macro/compare?countries=US,EU,JP,GB,BR,CN,IN&indicators=policyRate');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
  });

  if (loading) return <DeepSkeleton rows={6} />;
  if (error) return <DataUnavailable reason={error} />;
  if (!data || !Array.isArray(data)) return <DataUnavailable reason="No rate data" />;

  const maxRate = Math.max(...data.map(d => d.policyRate || 0));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {data.map((row) => (
        <div key={row.country} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ minWidth: 60, fontSize: 11, fontWeight: 600, color: '#e0e0e0' }}>
            {row.country}
          </div>
          <div style={{ flex: 1, height: 24, background: '#1a1a1a', borderRadius: 3, position: 'relative', overflow: 'hidden' }}>
            <div
              style={{
                height: '100%',
                width: `${(row.policyRate / maxRate) * 100}%`,
                background: 'linear-gradient(90deg, #9c27b0, #7b1fa2)',
                borderRadius: 3,
                transition: 'width 0.3s',
              }}
            />
          </div>
          <div style={{ minWidth: 50, textAlign: 'right', fontSize: 11, fontWeight: 600, color: '#9c27b0' }}>
            {fmt(row.policyRate, 2)}%
          </div>
        </div>
      ))}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────── */
/* 7. RISK APPETITE INDICATORS */
/* ─────────────────────────────────────────────────────────────────────── */
function RiskAppetiteIndicators() {
  const openDetail = useOpenDetail();
  const hyg = useTickerPrice('HYG');
  const eem = useTickerPrice('EEM');
  const spy = useTickerPrice('SPY');
  const gld = useTickerPrice('GLD');

  const emRiskRatio = eem?.price && spy?.price ? (eem.price / spy.price).toFixed(4) : null;
  const emRiskChange = eem?.changePct && spy?.changePct ? (eem.changePct - spy.changePct).toFixed(2) : null;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
      {/* Credit Risk (HYG) */}
      <div
        onClick={() => openDetail('HYG')}
        style={{
          background: '#0a0a1a',
          border: `1px solid ${hyg?.price && hyg.price > 95 ? '#66bb6a' : hyg?.price && hyg.price > 90 ? '#f57c00' : '#ef5350'}44`,
          borderRadius: 6,
          padding: '12px 14px',
          cursor: 'pointer',
        }}
      >
        <div style={{ fontSize: 10, color: '#888', marginBottom: 4, fontWeight: 500 }}>Credit Risk (HYG)</div>
        <div style={{ fontSize: 18, fontWeight: 700, color: '#e0e0e0', marginBottom: 4 }}>{fmt(hyg?.price)}</div>
        <div style={{ fontSize: 10, color: hyg?.changePct >= 0 ? '#66bb6a' : '#ef5350' }}>
          {fmtPct(hyg?.changePct)}
        </div>
      </div>

      {/* EM Risk (EEM/SPY) */}
      <div
        onClick={() => openDetail('EEM')}
        style={{
          background: '#0a0a1a',
          border: `1px solid ${emRiskChange && emRiskChange >= 0 ? '#4caf50' : '#f44336'}44`,
          borderRadius: 6,
          padding: '12px 14px',
          cursor: 'pointer',
        }}
      >
        <div style={{ fontSize: 10, color: '#888', marginBottom: 4, fontWeight: 500 }}>EM Risk Appetite</div>
        <div style={{ fontSize: 18, fontWeight: 700, color: '#e0e0e0', marginBottom: 4 }}>{emRiskRatio || '—'}</div>
        <div style={{ fontSize: 10, color: emRiskChange >= 0 ? '#66bb6a' : '#ef5350' }}>
          EEM/SPY {emRiskChange != null ? (emRiskChange >= 0 ? '+' : '') + emRiskChange + '%' : '—'}
        </div>
      </div>

      {/* Safe Haven (GLD) */}
      <div
        onClick={() => openDetail('GLD')}
        style={{
          background: '#0a0a1a',
          border: `1px solid ${gld?.changePct && gld.changePct >= 0 ? '#f57c00' : '#66bb6a'}44`,
          borderRadius: 6,
          padding: '12px 14px',
          cursor: 'pointer',
        }}
      >
        <div style={{ fontSize: 10, color: '#888', marginBottom: 4, fontWeight: 500 }}>Safe Haven (Gold)</div>
        <div style={{ fontSize: 18, fontWeight: 700, color: '#e0e0e0', marginBottom: 4 }}>{fmt(gld?.price)}</div>
        <div style={{ fontSize: 10, color: gld?.changePct >= 0 ? '#66bb6a' : '#ef5350' }}>
          {fmtPct(gld?.changePct)}
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────── */
/* 8. EUROPEAN MARKETS */
/* ─────────────────────────────────────────────────────────────────────── */
function EuropeanMarkets() {
  const openDetail = useOpenDetail();
  const { data, loading, error } = useSectionData({
    cacheKey: 'screen:macro:european',
    fetcher: async () => {
      const res = await apiFetch('/api/snapshot/european');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    refreshMs: 120000,
  });

  if (loading) return <DeepSkeleton rows={6} />;
  if (error) return <DataUnavailable reason={error} />;
  if (!data?.stocks) return <DataUnavailable reason="No European data" />;

  const stocks = Object.entries(data.stocks)
    .filter(([, v]) => v?.price != null)
    .sort((a, b) => Math.abs(b[1].changePct || 0) - Math.abs(a[1].changePct || 0))
    .slice(0, 12);

  return (
    <table className="ds-table">
      <thead>
        <tr><th>Ticker</th><th>Name</th><th>Price</th><th>1D %</th><th style={{ fontSize: 9 }}>CCY</th></tr>
      </thead>
      <tbody>
        {stocks.map(([sym, d]) => (
          <tr key={sym} className="ds-row-clickable" onClick={() => openDetail(sym)}>
            <td className="ds-ticker-col">{sym.replace('.L','').replace('.DE','').replace('.PA','')}</td>
            <td>{(d.name || sym).slice(0, 18)}</td>
            <td>{fmt(d.price)}</td>
            <td className={d.changePct != null && d.changePct >= 0 ? 'ds-up' : 'ds-down'}>
              {fmtPct(d.changePct)}
            </td>
            <td style={{ color: '#666', fontSize: 9 }}>{d.currency || '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ─────────────────────────────────────────────────────────────────────── */
/* 9. GLOBAL EQUITY INDEXES */
/* ─────────────────────────────────────────────────────────────────────── */
function GlobalEquityIndexes() {
  const openDetail = useOpenDetail();
  const indexes = ['SPY', 'QQQ', 'DIA', 'IWM', 'EWZ', 'EEM', 'EFA', 'FXI', 'EWJ', 'EWG'];

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8 }}>
      {indexes.map((symbol) => {
        const q = useTickerPrice(symbol);
        return (
          <div
            key={symbol}
            onClick={() => openDetail(symbol)}
            style={{
              background: '#0a0a1a',
              border: `1px solid ${q?.changePct >= 0 ? '#66bb6a' : '#ef5350'}44`,
              borderRadius: 6,
              padding: '10px 12px',
              cursor: 'pointer',
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: 10, fontWeight: 600, color: '#e0e0e0', marginBottom: 4 }}>{symbol}</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#e0e0e0', marginBottom: 2 }}>{q?.price != null ? fmt(q.price) : '—'}</div>
            <div style={{ fontSize: 9, color: q?.changePct >= 0 ? '#66bb6a' : '#ef5350' }}>
              {fmtPct(q?.changePct)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────── */
/* 10. MACRO CALENDAR */
/* ─────────────────────────────────────────────────────────────────────── */
function MacroCalendar() {
  const openDetail = useOpenDetail();
  const { data, loading, error } = useSectionData({
    cacheKey: 'screen:macro:calendar',
    fetcher: async () => {
      const res = await apiFetch('/api/market/macro-calendar');
      return res.ok ? await res.json() : null;
    },
    refreshMs: 600000,
  });

  if (loading) return <DeepSkeleton rows={5} />;
  if (error) return <DataUnavailable reason={error} />;
  if (!data || !Array.isArray(data)) return <DataUnavailable reason="No calendar data" />;

  const events = data.slice(0, 7);

  const getImpactColor = (impact) => {
    if (!impact) return '#888';
    const lower = impact.toLowerCase();
    if (lower === 'high') return '#d32f2f';
    if (lower === 'medium' || lower === 'med') return '#f57c00';
    return '#388e3c';
  };

  return (
    <table className="ds-table">
      <thead>
        <tr>
          <th style={{ width: '15%' }}>Date</th>
          <th style={{ width: '50%' }}>Event</th>
          <th style={{ width: '15%' }}>Country</th>
          <th style={{ width: '20%' }}>Impact</th>
        </tr>
      </thead>
      <tbody>
        {events.map((ev, idx) => (
          <tr key={idx} className="ds-row-clickable" onClick={() => ev.country && openDetail(ev.country)}>
            <td style={{ fontSize: 10, color: '#999' }}>
              {ev.date ? new Date(ev.date).toLocaleDateString('en-US', { month: 'short', day: '2-digit' }) : '—'}
            </td>
            <td style={{ fontSize: 11 }}>{ev.event || '—'}</td>
            <td style={{ fontSize: 10, color: '#999' }}>{ev.country || '—'}</td>
            <td style={{ color: getImpactColor(ev.impact), fontSize: 10, fontWeight: 500 }}>
              {ev.impact || '—'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ─────────────────────────────────────────────────────────────────────── */
/* MAIN SCREEN — Bloomberg Economics Equivalent */
/* ─────────────────────────────────────────────────────────────────────── */
function GlobalMacroScreenImpl() {
  const sections = [
    {
      id: 'charts',
      title: 'Sector & Asset Charts',
      span: 'full',
      component: () => <SectorChartPanel tickers={['SPY', 'EEM', 'TLT', 'GC=F', 'DXY', 'C:EURUSD']} height={200} cols={3} />,
    },
    {
      id: 'snapshot',
      title: 'Global Macro Snapshot',
      span: 'full',
      component: GlobalSnapshot,
    },
    {
      id: 'volatility',
      title: 'Volatility Dashboard',
      component: VolatilityDashboard,
    },
    {
      id: 'fx',
      title: 'FX Heatmap',
      span: 'full',
      component: FxHeatmap,
    },
    {
      id: 'yields',
      title: 'US Yield Curve',
      component: YieldCurveAnalysis,
    },
    {
      id: 'cb_rates',
      title: 'Central Bank Rates',
      component: CentralBankRates,
    },
    {
      id: 'risk',
      title: 'Risk Appetite Indicators',
      span: 'full',
      component: RiskAppetiteIndicators,
    },
    {
      id: 'european',
      title: 'European Markets',
      span: 'full',
      component: EuropeanMarkets,
    },
    {
      id: 'equity',
      title: 'Global Equity Indexes',
      span: 'full',
      component: GlobalEquityIndexes,
    },
    {
      id: 'calendar',
      title: 'Macro Calendar (Next 7 Days)',
      span: 'full',
      component: MacroCalendar,
    },
  ];

  return (
    <FullPageScreenLayout
      title="GLOBAL MACRO"
      accentColor="#9c27b0"
      subtitle="Central banks, rates, FX, volatility, and cross-asset risk monitor"
      sections={sections}
    />
  );
}

export default memo(GlobalMacroScreenImpl);
