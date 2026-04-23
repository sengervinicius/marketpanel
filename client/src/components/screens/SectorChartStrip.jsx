/**
 * SectorChartStrip.jsx — S6
 * Reusable mini-chart strip for deep/sector screens.
 * Each deep screen passes its own curated set of tickers to display as sparklines.
 * Shows a horizontal scrollable grid of compact area charts with live price overlays.
 */
import { useState, useEffect, useRef, useCallback, memo, useMemo } from 'react';
import { useTickerPrice } from '../../context/PriceContext';
import { useOpenDetail } from '../../context/OpenDetailContext';
import { AreaChart, Area, ResponsiveContainer, YAxis, ReferenceLine } from 'recharts';
import { apiFetch } from '../../utils/api';
import { sanitizeTicker } from '../../utils/ticker';
import { tapStart, tapMove, tapEnd } from '../../utils/tapHandlers';
import './SectorChartStrip.css';

const RANGES = [
  { label: '1D', multiplier: 5,  timespan: 'minute', days: 1   },
  { label: '1W', multiplier: 30, timespan: 'minute', days: 7   },
  { label: '1M', multiplier: 1,  timespan: 'day',    days: 30  },
  { label: '3M', multiplier: 1,  timespan: 'day',    days: 90  },
  { label: '6M', multiplier: 1,  timespan: 'day',    days: 180 },
  { label: '1Y', multiplier: 1,  timespan: 'day',    days: 365 },
];

const NAME_OVERRIDES = {
  SPY:'S&P 500', QQQ:'Nasdaq 100', DIA:'Dow Jones', IWM:'Russell 2000',
  EWZ:'Brazil ETF', GLD:'Gold', SLV:'Silver', USO:'Crude Oil',
  AAPL:'Apple', MSFT:'Microsoft', GOOGL:'Alphabet', META:'Meta', AMZN:'Amazon',
  TSLA:'Tesla', NVDA:'NVIDIA', AMD:'AMD', AVGO:'Broadcom', TSM:'TSMC',
  XOM:'Exxon', CVX:'Chevron', SHEL:'Shell', COP:'Conoco', SLB:'Schlumberger',
  LMT:'Lockheed', NOC:'Northrop', RTX:'Raytheon', BA:'Boeing', GD:'Gen Dynamics',
  BTC:'Bitcoin', ETH:'Ethereum', SOL:'Solana',
  'CL=F':'WTI Crude', 'BZ=F':'Brent', 'GC=F':'Gold', 'SI=F':'Silver',
  'NG=F':'Nat Gas', 'HG=F':'Copper', 'ZW=F':'Wheat', 'ZC=F':'Corn',
  'C:EURUSD':'EUR/USD', 'C:USDJPY':'USD/JPY', 'C:GBPUSD':'GBP/USD',
  'C:USDBRL':'USD/BRL', 'C:USDCNY':'USD/CNY', 'C:USDINR':'USD/INR',
  'X:BTCUSD':'Bitcoin', 'X:ETHUSD':'Ethereum', 'X:SOLUSD':'Solana',
  'PETR4.SA':'Petrobras', 'VALE3.SA':'Vale', 'ITUB4.SA':'Itaú',
  'BBDC4.SA':'Bradesco', 'WEGE3.SA':'WEG', 'EMBR3.SA':'Embraer',
  TLT:'20Y Treasury', IEF:'7-10Y Treasury', AGG:'US Agg Bond',
  HYG:'High Yield', LQD:'IG Corporate', EMB:'EM Bonds',
  VIX:'VIX', MSTR:'MicroStrategy', COIN:'Coinbase',
  NEE:'NextEra', ENPH:'Enphase', FSLR:'First Solar',
  PLTR:'Palantir', RKLB:'Rocket Lab', KTOS:'Kratos',
  MELI:'MercadoLibre', NU:'Nu Holdings', VALE:'Vale ADR',
  NEM:'Newmont', FCX:'Freeport', BHP:'BHP',
  XLE:'Energy ETF', XLK:'Tech ETF', SOXX:'Semis ETF',
  ITA:'Aero&Def ETF', ICLN:'Clean ETF', URA:'Uranium ETF',
};

function getFromDate(range) {
  const now = new Date();
  const from = new Date(now);
  from.setDate(from.getDate() - range.days);
  return from.toISOString().split('T')[0];
}

