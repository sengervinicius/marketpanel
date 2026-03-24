// ChartPanel.jsx â Bloomberg-style multi-chart grid (fixed 4Ã4 = 16 slots)
// Desktop: always-full 4Ã4 symmetric grid â no empty rows ever
// Mobile: 2-col scrollable layout sharing same localStorage as desktop
// Fix: onDragLeave uses relatedTarget.contains check to prevent flicker/stuck state
// Drag-to-swap: internal slots draggable; drop onto another slot swaps positions
// URL sync: ?c=SPY,QQQ,... persisted via history.replaceState for cross-device sharing
// Auto-sync: grid synced to server on change, fetched on mount for mobile cross-device
import { useState, useEffect, useRef, useCallback } from 'react';
import { AreaChart, Area, XAxis, YAxis, ResponsiveContainer, Tooltip, ReferenceLine } from 'recharts';

const API = import.meta.env.VITE_API_URL || '';
const LS_KEY = 'chartGrid_v3';
const MAX = 16;
const GRID_COLS = 4;
const GRID_ROWS = 4;

const TICKER_NAMES = {
  'BOVA11.SA':'Ibovespa ETF','PETR3.SA':'Petrobras','VALE3.SA':'Vale',
  'ITUB4.SA':'Itaú','BBDC4.SA':'Bradesco','WEGE3.SA':'WEG','ABEV3.SA':'Ambev',
  'MGLU3.SA':'Magazine Luiza','RENT3.SA':'Localiza','FLRY3.SA':'Fleury',
  'ONCO3.SA':'Oncoclínicas','BRFS3.SA':'BRF','CMIN3.SA':'CSN Mineração',
  'SPY':'S&P 500','QQQ':'Nasdaq 100','DIA':'Dow Jones','IWM':'Russell 2000',
  'GLD':'Gold','SLV':'Silver','USO':'WTI Oil','UNG':'Nat Gas',
  'CPER':'Copper','REMX':'Rare Earth','SOYB':'Soybeans','WEAT':'Wheat',
  'TSLA':'Tesla','AAPL':'Apple','MSFT':'Microsoft','NVDA':'NVIDIA',
  'GOOGL':'Alphabet','META':'Meta','AMZN':'Amazon','GS':'Goldman Sachs',
  'JPM':'JPMorgan','BAC':'Bank of America','EWG':'Germany DAX',
  'EWU':'UK FTSE','EZU':'Euro Stoxx','EWQ':'France CAC','EWP':'Spain IBEX',
  'EWZ':'Brazil ETF','EWM':'Mexico ETF','EWC':'Canada ETF','EWJ':'Japan ETF',
  'FXI':'China ETF','EFA':'EAFE ETF',
};


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
  if (typeof raw === 'object') raw = raw.symbol || 'SPY';
  const t = raw.trim().toUpperCase();
  if (t.endsWith('=X')) return 'C:' + t.slice(0, -2);
  if (t.endsWith('-USD') && !t.startsWith('C:')) return 'X:' + t.replace('-USD', 'USD');
  return t;
}

function displayTicker(norm) {
  if (norm.startsWith('C:')) return norm.slice(2, 5) + '/' + norm.slice(5);
  if (norm.startsWith('X:')) return norm.slice(2, 5) + '/' + norm.slice(5);
  if (norm.endsWith('.SA')) return norm.slice(0, -3);
  return norm;
}

const fmtPrice = (n) => n == null ? ' // ' : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtK = (n) => {
  if (n == null) return ' // ';
  const abs = Math.abs(n);
  if (abs >= 10000) return (n / 1000).toFixed(1) + 'k';
  if (abs >= 1000)  return (n / 1000).toFixed(2) + 'k';
  return n.toFixed(2);
};

