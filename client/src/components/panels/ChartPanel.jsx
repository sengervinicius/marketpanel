// ChartPanel.jsx — Bloomberg-style multi-chart grid (adaptive, max 4×3 = 12 slots)
// Desktop (H0): grid adapts to chart count — 1-2 charts → 2 cols, 3-4 → 2×2,
// 5-6 → 3×2, 7-9 → 3×3, 10-12 → 4×3 — with exactly ONE trailing "+" add-tile
// when below max (no wall of dashed holes).
// Mobile: 2-col scrollable layout sharing same localStorage as desktop
// Phase 15: indicator overlays + AI chart insight per MiniChart
import { useState, useEffect, useRef, useCallback, useMemo, memo } from 'react';
import { useTickerPrice } from '../../context/PriceContext';
import { useOpenDetail } from '../../context/OpenDetailContext';
import { AreaChart, Area, XAxis, YAxis, ResponsiveContainer, Tooltip, ReferenceLine, Line } from 'recharts';
import { useAIInsight } from '../../hooks/useAIInsight';
import { useIsMobile } from '../../hooks/useIsMobile';
import { apiFetch } from '../../utils/api';
import { computeIndicators, buildChartInsightPayload, getLatestIndicatorSnapshot, IND_COLORS, INDICATOR_LIST } from '../../utils/chartIndicators';
// H0: mini-chart up/down colors come from the design tokens. Recharts SVG
// attributes (stroke / stopColor) can't resolve CSS custom properties, so we
// use the sanctioned TOKEN_HEX mirror of tokens.css instead of inline hex.
import { TOKEN_HEX } from '../../utils/tokenHex';
import { fmtCompactAxis } from '../../utils/format';
import { toPolygonWithDefault, toDisplay } from '../../utils/tickerNormalize';
import { swallow } from '../../utils/swallow';
// #289 part 2 — per-tile freshness dot. Tiny coloured indicator that
// reads from /api/data-freshness/:symbol so a CIO can tell at a glance
// whether the price is actually live, stale, or frozen — without
// having to trust the price alone.
import FreshnessDot from '../common/FreshnessDot';
import PanelChrome from '../common/PanelChrome';
// fix/bug-wave3 BUG 2 — dirty-flag guard so a stale server settings snapshot
// can never clobber newer local grid edits across unmount/remount.
import {
  readGridMeta, markGridDirty, clearGridDirtyIfSynced, resolveIncomingServerGrid,
} from '../../utils/chartGridSync';
import './ChartPanel.css';

const LS_KEY = 'chartGrid_v3';
const MAX = 12;
const CHART_REFRESH_INTERVAL = 60_000;

// H0 adaptive grid, reworked (user report: “2 charts → blank band below”):
// the trailing add-tile used to count as a full tile, so 2 charts produced a
// 2×2 grid whose entire second row was the near-invisible add slot plus a
// blank cell — a black band under the charts. Now the CHART count alone
// drives the grid: cols from count, rows = ceil(charts / cols), and every
// row is 1fr so tiles always split the full panel height. The add-tile only
// fills leftover cells in the last row (spanning all of them) and never
// creates a row of its own; when the last row is exactly full the add
// affordance lives in the header (+ ADD button, drag-drop still works).
function gridDims(chartCount) {
  const n = Math.max(1, Math.min(MAX, chartCount));
  const cols = n <= 1 ? 1 : n <= 4 ? 2 : n <= 9 ? 3 : 4;
  return { cols, rows: Math.ceil(n / cols) };
}

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

// #241 / P1.1: normaliseTicker / displayTicker used to live here as
// private helpers. They now delegate to the shared tickerNormalize helpers
// (mirrored server-side) so the same input always maps to the same
// Polygon symbol + display label regardless of which panel is calling.
const normalizeTicker = toPolygonWithDefault;
const displayTicker = toDisplay;

const fmtPrice = (n) => n == null ? "—" : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// #240 / P1.2 / D2.1: axis labels now use the shared Intl.NumberFormat-based
// compact helper (fmtCompactAxis) from utils/format so every chart renders
// "1.2K / 3.4M / 1.2B" consistently instead of each panel inventing its own
// rounding/suffix rules.
const fmtK = (n) => fmtCompactAxis(n, 1);

