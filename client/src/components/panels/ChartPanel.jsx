// ChartPanel.jsx — Bloomberg-style multi-chart grid (fixed 4×3 = 12 slots)
// Desktop: always-full 4×3 symmetric grid — no empty rows ever
// Mobile: 2-col scrollable layout sharing same localStorage as desktop
// Phase 15: indicator overlays + AI chart insight per MiniChart
import { useState, useEffect, useRef, useCallback, useMemo, memo } from 'react';
import { useTickerPrice } from '../../context/PriceContext';
import { useOpenDetail } from '../../context/OpenDetailContext';
import { AreaChart, Area, XAxis, YAxis, ResponsiveContainer, Tooltip, ReferenceLine, Line } from 'recharts';
import { useAIInsight } from '../../hooks/useAIInsight';
import { apiFetch } from '../../utils/api';
import { computeIndicators, buildChartInsightPayload, getLatestIndicatorSnapshot, IND_COLORS, INDICATOR_LIST } from '../../utils/chartIndicators';
import './ChartPanel.css';

const LS_KEY = 'chartGrid_v3';
const MAX = 12;
const GRID_COLS = 4;
const GRID_ROWS = 3;
const CHART_REFRESH_INTERVAL = 60_000;

const RANGES = [
  { label: '1D', multiplier: 5,  timespan: 'minute', days: 1   },
  { label: '3D', multiplier: 30, timespan: 'minute', days: 3   },
  { label: '1M', multiplier: 1,  timespan: 'day',    days: 30  },
  { label: '6M', multiplier: 1,  timespan: 'day',    days: 180 },
  { label: 'YTD',multiplier: 1,  timespan: 'day',    days: 0   },
  { label: '1Y', multiplier: 1,  timespan: 'day',    days: 365 },
];

const _nameCache = new Map();

const NAME_OVERRIDES = {
  SPY:'S&P 500', QQQ:'Nasdaq 100', DIA:'Dow Jones', IWM:'Russell 2000',
  EWZ:'Brazil ETF', EWW:'Mexico ETF', EEM:'Emerg Mkts', EFA:'EAFE ETF',
  FXI:'China ETF', EWJ:'Japan ETF', EWG:'Germany ETF', EZU:'Eurozone ETF',
  EWU:'UK ETF', GLD:'Gold ETF', SLV:'Silver ETF', USO:'Crude Oil',
  UNG:'Nat Gas', CPER:'Copper ETF', REMX:'Rare Earth', SOYB:'Soybeans',
  WEAT:'Wheat', CORN:'Corn', BHP:'BHP Group',
  'BOVA11.SA':'Ibovespa ETF', 'ONCO3.SA':'Oncoclínicas', 'FLRY3.SA':'Fleury',
  'PETR3.SA':'Petrobras ON', 'PETR4.SA':'Petrobras PN', 'VALE3.SA':'Vale',
  'ITUB4.SA':'Itaú Unibanco', 'BBDC4.SA':'Bradesco', 'BBAS3.SA':'Banco Brasil',
  'RENT3.SA':'Localiza', 'ABEV3.SA':'Ambev', 'WEGE3.SA':'WEG',
  'RDOR3.SA':"Rede D'Or", 'SUZB3.SA':'Suzano', 'EMBR3.SA':'Embraer',
  'C:USDBRL':'USD/BRL', 'C:EURUSD':'EUR/USD', 'C:GBPUSD':'GBP/USD',
  'C:USDJPY':'USD/JPY', 'C:GBPBRL':'GBP/BRL',
  'X:BTCUSD':'Bitcoin', 'X:ETHUSD':'Ethereum', 'X:SOLUSD':'Solana',
  'X:XRPUSD':'XRP', 'X:BNBUSD':'BNB', 'X:DOGEUSD':'Dogecoin',
};

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
  if (/^[A-Z]:/.test(t)) return t;
  if (t.endsWith('=X')) return 'C:' + t.slice(0, -2);
  if (/^[A-Z]{6}$/.test(t)) return 'C:' + t;
  if (t.endsWith('-USD') && !t.startsWith('C:')) return 'X:' + t.replace('-USD', 'USD');
  return t;
}