function assetType(t) {
  if (!t) return 'EQUITY';
  if (t.startsWith('C:')) return 'FX';
  if (t.startsWith('X:')) return 'CRYPTO';
  if (t.endsWith('.SA')) return 'BR';
  const ETFS = new Set(['SPY','QQQ','DIA','IWM','EWZ','EWW','EEM','EFA','FXI','EWJ','GLD','SLV','CPER','REMX','USO','UNG','SOYB','WEAT','CORN','BHP']);
  if (ETFS.has(t)) return 'ETF';
  return 'EQUITY';
}
const CHART_LABELS = {
  'SPY': 'S&P 500', 'QQQ': 'Nasdaq 100', 'DIA': 'Dow Jones', 'IWM': 'Russell 2000',
  'GLD': 'Gold', 'SLV': 'Silver', 'USO': 'WTI Oil', 'TLT': '20Y Treasuries',
  'TSLA': 'Tesla', 'AAPL': 'Apple', 'MSFT': 'Microsoft', 'AMZN': 'Amazon',
  'GOOGL': 'Alphabet', 'NVDA': 'Nvidia', 'META': 'Meta', 'JPM': 'JPMorgan',
  'GS': 'Goldman Sachs', 'BAC': 'BofA', 'C': 'Citigroup', 'WFC': 'Wells Fargo',
  'X:BTCUSD': 'Bitcoin', 'X:ETHUSD': 'Ethereum', 'X:SOLUSD': 'Solana',
  'C:USDBRL': 'USD/BRL', 'C:EURBRL': 'EUR/BRL', 'C:GBPBRL': 'GBP/BRL',
  'C:EURUSD': 'EUR/USD', 'C:GBPUSD': 'GBP/USD', 'C:USDJPY': 'USD/JPY',
  'BOVA11.SA': 'Ibovespa ETF', 'PETR3.SA': 'Petrobras', 'VALE3.SA': 'Vale',
  'ITUB4.SA': 'Itau Unibanco', 'BBDC4.SA': 'Bradesco', 'RENT3.SA': 'Localiza',
  'ONCO3.SA': 'OncoclÃ­nicas', 'FLRY3.SA': 'Fleury', 'CPER': 'Copper', 'CMIN3.SA': 'CSN Mineracao',
  'EWG': 'DAX Germany', 'EWU': 'FTSE UK', 'EWQ': 'CAC France', 'EZU': 'Euro Stoxx',
};

