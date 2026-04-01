/**
 * PortfolioPanel.jsx — Desktop portfolio holdings panel
 *
 * Phase 4A: Replaces WatchlistPanel with full portfolio view.
 *   - Grid layout: TICKER | QTY | COST | LAST | P&L% | ✕
 *   - Live prices via useTickerPrice per row
 *   - Portfolio/subportfolio filter dropdown
 *   - Quick-add by symbol, Alt/Ctrl+click to edit, right-click context menu
 *   - PositionEditor modal for add/edit
 */

import { useState, useCallback, useRef, useEffect, memo } from 'react';
import PanelShell from '../common/PanelShell';
import PositionEditor from '../common/PositionEditor';
import EmptyState from '../common/EmptyState';
import { usePortfolio } from '../../context/PortfolioContext';
import { useTickerPrice } from '../../context/PriceContext';

const fmt    = (n) => n == null ? '—' : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtPct = (n) => n == null ? '—' : (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
const COLS   = '72px 56px 72px 72px 64px 24px';

const showInfo = (e, symbol) => {
  e.preventDefault();
  let assetType = 'EQUITY';
  if (/^[A-Z]{6}$/.test(symbol)) assetType = symbol.endsWith('USD') ? 'CRYPTO' : 'FX';
  if (symbol.endsWith('.SA')) assetType = 'BR';
  window.dispatchEvent(new CustomEvent('ticker:rightclick', {
    detail: { symbol, label: symbol, type: assetType, x: e.clientX + 6, y: e.clientY + 6 },
  }));
};

// ── Individual position row with live price ──
const PositionRow = memo(function PositionRow({ position, onTickerClick, onOpenDetail, onEdit, onRemove }) {
  const { price, changePct } = useTickerPrice(position.symbol);
  const ptRef = useRef(null);

  const entryPrice = position.entryPrice;
  const livePrice  = price || null;
  let pnlPct = null;
  if (livePrice && entryPrice) {
    pnlPct = ((livePrice - entryPrice) / entryPrice) * 100;
  }

  return (
    <div
      data-ticker={position.symbol}
      onClick={(e) => {
        if (e.ctrlKey || e.altKey || e.metaKey) { onEdit(position); }
        else { onTickerClick?.(position.symbol); }
      }}
      onDoubleClick={() => onOpenDetail?.(position.symbol)}
      onContextMenu={(e) => showInfo(e, position.symbol)}
      onTouchStart={(e) => { e.stopPropagation(); clearTimeout(ptRef.current); ptRef.current = setTimeout(() => onOpenDetail?.(position.symbol), 500); }}
      onTouchEnd={() => clearTimeout(ptRef.current)}
      onTouchMove={() => clearTimeout(ptRef.current)}
      style={{
        display: 'grid', gridTemplateColumns: COLS, padding: '3px 8px',
        borderBottom: '1px solid var(--border-subtle)', cursor: 'pointer',
        alignItems: 'center', transition: 'background-color 0.1s',
      }}
      onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--bg-hover)'}
      onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
    >
      <span style={{ color: 'var(--section-watchlist)', fontSize: 'var(--font-base)', fontWeight: 700 }}>{position.symbol}</span>
      <span style={{ color: 'var(--text-primary)', fontSize: 'var(--font-base)', textAlign: 'right', paddingRight: 4, fontVariantNumeric: 'tabular-nums' }}>
        {position.quantity != null ? position.quantity : '—'}
      </span>
      <span style={{ color: 'var(--text-primary)', fontSize: 'var(--font-base)', textAlign: 'right', paddingRight: 4, fontVariantNumeric: 'tabular-nums' }}>
        {fmt(entryPrice)}
      </span>
      <span style={{ color: 'var(--text-primary)', fontSize: 'var(--font-base)', textAlign: 'right', paddingRight: 4, fontVariantNumeric: 'tabular-nums' }}>
        {fmt(livePrice)}
      </span>
      <span style={{
        color: pnlPct != null ? (pnlPct >= 0 ? 'var(--price-up)' : 'var(--price-down)') : 'var(--text-muted)',
        fontSize: 'var(--font-base)', textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums',
      }}>
        {fmtPct(pnlPct)}
      </span>
      <button
        onClick={e => { e.stopPropagation(); onRemove(position.id); }}
        title="Remove position"
        style={{ background: 'none', border: 'none', color: 'var(--text-faint)', cursor: 'pointer', fontSize: 'var(--font-base)', padding: 0, textAlign: 'center', transition: 'color 0.15s' }}
        onMouseEnter={e => e.currentTarget.style.color = 'var(--price-down)'}
        onMouseLeave={e => e.currentTarget.style.color = 'var(--text-faint)'}
      >✕</button>
    </div>
  );
});