function displayTicker(norm) {
  if (norm.startsWith('C:')) return norm.slice(2, 5) + '/' + norm.slice(5);
  if (norm.startsWith('X:')) return norm.slice(2, 5) + '/' + norm.slice(5);
  if (norm.endsWith('.SA')) return norm.slice(0, -3);
  return norm;
}

const fmtPrice = (n) => n == null ? "—" : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtK = (n) => {
  if (n == null) return "—";
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


// ── AI Insight Popover ─────────────────────────────────────────────────────
function AiInsightPopover({ insight, loading, error, onClose }) {
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    const keyHandler = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', keyHandler);
    return () => { document.removeEventListener('mousedown', handler); document.removeEventListener('keydown', keyHandler); };
  }, [onClose]);

  return (
    <div ref={ref} className="mc-ai-popover">
      <span className="mc-ai-popover-badge">AI CHART INSIGHT</span>
      {loading && <span className="mc-ai-popover-text mc-ai-popover-text--loading">Analyzing...</span>}
      {error && <span className="mc-ai-popover-text mc-ai-popover-text--error">AI unavailable</span>}
      {insight && <span className="mc-ai-popover-text">{insight.body || insight}</span>}
    </div>
  );
}

const MiniChart = memo(function MiniChart({ ticker, index, onRemove, onReplace, onSwap }) {
  const openDetail = useOpenDetail();
  const shared = useTickerPrice(ticker);
  const [rawBars, setRawBars] = useState([]);
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
  const [name, setName] = useState('');

  // Indicator state (per mini-chart)
  const [activeIndicators, setActiveIndicators] = useState(new Set());
  // AI insight state
  const [showAi, setShowAi] = useState(false);

  const mountedRef  = useRef(true);
  const intervalRef = useRef(null);
  const snapshotChgRef = useRef(null);
  // Cache indicator results per symbol+range to avoid recomputing on every render
  const indCacheRef = useRef(new Map());

  const fetchData = useCallback(async (rIdx) => {
    if (!ticker) return;
    const range = RANGES[rIdx];
    if (mountedRef.current) setLoading(true);
    try {
      const toStr   = new Date().toISOString().split('T')[0];
      const fromStr = getFromDate(range);
      const url = `/api/chart/${encodeURIComponent(ticker)}?from=${fromStr}&to=${toStr}&multiplier=${range.multiplier}&timespan=${range.timespan}`;
      const res = await apiFetch(url);
      if (!res.ok) throw new Error(res.status);
      const json = await res.json();
      if (!mountedRef.current) return;
      let bars = (json.results || []).map(b => ({
        t: b.t,
        v: b.c ?? b.vw ?? 0,
        open: b.o ?? b.c ?? 0,
        high: b.h ?? b.c ?? 0,
        low: b.l ?? b.c ?? 0,
        close: b.c ?? b.vw ?? 0,
        volume: b.v ?? 0,
        label: range.timespan === 'minute'
          ? new Date(b.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          : new Date(b.t).toLocaleDateString([], { month: 'short', day: 'numeric' }),
      }));
      if (range.label === '1D') {
        const d0 = new Date(); d0.setHours(0,0,0,0);
        const tod = bars.filter(b => b.t >= d0.getTime());
        if (tod.length > 0) bars = tod;
      }
      setRawBars(bars);
      setData(bars);
      if (bars.length >= 2) {
        const last  = bars[bars.length - 1].v;
        const first = bars[0].v;
        setPrice(prev => (prev != null && prev > 0) ? prev : last);
        if (range.label === '1D' && snapshotChgRef.current) {
          setChg(snapshotChgRef.current.chg);
          setChgPct(snapshotChgRef.current.chgPct);
        } else {
          setChg(last - first);
          setChgPct(first ? ((last - first) / first) * 100 : 0);
        }
        setHigh(Math.max(...bars.map(b => b.v)));
        setLow(Math.min(...bars.map(b => b.v)));
      }
      // Invalidate indicator cache on new data
      indCacheRef.current.clear();
    } catch (_) {
      if (mountedRef.current) { setRawBars([]); setData([]); }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [ticker]);

  useEffect(() => {
    mountedRef.current = true;
    fetchData(rangeIdx);
    intervalRef.current = setInterval(() => fetchData(rangeIdx), CHART_REFRESH_INTERVAL);
    return () => { mountedRef.current = false; clearInterval(intervalRef.current); };
  }, [fetchData, rangeIdx]);

  useEffect(() => {
    if (!shared?.price) return;
    setPrice(shared.price);
    if (shared.changePct != null) {
      snapshotChgRef.current = { chg: shared.change, chgPct: shared.changePct };
      if (rangeIdx === 0) {
        if (shared.change != null) setChg(shared.change);
        setChgPct(shared.changePct);
      }
    }
  }, [shared, rangeIdx]);

  useEffect(() => {
    if (!ticker) return;
    const norm = normalizeTicker(ticker);
    const override = NAME_OVERRIDES[norm] || NAME_OVERRIDES[ticker];
    if (override) {
      _nameCache.set(norm, override);
      if (mountedRef.current) setName(override);
      return;
    }
    if (_nameCache.has(norm)) { setName(_nameCache.get(norm)); return; }
    if (norm.startsWith('C:') || norm.startsWith('X:')) {
      _nameCache.set(norm, ''); return;
    }
    apiFetch(`/api/ticker/${encodeURIComponent(norm)}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        const n = (d?.results?.name || '')
          .replace(/\s+-\s+.+$/, '')
          .replace(/,?\s*(Inc\.|Corp\.|Ltd\.)\s+.+$/i, '')
          .replace(/,?\s*(Inc\.?|Corp\.?|Ltd\.?|LLC|S\.A\.|plc|NV|AG|SE)\s*$/i, '')
          .replace(/[,.\s]+$/, '')
          .trim().slice(0, 22);
        _nameCache.set(norm, n);
        if (mountedRef.current) setName(n);
      }).catch(() => {});
  }, [ticker]);

  const handleRangeChange = (idx) => { clearInterval(intervalRef.current); setRangeIdx(idx); indCacheRef.current.clear(); };

  // ── Compute indicators (memoized with cache) ────────────────────────────
  const indicatorResult = useMemo(() => {
    if (activeIndicators.size === 0 || rawBars.length < 5) {
      return { bars: rawBars, hasOverlay: false, hasSubChart: false };
    }
    const cacheKey = `${ticker}:${rangeIdx}:${rawBars.length}:${[...activeIndicators].sort().join(',')}`;
    if (indCacheRef.current.has(cacheKey)) return indCacheRef.current.get(cacheKey);
    const result = computeIndicators(rawBars, activeIndicators);
    indCacheRef.current.set(cacheKey, result);
    return result;
  }, [rawBars, activeIndicators, ticker, rangeIdx]);

  const chartBars = indicatorResult.bars;
  const indSnapshot = useMemo(() => getLatestIndicatorSnapshot(chartBars), [chartBars]);

  const toggleIndicator = (key) => {
    setActiveIndicators(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else { next.add(key); }
      return next;
    });
  };

  // ── AI Chart Insight ────────────────────────────────────────────────────
  const aiCacheKey = showAi ? `chart:${ticker}:${RANGES[rangeIdx].label}` : null;
  const aiContext = useMemo(() => {
    if (!showAi || rawBars.length < 5) return {};
    const enriched = activeIndicators.size > 0 ? chartBars : rawBars;
    return buildChartInsightPayload(ticker, RANGES[rangeIdx].label, enriched);
  }, [showAi, ticker, rangeIdx, rawBars, chartBars, activeIndicators]);

  const { insight: aiInsight, loading: aiLoading, error: aiError, refresh: fetchAiInsight } = useAIInsight({
    type: 'chart',
    context: aiContext,
    cacheKey: aiCacheKey || `chart:${ticker}:${RANGES[rangeIdx].label}`,
    ttlMs: 300000,
    autoFetch: false,
  });

  const handleAiClick = useCallback(() => {
    if (rawBars.length < 5) return;
    if (!showAi) {
      setShowAi(true);
      fetchAiInsight();
    } else {
      setShowAi(false);
    }
  }, [showAi, rawBars, fetchAiInsight]);


  const dispPrice  = shared?.price ?? price;
  const dispChg    = rangeIdx === 0 ? (shared?.change    ?? chg) : chg;
  const dispChgPct = rangeIdx === 0 ? (shared?.changePct ?? chgPct) : chgPct;

  const isUp     = (dispChg ?? 0) >= 0;
  const lineColor = isUp ? '#e8e8e8' : '#ff5555';
  const gradId    = 'g' + ticker.replace(/[^a-zA-Z0-9]/g, '');
  const openPrice = chartBars[0]?.v ?? chartBars[0]?.close;
  const xFmt = (ms) => {
    const d = new Date(ms);
    if (RANGES[rangeIdx].timespan === 'minute')
      return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const cellClass = `mc-cell${isDragging ? ' mc-cell--dragging' : ''}${isDragOver ? ' mc-cell--dragover' : ''}`;

  // RSI color logic
  const rsiColor = indSnapshot.rsi14 != null
    ? (indSnapshot.rsi14 >= 70 ? 'var(--price-down)' : indSnapshot.rsi14 <= 30 ? 'var(--price-up)' : IND_COLORS.RSI14)
    : IND_COLORS.RSI14;
  // MACD color logic
  const macdColor = indSnapshot.macdHist != null
    ? (indSnapshot.macdHist >= 0 ? 'var(--price-up)' : 'var(--price-down)')
    : IND_COLORS.MACD;

  return (
    <div draggable
      data-ticker={ticker}
      data-ticker-label={displayTicker(ticker)}
      onDoubleClick={() => openDetail(ticker)}
      data-ticker-type={assetType(ticker)}
      className={cellClass}
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
      {/* Header */}
      <div className="mc-header">
        <span className="mc-ticker">
          {isDragOver ? 'SWAP / REPLACE' : displayTicker(ticker) + (name ? ' · ' + name : '')}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          {dispPrice != null && <span className="mc-price">{fmtPrice(dispPrice)}</span>}
          {dispChgPct != null && (
            <span className={`mc-chg ${isUp ? 'mc-chg--up' : 'mc-chg--down'}`}>
              {(isUp ? '+' : '') + dispChgPct.toFixed(2) + '%'}
            </span>
          )}
          {/* AI insight trigger */}
          <button onClick={handleAiClick} className="mc-ai-btn" title="AI Chart Insight" disabled={rawBars.length < 5}>
            AI
          </button>
          <button onClick={() => onRemove(ticker)} className="mc-remove" title="Remove"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
        </div>
      </div>

      {/* Indicator toggle bar */}
      <div className="mc-ind-bar">
        {INDICATOR_LIST.map(ind => (
          <button key={ind.key}
            className={`mc-ind-pill${activeIndicators.has(ind.key) ? ' mc-ind-pill--active' : ''}`}
            style={activeIndicators.has(ind.key) ? { borderColor: IND_COLORS[ind.key], color: IND_COLORS[ind.key] } : undefined}
            onClick={() => toggleIndicator(ind.key)}
          >{ind.label}</button>
        ))}
      </div>

      {/* Stats bar (includes RSI/MACD badges when active) */}
      <div className="mc-stats">
        <span className="mc-stat-label">Chg{' '}
          <span style={{ color: dispChg != null ? (isUp ? 'var(--price-up)' : 'var(--price-down)') : undefined }}>
            {dispChg != null ? (isUp ? '+' : '') + fmtK(dispChg) + ' (' + (isUp ? '+' : '') + (dispChgPct?.toFixed(2) ?? "—") + '%)' : "—"}
          </span>
        </span>
        <span className="mc-stat-label">Hi <span className="mc-stat-val">{fmtK(high)}</span></span>
        <span className="mc-stat-label">Lo <span className="mc-stat-val">{fmtK(low)}</span></span>
        {activeIndicators.has('RSI14') && indSnapshot.rsi14 != null && (
          <span className="mc-ind-badge" style={{ color: rsiColor }}>RSI {indSnapshot.rsi14.toFixed(0)}</span>
        )}
        {activeIndicators.has('MACD') && indSnapshot.macdHist != null && (
          <span className="mc-ind-badge" style={{ color: macdColor }}>MACD {indSnapshot.macdHist >= 0 ? '+' : ''}{indSnapshot.macdHist.toFixed(2)}</span>
        )}
      </div>

      {/* Chart */}
      <div style={{ flex: 1, minHeight: 0, pointerEvents: isDragOver ? 'none' : 'auto', position: 'relative' }}>
        {loading || data.length === 0 ? (
          <div className="mc-msg mc-skeleton-shimmer" style={{ opacity: 0.4 }}>&nbsp;</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartBars} margin={{ top: 4, right: 2, bottom: 2, left: 0 }}>
              <defs>
                <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={isUp ? '#1e50c8' : '#c81e1e'} stopOpacity={0.55} />
                  <stop offset="95%" stopColor={isUp ? '#1e50c8' : '#c81e1e'} stopOpacity={0.0}  />
                </linearGradient>
              </defs>
              <XAxis dataKey="t" tickFormatter={xFmt} tick={{ fill: 'var(--text-muted)', fontSize: 8 }} tickLine={false} axisLine={false} interval={Math.max(0, Math.ceil(chartBars.length / 4) - 1)} height={14} />
              <YAxis orientation="right" domain={['auto','auto']} tickFormatter={fmtK} tick={{ fill: 'var(--text-muted)', fontSize: 8 }} tickLine={false} axisLine={false} width={32} />
              {openPrice && <ReferenceLine y={openPrice} stroke="var(--accent-text)" strokeDasharray="3 3" strokeWidth={1} />}
              <Area type="monotone" dataKey="v" stroke={lineColor} strokeWidth={1.5} fill={`url(#${gradId})`} dot={false} isAnimationActive={false} />

              {/* Indicator overlays */}
              {activeIndicators.has('SMA20') && (
                <Line type="monotone" dataKey="sma20" stroke={IND_COLORS.SMA20} strokeWidth={1} dot={false} connectNulls isAnimationActive={false} />
              )}
              {activeIndicators.has('EMA50') && (
                <Line type="monotone" dataKey="ema50" stroke={IND_COLORS.EMA50} strokeWidth={1} dot={false} connectNulls isAnimationActive={false} />
              )}
              {activeIndicators.has('BB') && (
                <>
                  <Line type="monotone" dataKey="bbUpper" stroke={IND_COLORS.BB} strokeWidth={0.8} dot={false} strokeDasharray="4 2" connectNulls isAnimationActive={false} />
                  <Line type="monotone" dataKey="bbLower" stroke={IND_COLORS.BB} strokeWidth={0.8} dot={false} strokeDasharray="4 2" connectNulls isAnimationActive={false} />
                </>
              )}

              <Tooltip
                contentStyle={{ background: 'var(--bg-surface)', border: '1px solid var(--border-strong)', fontSize: 7, padding: '3px 6px' }}
                itemStyle={{ color: lineColor }}
                formatter={v => [fmtPrice(v), displayTicker(ticker)]}
                labelFormatter={ms => xFmt(ms)}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
        {/* AI Insight Popover */}
        {showAi && (
          <AiInsightPopover
            insight={aiInsight}
            loading={aiLoading}
            error={aiError}
            onClose={() => setShowAi(false)}
          />
        )}
      </div>

      {/* Range bar */}
      <div className="mc-range-bar">
        {RANGES.map((r, i) => (
          <button key={r.label} className={`mc-range-btn${i === rangeIdx ? ' mc-range-btn--active' : ''}`} onClick={() => handleRangeChange(i)}
          >{r.label}</button>
        ))}
      </div>

      {/* Drag overlay */}
      {isDragOver && (
        <div className="mc-drag-overlay">
          <span className="mc-drag-text">SWAP / REPLACE</span>
        </div>
      )}
    </div>
  );
});

function EmptySlot({ index, onAdd, onSwap }) {
  const [isDragOver, setIsDragOver] = useState(false);
  return (
    <div
      className={`cp-empty-slot${isDragOver ? ' cp-empty-slot--dragover' : ''}`}
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
      <span className="cp-empty-icon">{isDragOver ? '▼' : '+'}</span>
      {isDragOver && <span className="cp-empty-label">DROP TO ADD</span>}
    </div>
  );
}

function ChartPanel({ ticker: externalTicker, onGridChange, mobile = false }) {
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
    return ['SPY', 'QQQ', 'C:EURUSD', 'C:USDJPY', 'GLD', 'USO', 'EEM', 'EWZ', 'X:BTCUSD', 'VGK', 'MSFT', 'BZ=F'];
  });

  const [copied,  setCopied]  = useState(false);
  const [showQR,  setShowQR]  = useState(false);
  const [qrUrl,   setQrUrl]   = useState('');
  const gridSyncTimer = useRef(null);

  useEffect(() => {
    if (!mobile) {
      const urlParam = new URLSearchParams(window.location.search).get('c');
      if (urlParam) return;
    }
    apiFetch('/api/settings')
      .then(r => r.ok ? r.json() : null)
      .then(s => {
        if (Array.isArray(s?.settings?.chartGrid) && s.settings.chartGrid.length) {
          const serverGrid = s.settings.chartGrid.slice(0, MAX);
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

  useEffect(() => {
    localStorage.setItem(LS_KEY, JSON.stringify(tickers));
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('c', tickers.join(','));
      window.history.replaceState(null, '', url.toString());
    } catch (_) {}
    onGridChange?.(tickers.length);
    clearTimeout(gridSyncTimer.current);
    gridSyncTimer.current = setTimeout(() => {
      apiFetch('/api/settings', {
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

  const qrCodeUrl = useMemo(() => {
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('c', tickers.join(','));
      const link = url.toString();
      return `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(link)}&bgcolor=040508&color=e8a020&margin=8`;
    } catch (_) {
      return '';
    }
  }, [tickers]);

  const copyLink = useCallback(() => {
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('c', tickers.join(','));
      const link = url.toString();
      navigator.clipboard.writeText(link).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
      setQrUrl(qrCodeUrl);
      setShowQR(true);
    } catch (_) {}
  }, [tickers, qrCodeUrl]);

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

  const [addInput, setAddInput] = useState('');
  const [showAddInput, setShowAddInput] = useState(false);

  if (mobile) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', background: 'var(--bg-panel)' }} {...outerDrop}>
        <div className="cp-mobile-header">
          <div className="cp-mobile-top">
            <span className="cp-title">CHARTS</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className="cp-subtitle">{tickers.length}/{MAX}</span>
              <button onClick={() => setShowAddInput(v => !v)} className={`cp-add-btn${showAddInput ? ' cp-add-btn--open' : ''}`}>+ ADD</button>
            </div>
          </div>
          {showAddInput && (
            <div className="cp-mobile-add-row">
              <input value={addInput} onChange={e => setAddInput(e.target.value.toUpperCase())} onKeyDown={e => { if (e.key === 'Enter' && addInput.trim()) { addTicker(addInput.trim()); setAddInput(''); setShowAddInput(false); } }} placeholder="TICKER" className="cp-mobile-input" autoFocus />
              <button onClick={() => { if (addInput.trim()) { addTicker(addInput.trim()); setAddInput(''); setShowAddInput(false); } }} className="cp-add-btn cp-add-btn--submit">ADD</button>
            </div>
          )}
        </div>
        <div className="cp-grid cp-grid--mobile">
          {tickers.map((t, i) => (
            <MiniChart key={t} ticker={t} index={i} onRemove={removeTicker} onReplace={replaceTicker} onSwap={swapTickers} />
          ))}
          {tickers.length < MAX && <EmptySlot index={tickers.length} onAdd={addTicker} onSwap={swapTickers} />}
        </div>
      </div>
    );
  }

  return (
    <div className="cp-panel" {...outerDrop}>
      <div className="cp-header">
        <span className="cp-title">CHARTS</span>
        <span className="cp-subtitle">{tickers.length}/{MAX} // drag to reorder · drop to add</span>
      </div>
      <div className="cp-grid cp-grid--desktop">
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

export { ChartPanel };
export default memo(ChartPanel);
