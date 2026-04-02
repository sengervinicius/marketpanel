/**
 * ChartsPanelMobile.jsx
 *
 * Mobile-first charts panel:  ticker selector → single price+volume chart
 * Uses MobileChartContainer for explicit pixel heights (fixes 0-height bug).
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
  const mountedRef = useRef(true);

  const fetchData = useCallback(async (rIdx) => {
    if (!ticker) return;
    const range = RANGES[rIdx];
    if (mountedRef.current) setLoading(true);
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
      if (results.length >= 2) {
        const last = results[results.length - 1].close;
        const first = results[0].close;
        setPrice(last);
        setChg(last - first);
        setChgPct(first ? ((last - first) / first) * 100 : 0);
      }
    } catch (_) {
      if (mountedRef.current) setBars([]);
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

  // Sync live price
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      {/* Stats row */}
      <div style={{
        display: 'flex', alignItems: 'baseline', gap: 10, padding: '6px 10px',
        flexShrink: 0, borderBottom: '1px solid var(--border-default, #1e1e1e)',
      }}>
        <span style={{ color: 'var(--text-primary)', fontSize: 15, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
          {fmtPrice(price)}
        </span>
        {chg != null && (
          <span style={{ color: lineColor, fontSize: 11 }}>
            {isUp ? '+' : ''}{fmtPrice(chg)} ({isUp ? '+' : ''}{chgPct?.toFixed(2)}%)
          </span>
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
              <div style={{ height: priceHeight + volumeHeight, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-faint)', fontSize: 11 }}>
                Loading...
              </div>
            ) : bars.length === 0 ? (
              <div style={{ height: priceHeight + volumeHeight, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-faint)', fontSize: 11 }}>
                No data
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

/* ── Main panel ───────────────────────────────────────────────────────────── */
function ChartsPanelMobile({ onOpenDetail }) {
  const [chartSymbols, setChartSymbols] = useState(['SPY', 'QQQ']);
  const [activeSymbol, setActiveSymbol] = useState('SPY');
  const syncTimerRef = useRef(null);

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

  const currentSymbol = chartSymbols.includes(activeSymbol) ? activeSymbol : chartSymbols[0];

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      background: 'var(--bg-app)', fontFamily: 'inherit',
    }}>
      {/* Symbol selector bar */}
      <div style={{
        display: 'flex', overflowX: 'auto', padding: '6px 8px', gap: 6,
        borderBottom: '1px solid var(--border-default, #1e1e1e)',
        flexShrink: 0, alignItems: 'center', scrollbarWidth: 'none',
      }}>
        {chartSymbols.map(sym => (
          <button
            key={sym}
            onClick={() => setActiveSymbol(sym)}
            style={{
              padding: '7px 12px', fontSize: 11, fontFamily: 'inherit',
              background: currentSymbol === sym ? 'var(--accent, #ff6600)' : 'var(--bg-surface, #111)',
              color: currentSymbol === sym ? '#000' : 'var(--text-muted, #888)',
              border: `1px solid ${currentSymbol === sym ? 'var(--accent, #ff6600)' : 'var(--border-default, #2a2a2a)'}`,
              borderRadius: 3, cursor: 'pointer', whiteSpace: 'nowrap',
              fontWeight: currentSymbol === sym ? 'bold' : 'normal',
              letterSpacing: '0.05em', flexShrink: 0,
            }}
          >
            {sym}
          </button>
        ))}
        {onOpenDetail && currentSymbol && (
          <button
            onClick={() => onOpenDetail(currentSymbol)}
            style={{
              padding: '7px 10px', fontSize: 10, fontFamily: 'inherit',
              background: 'transparent', color: 'var(--text-muted, #555)',
              border: '1px solid var(--border-default, #2a2a2a)', borderRadius: 3,
              cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
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
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-faint)', fontSize: 11 }}>
            No charts configured
          </div>
        )}
    </div>
  );
}

export default memo(ChartsPanelMobile);