// ── Main panel ──
function PortfolioPanel({ onTickerClick, onOpenDetail }) {
  const { portfolios, positions, removePosition, addTicker } = usePortfolio();
  const [filterSubId, setFilterSubId] = useState('all');
  const [addInput, setAddInput]       = useState('');
  const [showAdd, setShowAdd]         = useState(false);
  const [editorPos, setEditorPos]     = useState(null);   // null | position obj
  const [showEditor, setShowEditor]   = useState(false);   // true = "add new" mode
  const inputRef = useRef(null);

  useEffect(() => {
    if (showAdd) setTimeout(() => inputRef.current?.focus(), 50);
  }, [showAdd]);

  // Build filter options
  const filterOptions = [];
  portfolios.forEach(p => {
    p.subportfolios.forEach(sp => {
      filterOptions.push({ value: sp.id, label: `${p.name} / ${sp.name}` });
    });
  });

  // Filter positions
  const filtered = filterSubId === 'all'
    ? positions
    : positions.filter(p => p.subportfolioId === filterSubId);

  const handleAdd = (e) => {
    e.preventDefault();
    const sym = addInput.trim().toUpperCase();
    if (sym) { addTicker(sym); setAddInput(''); setShowAdd(false); }
  };

  const handleEdit = useCallback((position) => {
    setEditorPos(position);
  }, []);

  const handleCloseEditor = useCallback(() => {
    setEditorPos(null);
    setShowEditor(false);
  }, []);

  return (
    <PanelShell>
      {/* Header */}
      <div style={{ padding: '4px 8px', borderBottom: '1px solid var(--border-strong)', background: 'var(--bg-elevated)', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ color: 'var(--section-watchlist)', fontSize: 'var(--font-base)', fontWeight: 700, letterSpacing: '1px' }}>📊 PORTFOLIO</span>
        <span style={{ color: 'var(--text-muted)', fontSize: 'var(--font-sm)' }}>{filtered.length} positions</span>
        <div style={{ flex: 1 }} />
        {filterOptions.length > 1 && (
          <select
            value={filterSubId}
            onChange={e => setFilterSubId(e.target.value)}
            style={{
              background: 'var(--bg-panel)', border: '1px solid var(--border-strong)', color: 'var(--text-muted)',
              fontSize: 'var(--font-sm)', padding: '1px 4px', fontFamily: 'inherit', borderRadius: 'var(--radius-sm)',
              cursor: 'pointer', outline: 'none',
            }}
          >
            <option value="all">ALL</option>
            {filterOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        )}
        <button
          onClick={() => setShowAdd(s => !s)}
          style={{ background: showAdd ? '#1a0d00' : 'none', border: '1px solid var(--border-strong)', color: 'var(--section-watchlist)', fontSize: 9, padding: '1px 6px', cursor: 'pointer', fontFamily: 'inherit', borderRadius: 'var(--radius-sm)' }}
        >+ ADD</button>
      </div>

      {/* Quick-add ticker */}
      {showAdd && (
        <form onSubmit={handleAdd} style={{ display: 'flex', gap: 4, padding: '4px 8px', borderBottom: '1px solid var(--border-default)', flexShrink: 0, background: 'var(--bg-surface)' }}>
          <input
            ref={inputRef}
            value={addInput}
            onChange={e => setAddInput(e.target.value.toUpperCase())}
            placeholder="e.g. AAPL or VALE3.SA"
            style={{
              flex: 1, background: 'var(--bg-panel)', border: '1px solid var(--border-strong)', color: 'var(--text-primary)',
              fontFamily: 'inherit', fontSize: 'var(--font-base)', padding: '3px 6px', outline: 'none', borderRadius: 'var(--radius-sm)',
            }}
          />
          <button type="submit" style={{ background: '#1a0d00', border: '1px solid var(--section-watchlist)', color: 'var(--section-watchlist)', fontSize: 9, padding: '2px 8px', cursor: 'pointer', fontFamily: 'inherit', borderRadius: 'var(--radius-sm)' }}>ADD</button>
          <button type="button" onClick={() => { setShowAdd(false); setAddInput(''); }} style={{ background: 'none', border: '1px solid var(--text-faint)', color: 'var(--text-muted)', fontSize: 9, padding: '2px 6px', cursor: 'pointer', fontFamily: 'inherit', borderRadius: 'var(--radius-sm)' }}>✕</button>
        </form>
      )}

      {/* Column headers */}
      <div style={{ display: 'grid', gridTemplateColumns: COLS, padding: '2px 8px', borderBottom: '1px solid var(--border-default)', flexShrink: 0 }}>
        {['TICKER', 'QTY', 'COST', 'LAST', 'P&L%', ''].map((h, i) => (
          <span key={i} style={{ color: 'var(--text-muted)', fontSize: 'var(--font-sm)', fontWeight: 700, letterSpacing: '1px', textAlign: i >= 1 ? 'right' : 'left', paddingRight: i >= 1 ? 4 : 0 }}>{h}</span>
        ))}
      </div>

      {/* Rows */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {filtered.length === 0 ? (
          <EmptyState
            icon="📊"
            title="No positions"
            message="Add a ticker to start tracking your portfolio."
          />
        ) : (
          filtered.map(pos => (
            <PositionRow
              key={pos.id}
              position={pos}
              onTickerClick={onTickerClick}
              onOpenDetail={onOpenDetail}
              onEdit={handleEdit}
              onRemove={removePosition}
            />
          ))
        )}
      </div>

      {/* PositionEditor modal — edit existing */}
      {editorPos && (
        <PositionEditor
          position={editorPos}
          onClose={handleCloseEditor}
        />
      )}

      {/* PositionEditor modal — add new */}
      {showEditor && (
        <PositionEditor
          position={null}
          defaultPortfolioId={portfolios[0]?.id}
          defaultSubportfolioId={portfolios[0]?.subportfolios[0]?.id}
          onClose={handleCloseEditor}
        />
      )}
    </PanelShell>
  );
}

export default memo(PortfolioPanel);
