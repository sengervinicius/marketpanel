/**
 * WatchlistPanel.jsx — Phase 9.2 unified Watchlist + Portfolio panel.
 *
 * The old split (Watchlist = just a list of symbols, Portfolio = positions
 * with P&L) was confusing for a CIO audience: most of our users live on
 * the watchlist but want to enrich a few of them with quantity + entry
 * price so they can see running P&L without opening a separate panel.
 *
 * So we killed Portfolio as a separate surface and folded all of its
 * power into Watchlist:
 *
 *   • One row per symbol; simple adds stay lightweight (just a symbol).
 *   • Alt/Ctrl/Meta-click or the ✎ button opens PositionEditor to set
 *     qty / entry / invested — upgrading the row into a "tracked"
 *     position with real P&L%.
 *   • Summary strip + AI Health Check appear automatically once any
 *     row has qty + entry.
 *   • Sort modes: default | HEAT (biggest |Δ%|) | P&L (biggest gainers).
 *   • Drag-drop tickers from search.
 *   • "Why is X moving?" per row (unchanged).
 *
 * State comes from PortfolioContext (positions[] of { symbol, qty,
 * entryPrice, investedAmount, note, subportfolioId, ... }). A plain
 * watchlist entry is just a position with null qty/entryPrice. Existing
 * watchlist and portfolio data are both preserved — PortfolioContext
 * already migrated legacy watchlist → positions on load.
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
import { fmt, fmtPct, fmtCompact, computeSummary, inferAssetType } from '../../utils/portfolioAnalytics';
import { SyncBadge, AIHealthCard, SummaryStrip } from './PortfolioPanelWidgets';
// H1.2: real last-20-close sparkline (v2) instead of the fake static polyline.
import Sparkline from '../common/Sparkline';
import { useSparklineData } from '../../hooks/useSparklineData';
import '../common/Shimmer.css';
import './WatchlistPanel.css';

// Grid: TICKER | LAST | CHG% | P&L% | [EXT] | [EARN] | [REC] | spark | actions
// Base template kept identical to pre-H2b so default layout never shifts.
const COLS = '72px 1fr 68px 68px 64px 72px';

// H2b item 3 — optional depth columns behind a column picker.
// Persisted in localStorage 'wlCols_v1'; default all OFF (no layout shift).
const WL_COLS_KEY = 'wlCols_v1';
const DEFAULT_COL_PREFS = { ext: false, earn: false, rec: false };
const EXTRA_SYMBOL_CAP = 30; // server batch cap for the extras endpoints

function loadColPrefs() {
  try {
    const raw = JSON.parse(localStorage.getItem(WL_COLS_KEY));
    return { ...DEFAULT_COL_PREFS, ...(raw && typeof raw === 'object' ? raw : {}) };
  } catch {
    return { ...DEFAULT_COL_PREFS };
  }
}

function buildGridCols(prefs) {
  let cols = '72px 1fr 68px 68px';
  if (prefs.ext)  cols += ' 100px';
  if (prefs.earn) cols += ' 58px';
  if (prefs.rec)  cols += ' 74px';
  return cols + ' 64px 72px';
}

function fmtEarnDate(iso) {
  if (!iso) return null;
  const d = new Date(iso + 'T00:00:00');
  if (isNaN(d)) return null;
  return `${d.toLocaleString('en-US', { month: 'short' }).toUpperCase()} ${d.getDate()}`;
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
  if (/^(BTC|ETH|SOL|XRP|BNB|DOGE|ADA|DOT|AVAX|MATIC)USD$/.test(s)) return 'CRYPTO';
  if (/^[A-Z]{6}$/.test(s)) return 'FX';
  return 'EQUITY';
}

// ── Individual row ──────────────────────────────────────────────────
// #290 part 2 — was reading from a parallel `/api/snapshot/stocks` fetch
// (10s cadence) AND PriceContext (6s cadence) and falling through. Two
// independent pipelines on the same screen guaranteed visible drift
// vs. ChartPanel which only reads PriceContext. Now: PriceContext only.
const WatchlistRow = memo(function WatchlistRow({
  position, sparkData, onTickerClick, onEdit, onRemove, onWhy, onReportPrice,
  gridCols = COLS, colPrefs = DEFAULT_COL_PREFS, ext = null, earn = null, rec = null,
}) {
  const openDetail = useOpenDetail();
  const priceCtx   = useTickerPrice(position.symbol);
  const ptRef      = useRef(null);

  const price     = priceCtx?.price     ?? null;
  const changePct = priceCtx?.changePct ?? null;

  // Report price up so the summary strip can recompute
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
  const pos       = (changePct ?? 0) >= 0;

  return (
    <div
      data-ticker={position.symbol}
      data-ticker-label={position.symbol}
      data-ticker-type={assetType}
      onClick={(e) => {
        if (e.ctrlKey || e.altKey || e.metaKey) onEdit(position);
        else onTickerClick?.(position.symbol);
      }}
      onDoubleClick={() => openDetail(position.symbol)}
      onContextMenu={e => showInfo(e, position.symbol, position.symbol, assetType)}
      onTouchStart={(e) => { e.stopPropagation(); clearTimeout(ptRef.current); ptRef.current = setTimeout(() => openDetail(position.symbol), 500); }}
      onTouchEnd={() => clearTimeout(ptRef.current)}
      onTouchMove={() => clearTimeout(ptRef.current)}
      className="wp-row"
      style={{ gridTemplateColumns: gridCols }}
      title={isTracked
        ? `${position.quantity} @ ${fmt(position.entryPrice)} · cost ${fmtCompact((position.quantity || 0) * (position.entryPrice || 0))}`
        : 'Click to chart · Alt+click to add position details'}
    >
      <span className="wp-row-symbol">{position.symbol}</span>
      <span className="wp-row-price">{fmt(price)}</span>
      <span className={`wp-row-change ${pos ? 'wp-row-change-positive' : 'wp-row-change-negative'}`}>
        {fmtPct(changePct)}
      </span>
      <span className={`wp-row-pnl ${
        pnlPct == null ? 'wp-row-pnl-neutral'
        : pnlPct >= 0   ? 'wp-row-pnl-positive'
                        : 'wp-row-pnl-negative'
      }`}>
        {pnlPct == null ? '—' : fmtPct(pnlPct)}
      </span>
      {/* H2b optional depth columns — each degrades to an em-dash */}
      {colPrefs.ext && (() => {
        const cell = ext?.post?.price != null
          ? { tag: 'POST', ...ext.post }
          : ext?.pre?.price != null ? { tag: 'PRE', ...ext.pre } : null;
        if (!cell) return <span className="wp-row-extra wp-row-extra--empty">—</span>;
        const up = (cell.changePct ?? 0) >= 0;
        return (
          <span className="wp-row-extra" title={`${cell.tag}-market`}>
            {fmt(cell.price)}{' '}
            <span className={up ? 'wp-row-change-positive' : 'wp-row-change-negative'}>
              {cell.changePct != null ? fmtPct(cell.changePct) : ''}
            </span>
          </span>
        );
      })()}
      {colPrefs.earn && (
        <span
          className={`wp-row-extra${earn?.date ? '' : ' wp-row-extra--empty'}`}
          title={earn?.date ? `Next earnings ${earn.date}${earn.daysUntil != null ? ` · in ${earn.daysUntil}d` : ''}` : 'No upcoming earnings found'}
        >
          {fmtEarnDate(earn?.date) || '—'}
        </span>
      )}
      {colPrefs.rec && (
        rec ? (
          <span
            className={`wp-rec-chip ${rec.buy > rec.sell ? 'wp-rec-chip--bull' : rec.sell > rec.buy ? 'wp-rec-chip--bear' : ''}`}
            title={`Analyst recs${rec.period ? ` (${rec.period})` : ''}: ${rec.buy} buy · ${rec.hold} hold · ${rec.sell} sell`}
          >
            {rec.buy}B/{rec.hold}H/{rec.sell}S
          </span>
        ) : <span className="wp-row-extra wp-row-extra--empty">—</span>
      )}
      <span className="wp-row-spark">
        {sparkData && sparkData.length >= 2 && (
          <Sparkline data={sparkData} width={56} height={14} />
        )}
      </span>
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

