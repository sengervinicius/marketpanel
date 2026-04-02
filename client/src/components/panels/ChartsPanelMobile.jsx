/**
 * ChartsPanelMobile.jsx
 *
 * Mobile-first charts panel:  ticker selector → single price+volume chart
 * Uses MobileChartContainer for explicit pixel heights (fixes 0-height bug).
 *
 * Phase 5 rewrite:
 *   - Ticker pills show symbol + short name
 *   - Active pill has distinct accent styling + auto-scroll-into-view
 *   - No-data state shows clear message instead of blank area
 *   - Stats row shows N/A when data is missing
 *   - Chart heading displays symbol — name above the chart
 */
import { useState, useEffect, useRef, useCallback, memo } from 'react';
import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, ResponsiveContainer, Tooltip, ReferenceLine,
} from 'recharts';
import { apiFetch } from '../../utils/api';
import { useTickerPrice } from '../../context/PriceContext';
import MobileChartContainer from '../common/MobileChartContainer';

const SYNC_INTERVAL = 30_000;

const RANGES = [
  { label: '1D', multiplier: 5,  timespan: 'minute', days: 1   },
  { label: '3D', multiplier: 30, timespan: 'minute', days: 3   },
  { label: '1M', multiplier: 1,  timespan: 'day',    days: 30  },
  { label: '6M', multiplier: 1,  timespan: 'day',    days: 180 },
  { label: 'YTD',multiplier: 1,  timespan: 'day',    days: 0   },
  { label: '1Y', multiplier: 1,  timespan: 'day',    days: 365 },
];

/* ── Ticker metadata: short names for common chart symbols ───────────────── */
const TICKER_NAMES = {
  'SPY': 'S&P 500',
  'QQQ': 'Nasdaq 100',
  'DIA': 'Dow Jones',
  'IWM': 'Russell 2000',
  'AAPL': 'Apple',
  'MSFT': 'Microsoft',
  'GOOGL': 'Alphabet',
  'GOOG': 'Alphabet',
  'AMZN': 'Amazon',
  'NVDA': 'Nvidia',
  'TSLA': 'Tesla',
  'META': 'Meta',
  'GLD': 'Gold ETF',
  'SLV': 'Silver ETF',
  'USO': 'Crude Oil',
  'UNG': 'Nat Gas',
  'CPER': 'Copper ETF',
  'BHP': 'BHP Group',
  'EEM': 'EM Markets',
  'EFA': 'Intl Dev.',
  'EWZ': 'Brazil ETF',
  'FXI': 'China ETF',
  'BOVA11.SA': 'iBovespa',
  'PETR4.SA': 'Petrobras',
  'VALE3.SA': 'Vale',
  'ITUB4.SA': 'Itau',
  'BBDC4.SA': 'Bradesco',
  'ABEV3.SA': 'Ambev',
  'WEGE3.SA': 'WEG',
  'C:EURUSD': 'EUR/USD',
  'C:GBPUSD': 'GBP/USD',
  'C:USDJPY': 'USD/JPY',
  'C:USDBRL': 'USD/BRL',
  'C:GBPBRL': 'GBP/BRL',
  'C:USDCHF': 'USD/CHF',
  'C:USDCNY': 'USD/CNY',
  'C:USDMXN': 'USD/MXN',
  'X:BTCUSD': 'Bitcoin',
  'X:ETHUSD': 'Ethereum',
  'X:SOLUSD': 'Solana',
  'X:BNBUSD': 'BNB',
  'X:XRPUSD': 'XRP',
  'DEFT': 'DeFi Tech',
  'ONCO3.SA': 'Oncoclínicas',
};

/** Display-friendly symbol (strips prefixes for UI) */
function displaySymbol(sym) {
  if (!sym) return '';
  if (sym.startsWith('C:')) return sym.slice(2, 5) + '/' + sym.slice(5);
  if (sym.startsWith('X:')) return sym.slice(2).replace('USD', '');
  if (sym.endsWith('.SA')) return sym.slice(0, -3);
  return sym;
}

function getFromDate(range) {
  const now = new Date();
  if (range.label === 'YTD') return `${now.getFullYear()}-01-01`;
  const from = new Date(now);
  from.setDate(from.getDate() - range.days);
  return from.toISOString().split('T')[0];
}