// ── Single Sparkline Chart ────────────────────────────────────────────────────
const SparkChart = memo(function SparkChart({ ticker, label, rangeIdx, sectorName }) {
  const openDetail = useOpenDetail();
  const shared = useTickerPrice(ticker);
  const [bars, setBars] = useState([]);
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);

  const fetchData = useCallback(async () => {
    if (!ticker) return;
    const range = RANGES[rangeIdx];
    if (mountedRef.current && bars.length === 0) setLoading(true);
    try {
      const toStr = new Date().toISOString().split('T')[0];
      const fromStr = getFromDate(range);
      const url = `/api/chart/${encodeURIComponent(ticker)}?from=${fromStr}&to=${toStr}&multiplier=${range.multiplier}&timespan=${range.timespan}`;
      const res = await apiFetch(url);
      if (!res.ok) throw new Error(res.status);
      const json = await res.json();
      if (!mountedRef.current) return;
      let data = (json.results || []).map(b => ({
        t: b.t,
        v: b.c ?? b.vw ?? 0,
      }));
      // For 1D, show only today
      if (range.label === '1D') {
        const d0 = new Date(); d0.setHours(0, 0, 0, 0);
        const today = data.filter(b => b.t >= d0.getTime());
        if (today.length > 0) data = today;
      }
      setBars(data);
    } catch {
      if (mountedRef.current) setBars([]);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [ticker, rangeIdx]);

  useEffect(() => {
    mountedRef.current = true;
    fetchData();
    return () => { mountedRef.current = false; };
  }, [fetchData]);

  const price = shared?.price;
  const changePct = shared?.changePct;
  const isUp = changePct != null ? changePct >= 0 : (bars.length >= 2 ? bars[bars.length - 1].v >= bars[0].v : true);
  // Must use hex, not CSS vars — SVG stopColor can't resolve CSS custom properties
  const color = isUp ? 'var(--semantic-up)' : 'var(--semantic-down)';

  const displayTicker = sanitizeTicker(ticker || '')
    .replace('.SA', '').replace('=F', '');
  const displayName = label || NAME_OVERRIDES[ticker] || displayTicker;

  // Calculate period change from chart data
  const periodChg = useMemo(() => {
    if (bars.length < 2) return null;
    const first = bars[0].v;
    const last = bars[bars.length - 1].v;
    return first ? ((last - first) / first) * 100 : 0;
  }, [bars]);

  const firstVal = bars.length > 0 ? bars[0].v : null;

  return (
    <div
      className="scs-chart"
      onClick={() => openDetail(ticker, sectorName || null)}
      onTouchStart={tapStart}
      onTouchMove={tapMove}
      onTouchEnd={(e) => tapEnd(e, () => openDetail(ticker, sectorName || null))}
    >
      {/* Header */}
      <div className="scs-chart-head">
        <span className="scs-chart-ticker">{displayTicker}</span>
        <span className="scs-chart-name">{displayName}</span>
      </div>

      {/* Sparkline */}
      <div className="scs-chart-area">
        {loading ? (
          <div className="scs-chart-loading" />
        ) : bars.length < 2 ? (
          <div className="scs-chart-loading" />
        ) : (
          <ResponsiveContainer width="100%" height={120}>
            <AreaChart data={bars} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id={`grad-${ticker}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={color} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={color} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <YAxis domain={['dataMin', 'dataMax']} hide />
              {firstVal != null && (
                <ReferenceLine y={firstVal} stroke="rgba(255,255,255,0.08)" strokeDasharray="2 2" />
              )}
              <Area
                type="monotone"
                dataKey="v"
                stroke={color}
                strokeWidth={1.5}
                fill={`url(#grad-${ticker})`}
                dot={false}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Footer — price & change */}
      <div className="scs-chart-foot">
        <span className="scs-chart-price">
          {price != null ? price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}
        </span>
        <span className={`scs-chart-chg ${isUp ? 'up' : 'down'}`}>
          {periodChg != null ? `${periodChg >= 0 ? '+' : ''}${periodChg.toFixed(2)}%` : (changePct != null ? `${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}%` : '—')}
        </span>
      </div>
    </div>
  );
});

// ── Main Strip ────────────────────────────────────────────────────────────────
function SectorChartStrip({ tickers, labels, title, defaultRange, sectorName }) {
  const [rangeIdx, setRangeIdx] = useState(defaultRange ?? 2); // default 1M

  if (!tickers || tickers.length === 0) return null;

  return (
    <div className="scs-strip">
      <div className="scs-strip-head">
        <span className="scs-strip-title">{title || 'SECTOR CHARTS'}</span>
        <div className="scs-range-bar">
          {RANGES.map((r, i) => (
            <button
              key={r.label}
              className={`scs-range-btn ${i === rangeIdx ? 'scs-range-btn--active' : ''}`}
              onClick={() => setRangeIdx(i)}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>
      <div className="scs-charts-row">
        {tickers.map((t, i) => (
          <SparkChart
            key={typeof t === 'string' ? t : t.symbol}
            ticker={typeof t === 'string' ? t : t.symbol}
            label={labels?.[i] || (typeof t === 'object' ? t.label : null)}
            rangeIdx={rangeIdx}
            sectorName={sectorName}
          />
        ))}
      </div>
    </div>
  );
}

export default memo(SectorChartStrip);