function MiniChart({ ticker, index, onRemove, onReplace, onSwap, onOpenDetail }) {
  const [data,    setData]    = useState([]);
  const [price,   setPrice]   = useState(null);
  const [chg,     setChg]     = useState(null);
  const [chgPct,  setChgPct]  = useState(null);
  const [high,    setHigh]    = useState(null);
  const [low,     setLow]     = useState(null);
  const [loading, setLoading] = useState(true);
  const [isDragOver,  setIsDragOver]  = useState(false);
  const [isDragging,  setIsDragging]  = useState(false);
  const [rangeIdx, setRangeIdx] = useState(0);
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
      const res = await fetch(url);
      if (!res.ok) throw new Error(res.status);
      const json = await res.json();
      if (!mountedRef.current) return;
      const bars = (json.results || []).map(b => ({ t: b.t, v: b.c ?? b.vw ?? 0 }));
      setData(bars);
      if (bars.length >= 2) {
        const last  = bars[bars.length - 1].v;
        const first = bars[0].v;
        setPrice(last);
        setChg(last - first);
        setChgPct(first ? ((last - first) / first) * 100 : 0);
        setHigh(Math.max(...bars.map(b => b.v)));
        setLow(Math.min(...bars.map(b => b.v)));
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

  // Live snapshot price — overrides bar-close with real-time price
  useEffect(() => {
    if (!ticker) return;
    const norm = normalizeTicker(ticker);
    fetch(`${API}/api/snapshot/ticker/${encodeURIComponent(norm)}`)
      .then(r => r.json())
      .then(d => {
        const snap = d?.ticker ?? d;
        const live = snap?.min?.c || snap?.day?.c || snap?.lastTrade?.p;
        const prev = snap?.prevDay?.c;
        if (live > 0) {
          setPrice(live);
          if (prev > 0) {
            setChg(live - prev);
            setChgPct(((live - prev) / prev) * 100);
          }
        }
      })
      .catch(() => {});
  }, [ticker]);

  const handleRangeChange = (idx) => { clearInterval(intervalRef.current); setRangeIdx(idx); };

  const isUp     = (chg ?? 0) >= 0;
  const lineColor = isUp ? '#e8e8e8' : '#ff5555';
  const gradId    = 'g' + ticker.replace(/[^a-zA-Z0-9]/g, '');
  const openPrice = data[0]?.v;
  const xFmt = (ms) => {
    const d = new Date(ms);
    if (RANGES[rangeIdx].timespan === 'minute')
      return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  return (
    <div draggable
      data-ticker={ticker}
      data-ticker-label={displayTicker(ticker)}
      onDoubleClick={() => onOpenDetail?.(ticker)}
      data-ticker-type={assetType(ticker)}
      style={{
        background: isDragOver ? '#0d1a2e' : '#07090f',
        border: `1px solid ${isDragOver ? '#ff6600' : isDragging ? '#e8a020' : '#141420'}`,
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        position: 'relative', minHeight: 0,
        transition: 'border-color 0.15s, opacity 0.15s',
        opacity: isDragging ? 0.45 : 1,
        cursor: isDragging ? 'grabbing' : 'grab',
      }}
      onDragStart={e => { setIsDragging(true); e.dataTransfer.setData('application/x-chart-index', String(index)); e.dataTransfer.effectAllowed = 'move'; }}
      onDragEnd={() => setIsDragging(false)}
      onDragOver={e  => { e.preventDefault(); e.stopPropagation(); if (!isDragOver) setIsDragOver(true); }}
      onDragEnter={e => { e.preventDefault(); e.stopPropagation(); setIsDragOver(true); }}
      onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setIsDragOver(false); }}
      onDrop={e => {
        e.preventDefault(); e.stopPropagation(); setIsDragOver(false);
        try {
          const fromStr = e.dataTransfer.getData('application/x-chart-index');
          if (fromStr !== '') { const fi = parseInt(fromStr, 10); if (!isNaN(fi) && fi !== index) { onSwap(fi, index); return; } }
          const raw = e.dataTransfer.getData('application/x-ticker');
          if (raw) { const { symbol } = JSON.parse(raw); onReplace(ticker, normalizeTicker(symbol)); }
        } catch (_) {}
      }}
    >
      <span style={{ position: 'absolute', top: '4px', left: '6px', fontSize: '10px', color: 'rgba(255,255,255,0.45)', pointerEvents: 'none', zIndex: 10, fontWeight: 600, letterSpacing: '0.3px', whiteSpace: 'nowrap' }}>
        {CHART_LABELS[ticker] ? ticker + ' Â· ' + CHART_LABELS[ticker] : ticker}
      </span>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '3px 5px', flexShrink: 0 }}>
        <span style={{ color: '#e8a020', fontWeight: 700, fontSize: 9, letterSpacing: '0.1em', pointerEvents: 'none' }}>
          {isDragOver ? 'â SWAP / REPLACE' : displayTicker(ticker)}
        </span>
        {TICKER_NAMES[ticker] ? <span style={{ color: '#555', fontSize: 7, marginLeft: 3, pointerEvents: 'none' }}>{TICKER_NAMES[ticker]}</span> : null}
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          {price != null && <span style={{ color: '#cccccc', fontSize: 8, fontVariantNumeric: 'tabular-nums', pointerEvents: 'none' }}>{fmtPrice(price)}</span>}
          {chgPct != null && (
            <span style={{ color: isUp ? '#4caf50' : '#f44336', fontSize: 8, fontWeight: 700, pointerEvents: 'none' }}>
              {(isUp ? '+' : '') + chgPct.toFixed(2) + '%'}
            </span>
          )}
          <button onClick={() => onRemove(ticker)}
            style={{ background: 'none', border: 'none', color: '#333', cursor: 'pointer', fontSize: 10, padding: '0 2px', lineHeight: 1, fontFamily: 'inherit' }}
            title="Remove">â</button>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6, padding: '1px 5px', flexShrink: 0, borderTop: '1px solid #0d0d18', borderBottom: '1px solid #0d0d18', pointerEvents: 'none' }}>
        <span style={{ color: '#3a3a5a', fontSize: 6.5 }}>â¡ Chg{' '}
          <span style={{ color: chg != null ? (isUp ? '#4caf50' : '#f44336') : '#3a3a5a' }}>
            {chg != null ? (isUp ? '+' : '') + fmtK(chg) + ' (' + (isUp ? '+' : '') + (chgPct?.toFixed(2) ?? ' // ') + '%)' : ' // '}
          </span>
        </span>
        <span style={{ color: '#3a3a5a', fontSize: 6.5 }}>â¡ Hi <span style={{ color: '#888' }}>{fmtK(high)}</span></span>
        <span style={{ color: '#3a3a5a', fontSize: 6.5 }}>â¡ Lo <span style={{ color: '#888' }}>{fmtK(low)}</span></span>
      </div>
      <div style={{ flex: 1, minHeight: 0, pointerEvents: isDragOver ? 'none' : 'auto' }}>
        {loading ? (
          <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#222233', fontSize: 8 }}>loadingâ¦</div>
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
              <XAxis dataKey="t" tickFormatter={xFmt} tick={{ fill: '#6a6a8a', fontSize: 6 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
              <YAxis orientation="right" domain={['auto','auto']} tickFormatter={fmtK} tick={{ fill: '#6a6a8a', fontSize: 6 }} tickLine={false} axisLine={false} width={30} />
              {openPrice && <ReferenceLine y={openPrice} stroke="#e8a020" strokeDasharray="3 3" strokeWidth={1} />}
              <Area type="monotone" dataKey="v" stroke={lineColor} strokeWidth={1.5} fill={`url(#${gradId})`} dot={false} isAnimationActive={false} />
              <Tooltip
                contentStyle={{ background: '#0a0c18', border: '1px solid #2a2a4a', fontSize: 7, padding: '3px 6px', borderRadius: 2 }}
                itemStyle={{ color: lineColor }}
                formatter={v => [fmtPrice(v), displayTicker(ticker)]}
                labelFormatter={ms => xFmt(ms)}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
      <div style={{ display: 'flex', borderTop: '1px solid #0d0d18', flexShrink: 0 }}>
        {RANGES.map((r, i) => (
          <button key={r.label} onClick={() => handleRangeChange(i)}
            style={{
              flex: 1, padding: '2px 0', background: 'transparent', border: 'none',
              borderBottom: i === rangeIdx ? '2px solid #e8a020' : '2px solid transparent',
              color: i === rangeIdx ? '#e8a020' : '#333', fontSize: 7, cursor: 'pointer',
              fontFamily: 'inherit', fontWeight: i === rangeIdx ? 700 : 400,
              letterSpacing: '0.05em', transition: 'color 0.1s, border-color 0.1s',
            }}>{r.label}</button>
        ))}
      </div>
      {isDragOver && (
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(255,102,0,0.08)', border: '2px solid #ff6600', display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', zIndex: 10 }}>
          <span style={{ color: '#ff6600', fontSize: 8, fontWeight: 700, letterSpacing: '0.15em', fontFamily: 'inherit' }}>â SWAP / REPLACE</span>
        </div>
      )}
    </div>
  );
}

function EmptySlot({ index, onAdd, onSwap }) {
  const [isDragOver, setIsDragOver] = useState(false);
  return (
    <div
      style={{
        border: `1px dashed ${isDragOver ? '#ff6600' : '#1a1a28'}`,
        background: isDragOver ? '#1a0d00' : '#040508',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: isDragOver ? '#ff6600' : '#1a1a28', minHeight: 0,
        cursor: 'copy', flexDirection: 'column', gap: 3, transition: 'all 0.15s',
      }}
      onDragOver={e  => { e.preventDefault(); e.stopPropagation(); if (!isDragOver) setIsDragOver(true); }}
      onDragEnter={e => { e.preventDefault(); e.stopPropagation(); setIsDragOver(true); }}
      onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setIsDragOver(false); }}
      onDrop={e => {
        e.preventDefault(); e.stopPropagation(); setIsDragOver(false);
        try {
          const fromStr = e.dataTransfer.getData('application/x-chart-index');
          if (fromStr !== '') { const fi = parseInt(fromStr, 10); if (!isNaN(fi)) { onSwap(fi, index); return; } }
          const raw = e.dataTransfer.getData('application/x-ticker');
          if (raw) { const { symbol } = JSON.parse(raw); onAdd(symbol); }
        } catch (_) {}
      }}
    >
      <span style={{ fontSize: 14, lineHeight: 1, pointerEvents: 'none' }}>{isDragOver ? 'â¼' : '+'}</span>
      {isDragOver && <span style={{ fontSize: 7, letterSpacing: '0.1em', fontFamily: 'inherit', pointerEvents: 'none' }}>DROP TO ADD</span>}
    </div>
  );
}