const fmtPrice = n =>
  n == null ? '--' : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtVol = v => {
  if (v == null) return '--';
  if (v >= 1e9) return (v / 1e9).toFixed(1) + 'B';
  if (v >= 1e6) return (v / 1e6).toFixed(0) + 'M';
  if (v >= 1e3) return (v / 1e3).toFixed(0) + 'K';
  return String(Math.round(v));
};

/* ── Single-chart sub-component ───────────────────────────────────────────── */
const MobileChart = memo(function MobileChart({ ticker }) {
  const shared = useTickerPrice(ticker);
  const [bars, setBars] = useState([]);
  const [loading, setLoading] = useState(true);
  const [rangeIdx, setRangeIdx] = useState(0);
  const [price, setPrice] = useState(null);
  const [chg, setChg] = useState(null);
  const [chgPct, setChgPct] = useState(null);
  const [noData, setNoData] = useState(false);
  const mountedRef = useRef(true);

  const fetchData = useCallback(async (rIdx) => {
    if (!ticker) return;
    const range = RANGES[rIdx];
    if (mountedRef.current) { setLoading(true); setNoData(false); }
    try {
      const toStr = new Date().toISOString().split('T')[0];
      const fromStr = getFromDate(range);
      const url = `/api/chart/${encodeURIComponent(ticker)}?from=${fromStr}&to=${toStr}&multiplier=${range.multiplier}&timespan=${range.timespan}`;
      const res = await apiFetch(url);
      if (!res.ok) throw new Error(res.status);
      const json = await res.json();
      if (!mountedRef.current) return;
      let results = (json.results || []).map(b => ({
        t: b.t,
        close: b.c ?? b.vw ?? 0,
        volume: b.v ?? 0,
        label: range.timespan === 'minute'
          ? new Date(b.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          : new Date(b.t).toLocaleDateString([], { month: 'short', day: 'numeric' }),
      }));
      if (range.label === '1D') {
        const d0 = new Date(); d0.setHours(0, 0, 0, 0);
        const tod = results.filter(b => b.t >= d0.getTime());
        if (tod.length) results = tod;
      }
      setBars(results);
      if (results.length === 0) {
        setNoData(true);
      } else if (results.length >= 2) {
        const last = results[results.length - 1].close;
        const first = results[0].close;
        setPrice(last);
        setChg(last - first);
        setChgPct(first ? ((last - first) / first) * 100 : 0);
        setNoData(false);
      }
    } catch (_) {
      if (mountedRef.current) { setBars([]); setNoData(true); }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [ticker]);

  useEffect(() => {
    mountedRef.current = true;
    fetchData(rangeIdx);
    const iv = setInterval(() => fetchData(rangeIdx), 60_000);
    return () => { mountedRef.current = false; clearInterval(iv); };
  }, [fetchData, rangeIdx]);

  // Sync live price from PriceContext
  useEffect(() => {
    if (shared?.price) setPrice(shared.price);
    if (shared?.change != null) setChg(shared.change);
    if (shared?.changePct != null) setChgPct(shared.changePct);
  }, [shared]);

  const isUp = (chgPct ?? 0) >= 0;
  const lineColor = isUp ? 'var(--price-up, #00c851)' : 'var(--price-down, #f44336)';
  const rawLineColor = isUp ? '#00c851' : '#f44336';
  const openPrice = bars.length > 0 ? bars[0].close : null;
  const gradId = `mcg-${ticker}-${rangeIdx}`;
  const tickerName = TICKER_NAMES[ticker] || '';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      {/* Chart heading: symbol — name */}
      <div style={{
        padding: '8px 10px 2px', flexShrink: 0,
        display: 'flex', alignItems: 'baseline', gap: 6,
      }}>
        <span style={{ color: 'var(--accent, #ff6600)', fontSize: 14, fontWeight: 700, fontFamily: 'inherit', letterSpacing: '0.03em' }}>
          {displaySymbol(ticker)}
        </span>
        {tickerName && (
          <span style={{ color: 'var(--text-muted, #666)', fontSize: 11 }}>
            {tickerName}
          </span>
        )}
      </div>

      {/* Stats row */}
      <div style={{
        display: 'flex', alignItems: 'baseline', gap: 10, padding: '2px 10px 6px',
        flexShrink: 0, borderBottom: '1px solid var(--border-default, #1e1e1e)',
      }}>
        {!noData && !loading ? (
          <>
            <span style={{ color: 'var(--text-primary)', fontSize: 15, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
              {fmtPrice(price)}
            </span>
            {chg != null && (
              <span style={{ color: lineColor, fontSize: 11 }}>
                {isUp ? '+' : ''}{fmtPrice(chg)} ({isUp ? '+' : ''}{chgPct?.toFixed(2)}%)
              </span>
            )}
          </>
        ) : loading ? (
          <span style={{ color: 'var(--text-muted, #555)', fontSize: 11 }}>Loading...</span>
        ) : (
          <span style={{ color: 'var(--text-muted, #555)', fontSize: 11 }}>No price data available</span>
        )}
      </div>

      {/* Range selector */}
      <div style={{ display: 'flex', gap: 4, padding: '5px 10px', flexShrink: 0 }}>
        {RANGES.map((r, i) => (
          <button key={r.label} onClick={() => setRangeIdx(i)} style={{
            flex: 1, padding: '5px 0', fontSize: 10, cursor: 'pointer', fontFamily: 'inherit',
            fontWeight: i === rangeIdx ? 700 : 400, letterSpacing: '0.05em',
            background: i === rangeIdx ? 'rgba(255,102,0,0.1)' : 'transparent',
            border: `1px solid ${i === rangeIdx ? 'var(--accent, #ff6600)' : 'var(--border-default, #1e1e1e)'}`,
            color: i === rangeIdx ? 'var(--accent, #ff6600)' : 'var(--text-muted, #555)',
            borderRadius: 3,
          }}>{r.label}</button>
        ))}
      </div>

      {/* Charts via MobileChartContainer (explicit pixel heights) */}
      <MobileChartContainer>
        {({ width, priceHeight, volumeHeight }) => (
          <>
            {loading ? (
              <div style={{
                height: priceHeight + volumeHeight,
                display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center',
                color: 'var(--text-faint)', fontSize: 12,
              }}>
                <div style={{ marginBottom: 4 }}>Loading chart data...</div>
              </div>
            ) : noData || bars.length === 0 ? (
              <div style={{
                height: priceHeight + volumeHeight,
                display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center',
                color: 'var(--text-muted, #555)',
                gap: 6,
              }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>No chart data available</div>
                <div style={{ fontSize: 11, color: 'var(--text-faint, #444)' }}>
                  Try a different time range or check if this symbol is supported.
                </div>
              </div>
            ) : (
              <>
                <ResponsiveContainer width={width} height={priceHeight}>
                  <AreaChart data={bars} margin={{ top: 6, right: 4, bottom: 0, left: 4 }}>
                    <defs>
                      <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={isUp ? '#1e50c8' : '#c81e1e'} stopOpacity={0.45} />
                        <stop offset="95%" stopColor={isUp ? '#1e50c8' : '#c81e1e'} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis
                      dataKey="label" tick={{ fill: '#444', fontSize: 9 }}
                      tickLine={false} axisLine={{ stroke: '#1e1e1e' }}
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      orientation="right" domain={['auto', 'auto']}
                      tickFormatter={fmtPrice} tick={{ fill: '#444', fontSize: 9 }}
                      tickLine={false} axisLine={false} width={52}
                    />
                    {openPrice && <ReferenceLine y={openPrice} stroke="#e8a020" strokeDasharray="3 3" strokeWidth={1} />}
                    <Area
                      type="monotone" dataKey="close" stroke={rawLineColor} strokeWidth={1.5}
                      fill={`url(#${gradId})`} dot={false} isAnimationActive={false}
                    />
                    <Tooltip
                      contentStyle={{ background: '#0d0d0d', border: '1px solid #2a2a2a', fontSize: 10, padding: '4px 8px', borderRadius: 3 }}
                      itemStyle={{ color: rawLineColor }}
                      formatter={v => [fmtPrice(v), 'Close']}
                      labelFormatter={l => l}
                    />
                  </AreaChart>
                </ResponsiveContainer>
                <ResponsiveContainer width={width} height={volumeHeight}>
                  <BarChart data={bars} margin={{ top: 2, right: 4, bottom: 0, left: 4 }}>
                    <XAxis dataKey="label" hide axisLine={false} />
                    <YAxis
                      tick={{ fill: '#333', fontSize: 8 }} width={52}
                      tickFormatter={fmtVol} axisLine={false}
                    />
                    <Bar dataKey="volume" fill="#1a3352" opacity={0.85} radius={[1, 1, 0, 0]} />
                    <Tooltip
                      contentStyle={{ background: '#0d0d0d', border: '1px solid #2a2a2a', fontSize: 10, borderRadius: 3 }}
                      formatter={v => [fmtVol(v), 'Volume']}
                      labelStyle={{ color: '#555' }}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </>
            )}
          </>
        )}
      </MobileChartContainer>
    </div>
  );
});

/* ── TickerPill: individual pill in the selector strip ────────────────────── */
const TickerPill = memo(function TickerPill({ symbol, isActive, onClick, pillRef }) {
  const name = TICKER_NAMES[symbol] || '';
  const dSym = displaySymbol(symbol);

  return (
    <button
      ref={pillRef}
      onClick={onClick}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
        padding: '6px 12px', minWidth: 70, cursor: 'pointer', fontFamily: 'inherit',
        background: isActive ? 'rgba(255,102,0,0.12)' : 'var(--bg-surface, #111)',
        border: `1.5px solid ${isActive ? 'var(--accent, #ff6600)' : 'var(--border-default, #2a2a2a)'}`,
        borderRadius: 5, whiteSpace: 'nowrap', flexShrink: 0,
        transition: 'border-color 100ms, background 100ms',
      }}
    >
      <span style={{
        fontSize: 11, fontWeight: isActive ? 700 : 500,
        color: isActive ? 'var(--accent, #ff6600)' : 'var(--text-primary, #ccc)',
        letterSpacing: '0.04em', lineHeight: 1.2,
      }}>
        {dSym}
      </span>
      {name && (
        <span style={{
          fontSize: 9, color: isActive ? 'var(--text-secondary, #aaa)' : 'var(--text-muted, #666)',
          lineHeight: 1.2, marginTop: 1,
        }}>
          {name}
        </span>
      )}
    </button>
  );
});

/* ── Main panel ───────────────────────────────────────────────────────────── */
function ChartsPanelMobile({ onOpenDetail }) {
  const [chartSymbols, setChartSymbols] = useState(['SPY', 'QQQ']);
  const [activeSymbol, setActiveSymbol] = useState('SPY');
  const syncTimerRef = useRef(null);
  const pillRefs = useRef({});
  const stripRef = useRef(null);

  useEffect(() => {
    const fetchGrid = async () => {
      try {
        const res = await apiFetch('/api/settings');
        if (res.ok) {
          const data = await res.json();
          const grid = data.settings?.chartGrid;
          if (Array.isArray(grid) && grid.length > 0) {
            setChartSymbols(grid);
            setActiveSymbol(prev => grid.includes(prev) ? prev : grid[0]);
          }
        }
      } catch (_) {}
    };
    fetchGrid();
    syncTimerRef.current = setInterval(fetchGrid, SYNC_INTERVAL);
    return () => clearInterval(syncTimerRef.current);
  }, []);

  // Auto-scroll active pill into view
  useEffect(() => {
    const el = pillRefs.current[activeSymbol];
    if (el && stripRef.current) {
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
  }, [activeSymbol]);

  const currentSymbol = chartSymbols.includes(activeSymbol) ? activeSymbol : chartSymbols[0];

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      background: 'var(--bg-app)', fontFamily: 'inherit',
    }}>
      {/* Symbol selector bar */}
      <div
        ref={stripRef}
        style={{
          display: 'flex', overflowX: 'auto', padding: '6px 8px', gap: 6,
          borderBottom: '1px solid var(--border-default, #1e1e1e)',
          flexShrink: 0, alignItems: 'stretch', scrollbarWidth: 'none',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        {chartSymbols.map(sym => (
          <TickerPill
            key={sym}
            symbol={sym}
            isActive={currentSymbol === sym}
            onClick={() => setActiveSymbol(sym)}
            pillRef={el => { pillRefs.current[sym] = el; }}
          />
        ))}
        {onOpenDetail && currentSymbol && (
          <button
            onClick={() => onOpenDetail(currentSymbol)}
            style={{
              padding: '6px 10px', fontSize: 10, fontFamily: 'inherit',
              background: 'transparent', color: 'var(--accent, #ff6600)',
              border: '1.5px solid var(--accent, #ff6600)', borderRadius: 5,
              cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
              fontWeight: 600, letterSpacing: '0.06em',
            }}
          >
            DETAIL
          </button>
        )}
      </div>

      {/* Chart for selected symbol */}
      {currentSymbol
        ? <MobileChart key={currentSymbol} ticker={currentSymbol} />
        : (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-faint)', fontSize: 12 }}>
            No charts configured
          </div>
        )}
    </div>
  );
}

export default memo(ChartsPanelMobile);
