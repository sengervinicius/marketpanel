/**
 * WatchlistPanel.jsx — Phase 9.2 unified Watchlist + Portfolio panel,
 * restyled per Design v1 "Watchlist with Depth" (approved mockup
 * particle-home-design-review.html, section 3).
 *
 * Named column VIEWS (replaces the COLS picker), persisted in
 * localStorage 'wlView_v1':
 *   TRADER      — LAST · CHG% · SPARK · VOL×AVG · NEXT EARN · REC
 *   FUNDAMENTAL — LAST · CHG% · MKT CAP · P/E · EV/EBITDA (else P/S) ·
 *                 DIV YLD · NEXT EARN
 *   P&L         — the existing P&L columns (LAST · CHG% · P&L% · SPARK)
 *
 * Depth behaviours:
 *   · VOL×AVG = todayVolume / averageDailyVolume3Month ("1.4×"); ≥2×
 *     renders accent. Fields ride the /api/snapshot/tickers batch.
 *   · NEXT EARN within 7 days → accent. REC = 46×8 buy/hold/sell bar.
 *   · Ticker cell = mono bold symbol + muted name below (batch name).
 *   · 300ms hover → mini-profile card (pointer-events:none — it can
 *     never block clicks); row CLICK opens the full InstrumentDetail
 *     (was double-click). Alt/Ctrl/Meta-click still edits the position.
 *   · Non-equities show "—" for equity-only columns. All hover data is
 *     lazy + cached (one fundamentals / news-count fetch per symbol per
 *     session).
 *
 * Everything else from Phase 9.2 is preserved: PositionEditor, P&L
 * summary strip, AI Health Check, sort modes, drag-drop, share, "why is
 * X moving?".
 */

import { useState, useEffect, useRef, useCallback, useMemo, memo } from 'react';
import { usePortfolio } from '../../context/PortfolioContext';
import { useOpenDetail } from '../../context/OpenDetailContext';
import { useTickerPrice } from '../../context/PriceContext';
import { apiFetch, apiJSON } from '../../utils/api';
import EmptyState from '../common/EmptyState';
import PanelShell from '../common/PanelShell';
import PanelChrome from '../common/PanelChrome';
import PositionEditor from '../common/PositionEditor';
import ShareModal from '../common/ShareModal';
import { fmt, fmtPct, fmtCompact } from '../../utils/portfolioAnalytics';
import { SyncBadge, AIHealthCard, SummaryStrip } from './PortfolioPanelWidgets';
import Sparkline from '../common/Sparkline';
import { useSparklineData } from '../../hooks/useSparklineData';
import '../common/Shimmer.css';
import './WatchlistPanel.css';

// ── Named column VIEWS (Design v1) ──────────────────────────────────
const WL_VIEW_KEY = 'wlView_v1';
const VIEWS = [
  { key: 'trader',      label: 'TRADER' },
  { key: 'fundamental', label: 'FUNDAMENTAL' },
  { key: 'pnl',         label: 'P&L' },
];

function loadView() {
  try {
    const v = localStorage.getItem(WL_VIEW_KEY);
    return VIEWS.some(x => x.key === v) ? v : 'trader';
  } catch { return 'trader'; }
}

// Grid templates per view (ticker | LAST | … | actions).
const GRID = {
  trader:      'minmax(84px,1.2fr) 1fr 54px 62px 52px 52px 50px 58px',
  fundamental: 'minmax(84px,1.2fr) 1fr 50px 58px 42px 56px 46px 52px 58px',
  pnl:         'minmax(84px,1.2fr) 1fr 60px 60px 64px 58px',
};

const EXTRA_SYMBOL_CAP = 30; // server batch cap for the extras endpoints

function fmtEarnDate(iso) {
  if (!iso) return null;
  const d = new Date(iso + 'T00:00:00');
  if (isNaN(d)) return null;
  return `${d.toLocaleString('en-US', { month: 'short' }).toUpperCase()} ${d.getDate()}`;
}

function fmtRatio(v, dp = 1) {
  return v != null && isFinite(v) ? `${v.toFixed(dp)}×` : '—';
}

function fmtYieldPct(frac) {
  if (frac == null || !isFinite(frac)) return '—';
  // Yahoo serves dividend yield as a fraction (0.084 → 8.4%).
  const pct = frac < 1 ? frac * 100 : frac;
  return `${pct.toFixed(1)}%`;
}

const showInfo = (e, symbol, label, type) => {
  e.preventDefault();
  window.dispatchEvent(new CustomEvent('ticker:rightclick', {
    detail: { symbol, label, type, x: e.clientX + 6, y: e.clientY + 6 },
  }));
};

