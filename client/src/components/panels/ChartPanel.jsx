// ChartPanel.jsx — multi-chart grid (up to 16 slots)
// Drop any ticker from panels to ADD a chart; X button to remove; persists to localStorage
import { useState, useEffect, useRef, useCallback } from 'react';
import { LineChart, Line, ResponsiveContainer, Tooltip, ReferenceLine } from 'recharts';

const API = import.meta.env.VITE_API_URL || '';
const LS_KEY = 'chartGrid_v2';
const MAX = 16;

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

// Individual mini-chart tile
function MiniChart({ ticker, onRemove }) {
  const [data, setData] = useState([]);
  const [price, setPrice] = useState(null);
  const [pct, setPct] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isDragOver, setIsDragOver] = useState(false);
  const mountedRef = useRef(true);

  const fetchData = useCallback(async () => {
    if (!ticker) return;
    try {
      const now = new Date();
      const from = new Date(now); from.setMonth(from.getMonth() - 1);
      const fromStr = from.toISOString().split('T')[0];
      const toStr   = now.toISOString().split('T')[0];
      const res = await fetch(`${API}/api/chart/${encodeURIComponent(ticker)}?from=${fromStr}&to=${toStr}&multiplier=1&timespan=day`);
      if (!res.ok) throw new Error(res.status);
      const json = await res.json();
      if (!mountedRef.current) return;
      const bars = (json.results || []).map(b => ({ t: b.t, v: b.c ?? b.vw ?? 0 }));
      setData(bars);
      if (bars.length >= 2) {
        const last  = bars[bars.length - 1].v;
        const first = bars[0].v;
        setPrice(last);
        setPct(first ? ((last - first) / first) * 100 : 0);
      }
    } catch (_) {}
    finally { if (mountedRef.current) setLoading(false); }
  }, [ticker]);

  useEffect(() => {
    mountedRef.current = true;
    fetchData();
    const id = setInterval(fetchData, 60_000);
    return () => { mountedRef.current = false; clearInterval(id); };
  }, [fetchData]);

  const up = (pct ?? 0) >= 0;
  const lineColor = up ? '#00c853' : '#f44336';
  const min = data.length ? Math.min(...data.map(d => d.v)) : 0;
  const max = data.length ? Math.max(...data.map(d => d.v)) : 1;

  return (
    <div
      style={{
        background: isDragOver ? '#1a1a00' : '#0d0d0d',
        border: `1px solid ${isDragOver ? '#ff6600' : '#1e1e1e'}`,
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden', position: 'relative', minHeight: 0,
      }}
      onDragOver={e => { e.preventDefault(); setIsDragOver(true); }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={e => {
        e.preventDefault(); setIsDragOver(false);
        // Drop on existing chart replaces it
        try {
          const raw = e.dataTransfer.getData('application/x-ticker');
          if (raw) {
            const { symbol } = JSON.parse(raw);
            onRemove(ticker, normalizeTicker(symbol));
          }
        } catch (_) {}
      }}
    >
      {/* Header row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '2px 4px', flexShrink: 0 }}>
        <span style={{ color: '#e8a020', fontWeight: 700, fontSize: 8, letterSpacing: '0.1em' }}>{displayTicker(ticker)}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {price != null && <span style={{ color: '#aaa', fontSize: 7, fontVariantNumeric: 'tabular-nums' }}>{fmtPrice(price)}</span>}
          {pct != null && <span style={{ color: lineColor, fontSize: 7, fontWeight: 600 }}>{(up ? '+' : '') + pct.toFixed(2)}%</span>}
          <button
            onClick={() => onRemove(ticker, null)}
            style={{ background: 'none', border: 'none', color: '#333', cursor: 'pointer', fontSize: 9, padding: '0 2px', lineHeight: 1 }}
            title="Remove"
          >✕</button>
        </div>
      </div>

      {/* Chart */}
      <div style={{ flex: 1, minHeight: 0 }}>
        {loading ? (
          <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#333', fontSize: 7 }}>…</div>
        ) : data.length === 0 ? (
          <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#333', fontSize: 7 }}>NO DATA</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
              <Line type="monotone" dataKey="v" stroke={lineColor} dot={false} strokeWidth={1} isAnimationActive={false} />
              <ReferenceLine y={data[0]?.v} stroke="#333" strokeDasharray="2 2" strokeWidth={1} />
              <Tooltip
                contentStyle={{ background: '#111', border: '1px solid #333', fontSize: 7, padding: '2px 4px' }}
                itemStyle={{ color: lineColor }}
                formatter={v => [fmtPrice(v), '']}
                labelFormatter={() => ''}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

// Empty drop slot
function EmptySlot({ onDrop }) {
  const [isDragOver, setIsDragOver] = useState(false);
  return (
    <div
      style={{
        border: `1px dashed ${isDragOver ? '#ff6600' : '#1a1a1a'}`,
        background: isDragOver ? '#1a0d00' : 'transparent',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: isDragOver ? '#ff6600' : '#222', fontSize: 8,
        minHeight: 0, cursor: 'copy',
      }}
      onDragOver={e => { e.preventDefault(); setIsDragOver(true); }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={e => {
        e.preventDefault(); setIsDragOver(false);
        try {
          const raw = e.dataTransfer.getData('application/x-ticker');
          if (raw) { const { symbol } = JSON.parse(raw); onDrop(symbol); }
        } catch (_) {}
      }}
    >
      {isDragOver ? 'ADD CHART' : '+'}
    </div>
  );
}

export function ChartPanel({ ticker: externalTicker, onTickerChange }) {
  // Load saved tickers from localStorage, fallback to [SPY]
  const [tickers, setTickers] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(LS_KEY));
      if (Array.isArray(saved) && saved.length) return saved.slice(0, MAX);
    } catch (_) {}
    return ['SPY'];
  });

  // Sync external ticker in (from main chart search)
  useEffect(() => {
    if (!externalTicker) return;
    const norm = normalizeTicker(externalTicker);
    setTickers(prev => {
      if (prev.includes(norm)) return prev;
      const next = prev.length < MAX ? [...prev, norm] : [...prev.slice(0, MAX - 1), norm];
      return next;
    });
  }, [externalTicker]);

  // Persist to localStorage whenever tickers change
  useEffect(() => {
    localStorage.setItem(LS_KEY, JSON.stringify(tickers));
  }, [tickers]);

  const addTicker = useCallback((raw) => {
    const norm = normalizeTicker(raw);
    setTickers(prev => {
      if (prev.includes(norm)) return prev;
      if (prev.length >= MAX) return prev; // full, ignore
      return [...prev, norm];
    });
  }, []);

  // onRemove: if replacement is given, swap; else remove
  const handleRemove = useCallback((ticker, replacement) => {
    setTickers(prev => {
      if (replacement) return prev.map(t => t === ticker ? replacement : t);
      return prev.filter(t => t !== ticker);
    });
  }, []);

  // Build grid: fill remaining slots up to next square (or just show filled + N empty slots)
  const cols = tickers.length <= 1 ? 1 : tickers.length <= 4 ? 2 : tickers.length <= 9 ? 3 : 4;
  const rows = Math.ceil(tickers.length / cols);
  const totalSlots = cols * rows;
  const emptySlots = Math.min(MAX - tickers.length, totalSlots - tickers.length);

  const [isDragOverPanel, setIsDragOverPanel] = useState(false);

  return (
    <div
      style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#0a0a0a', overflow: 'hidden' }}
      onDragOver={e => { e.preventDefault(); setIsDragOverPanel(true); }}
      onDragLeave={() => setIsDragOverPanel(false)}
      onDrop={e => {
        e.preventDefault(); setIsDragOverPanel(false);
        try {
          const raw = e.dataTransfer.getData('application/x-ticker');
          if (raw) { const { symbol } = JSON.parse(raw); addTicker(symbol); }
        } catch (_) {}
      }}
    >
      {/* Panel header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '3px 8px', borderBottom: '1px solid #1e1e1e', flexShrink: 0 }}>
        <span style={{ color: '#e8a020', fontWeight: 700, fontSize: 9, letterSpacing: '0.2em' }}>CHARTS</span>
        <span style={{ color: '#333', fontSize: 7 }}>{tickers.length}/{MAX} — drop to add</span>
      </div>

      {/* Grid */}
      <div style={{
        flex: 1,
        display: 'grid',
        gridTemplateColumns: `repeat(${cols}, 1fr)`,
        gridTemplateRows: `repeat(${rows + (emptySlots > 0 ? 1 : 0)}, 1fr)`,
        gap: 1,
        overflow: 'hidden',
        padding: 1,
      }}>
        {tickers.map(t => (
          <MiniChart key={t} ticker={t} onRemove={handleRemove} />
        ))}
        {emptySlots > 0 && (
          <EmptySlot onDrop={addTicker} />
        )}
      </div>
    </div>
  );
}
