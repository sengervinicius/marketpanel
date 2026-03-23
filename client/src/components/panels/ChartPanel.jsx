// ChartPanel.jsx — Bloomberg-style multi-chart grid (up to 16 slots)
// Area chart with gradient fill, Y-axis right, date range buttons, stats row
// Bulletproof drag: stopPropagation prevents double-add on event bubble
import { useState, useEffect, useRef, useCallback } from 'react';
import { AreaChart, Area, XAxis, YAxis, ResponsiveContainer, Tooltip, ReferenceLine } from 'recharts';

const API    = import.meta.env.VITE_API_URL || '';
const LS_KEY = 'chartGrid_v3';
const MAX    = 16;

// Time range configs
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

function normalizeTicker(raw) {
  if (!raw) return 'SPY';
  const t = raw.trim().toUpperCase();
  if (t.endsWith('=X')) return 'C:' + t.slice(0, -2);
  if (t.endsWith('-USD') && !t.startsWith('C:')) return 'X:' + t.replace('-USD', 'USD');
  return t;
}

function displayTicker(norm) {
  if (norm.startsWith('C:')) return norm.slice(2, 5) + '/' + norm.slice(5);
  if (norm.startsWith('X:')) return norm.slice(2, 5) + '/' + norm.slice(5);
  return norm;
}

const fmtPrice = (n) => n == null ? '—' : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtK = (n) => {
  if (n == null) return '—';
  const abs = Math.abs(n);
  if (abs >= 10000) return (n / 1000).toFixed(1) + 'k';
  if (abs >= 1000)  return (n / 1000).toFixed(2) + 'k';
  return n.toFixed(2);
};