function assetTypeFromSymbol(sym) {
  const s = (sym || '').toUpperCase();
  if (s.endsWith('.SA')) return 'BR';
  if (/^(BTC|ETH|SOL|XRP|BNB|DOGE|ADA|DOT|AVAX|MATIC)USD$/.test(s) || s.startsWith('X:')) return 'CRYPTO';
  if (/^[A-Z]{6}$/.test(s) || s.startsWith('C:')) return 'FX';
  if (s.includes('=')) return 'FUT';
  return 'EQUITY';
}

const isEquityType = t => t === 'EQUITY' || t === 'BR';

const EMPTY_CELL = <span className="wp-row-extra wp-row-extra--empty">—</span>;

// ── REC bar: 46×8 horizontal buy/hold/sell widths ───────────────────
function RecBar({ rec }) {
  if (!rec) return EMPTY_CELL;
  const total = (rec.buy || 0) + (rec.hold || 0) + (rec.sell || 0);
  if (!total) return EMPTY_CELL;
  const w = n => `${((n || 0) / total) * 100}%`;
  return (
    <span
      className="wp-recbar"
      title={`Analyst recs${rec.period ? ` (${rec.period})` : ''}: ${rec.buy} buy · ${rec.hold} hold · ${rec.sell} sell`}
    >
      <i className="wp-recbar-buy"  style={{ width: w(rec.buy) }} />
      <i className="wp-recbar-hold" style={{ width: w(rec.hold) }} />
      <i className="wp-recbar-sell" style={{ width: w(rec.sell) }} />
    </span>
  );
}

// ── Hover mini-profile card (Fey pattern) ───────────────────────────
// pointer-events:none (CSS) — the card can NEVER intercept row clicks.
function HoverCard({ sym, top, snap, fund, newsCount, price }) {
  const f = fund && typeof fund === 'object' && !fund._error ? fund : null;
  const fLoading = fund === 'loading';
  const name = snap?.name || '';

  const evEbitda = f && f.enterpriseValue != null && f.ebitda ? f.enterpriseValue / f.ebitda : null;
  const ps = f?.priceToSales ?? null;
  const pe = f?.peRatio ?? snap?.fund?.trailingPE ?? null;
  const multiLabel = evEbitda != null ? 'P/E · EV/EBITDA' : ps != null ? 'P/E · P/S' : 'P/E';
  const multiVal = [
    pe != null ? `${pe.toFixed(1)}×` : '—',
    evEbitda != null ? `${evEbitda.toFixed(1)}×` : ps != null ? `${ps.toFixed(1)}×` : null,
  ].filter(Boolean).join(' · ');

  const mktCap = f?.marketCap ?? snap?.fund?.marketCap ?? null;
  const divYield = f?.dividendYield ?? snap?.fund?.divYield ?? null;
  const lo = f?.fiftyTwoWeekLow ?? snap?.fund?.fiftyTwoWeekLow ?? null;
  const hi = f?.fiftyTwoWeekHigh ?? snap?.fund?.fiftyTwoWeekHigh ?? null;
  const rangePos = lo != null && hi != null && hi > lo && price != null
    ? Math.min(1, Math.max(0, (price - lo) / (hi - lo)))
    : null;

  return (
    <div className="wp-hcard" style={{ top }}>
      <div className="wp-hcard-title">{sym}{name ? ` · ${name.toUpperCase()}` : ''}</div>
      <div className="wp-hcard-row"><span>Mkt cap</span><b>{mktCap != null ? fmtCompact(mktCap) : fLoading ? '…' : '—'}</b></div>
      <div className="wp-hcard-row"><span>{multiLabel}</span><b>{multiVal || (fLoading ? '…' : '—')}</b></div>
      <div className="wp-hcard-row"><span>Div yield</span><b>{divYield != null ? fmtYieldPct(divYield) : fLoading ? '…' : '—'}</b></div>
      <div className="wp-hcard-row">
        <span>52w range</span>
        <b>
          {lo != null && hi != null ? `${fmt(lo)} — ${fmt(hi)}` : fLoading ? '…' : '—'}
          {rangePos != null && (
            <span className="wp-hcard-range"><i style={{ left: `${rangePos * 100}%` }} /></span>
          )}
        </b>
      </div>
      <div className="wp-hcard-row"><span>News (7d)</span><b>{newsCount == null ? '…' : `${newsCount} stor${newsCount === 1 ? 'y' : 'ies'}`}</b></div>
      <div className="wp-hcard-row wp-hcard-footer"><span>click row → full instrument view ↗</span></div>
    </div>
  );
}