// ── Main panel ──────────────────────────────────────────────────────
function WatchlistPanel({ onTickerClick }) {
  const {
    positions, portfolios, addTicker, removePosition, removeTicker,
    syncStatus, retrySync,
  } = usePortfolio();

  // #290 part 2 — removed the parallel /api/snapshot/stocks fetch. All
  // prices now come from PriceContext (single source of truth) via the
  // row's useTickerPrice hook. `loading` is derived from "have we seen
  // any price yet" instead of a fetch flag.


  // UI state
  const [sortMode, setSortMode] = useState('default'); // 'default' | 'heat' | 'pnl'
  // H2b item 3 — optional depth columns (persisted, default OFF)
  const [colPrefs, setColPrefs] = useState(loadColPrefs);
  const [showColPicker, setShowColPicker] = useState(false);
  const toggleCol = useCallback((key) => {
    setColPrefs(prev => {
      const next = { ...prev, [key]: !prev[key] };
      try { localStorage.setItem(WL_COLS_KEY, JSON.stringify(next)); } catch { /* private mode */ }
      return next;
    });
  }, []);
  const gridCols = useMemo(() => buildGridCols(colPrefs), [colPrefs]);
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

  // #290 part 2 — fetchQuotes() and its 10s interval removed. PriceContext
  // already polls the canonical batch every 6s and merges WS overlays;
  // running a second poll here just produced visible drift between the
  // chart grid and watchlist for the same symbol. WatchlistRow reads
  // priceCtx directly now.

  // #291 HOTFIX — the previous derived `loading = !priceSnapshot.size`
  // created a deadlock: rows are gated behind `!loading`, but
  // priceSnapshot only gets populated when rows call reportPrice.
  // No rows = no reportPrice = priceSnapshot empty = loading forever
  // = no rows. The watchlist was perma-stuck on "LOADING…".
  //
  // Fix: render rows immediately. Each row's price column will show
  // the fmt(null) placeholder ("—") for at most one PriceContext
  // batch interval (~6s), then fill in. That's much better UX than
  // an infinite spinner that never resolves.

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

  // ── Remove: route by whether it has position data ───────────────
  const handleRemove = useCallback((id) => {
    // `id` is the position id; removePosition handles the general case.
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

  // ── AI Health Check ─────────────────────────────────────────────
  const trackedPositions = useMemo(
    () => positions.filter(p => p.entryPrice != null && p.quantity != null),
    [positions]
  );

  // H1.2: last-20-close history for the per-row sparkline column.
  const watchSymbols = useMemo(() => positions.map(p => p.symbol), [positions]);
  const rowSparklines = useSparklineData(watchSymbols);
  const anyTracked = trackedPositions.length > 0;

  // H2b item 3 — batch data for the optional columns. Only fetched while
  // the column is enabled; every source degrades to {} (rows show "—").
  const symbolsKey = useMemo(
    () => watchSymbols.slice(0, EXTRA_SYMBOL_CAP).join(','),
    [watchSymbols]
  );
  const [extData,  setExtData]  = useState({}); // SYM → { pre, post }
  const [earnData, setEarnData] = useState({}); // SYM → { date, daysUntil }
  const [recData,  setRecData]  = useState({}); // SYM → { buy, hold, sell, period }

  // PRE/POST — extended-hours fields ride the ticker snapshot batch (60s).
  useEffect(() => {
    if (!colPrefs.ext || !symbolsKey) return undefined;
    let alive = true;
    const load = async () => {
      try {
        const res = await apiFetch(`/api/snapshot/tickers?symbols=${encodeURIComponent(symbolsKey)}`);
        if (!res.ok) return;
        const json = await res.json();
        if (!alive || !json?.results) return;
        const map = {};
        for (const [sym, entry] of Object.entries(json.results)) {
          if (entry?.ticker?.ext) map[sym] = entry.ticker.ext;
        }
        setExtData(map);
      } catch { /* degrade to em-dash */ }
    };
    load();
    const id = setInterval(load, 60_000);
    return () => { alive = false; clearInterval(id); };
  }, [colPrefs.ext, symbolsKey]);

  // NEXT EARNINGS — server caches 12h; one fetch per symbol-set change.
  useEffect(() => {
    if (!colPrefs.earn || !symbolsKey) return undefined;
    let alive = true;
    apiFetch(`/api/market/next-earnings?symbols=${encodeURIComponent(symbolsKey)}`)
      .then(r => (r.ok ? r.json() : null))
      .then(j => { if (alive && j?.ok) setEarnData(j.data || {}); })
      .catch(() => { /* degrade to em-dash */ });
    return () => { alive = false; };
  }, [colPrefs.earn, symbolsKey]);

  // REC TREND — server caches 12h; one fetch per symbol-set change.
  useEffect(() => {
    if (!colPrefs.rec || !symbolsKey) return undefined;
    let alive = true;
    apiFetch(`/api/market/rec-trends?symbols=${encodeURIComponent(symbolsKey)}`)
      .then(r => (r.ok ? r.json() : null))
      .then(j => { if (alive && j?.ok) setRecData(j.data || {}); })
      .catch(() => { /* degrade to em-dash */ });
    return () => { alive = false; };
  }, [colPrefs.rec, symbolsKey]);

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

      // #291 W1.12 — 30s timeout. Previously this call had no client-side
      // timeout, so if the upstream LLM hung the user saw an infinite
      // spinner with no recovery. apiFetch has its own 35s default, but
      // explicit AbortController here surfaces a friendlier error first.
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
  // #290 part 2 — sort uses priceSnapshot only (PriceContext-derived).
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
    // 'pnl' — tracked positions first (by pnl desc), then the rest by chg
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

  return (
    <PanelShell onDropTicker={handleDropTicker}>
      {/* Header — H1.1 shared chrome; every control lives in the actions slot */}
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
              {anyTracked && sortBtn('pnl', 'P&L')}
            </div>
            {/* AI Health Check — only when tracked positions exist */}
            {anyTracked && (
              <button
                className="wp-ai-btn"
                onClick={handleAIHealthCheck}
                disabled={aiLoading}
                title="AI health check on tracked positions"
              >{aiLoading ? 'ANALYZING…' : '◆ AI HEALTH'}</button>
            )}
            {/* H2b — column picker for optional depth columns */}
            <div className="wp-cols-wrap">
              <button
                className={`btn wp-add-btn ${showColPicker || colPrefs.ext || colPrefs.earn || colPrefs.rec ? 'wp-add-btn-active' : ''}`}
                onClick={() => setShowColPicker(v => !v)}
                title="Show/hide optional columns"
              >COLS</button>
              {showColPicker && (
                <div className="wp-cols-popover">
                  {[['ext', 'PRE/POST'], ['earn', 'NEXT EARN'], ['rec', 'REC TREND']].map(([key, lbl]) => (
                    <label key={key} className="wp-cols-option">
                      <input
                        type="checkbox"
                        checked={!!colPrefs[key]}
                        onChange={() => toggleCol(key)}
                      />
                      <span>{lbl}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
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
      <div className="wp-col-header" style={{ gridTemplateColumns: gridCols }}>
        <span className="wp-col-header-cell">TICKER</span>
        <span className="wp-col-header-cell wp-col-header-right">LAST</span>
        <span className="wp-col-header-cell wp-col-header-right">CHG%</span>
        <span className="wp-col-header-cell wp-col-header-right" title="P&L% (requires qty + entry)">P&amp;L%</span>
        {colPrefs.ext && <span className="wp-col-header-cell wp-col-header-right" title="Pre/post-market price + %">PRE/POST</span>}
        {colPrefs.earn && <span className="wp-col-header-cell wp-col-header-right" title="Next earnings date (Finnhub)">EARN</span>}
        {colPrefs.rec && <span className="wp-col-header-cell wp-col-header-right" title="Analyst recommendation trend (Finnhub)">REC</span>}
        <span className="wp-col-header-cell wp-col-header-right"></span>
        <span className="wp-col-header-cell"></span>
      </div>

      {/* Rows */}
      <div className="wp-rows-container">
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
              sparkData={rowSparklines[pos.symbol]}
              gridCols={gridCols}
              colPrefs={colPrefs}
              ext={extData[pos.symbol] || null}
              earn={earnData[pos.symbol] || null}
              rec={recData[pos.symbol] || null}
              onTickerClick={onTickerClick}
              onEdit={handleEdit}
              onRemove={handleRemove}
              onWhy={handleWhy}
              onReportPrice={reportPrice}
            />
          ))
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