// Bloomberg-style mini chart tile
function MiniChart({ ticker, onRemove, onReplace }) {
  const [data, setData]         = useState([]);
  const [price, setPrice]       = useState(null);
  const [chg, setChg]           = useState(null);
  const [chgPct, setChgPct]     = useState(null);
  const [high, setHigh]         = useState(null);
  const [low, setLow]           = useState(null);
  const [loading, setLoading]   = useState(true);
  const [isDragOver, setIsDragOver] = useState(false);
  const [rangeIdx, setRangeIdx] = useState(2); // default 1M
  const mountedRef  = useRef(true);
  const intervalRef = useRef(null);

  const fetchData = useCallback(async (rIdx) => {
    if (!ticker) return;
    const range = RANGES[rIdx];
    if (mountedRef.current) setLoading(true);
    try {
      const toStr   = new Date().toISOString().split('T')[0];
      const fromStr = getFromDate(range);
      const url = `${API}/api/chart/${encodeURIComponent(ticker)}?from=${fromStr}&to=${toStr}&multiplier=${range.multiplier}&timespan=${range.timespan}`;
      const res  = await fetch(url);
      if (!res.ok) throw new Error(res.status);
      const json = await res.json();
      if (!mountedRef.current) return;
      const bars = (json.results || []).map(b => ({ t: b.t, v: b.c ?? b.vw ?? 0 }));
      setData(bars);
      if (bars.length >= 2) {
        const last  = bars[bars.length - 1].v;
        const first = bars[0].v;
        const hi    = Math.max(...bars.map(b => b.v));
        const lo    = Math.min(...bars.map(b => b.v));
        setPrice(last);
        setChg(last - first);
        setChgPct(first ? ((last - first) / first) * 100 : 0);
        setHigh(hi);
        setLow(lo);
      }
    } catch (_) {
      if (mountedRef.current) setData([]);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [ticker]);

  useEffect(() => {
    mountedRef.current = true;
    fetchData(rangeIdx);
    intervalRef.current = setInterval(() => fetchData(rangeIdx), 60_000);
    return () => { mountedRef.current = false; clearInterval(intervalRef.current); };
  }, [fetchData, rangeIdx]);

  const handleRangeChange = (idx) => {
    clearInterval(intervalRef.current);
    setRangeIdx(idx);
  };

  const isUp      = (chg ?? 0) >= 0;
  const lineColor = isUp ? '#e8e8e8' : '#ff5555';
  const gradId    = 'g' + ticker.replace(/[^a-zA-Z0-9]/g, '');
  const openPrice = data[0]?.v;

  const xFmt = (ms) => {
    const d = new Date(ms);
    if (RANGES[rangeIdx].timespan === 'minute') {
      return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
    }
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  return (
    <div
      style={{
        background: isDragOver ? '#0d1a2e' : '#07090f',
        border: `1px solid ${isDragOver ? '#ff6600' : '#141420'}`,
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden', position: 'relative', minHeight: 0,
        transition: 'border-color 0.15s',
      }}
      onDragOver={e => { e.preventDefault(); setIsDragOver(true); }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={e => {
        e.preventDefault();
        e.stopPropagation(); // CRITICAL: prevents bubble to parent addTicker
        setIsDragOver(false);
        try {
          const raw = e.dataTransfer.getData('application/x-ticker');
          if (raw) { const { symbol } = JSON.parse(raw); onReplace(ticker, normalizeTicker(symbol)); }
        } catch (_) {}
      }}
    >
      {/* Header: ticker + price + change + X */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '3px 5px', flexShrink: 0 }}>
        <span style={{ color: '#e8a020', fontWeight: 700, fontSize: 9, letterSpacing: '0.1em' }}>
          {isDragOver ? 'DROP TO REPLACE' : displayTicker(ticker)}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          {price  != null && <span style={{ color: '#cccccc', fontSize: 8, fontVariantNumeric: 'tabular-nums' }}>{fmtPrice(price)}</span>}
          {chgPct != null && (
            <span style={{ color: isUp ? '#4caf50' : '#f44336', fontSize: 8, fontWeight: 700 }}>
              {(isUp ? '+' : '') + chgPct.toFixed(2) + '%'}
            </span>
          )}
          <button onClick={() => onRemove(ticker)} style={{ background: 'none', border: 'none', color: '#333', cursor: 'pointer', fontSize: 10, padding: '0 2px', lineHeight: 1, fontFamily: 'inherit' }} title="Remove chart">✕</button>
        </div>
      </div>

      {/* Bloomberg stats row */}
      <div style={{ display: 'flex', gap: 6, padding: '1px 5px', flexShrink: 0, borderTop: '1px solid #0d0d18', borderBottom: '1px solid #0d0d18' }}>
        <span style={{ color: '#3a3a5a', fontSize: 6.5 }}>
          □ Chg{' '}
          <span style={{ color: chg != null ? (isUp ? '#4caf50' : '#f44336') : '#3a3a5a' }}>
            {chg != null ? (isUp ? '+' : '') + fmtK(chg) + ' (' + (isUp ? '+' : '') + (chgPct?.toFixed(2) ?? '—') + '%)' : '—'}
          </span>
        </span>
        <span style={{ color: '#3a3a5a', fontSize: 6.5 }}>□ High <span style={{ color: '#888' }}>{fmtK(high)}</span></span>
        <span style={{ color: '#3a3a5a', fontSize: 6.5 }}>□ Low <span style={{ color: '#888' }}>{fmtK(low)}</span></span>
      </div>

      {/* Chart area */}
      <div style={{ flex: 1, minHeight: 0 }}>
        {loading ? (
          <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#222233', fontSize: 8 }}>loading…</div>
        ) : data.length === 0 ? (
          <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#222233', fontSize: 8 }}>NO DATA</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 4, right: 2, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={isUp ? '#1e50c8' : '#c81e1e'} stopOpacity={0.55} />
                  <stop offset="95%" stopColor={isUp ? '#1e50c8' : '#c81e1e'} stopOpacity={0.0}  />
                </linearGradient>
              </defs>
              <XAxis dataKey="t" tickFormatter={xFmt} tick={{ fill: '#2a2a45', fontSize: 6 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
              <YAxis orientation="right" domain={['auto','auto']} tickFormatter={fmtK} tick={{ fill: '#2a2a45', fontSize: 6 }} tickLine={false} axisLine={false} width={30} />
              {openPrice && <ReferenceLine y={openPrice} stroke="#e8a020" strokeDasharray="3 3" strokeWidth={1} />}
              <Area type="monotone" dataKey="v" stroke={lineColor} strokeWidth={1.5} fill={`url(#${gradId})`} dot={false} isAnimationActive={false} />
              <Tooltip
                contentStyle={{ background: '#0a0c18', border: '1px solid #2a2a4a', fontSize: 7, padding: '3px 6px', borderRadius: 2 }}
                itemStyle={{ color: lineColor }}
                formatter={v => [fmtPrice(v), ticker]}
                labelFormatter={ms => xFmt(ms)}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Date range buttons */}
      <div style={{ display: 'flex', borderTop: '1px solid #0d0d18', flexShrink: 0 }}>
        {RANGES.map((r, i) => (
          <button key={r.label} onClick={() => handleRangeChange(i)} style={{
            flex: 1, padding: '2px 0', background: 'transparent', border: 'none',
            borderBottom: i === rangeIdx ? '2px solid #e8a020' : '2px solid transparent',
            color: i === rangeIdx ? '#e8a020' : '#333',
            fontSize: 7, cursor: 'pointer', fontFamily: 'inherit',
            fontWeight: i === rangeIdx ? 700 : 400, letterSpacing: '0.05em',
            transition: 'color 0.1s, border-color 0.1s',
          }}>
            {r.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// Empty slot — prominent drop target
function EmptySlot({ onAdd }) {
  const [isDragOver, setIsDragOver] = useState(false);
  return (
    <div
      style={{
        border: `1px dashed ${isDragOver ? '#ff6600' : '#1a1a28'}`,
        background: isDragOver ? '#1a0d00' : '#040508',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: isDragOver ? '#ff6600' : '#1a1a28',
        fontSize: 20, minHeight: 0, cursor: 'copy',
        flexDirection: 'column', gap: 3,
        transition: 'all 0.15s',
      }}
      onDragOver={e => { e.preventDefault(); setIsDragOver(true); }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={e => {
        e.preventDefault();
        e.stopPropagation(); // CRITICAL: prevents double-add
        setIsDragOver(false);
        try {
          const raw = e.dataTransfer.getData('application/x-ticker');
          if (raw) { const { symbol } = JSON.parse(raw); onAdd(symbol); }
        } catch (_) {}
      }}
    >
      <span style={{ fontSize: 16, lineHeight: 1 }}>{isDragOver ? '▼' : '+'}</span>
      {isDragOver && <span style={{ fontSize: 7, letterSpacing: '0.1em', fontFamily: 'inherit' }}>DROP TO ADD</span>}
    </div>
  );
}

export function ChartPanel({ ticker: externalTicker, onGridChange }) {
  const [tickers, setTickers] = useState(() => {
    try {
      const v3 = JSON.parse(localStorage.getItem(LS_KEY));
      if (Array.isArray(v3) && v3.length) return v3.slice(0, MAX);
      const v2 = JSON.parse(localStorage.getItem('chartGrid_v2'));
      if (Array.isArray(v2) && v2.length) return v2.slice(0, MAX);
    } catch (_) {}
    return ['SPY', 'QQQ'];
  });

  // When another panel ticker is clicked, add it to the grid
  useEffect(() => {
    if (!externalTicker) return;
    const norm = normalizeTicker(externalTicker);
    setTickers(prev => {
      if (prev.includes(norm) || prev.length >= MAX) return prev;
      return [...prev, norm];
    });
  }, [externalTicker]);

  useEffect(() => {
    localStorage.setItem(LS_KEY, JSON.stringify(tickers));
    onGridChange?.(tickers.length); // notify parent (mobile height adjustment)
  }, [tickers, onGridChange]);

  const addTicker = useCallback((raw) => {
    const norm = normalizeTicker(raw);
    setTickers(prev => {
      if (prev.includes(norm) || prev.length >= MAX) return prev;
      return [...prev, norm];
    });
  }, []);

  const removeTicker  = useCallback((ticker) => { setTickers(prev => prev.filter(t => t !== ticker)); }, []);
  const replaceTicker = useCallback((oldTicker, newTicker) => { setTickers(prev => prev.map(t => t === oldTicker ? newTicker : t)); }, []);

  // Adaptive grid columns
  const cols      = tickers.length <= 1 ? 1 : tickers.length <= 4 ? 2 : tickers.length <= 9 ? 3 : 4;
  const rows      = Math.ceil(tickers.length / cols);
  const totalSlots = cols * rows;
  const emptySlots = Math.min(MAX - tickers.length, totalSlots - tickers.length);

  return (
    <div
      style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#040508', overflow: 'hidden' }}
      onDragOver={e => e.preventDefault()}
      onDrop={e => {
        e.preventDefault();
        try {
          const raw = e.dataTransfer.getData('application/x-ticker');
          if (raw) { const { symbol } = JSON.parse(raw); addTicker(symbol); }
        } catch (_) {}
      }}
    >
      {/* Panel header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '3px 8px', borderBottom: '1px solid #141420', flexShrink: 0 }}>
        <span style={{ color: '#e8a020', fontWeight: 700, fontSize: 9, letterSpacing: '0.2em' }}>CHARTS</span>
        <span style={{ color: '#222233', fontSize: 7 }}>{tickers.length}/{MAX} — drag any ticker here to add</span>
      </div>

      {/* Grid of charts + empty slots */}
      <div style={{
        flex: 1, display: 'grid',
        gridTemplateColumns: `repeat(${cols}, 1fr)`,
        gridTemplateRows: `repeat(${rows + (emptySlots > 0 ? 1 : 0)}, 1fr)`,
        gap: 1, overflow: 'hidden', padding: 1,
      }}>
        {tickers.map(t => (
          <MiniChart key={t} ticker={t} onRemove={removeTicker} onReplace={replaceTicker} />
        ))}
        {emptySlots > 0 && <EmptySlot onAdd={addTicker} />}
      </div>
    </div>
  );
}