// ── Individual row ──────────────────────────────────────────────────
// #290 part 2 — prices come from PriceContext only (single source of truth).
const WatchlistRow = memo(function WatchlistRow({
  position, view, sparkData, onOpen, onEdit, onRemove, onWhy, onReportPrice,
  onHoverStart, onHoverEnd, snap = null, earn = null, rec = null, fund = null,
}) {
  const priceCtx = useTickerPrice(position.symbol);
  const ptRef    = useRef(null);

  const price     = priceCtx?.price     ?? null;
  const changePct = priceCtx?.changePct ?? null;

  useEffect(() => {
    if (price != null) {
      onReportPrice(position.symbol, { price, changePct, change: priceCtx?.change ?? null });
    }
  }, [price, changePct, position.symbol, priceCtx, onReportPrice]);

  const isTracked = position.entryPrice != null && position.quantity != null;
  const pnlPct = (isTracked && price && position.entryPrice > 0)
    ? ((price - position.entryPrice) / position.entryPrice) * 100
    : null;

  const assetType = assetTypeFromSymbol(position.symbol);
  const equity    = isEquityType(assetType);
  const pos       = (changePct ?? 0) >= 0;

  // VOL×AVG — today's volume vs 3-month average daily volume.
  const volRatio = snap?.vol > 0 && snap?.avgVolume3M > 0 ? snap.vol / snap.avgVolume3M : null;

  // FUNDAMENTAL cells (deep fund = /api/market/fundamentals, lazy+cached).
  const deep = fund && fund !== 'loading' && !fund._error ? fund : null;
  const mktCap = deep?.marketCap ?? snap?.fund?.marketCap ?? null;
  const pe = deep?.peRatio ?? snap?.fund?.trailingPE ?? null;
  const evEbitda = deep && deep.enterpriseValue != null && deep.ebitda ? deep.enterpriseValue / deep.ebitda : null;
  const ps = deep?.priceToSales ?? null;
  const divYield = deep?.dividendYield ?? snap?.fund?.divYield ?? null;

  const earnCell = equity ? (
    <span
      className={`wp-row-extra${earn?.date ? '' : ' wp-row-extra--empty'}${earn?.daysUntil != null && earn.daysUntil <= 7 ? ' wp-row-extra--soon' : ''}`}
      title={earn?.date ? `Next earnings ${earn.date}${earn.daysUntil != null ? ` · in ${earn.daysUntil}d` : ''}` : 'No upcoming earnings found'}
    >
      {fmtEarnDate(earn?.date) || '—'}
    </span>
  ) : EMPTY_CELL;

  return (
    <div
      data-ticker={position.symbol}
      data-ticker-label={position.symbol}
      data-ticker-type={assetType}
      onClick={(e) => {
        if (e.ctrlKey || e.altKey || e.metaKey) onEdit(position);
        else onOpen(position.symbol); // Design v1: click → full InstrumentDetail
      }}
      onMouseEnter={(e) => onHoverStart(position.symbol, e)}
      onMouseLeave={onHoverEnd}
      onContextMenu={e => showInfo(e, position.symbol, position.symbol, assetType)}
      onTouchStart={(e) => { e.stopPropagation(); clearTimeout(ptRef.current); ptRef.current = setTimeout(() => onOpen(position.symbol), 500); }}
      onTouchEnd={() => clearTimeout(ptRef.current)}
      onTouchMove={() => clearTimeout(ptRef.current)}
      className="wp-row"
      style={{ gridTemplateColumns: GRID[view] }}
      title={isTracked
        ? `${position.quantity} @ ${fmt(position.entryPrice)} · cost ${fmtCompact((position.quantity || 0) * (position.entryPrice || 0))} · click for instrument view`
        : 'Click → full instrument view · Alt+click to add position details'}
    >
      {/* Ticker cell: mono bold symbol + muted name below (mockup) */}
      <span className="wp-row-ticker">
        <span className="wp-row-symbol">{position.symbol}</span>
        <span className="wp-row-name">{snap?.name || ''}</span>
      </span>
      <span className="wp-row-price">{fmt(price)}</span>
      <span className={`wp-row-change ${pos ? 'wp-row-change-positive' : 'wp-row-change-negative'}`}>
        {fmtPct(changePct)}
      </span>

      {view === 'pnl' && (
        <span className={`wp-row-pnl ${
          pnlPct == null ? 'wp-row-pnl-neutral'
          : pnlPct >= 0   ? 'wp-row-pnl-positive'
                          : 'wp-row-pnl-negative'
        }`}>
          {pnlPct == null ? '—' : fmtPct(pnlPct)}
        </span>
      )}

      {view === 'trader' && (
        <span className="wp-row-spark">
          {sparkData && sparkData.length >= 2 && (
            <Sparkline data={sparkData} width={56} height={14} />
          )}
        </span>
      )}

      {view === 'trader' && (
        volRatio != null ? (
          <span
            className={`wp-row-extra wp-row-vol${volRatio >= 2 ? ' wp-row-vol--hot' : ''}`}
            title={`Today's volume vs 3-month average${volRatio >= 2 ? ' — unusually active' : ''}`}
          >{fmtRatio(volRatio)}</span>
        ) : EMPTY_CELL
      )}

      {view === 'trader' && earnCell}
      {view === 'trader' && (equity ? <span className="wp-row-extra">{rec ? <RecBar rec={rec} /> : '—'}</span> : EMPTY_CELL)}

      {view === 'fundamental' && (
        (equity || assetType === 'CRYPTO') && mktCap != null
          ? <span className="wp-row-extra">{fmtCompact(mktCap)}</span>
          : EMPTY_CELL
      )}
      {view === 'fundamental' && (
        equity && pe != null ? <span className="wp-row-extra">{pe.toFixed(1)}</span> : EMPTY_CELL
      )}
      {view === 'fundamental' && (
        equity
          ? (evEbitda != null
              ? <span className="wp-row-extra" title="EV/EBITDA">{evEbitda.toFixed(1)}</span>
              : ps != null
                ? <span className="wp-row-extra" title="P/S (EV/EBITDA unavailable)">{ps.toFixed(1)}</span>
                : fund === 'loading' ? <span className="wp-row-extra wp-row-extra--empty">…</span> : EMPTY_CELL)
          : EMPTY_CELL
      )}
      {view === 'fundamental' && (
        equity && divYield != null ? <span className="wp-row-extra">{fmtYieldPct(divYield)}</span> : EMPTY_CELL
      )}
      {view === 'fundamental' && earnCell}

      {view === 'pnl' && (
        <span className="wp-row-spark">
          {sparkData && sparkData.length >= 2 && (
            <Sparkline data={sparkData} width={56} height={14} />
          )}
        </span>
      )}

      <div className="wp-row-actions">
        <button className="btn wp-icon-btn" title="Why is this moving?"
          onClick={e => { e.stopPropagation(); onWhy(position.symbol); }}
        >?</button>
        <button className="btn wp-icon-btn" title="Add/edit position details"
          onClick={e => { e.stopPropagation(); onEdit(position); }}
        ><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg></button>
        <button className="btn wp-icon-btn wp-remove-btn" title="Remove"
          onClick={e => { e.stopPropagation(); onRemove(position.id); }}
        ><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
      </div>
    </div>
  );
});