export function ChartPanel({ ticker: externalTicker, onGridChange, mobile = false, onOpenDetail }) {
  const [tickers, setTickers] = useState(() => {
    try {
      const urlParam = mobile ? null : new URLSearchParams(window.location.search).get('c');
      if (urlParam) {
        const fromUrl = urlParam.split(',').map(s => s.trim()).filter(Boolean).slice(0, MAX);
        if (fromUrl.length) return fromUrl;
      }
      const _urlC = new URLSearchParams(window.location.search).get('c');
      const _urlGrid = _urlC ? _urlC.split(',').filter(Boolean) : null;
      if (_urlGrid && _urlGrid.length) localStorage.setItem(LS_KEY, JSON.stringify(_urlGrid));
      const v3 = (_urlGrid && _urlGrid.length) ? _urlGrid : JSON.parse(localStorage.getItem(LS_KEY));
      if (Array.isArray(v3) && v3.length) return v3.slice(0, MAX);
      const v2 = JSON.parse(localStorage.getItem('chartGrid_v2'));
      if (Array.isArray(v2) && v2.length) return v2.slice(0, MAX);
    } catch (_) {}
    return ['SPY', 'QQQ'];
  });

  const [copied,  setCopied]  = useState(false);
  const [showQR,  setShowQR]  = useState(false);
  const [qrUrl,   setQrUrl]   = useState('');
  const gridSyncTimer = useRef(null);

  // ââ Fetch grid from server on mount (mobile auto-sync) ââââââââââââââââââââââââââââââââââââââââââââââââââââ
  useEffect(() => {
    if (!mobile) {
      const urlParam = new URLSearchParams(window.location.search).get('c');
      if (urlParam) return; // Desktop: skip server fetch when URL already has tickers
    } // skip server fetch
    fetch(API + '/api/settings')
      .then(r => r.ok ? r.json() : null)
      .then(s => {
        if (Array.isArray(s?.chartGrid) && s.chartGrid.length) {
          const serverGrid = s.chartGrid.slice(0, MAX);
          setTickers(prev =>
            JSON.stringify(prev) === JSON.stringify(serverGrid) ? prev : serverGrid
          );
        }
      })
      .catch(() => {});
  }, [mobile]);

  useEffect(() => {
    if (!externalTicker) return;
    const norm = normalizeTicker(externalTicker);
    setTickers(prev => {
      if (prev.includes(norm) || prev.length >= MAX) return prev;
      return [...prev, norm];
    });
  }, [externalTicker]);

  // ââ Persist + URL update + server sync on change ââââââââââââââââââââââââââââââââââââââââââââââââââââââ
  useEffect(() => {
    localStorage.setItem(LS_KEY, JSON.stringify(tickers));
    const _url = new URL(window.location.href);
    _url.searchParams.set('c', tickers.join(','));
    window.history.replaceState({}, '', _url.toString());
    onGridChange?.(tickers.length);
    if (!mobile) {
      try {
        const url = new URL(window.location.href);
        url.searchParams.set('c', tickers.join(','));
        window.history.replaceState(null, '', url.toString());
      } catch (_) {}
    }
    // Debounced sync to server so mobile auto-matches desktop
    clearTimeout(gridSyncTimer.current);
    gridSyncTimer.current = setTimeout(() => {
      fetch(API + '/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chartGrid: tickers }),
      }).catch(() => {});
    }, 1500);
  }, [tickers, onGridChange, mobile]);

  const addTicker     = useCallback((raw)       => { const norm = normalizeTicker(raw);  setTickers(prev => prev.includes(norm) || prev.length >= MAX ? prev : [...prev, norm]); }, []);
  const removeTicker  = useCallback((t)          => setTickers(prev => prev.filter(x => x !== t)), []);
  const replaceTicker = useCallback((old, nw)    => setTickers(prev => prev.map(x => x === old ? nw : x)), []);
  const swapTickers   = useCallback((fromIdx, toIdx) => {
    setTickers(prev => {
      if (fromIdx === toIdx) return prev;
      const arr = [...prev];
      if (toIdx < arr.length) { [arr[fromIdx], arr[toIdx]] = [arr[toIdx], arr[fromIdx]]; }
      else { const item = arr.splice(fromIdx, 1)[0]; arr.push(item); }
      return arr;
    });
  }, []);

  const copyLink = useCallback(() => {
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('c', tickers.join(','));
      const link = url.toString();
      navigator.clipboard.writeText(link).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
      setQrUrl(`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(link)}&bgcolor=040508&color=e8a020&margin=8`);
      setShowQR(true);
    } catch (_) {}
  }, [tickers]);

  const outerDrop = {
    onDragOver: e => e.preventDefault(),
    onDrop: e => {
      e.preventDefault();
      try {
        if (e.dataTransfer.getData('application/x-chart-index')) return;
        const raw = e.dataTransfer.getData('application/x-ticker');
        if (raw) { const { symbol } = JSON.parse(raw); addTicker(symbol); }
      } catch (_) {}
    },
  };

  if (mobile) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', background: '#040508' }} {...outerDrop}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 10px', borderBottom: '1px solid #141420' }}>
          <span style={{ color: '#e8a020', fontWeight: 700, fontSize: 10, letterSpacing: '0.2em' }}>CHARTS</span>
          <span style={{ color: '#333', fontSize: 8 }}>{tickers.length}/{MAX} Â· use "SYNC TO MOBILE" on desktop to import</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gridAutoRows: '46vw', gap: 1, padding: 1 }}>
          {tickers.map((t, i) => (
            <MiniChart key={t} ticker={t} index={i} onRemove={removeTicker} onReplace={replaceTicker} onSwap={swapTickers} onOpenDetail={onOpenDetail} />
          ))}
          {tickers.length < MAX && <EmptySlot index={tickers.length} onAdd={addTicker} onSwap={swapTickers} />}
        </div>
      </div>
    );
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#040508', overflow: 'hidden' }} {...outerDrop}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '3px 8px', borderBottom: '1px solid #141420', flexShrink: 0 }}>
        <span style={{ color: '#e8a020', fontWeight: 700, fontSize: 9, letterSpacing: '0.2em' }}>CHARTS</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: '#222233', fontSize: 7 }}>{tickers.length}/{MAX} // drag to reorder Â· drop to add</span>
          <div style={{ position: 'relative' }}>
            <button onClick={copyLink}
              style={{
                background: copied ? '#0a2010' : 'transparent',
                border: `1px solid ${copied ? '#4caf50' : '#2a2a3a'}`,
                color: copied ? '#4caf50' : '#444', fontSize: 7, cursor: 'pointer',
                padding: '2px 6px', borderRadius: 2, fontFamily: 'inherit',
                letterSpacing: '0.05em', transition: 'all 0.2s',
              }}>
              {copied ? 'â COPIED' : 'â SYNC TO MOBILE'}
            </button>
            {showQR && (
              <div onClick={() => setShowQR(false)}
                style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.75)' }}
              >
                <div onClick={e => e.stopPropagation()}
                  style={{ background: '#0a0a0f', border: '1px solid #2a2a3a', borderRadius: 6, padding: 20, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}
                >
                  <span style={{ color: '#e8a020', fontSize: 11, fontWeight: 700, letterSpacing: '0.15em' }}>SYNC TO MOBILE</span>
                  <span style={{ color: '#555', fontSize: 9 }}>Scan with your phone to open your {tickers.length} charts</span>
                  <img src={qrUrl} alt="QR Code" style={{ width: 180, height: 180, borderRadius: 4 }} />
                  <span style={{ color: '#333', fontSize: 8 }}>Link also copied to clipboard Â· click anywhere to close</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: `repeat(${GRID_COLS}, 1fr)`, gridTemplateRows: `repeat(${GRID_ROWS}, 1fr)`, gap: 1, overflow: 'hidden', padding: 1 }}>
        {Array.from({ length: MAX }, (_, i) => {
          const t = tickers[i];
          return t
            ? <MiniChart key={t} ticker={t} index={i} onRemove={removeTicker} onReplace={replaceTicker} onSwap={swapTickers} />
            : <EmptySlot key={`empty-${i}`} index={i} onAdd={addTicker} onSwap={swapTickers} />;
        })}
      </div>
    </div>
  );
}
Fix ChartPanel: sync chart grid from ?c= URL param (bidirectional) for cross-device sharing