// #UX-2: the mini-chart hover tooltip rendered at 7px via Recharts
// contentStyle — illegible. Custom content: bold mono price at 13px,
// change% vs the visible window's open colored up/down, solid dark bg.
// Styling lives in ChartPanel.css (.mc-tooltip*).
function MiniChartTooltip({ active, payload, label, xFmt, openPrice }) {
  if (!active || !payload || payload.length === 0) return null;
  const pt = payload.find(p => p.dataKey === 'v') || payload[0];
  const v = pt && pt.value;
  if (v == null) return null;
  const pct = openPrice ? ((v - openPrice) / openPrice) * 100 : null;
  const up = (pct ?? 0) >= 0;
  return (
    <div className="mc-tooltip">
      <div className="mc-tooltip-time">{xFmt(label)}</div>
      <div className="mc-tooltip-price">{fmtPrice(v)}</div>
      {pct != null && (
        <div className={`mc-tooltip-chg ${up ? 'mc-tooltip-chg--up' : 'mc-tooltip-chg--down'}`}>
          {(up ? '+' : '') + pct.toFixed(2) + '%'}
        </div>
      )}
    </div>
  );
}

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
  // #247 P2.5 — HTML5 drag-and-drop is a no-op on touch devices and
  // hijacks scroll. Disable drag on mobile; users still get double-tap
  // to open the detail page.
  const isMobileDevice = useIsMobile();
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
      // #291 W2.16b — drop bars without a finite timestamp or close.
      // Same fix as InstrumentDetail W2.16 — recharts XAxis cannot
      // tolerate NaN/undefined on its dataKey and crashes the entire
      // chart subtree. OHLC fields already fall back to b.c, but
      // `t` had no fallback so a malformed Yahoo response with a
      // missing timestamp could nuke this panel.
      let bars = (json.results || [])
        .filter(b => b && Number.isFinite(b.t) && Number.isFinite(b.c ?? b.vw))
        .map(b => ({
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
    // #288 / FIX-006 — Production audit found MSFT and BZ=F charts in the
    // grid showed ticker without name (rendered as "MSFT 411.13" or
    // "BZ 110.99" with the layout collapsing because the name slot was
    // empty). Polygon's /api/ticker doesn't return a name for futures
    // contracts (BZ=F, CL=F, etc.) and occasionally returns null for
    // equities the user types in odd casings. A small static fallback
    // map covers the common cases so the title row stays well-formed.
    // The dynamic API lookup still runs and overrides with the live
    // name when it arrives.
    const STATIC_NAME_FALLBACK = {
      'BZ=F':   'Brent Crude',
      'CL=F':   'WTI Crude',
      'NG=F':   'Natural Gas',
      'GC=F':   'Gold Futures',
      'SI=F':   'Silver Futures',
      'HG=F':   'Copper Futures',
      'ZC=F':   'Corn Futures',
      'ZS=F':   'Soybean Futures',
      'ZW=F':   'Wheat Futures',
      'KC=F':   'Coffee Futures',
      'CT=F':   'Cotton Futures',
      'MSFT':   'Microsoft',
      'AAPL':   'Apple',
      'NVDA':   'NVIDIA',
      'GOOGL':  'Alphabet',
      'META':   'Meta',
      'AMZN':   'Amazon',
      'TSLA':   'Tesla',
    };
    const fallback = STATIC_NAME_FALLBACK[norm];
    if (fallback) {
      // Seed the cache + state with the fallback immediately so the
      // initial render is well-formed; live API can refine it after.
      setName(fallback);
    }
    if (norm.startsWith('C:') || norm.startsWith('X:')) {
      // FX / crypto already have synthetic names from displayTicker
      // (EUR/USD etc.); no API lookup. Cache empty so we don't refetch.
      _nameCache.set(norm, fallback || '');
      return;
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
        // #288 / FIX-006 — if the API returned nothing usable, fall back
        // to our static map so the title row never collapses to just the
        // ticker.
        const finalName = n || STATIC_NAME_FALLBACK[norm] || '';
        _nameCache.set(norm, finalName);
        if (mountedRef.current) setName(finalName);
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
  // H0: up = token green, down = token red — line AND gradient fill.
  const lineColor = isUp ? TOKEN_HEX.up : TOKEN_HEX.down;
  const gradId    = 'g' + ticker.replace(/[^a-zA-Z0-9]/g, '');
  const openPrice = chartBars[0]?.v ?? chartBars[0]?.close;
  const xFmt = (ms) => {
    const d = new Date(ms);
    if (RANGES[rangeIdx].timespan === 'minute')
      return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  // #UX-2: hovered bar price mirrored into the header slot (a much
  // bigger read target than the tooltip). Cleared on mouse leave.
  const [hoverPrice, setHoverPrice] = useState(null);
  const handleChartMove = useCallback((st) => {
    const pl = st && st.activePayload && st.activePayload.find(x => x.dataKey === 'v');
    setHoverPrice(pl && pl.value != null ? pl.value : null);
  }, []);
  const handleChartLeave = useCallback(() => setHoverPrice(null), []);

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
    <div draggable={!isMobileDevice}
      data-ticker={ticker}
      data-ticker-label={displayTicker(ticker)}
      onDoubleClick={() => openDetail(ticker)}
      data-ticker-type={assetType(ticker)}
      className={cellClass}
      onDragStart={isMobileDevice ? undefined : e => { setIsDragging(true); e.dataTransfer.setData('application/x-chart-index', String(index)); e.dataTransfer.effectAllowed = 'move'; }}
      onDragEnd={isMobileDevice ? undefined : () => setIsDragging(false)}
      onDragOver={isMobileDevice ? undefined : e  => { e.preventDefault(); e.stopPropagation(); if (!isDragOver) setIsDragOver(true); }}
      onDragEnter={isMobileDevice ? undefined : e => { e.preventDefault(); e.stopPropagation(); setIsDragOver(true); }}
      onDragLeave={isMobileDevice ? undefined : e => { if (!e.currentTarget.contains(e.relatedTarget)) setIsDragOver(false); }}
      onDrop={isMobileDevice ? undefined : e => {
        e.preventDefault(); e.stopPropagation(); setIsDragOver(false);
        try {
          const fromStr = e.dataTransfer.getData('application/x-chart-index');
          if (fromStr !== '') { const fi = parseInt(fromStr, 10); if (!isNaN(fi) && fi !== index) { onSwap(fi, index); return; } }
          const raw = e.dataTransfer.getData('application/x-ticker');
          if (raw) { const { symbol } = JSON.parse(raw); onReplace(ticker, normalizeTicker(symbol)); }
        } catch (e) { swallow(e, 'panel.chart.drop_parse'); }
      }}
    >
      {/* Header */}
      <div className="mc-header">
        <span className="mc-ticker">
          {/* #289 part 2 — freshness dot. Hidden during drag swap visual
              so the SWAP/REPLACE prompt isn't competing with it. */}
          {!isDragOver && <FreshnessDot symbol={ticker} style={{ marginRight: 6 }} />}
          {isDragOver ? 'SWAP / REPLACE' : displayTicker(ticker) + (name ? ' · ' + name : '')}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          {(hoverPrice ?? dispPrice) != null && (
            <span className={`mc-price${hoverPrice != null ? ' mc-price--hover' : ''}`}>
              {fmtPrice(hoverPrice ?? dispPrice)}
            </span>
          )}
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
            <AreaChart data={chartBars} margin={{ top: 4, right: 2, bottom: 2, left: 0 }}
              onMouseMove={handleChartMove} onMouseLeave={handleChartLeave}>
              <defs>
                <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={lineColor} stopOpacity={0.18} />
                  <stop offset="95%" stopColor={lineColor} stopOpacity={0.0}  />
                </linearGradient>
              </defs>
              <XAxis dataKey="t" tickFormatter={xFmt} tick={{ fill: 'var(--text-muted)', fontSize: 8.5 }} tickLine={false} axisLine={false} interval={Math.max(0, Math.ceil(chartBars.length / 4) - 1)} height={14} />
              <YAxis orientation="right" domain={['auto','auto']} tickFormatter={fmtK} tick={{ fill: 'var(--text-muted)', fontSize: 8.5 }} tickLine={false} axisLine={false} width={32} />
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
                cursor={{ stroke: 'var(--text-muted)', strokeWidth: 1, strokeDasharray: '2 2' }}
                isAnimationActive={false}
                content={<MiniChartTooltip xFmt={xFmt} openPrice={openPrice} />}
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

function EmptySlot({ index, span = 1, onAdd, onSwap }) {
  const [isDragOver, setIsDragOver] = useState(false);
  return (
    <div
      className={`cp-empty-slot${isDragOver ? ' cp-empty-slot--dragover' : ''}`}
      style={span > 1 ? { gridColumn: `span ${span}` } : undefined}
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
        } catch (e) { swallow(e, 'panel.chart.empty_slot_drop'); }
      }}
    >
      <span className="cp-empty-icon">{isDragOver ? '▼' : '+'}</span>
      {isDragOver && <span className="cp-empty-label">DROP TO ADD</span>}
    </div>
  );
}

// Hardcoded fallback for brand-new users who have NEVER saved a chart grid
// (no URL param, no localStorage, no server settings). If the fallback is ever
// used for an existing user it means their settings row was wiped and we want
// to know about it — every fallback activation logs a warning so we can see it
// in Sentry / the browser console instead of silently overwriting server
// settings with the default list. This was the VGK-keeps-reappearing mystery
// from 2026-04-20 — fresh DB wiped settings, client loaded this list and
// auto-POSTed it back as if it were the user's choice.
const HARDCODED_FALLBACK_GRID = ['SPY', 'QQQ', 'C:EURUSD', 'C:USDJPY', 'GLD', 'USO', 'EEM', 'EWZ', 'X:BTCUSD', 'VGK', 'MSFT', 'BZ=F'];

function ChartPanel({ onGridChange, mobile = false }) {
  // Track where the initial tickers came from so we can decide whether to
  // persist them back to the server. 'url' / 'localStorage' / 'fallback'.
  const initialSourceRef = useRef('fallback');
  const [tickers, setTickers] = useState(() => {
    try {
      const urlParam = mobile ? null : new URLSearchParams(window.location.search).get('c');
      if (urlParam) {
        const fromUrl = urlParam.split(',').map(s => s.trim()).filter(Boolean).slice(0, MAX);
        if (fromUrl.length) { initialSourceRef.current = 'url'; return fromUrl; }
      }
      const _urlC = new URLSearchParams(window.location.search).get('c');
      const _urlGrid = _urlC ? _urlC.split(',').filter(Boolean) : null;
      if (_urlGrid && _urlGrid.length) localStorage.setItem(LS_KEY, JSON.stringify(_urlGrid));
      const v3 = (_urlGrid && _urlGrid.length) ? _urlGrid : JSON.parse(localStorage.getItem(LS_KEY));
      if (Array.isArray(v3) && v3.length) { initialSourceRef.current = 'localStorage'; return v3.slice(0, MAX); }
      const v2 = JSON.parse(localStorage.getItem('chartGrid_v2'));
      if (Array.isArray(v2) && v2.length) { initialSourceRef.current = 'localStorage'; return v2.slice(0, MAX); }
    } catch (e) { swallow(e, 'panel.chart.initial_load'); }
    initialSourceRef.current = 'fallback';
    return HARDCODED_FALLBACK_GRID;
  });

  const [copied,  setCopied]  = useState(false);
  const [showQR,  setShowQR]  = useState(false);
  const [qrUrl,   setQrUrl]   = useState('');
  const gridSyncTimer = useRef(null);
  const pendingSaveRef = useRef(null);

  // POST the grid; on ack, clear the dirty flag ONLY if the grid on disk
  // still matches what we saved (user may have kept editing meanwhile).
  const postGrid = useCallback((grid) => {
    apiFetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chartGrid: grid }),
    })
      .then(r => {
        if (r && r.ok) clearGridDirtyIfSynced(window.localStorage, grid, LS_KEY);
      })
      .catch(() => { /* stay dirty — next edit/mount retries */ });
  }, []);
  // Don't auto-POST to the server until we've heard back from the initial
  // /api/settings GET. Otherwise, on a user whose server settings were wiped
  // (as happened 2026-04-20) the debounced save effect fires with the
  // hardcoded fallback before the GET resolves, and persists the fallback as
  // if it were the user's choice.
  const [serverLoaded, setServerLoaded] = useState(false);
  const serverHadGridRef = useRef(false);

  useEffect(() => {
    if (!mobile) {
      const urlParam = new URLSearchParams(window.location.search).get('c');
      if (urlParam) {
        // URL param takes precedence and shouldn't be persisted automatically;
        // treat as 'loaded' so manual edits after this point do persist.
        setServerLoaded(true);
        return;
      }
    }
    apiFetch('/api/settings')
      .then(r => r.ok ? r.json() : null)
      .then(s => {
        const grid = s?.settings?.chartGrid;
        if (Array.isArray(grid) && grid.length) {
          serverHadGridRef.current = true;
          // BUG 2 guard: while local edits are pending (dirty flag persisted
          // in localStorage, so it survives the Vault/Particle round-trip),
          // the server snapshot is stale by definition — keep local state and
          // let the save effect push it up instead of letting the snapshot
          // clobber the user's adds/removes.
          const { dirty } = readGridMeta(window.localStorage);
          setTickers(prev => {
            const { grid: next } = resolveIncomingServerGrid({
              localGrid: prev, serverGrid: grid, dirty, max: MAX,
            });
            return JSON.stringify(prev) === JSON.stringify(next) ? prev : next;
          });
        } else if (initialSourceRef.current === 'fallback') {
          // Brand new user (or wiped-settings user with no localStorage):
          // they're about to see the hardcoded default. Log it so production
          // sees the signal when it's firing unexpectedly.
          // eslint-disable-next-line no-console
          console.warn('[ChartPanel] no saved grid on server or locally — using hardcoded default (VGK/SPY/QQQ/…). If you did not expect this, your server settings row may be missing.');
        }
      })
      .catch(() => {})
      .finally(() => {
        setServerLoaded(true);
      });
  }, [mobile]);

  // FIX 4 (ux-round4) INVARIANT: ticker clicks elsewhere in the terminal
  // NEVER touch this grid. The old external `ticker` prop effect
  // (replace-primary / promote-on-click) is gone; clicks open the instrument
  // DETAIL view instead (openDetail). The grid changes ONLY through explicit
  // user edits inside this panel: + ADD, the empty slot, drag-and-drop
  // (addTicker / replaceTicker / swapTickers) and × remove.

  useEffect(() => {
    localStorage.setItem(LS_KEY, JSON.stringify(tickers));
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('c', tickers.join(','));
      window.history.replaceState(null, '', url.toString());
    } catch (e) { swallow(e, 'panel.chart.url_sync'); }
    onGridChange?.(tickers.length);
    // Gate the auto-POST on two conditions:
    //   1. Server GET has resolved (serverLoaded).
    //   2. Either the server already had a grid (so we're editing it), OR the
    //      initial source was real user intent (url param or localStorage) —
    //      i.e. NOT the hardcoded fallback. This prevents the "fresh DB wipes
    //      settings → client silently persists fallback as user's preference"
    //      failure mode that produced the mysterious VGK on 2026-04-20.
    if (!serverLoaded) return;
    if (!serverHadGridRef.current && initialSourceRef.current === 'fallback') {
      // User hasn't touched anything yet and server has nothing. Don't persist
      // the fallback — wait for an actual user edit before creating a grid on
      // the server. Any manual add/remove/replace will flip the ref below.
      return;
    }
    clearTimeout(gridSyncTimer.current);
    pendingSaveRef.current = tickers;
    gridSyncTimer.current = setTimeout(() => {
      pendingSaveRef.current = null;
      postGrid(tickers);
    }, 1500);
  }, [tickers, onGridChange, mobile, serverLoaded, postGrid]);

  // BUG 2: flush the debounced save on unmount. Navigating to another view
  // right after an edit used to leave the POST racing the next mount's GET;
  // firing it immediately shrinks that window, and the dirty flag guards
  // whatever race remains.
  useEffect(() => () => {
    if (gridSyncTimer.current) clearTimeout(gridSyncTimer.current);
    if (pendingSaveRef.current) {
      const grid = pendingSaveRef.current;
      pendingSaveRef.current = null;
      postGrid(grid);
    }
  }, [postGrid]);

  // Any user edit promotes the grid from "fallback shown on screen" to
  // "real user state worth persisting" — flip the ref so the save effect
  // stops skipping the POST — and marks the grid dirty (persisted) so a
  // stale server snapshot can't clobber the edit after a remount.
  const markUserEdit = useCallback(() => {
    serverHadGridRef.current = true;
    try { markGridDirty(window.localStorage); } catch { /* storage optional */ }
  }, []);

  const addTicker     = useCallback((raw)       => { const norm = normalizeTicker(raw);  markUserEdit(); setTickers(prev => prev.includes(norm) || prev.length >= MAX ? prev : [...prev, norm]); }, [markUserEdit]);
  const removeTicker  = useCallback((t)          => { markUserEdit(); setTickers(prev => prev.filter(x => x !== t)); }, [markUserEdit]);
  const replaceTicker = useCallback((old, nw)    => { markUserEdit(); setTickers(prev => prev.map(x => x === old ? nw : x)); }, [markUserEdit]);
  const swapTickers   = useCallback((fromIdx, toIdx) => {
    markUserEdit();
    setTickers(prev => {
      if (fromIdx === toIdx) return prev;
      const arr = [...prev];
      if (toIdx < arr.length) { [arr[fromIdx], arr[toIdx]] = [arr[toIdx], arr[fromIdx]]; }
      else { const item = arr.splice(fromIdx, 1)[0]; arr.push(item); }
      return arr;
    });
  }, [markUserEdit]);

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
    } catch (e) { swallow(e, 'panel.chart.copy_link'); }
  }, [tickers, qrCodeUrl]);

  const outerDrop = {
    onDragOver: e => e.preventDefault(),
    onDrop: e => {
      e.preventDefault();
      try {
        if (e.dataTransfer.getData('application/x-chart-index')) return;
        const raw = e.dataTransfer.getData('application/x-ticker');
        if (raw) { const { symbol } = JSON.parse(raw); addTicker(symbol); }
      } catch (e) { swallow(e, 'panel.chart.outer_drop'); }
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
      {/* H1.1 shared chrome (desktop; mobile header below keeps its own markup) */}
      <PanelChrome
        title="CHARTS"
        subtitle={`${tickers.length}/${MAX} // drag to reorder · drop to add`}
        actions={tickers.length < MAX ? (
          <>
            {showAddInput && (
              <input
                value={addInput}
                onChange={e => setAddInput(e.target.value.toUpperCase())}
                onKeyDown={e => { if (e.key === 'Enter' && addInput.trim()) { addTicker(addInput.trim()); setAddInput(''); setShowAddInput(false); } }}
                placeholder="TICKER"
                className="cp-header-add-input"
                autoFocus
              />
            )}
            <button
              onClick={() => {
                if (showAddInput && addInput.trim()) { addTicker(addInput.trim()); setAddInput(''); }
                setShowAddInput(v => !v);
              }}
              className={`cp-add-btn${showAddInput ? ' cp-add-btn--open' : ''}`}
            >+ ADD</button>
          </>
        ) : null}
      />
      {(() => {
        const { cols, rows } = gridDims(tickers.length);
        // Cells left over in the last row after all charts are placed. The
        // add-tile stretches across ALL of them so the grid never shows a
        // blank cell; if there are none (count divides evenly, or MAX) the
        // add-tile is omitted entirely — the header + ADD button and
        // drag-drop remain as add entry points, and no extra row is created.
        const leftover = tickers.length % cols === 0 ? 0 : cols - (tickers.length % cols);
        const showAddTile = tickers.length < MAX && leftover > 0;
        return (
          <div
            className="cp-grid cp-grid--desktop"
            style={{ gridTemplateColumns: `repeat(${cols}, 1fr)`, gridTemplateRows: `repeat(${rows}, 1fr)` }}
          >
            {tickers.map((t, i) => (
              <MiniChart key={t} ticker={t} index={i} onRemove={removeTicker} onReplace={replaceTicker} onSwap={swapTickers} />
            ))}
            {showAddTile && <EmptySlot index={tickers.length} span={leftover} onAdd={addTicker} onSwap={swapTickers} />}
          </div>
        );
      })()}
    </div>
  );
}

export { ChartPanel };
export default memo(ChartPanel);
