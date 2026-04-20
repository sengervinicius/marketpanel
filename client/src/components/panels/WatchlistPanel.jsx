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
import PositionEditor from '../common/PositionEditor';
import ShareModal from '../common/ShareModal';
import { fmt, fmtPct, fmtCompact, computeSummary, inferAssetType } from '../../utils/portfolioAnalytics';
import { MiniSparkline, SyncBadge, AIHealthCard, SummaryStrip } from './PortfolioPanelWidgets';
import '../common/Shimmer.css';
import './WatchlistPanel.css';

// Grid: TICKER | LAST | CHG% | P&L% | spark | actions
const COLS = '72px 1fr 68px 68px 64px 72px';

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

function normalizePolygonQuote(t) {
  const price = (t.min?.c > 0 ? t.min.c : null)
             ?? (t.day?.c > 0 ? t.day.c : null)
             ?? t.lastTrade?.p
             ?? t.prevDay?.c
             ?? null;
  return {
    symbol: t.ticker,
    price,
    changePct: t.todaysChangePerc ?? null,
    change: t.todaysChange ?? null,
  };
}

// ── Individual row ──────────────────────────────────────────────────
const WatchlistRow = memo(function WatchlistRow({
  position, quote, onTickerClick, onEdit, onRemove, onWhy, onReportPrice,
}) {
  const openDetail = useOpenDetail();
  const priceCtx   = useTickerPrice(position.symbol);
  const ptRef      = useRef(null);

  // Prefer batch Polygon quote, fall back to PriceContext
  const price     = quote?.price     ?? priceCtx?.price     ?? null;
  const changePct = quote?.changePct ?? priceCtx?.changePct ?? null;

  // Report price up so the summary strip can recompute
  useEffect(() => {
    if (price != null) {
      onReportPrice(position.symbol, { price, changePct, change: quote?.change ?? priceCtx?.change ?? null });
    }
  }, [price, changePct, position.symbol, quote, priceCtx, onReportPrice]);

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
      style={{ gridTemplateColumns: COLS }}
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
      <span className="wp-row-spark">
        {changePct != null && <MiniSparkline positive={pos} />}
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

  // Ad-hoc batch quotes for equities (fast path); crypto/FX fall through
  // to PriceContext via WatchlistRow.
  const [quotes, setQuotes] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);

  // UI state
  const [sortMode, setSortMode] = useState('default'); // 'default' | 'heat' | 'pnl'
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

  // ── Batch equity quotes ─────────────────────────────────────────
  const symbols = useMemo(() => positions.map(p => p.symbol), [positions]);
  const symbolsKey = symbols.join(',');

  const fetchQuotes = useCallback(async () => {
    if (symbols.length === 0) { setQuotes({}); return; }
    setLoading(true);
    setError(null);
    try {
      // Batch endpoint only handles US equities — that's fine, other
      // assets still get prices via PriceContext in the row.
      const res  = await apiFetch(`/api/snapshot/stocks?tickers=${encodeURIComponent(symbols.join(','))}`);
      const json = await res.json();
      if (!res.ok) { setError(json.error || 'Error fetching quotes'); return; }
      const map = {};
      (json.tickers || []).forEach(t => { map[t.ticker] = normalizePolygonQuote(t); });
      setQuotes(map);
      setLastUpdated(new Date());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [symbols, symbolsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchQuotes();
    const id = setInterval(fetchQuotes, 10_000);
    return () => clearInterval(id);
  }, [fetchQuotes]);

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
  const anyTracked = trackedPositions.length > 0;

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

      const response = await apiJSON('/api/search/portfolio-insight', {
        method: 'POST',
        body: JSON.stringify({ positions: positionsData, totalValue }),
      });
      setAiInsight(response);
    } catch (err) {
      setAiError(err.message || 'Failed to analyze portfolio');
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
      const q   = quotes[p.symbol];
      const pd  = getPriceData(p.symbol);
      const chg = q?.changePct ?? pd?.changePct ?? 0;
      const px  = q?.price ?? pd?.price ?? null;
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
  }, [positions, sortMode, quotes, getPriceData]);

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
      {/* Header */}
      <div className="flex-row wp-header">
        <span className="wp-header-title">WATCHLIST</span>
        <span className="wp-header-count">{positions.length}</span>
        {anyTracked && (
          <span className="wp-header-tracked" title="Positions with qty + entry">
            · {trackedPositions.length} tracked
          </span>
        )}
        <SyncBadge syncStatus={syncStatus} onRetry={retrySync} />
        <div className="wp-spacer" />
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
        <button className="btn wp-add-btn" onClick={() => setShareOpen(true)} title="Share">SHARE</button>
        <button
          className={`btn wp-add-btn ${showAdd ? 'wp-add-btn-active' : ''}`}
          onClick={() => setShowAdd(s => !s)}
        >+ ADD</button>
      </div>

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
      <div className="wp-col-header" style={{ gridTemplateColumns: COLS }}>
        <span className="wp-col-header-cell">TICKER</span>
        <span className="wp-col-header-cell wp-col-header-right">LAST</span>
        <span className="wp-col-header-cell wp-col-header-right">CHG%</span>
        <span className="wp-col-header-cell wp-col-header-right" title="P&L% (requires qty + entry)">P&amp;L%</span>
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
        ) : loading && Object.keys(quotes).length === 0 ? (
          <div className="wp-loading">LOADING…</div>
        ) : (
          sortedPositions.map(pos => (
            <WatchlistRow
              key={pos.id}
              position={pos}
              quote={quotes[pos.symbol]}
              onTickerClick={onTickerClick}
              onEdit={handleEdit}
              onRemove={handleRemove}
              onWhy={handleWhy}
              onReportPrice={reportPrice}
            />
          ))
        )}
        {error && (
          <div className="wp-error-msg">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: 'middle', marginRight: 2 }}><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            {error}
          </div>
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