// Column headers per view (mono 8.5px uppercase — CSS).
const HEADERS = {
  trader:      ['TICKER', 'LAST', 'CHG%', 'SPARK', 'VOL×AVG', 'NEXT EARN', 'REC', ''],
  fundamental: ['TICKER', 'LAST', 'CHG%', 'MKT CAP', 'P/E', 'EV/EBITDA', 'DIV YLD', 'NEXT EARN', ''],
  pnl:         ['TICKER', 'LAST', 'CHG%', 'P&L%', 'SPARK', ''],
};

// ── Main panel ──────────────────────────────────────────────────────
function WatchlistPanel() {
  const {
    positions, portfolios, addTicker, removePosition,
    syncStatus, retrySync,
  } = usePortfolio();
  const openDetail = useOpenDetail();

  // UI state
  const [sortMode, setSortMode] = useState('default'); // 'default' | 'heat' | 'pnl'
  // Design v1 — named column views, persisted.
  const [view, setViewState] = useState(loadView);
  const setView = useCallback((v) => {
    setViewState(v);
    try { localStorage.setItem(WL_VIEW_KEY, v); } catch { /* private mode */ }
  }, []);
  const [showAdd, setShowAdd]   = useState(false);
  const [addInput, setAddInput] = useState('');
  const inputRef                = useRef(null);

  // Position editor modal
  const [editorPos, setEditorPos] = useState(null);
  const [showEditor, setShowEditor] = useState(false);

  // Share modal
  const [shareOpen, setShareOpen] = useState(false);

  // Why-is-it-moving popover
  const [whySymbol, setWhySymbol] = useState(null);
  const [whySummary, setWhySummary] = useState(null);
  const [whyLoading, setWhyLoading] = useState(false);
  const [whyError, setWhyError] = useState(null);

  // AI Health Check
  const [aiInsight, setAiInsight] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError]     = useState(null);

  // Price snapshot from rows for summary + AI
  const priceSnapshotRef = useRef({});
  const [priceSnapshot, setPriceSnapshot] = useState({});
  const reportPrice = useCallback((symbol, data) => {
    if (data && data.price != null) priceSnapshotRef.current[symbol] = data;
  }, []);
  useEffect(() => {
    const id = setInterval(() => setPriceSnapshot({ ...priceSnapshotRef.current }), 2000);
    return () => clearInterval(id);
  }, []);
  const getPriceData = useCallback(sym => priceSnapshot[sym] || null, [priceSnapshot]);

  // ── Drop handler ────────────────────────────────────────────────
  const handleDropTicker = useCallback((ticker) => {
    if (ticker) addTicker(ticker);
  }, [addTicker]);

  // ── Add ticker form ─────────────────────────────────────────────
  useEffect(() => {
    if (showAdd) setTimeout(() => inputRef.current?.focus(), 50);
  }, [showAdd]);

  const handleAdd = (e) => {
    e.preventDefault();
    const sym = addInput.trim().toUpperCase();
    if (sym) { addTicker(sym); setAddInput(''); setShowAdd(false); }
  };

  // ── Position editor handlers ────────────────────────────────────
  const handleEdit = useCallback((position) => {
    setEditorPos(position);
  }, []);

  const handleCloseEditor = useCallback(() => {
    setEditorPos(null);
    setShowEditor(false);
  }, []);

  const handleRemove = useCallback((id) => {
    removePosition(id);
  }, [removePosition]);

  // ── Why is X moving ─────────────────────────────────────────────
  const handleWhy = useCallback(async (symbol) => {
    setWhySymbol(symbol);
    setWhyLoading(true);
    setWhyError(null);
    setWhySummary(null);
    try {
      const query = `Why is ${symbol} moving today? What are the latest catalysts and news driving ${symbol} price action?`;
      const res = await apiFetch('/api/search/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      });
      const json = await res.json();
      if (!res.ok) { setWhyError(json.error || 'Failed to fetch analysis'); return; }
      setWhySummary(json.summary || '');
    } catch (err) {
      setWhyError(err.message || 'Error fetching analysis');
    } finally {
      setWhyLoading(false);
    }
  }, []);

  // ── Tracked positions / sparklines ──────────────────────────────
  const trackedPositions = useMemo(
    () => positions.filter(p => p.entryPrice != null && p.quantity != null),
    [positions]
  );
  const watchSymbols = useMemo(() => positions.map(p => p.symbol), [positions]);
  const rowSparklines = useSparklineData(watchSymbols);
  const anyTracked = trackedPositions.length > 0;

  const symbolsKey = useMemo(
    () => watchSymbols.slice(0, EXTRA_SYMBOL_CAP).join(','),
    [watchSymbols]
  );

  // ── Snapshot batch (name, volume, avg volume, v7 fundamentals) ──
  // Same 60s cadence the old EXT column used; powers VOL×AVG, the
  // ticker-cell name and the FUNDAMENTAL basics. SYM → { name, vol,
  // avgVolume3M, fund }.
  const [snapData, setSnapData] = useState({});
  useEffect(() => {
    if (!symbolsKey) return undefined;
    let alive = true;
    const load = async () => {
      try {
        const res = await apiFetch(`/api/snapshot/tickers?symbols=${encodeURIComponent(symbolsKey)}`);
        if (!res.ok) return;
        const json = await res.json();
        if (!alive || !json?.results) return;
        const map = {};
        for (const [sym, entry] of Object.entries(json.results)) {
          const t = entry?.ticker;
          if (!t) continue;
          map[sym] = {
            name: t.name || null,
            vol: t.day?.v ?? null,
            avgVolume3M: t.avgVolume3M ?? null,
            fund: t.fund || null,
          };
        }
        setSnapData(map);
      } catch { /* degrade to em-dash */ }
    };
    load();
    const id = setInterval(load, 60_000);
    return () => { alive = false; clearInterval(id); };
  }, [symbolsKey]);

  // ── NEXT EARN / REC — server caches 12h; one fetch per symbol set ──
  const [earnData, setEarnData] = useState({});
  const [recData,  setRecData]  = useState({});
  const needEarn = view === 'trader' || view === 'fundamental';
  useEffect(() => {
    if (!needEarn || !symbolsKey) return undefined;
    let alive = true;
    apiFetch(`/api/market/next-earnings?symbols=${encodeURIComponent(symbolsKey)}`)
      .then(r => (r.ok ? r.json() : null))
      .then(j => { if (alive && j?.ok) setEarnData(j.data || {}); })
      .catch(() => { /* degrade to em-dash */ });
    return () => { alive = false; };
  }, [needEarn, symbolsKey]);

  useEffect(() => {
    if (view !== 'trader' || !symbolsKey) return undefined;
    let alive = true;
    apiFetch(`/api/market/rec-trends?symbols=${encodeURIComponent(symbolsKey)}`)
      .then(r => (r.ok ? r.json() : null))
      .then(j => { if (alive && j?.ok) setRecData(j.data || {}); })
      .catch(() => { /* degrade to em-dash */ });
    return () => { alive = false; };
  }, [view, symbolsKey]);

  // ── Deep fundamentals (EV/EBITDA · P/S · 52w) — lazy + cached ────
  // One /api/market/fundamentals/:symbol fetch per symbol per session,
  // triggered by the FUNDAMENTAL view (queued, max 3 in flight) or the
  // first hover on a row. Never polled.
  const fundCacheRef = useRef(new Map()); // SYM → promise
  const [fundData, setFundData] = useState({}); // SYM → object | 'loading' | { _error }
  const loadFund = useCallback((sym) => {
    if (!sym || !isEquityType(assetTypeFromSymbol(sym))) return;
    const cache = fundCacheRef.current;
    if (cache.has(sym)) return;
    const p = (async () => {
      setFundData(prev => ({ ...prev, [sym]: 'loading' }));
      try {
        const res = await apiFetch(`/api/market/fundamentals/${encodeURIComponent(sym)}`);
        const json = res.ok ? await res.json() : null;
        setFundData(prev => ({ ...prev, [sym]: json || { _error: true } }));
      } catch {
        setFundData(prev => ({ ...prev, [sym]: { _error: true } }));
      }
    })();
    cache.set(sym, p);
  }, []);

  useEffect(() => {
    if (view !== 'fundamental') return undefined;
    // Queue the watchlist symbols 3-at-a-time to avoid provider bursts.
    let cancelled = false;
    const pending = watchSymbols
      .slice(0, EXTRA_SYMBOL_CAP)
      .filter(s => isEquityType(assetTypeFromSymbol(s)) && !fundCacheRef.current.has(s));
    (async () => {
      for (let i = 0; i < pending.length && !cancelled; i += 3) {
        pending.slice(i, i + 3).forEach(loadFund);
        // Wait for the chunk before launching the next.
        await Promise.allSettled(pending.slice(i, i + 3).map(s => fundCacheRef.current.get(s)));
      }
    })();
    return () => { cancelled = true; };
  }, [view, watchSymbols, loadFund]);

  // ── News count 7d — lazy on first hover, cached per symbol ──────
  const newsCountCacheRef = useRef(new Map());
  const [newsCounts, setNewsCounts] = useState({});
  const loadNewsCount = useCallback((sym) => {
    const cache = newsCountCacheRef.current;
    if (cache.has(sym)) return;
    const p = (async () => {
      try {
        const res = await apiFetch(`/api/news?tickers=${encodeURIComponent(sym)}&limit=50`);
        const json = res.ok ? await res.json() : null;
        const items = Array.isArray(json) ? json : (json?.results || []);
        const weekAgo = Date.now() - 7 * 86400000;
        const count = items.filter(n => {
          const t = n.published_utc ? new Date(n.published_utc).getTime() : null;
          return t == null || t >= weekAgo;
        }).length;
        setNewsCounts(prev => ({ ...prev, [sym]: count }));
      } catch {
        setNewsCounts(prev => ({ ...prev, [sym]: 0 }));
      }
    })();
    cache.set(sym, p);
  }, []);

  // ── Hover mini-profile card (300ms) ─────────────────────────────
  const rowsRef = useRef(null);
  const hoverTimerRef = useRef(null);
  const [hover, setHover] = useState(null); // { sym, top }
  const handleHoverStart = useCallback((sym, e) => {
    clearTimeout(hoverTimerRef.current);
    const rowEl = e.currentTarget;
    hoverTimerRef.current = setTimeout(() => {
      const cont = rowsRef.current;
      if (!cont || !rowEl.isConnected) return;
      const rowRect = rowEl.getBoundingClientRect();
      const contRect = cont.getBoundingClientRect();
      let top = rowRect.bottom - contRect.top + cont.scrollTop - 2;
      // Keep the ~168px card inside the scroll area.
      top = Math.min(top, cont.scrollTop + cont.clientHeight - 172);
      setHover({ sym, top: Math.max(top, cont.scrollTop + 2) });
      // Lazy data: fundamentals + news count, both cached per session.
      loadFund(sym);
      loadNewsCount(sym);
    }, 300);
  }, [loadFund, loadNewsCount]);
  const handleHoverEnd = useCallback(() => {
    clearTimeout(hoverTimerRef.current);
    setHover(null);
  }, []);
  useEffect(() => () => clearTimeout(hoverTimerRef.current), []);

  // ── Open the full instrument view (row click) ───────────────────
  const handleOpen = useCallback((sym) => {
    handleHoverEnd();
    openDetail(sym);
  }, [openDetail, handleHoverEnd]);

  // ── AI Health Check ─────────────────────────────────────────────
  const handleAIHealthCheck = useCallback(async () => {
    if (trackedPositions.length === 0) {
      setAiError('Add at least one position with qty + entry to run the AI health check.');
      return;
    }
    setAiLoading(true);
    setAiError(null);
    setAiInsight(null);

    try {
      let totalValue = 0;
      const positionsData = trackedPositions.map(pos => {
        const pd = getPriceData(pos.symbol) || {};
        const cur = pd.price ?? pos.entryPrice ?? 0;
        const val = (pos.quantity || 0) * cur;
        totalValue += val;
        return {
          symbol: pos.symbol,
          weight: val,
          returnPct: pos.entryPrice ? ((cur - pos.entryPrice) / pos.entryPrice) * 100 : 0,
          sector: pos.sector || 'Unknown',
        };
      });
      if (totalValue > 0) positionsData.forEach(p => { p.weight = p.weight / totalValue; });

      // #291 W1.12 — 30s timeout with a friendlier error than apiFetch's.
      const abortCtrl = new AbortController();
      const timeoutId = setTimeout(() => abortCtrl.abort(), 30_000);
      try {
        const response = await apiJSON('/api/search/portfolio-insight', {
          method: 'POST',
          body: JSON.stringify({ positions: positionsData, totalValue }),
          signal: abortCtrl.signal,
        });
        setAiInsight(response);
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        setAiError('Health check timed out after 30s. The AI service may be busy — try again in a moment.');
      } else {
        setAiError(err.message || 'Failed to analyze portfolio');
      }
    } finally {
      setAiLoading(false);
    }
  }, [trackedPositions, getPriceData]);

  const handleAIRetry = useCallback(() => handleAIHealthCheck(), [handleAIHealthCheck]);
  const handleAIClose = useCallback(() => {
    setAiInsight(null); setAiError(null); setAiLoading(false);
  }, []);

  // ── Sorting ─────────────────────────────────────────────────────
  const sortedPositions = useMemo(() => {
    if (sortMode === 'default') return positions;
    const scored = positions.map(p => {
      const pd  = getPriceData(p.symbol);
      const chg = pd?.changePct ?? 0;
      const px  = pd?.price ?? null;
      const pnl = (px != null && p.entryPrice != null && p.entryPrice > 0)
        ? ((px - p.entryPrice) / p.entryPrice) * 100 : null;
      return { ...p, _chg: chg, _pnl: pnl };
    });
    if (sortMode === 'heat') {
      return scored.sort((a, b) => Math.abs(b._chg) - Math.abs(a._chg));
    }
    return scored.sort((a, b) => {
      if (a._pnl != null && b._pnl != null) return b._pnl - a._pnl;
      if (a._pnl != null) return -1;
      if (b._pnl != null) return 1;
      return Math.abs(b._chg) - Math.abs(a._chg);
    });
  }, [positions, sortMode, getPriceData]);

  // ── Render ──────────────────────────────────────────────────────
  const sortBtn = (key, label) => (
    <button
      key={key}
      className={`wp-sort-btn ${sortMode === key ? 'wp-sort-btn-active' : ''}`}
      onClick={() => setSortMode(key)}
      title={`Sort: ${label}`}
    >{label}</button>
  );

  const hoverSnap = hover ? snapData[hover.sym] : null;

  return (
    <PanelShell onDropTicker={handleDropTicker}>
      <PanelChrome
        title="WATCHLIST"
        count={positions.length}
        subtitle={anyTracked ? `${trackedPositions.length} tracked` : null}
        status={<SyncBadge syncStatus={syncStatus} onRetry={retrySync} />}
        actions={(
          <>
            {/* Sort toggle */}
            <div className="wp-sort-group" role="tablist">
              {sortBtn('default', 'ORDER')}
              {sortBtn('heat',    'HEAT')}
            </div>
            {/* Design v1 — named column VIEWS (replaces the COLS picker) */}
            <div className="wp-view-group" role="group" aria-label="Column view">
              {VIEWS.map(v => (
                <button
                  key={v.key}
                  className={`wp-view-chip ${view === v.key ? 'wp-view-chip--on' : ''}`}
                  onClick={() => setView(v.key)}
                  title={`${v.label} column view`}
                >{view === v.key ? `VIEW: ${v.label}` : v.label}</button>
              ))}
            </div>
            {/* AI Health Check — only when tracked positions exist */}
            {anyTracked && (
              <button
                className="wp-ai-btn"
                onClick={handleAIHealthCheck}
                disabled={aiLoading}
                title="AI health check on tracked positions"
              >{aiLoading ? 'ANALYZING…' : '◆ AI'}</button>
            )}
            <button className="btn wp-add-btn" onClick={() => setShareOpen(true)} title="Share">SHARE</button>
            <button
              className={`btn wp-add-btn ${showAdd ? 'wp-add-btn-active' : ''}`}
              onClick={() => setShowAdd(s => !s)}
            >+ ADD</button>
          </>
        )}
      />

      {/* Quick-add input */}
      {showAdd && (
        <form onSubmit={handleAdd} className="flex-row wp-add-form">
          <input
            ref={inputRef}
            value={addInput}
            onChange={e => setAddInput(e.target.value.toUpperCase())}
            placeholder="e.g. AAPL, PETR4.SA, BTCUSD"
            className="wp-add-input"
          />
          <button className="btn wp-add-submit-btn" type="submit">ADD</button>
          <button className="btn wp-add-submit-btn" type="button"
            onClick={() => { setShowEditor(true); setShowAdd(false); setAddInput(''); }}
            title="Add a position with qty + entry"
          >+ POSITION</button>
          <button className="btn wp-add-cancel-btn" type="button"
            onClick={() => { setShowAdd(false); setAddInput(''); }}
          ><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
        </form>
      )}

      {/* AI Health Card (appears after Run) */}
      <AIHealthCard
        aiInsight={aiInsight}
        aiLoading={aiLoading}
        aiError={aiError}
        onRetry={handleAIRetry}
        onClose={handleAIClose}
      />

      {/* Summary strip — only when at least one tracked position */}
      {anyTracked && (
        <SummaryStrip
          positions={trackedPositions}
          getPriceData={getPriceData}
          portfolios={portfolios}
          benchmarkSymbol={null}
          benchmarkData={null}
        />
      )}

      {/* Column headers */}
      <div className="wp-col-header" style={{ gridTemplateColumns: GRID[view] }}>
        {HEADERS[view].map((h, i) => (
          <span
            key={`${h}-${i}`}
            className={`wp-col-header-cell${i > 0 ? ' wp-col-header-right' : ''}`}
          >{h}</span>
        ))}
      </div>

      {/* Rows */}
      <div className="wp-rows-container" ref={rowsRef}>
        {positions.length === 0 ? (
          <EmptyState
            icon="☆"
            title="No tickers yet"
            message="Add a symbol to start tracking. Alt+click any row later to add qty + entry for P&L."
          />
        ) : (
          sortedPositions.map(pos => (
            <WatchlistRow
              key={pos.id}
              position={pos}
              view={view}
              sparkData={rowSparklines[pos.symbol]}
              snap={snapData[pos.symbol] || null}
              earn={earnData[pos.symbol] || null}
              rec={recData[pos.symbol] || null}
              fund={fundData[pos.symbol] || null}
              onOpen={handleOpen}
              onEdit={handleEdit}
              onRemove={handleRemove}
              onWhy={handleWhy}
              onReportPrice={reportPrice}
              onHoverStart={handleHoverStart}
              onHoverEnd={handleHoverEnd}
            />
          ))
        )}
        {/* Hover mini-profile card — pointer-events:none, absolute in the
            rows scroller, hides on row mouseleave. */}
        {hover && (
          <HoverCard
            sym={hover.sym}
            top={hover.top}
            snap={hoverSnap}
            fund={fundData[hover.sym] || null}
            newsCount={newsCounts[hover.sym] ?? null}
            price={getPriceData(hover.sym)?.price ?? null}
          />
        )}
      </div>

      {/* Position editor — edit existing */}
      {editorPos && (
        <PositionEditor
          position={editorPos}
          onClose={handleCloseEditor}
        />
      )}

      {/* Position editor — add new */}
      {showEditor && (
        <PositionEditor
          position={null}
          defaultPortfolioId={portfolios[0]?.id}
          defaultSubportfolioId={portfolios[0]?.subportfolios[0]?.id}
          onClose={handleCloseEditor}
        />
      )}

      {/* Share */}
      <ShareModal
        isOpen={shareOpen}
        onClose={() => setShareOpen(false)}
        cardType="portfolio"
        cardData={{}}
      />

      {/* Why popover */}
      {whySymbol && (
        <div className="wp-why-popover">
          <div className="wp-why-header">
            <span className="wp-why-title">Why is {whySymbol} moving?</span>
            <button className="btn wp-why-close"
              onClick={() => { setWhySymbol(null); setWhySummary(null); setWhyError(null); }}
            ><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
          </div>
          <div className="wp-why-content">
            {whyLoading && <div className="wp-why-loading"><span>Loading analysis…</span></div>}
            {whyError && (
              <div className="wp-why-error">
                <span>{whyError}</span>
                <button className="btn wp-why-retry"
                  onClick={() => handleWhy(whySymbol)}
                >Retry</button>
              </div>
            )}
            {whySummary && <div className="wp-why-text">{whySummary}</div>}
          </div>
        </div>
      )}
    </PanelShell>
  );
}

export default memo(WatchlistPanel);
