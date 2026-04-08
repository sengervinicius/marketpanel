/**
 * CustomSubsectionBlock.jsx
 * Renders a user-created custom subsection with its tickers.
 * Includes inline ticker add/remove functionality.
 * Used by StockPanel, ForexPanel, CommoditiesPanel.
 */
import { useState, useRef, useEffect, memo } from 'react';
import { useOpenDetail } from '../../context/OpenDetailContext';
import useMergedTickerQuote from './useMergedTickerQuote';
import './CustomSubsectionBlock.css';

const fmt = (n) => n == null ? '—' : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtPct = (n) => n == null ? '—' : (n >= 0 ? '+' : '') + n.toFixed(2) + '%';

/**
 * Individual ticker row that falls back to PriceContext when the
 * parent snapshot data doesn't contain this symbol's price.
 * Phase 8: now uses shared useMergedTickerQuote hook.
 */
function TickerRow({ sym, data, color, gridCols, subsection, onTickerClick, onRemoveTicker, onDragStart, flash }) {
  const openDetail = useOpenDetail();
  // Look up snapshot: try raw symbol first, then strip C:/X: prefix (batch data
  // uses unprefixed keys like 'EURUSD' while drag symbols use 'C:EURUSD').
  const rawKey = sym.startsWith('C:') ? sym.slice(2)
               : sym.startsWith('X:') ? sym.slice(2)
               : sym;
  const d = data[sym] || data[rawKey] || {};
  const { price, changePct, change } = useMergedTickerQuote(sym, d);

  const name = d.name || sym;
  const pos = (changePct ?? 0) >= 0;

  return (
    <div
      key={sym}
      data-ticker={sym}
      data-ticker-type="CUSTOM"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'copy';
        e.dataTransfer.setData('application/x-ticker', JSON.stringify({ symbol: sym, name: sym, type: 'CUSTOM' }));
        onDragStart?.(e, sym);
      }}
      onClick={() => onTickerClick?.(sym)}
      onDoubleClick={() => openDetail?.(sym)}
      className={`csb-row${flash ? ' price-row-flash' : ''}`}
      style={{ gridTemplateColumns: gridCols }}
      role="button"
      tabIndex={0}
      aria-label={`${sym}: Price ${fmt(price)}, Change ${fmtPct(changePct)}. Click to view details.`}
    >
      <span className="csb-symbol" style={{ color }}>{sym}</span>
      <span className="csb-name">
        {name}
      </span>
      <span className="csb-price">
        {fmt(price)}
      </span>
      <span className="csb-change-section">
        <span className="csb-change" style={{ color: pos ? 'var(--price-up)' : 'var(--price-down)' }} aria-live="polite" aria-atomic="true">
          {pos ? '▲' : '▼'} {fmtPct(changePct)}
        </span>
        <button className="csb-remove-btn"
          onClick={(e) => { e.stopPropagation(); onRemoveTicker?.(subsection.key, sym); }}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--price-down)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--border-strong)'; }}
          title={`Remove ${sym} from ${subsection.label}`}
          aria-label={`Remove ${sym} from ${subsection.label}`}
        >×</button>
      </span>
    </div>
  );
}

function CustomSubsectionBlock({
  subsection,       // { key, label, color, symbols }
  data = {},        // market data object
  gridCols = '60px 1fr 68px 60px',
  onTickerClick,
  onAddTicker,      // (key, symbol) => void
  onRemoveTicker,   // (key, symbol) => void
  onDragStart,      // (e, symbol) => void (for drag from this section)
  flashSymbol,      // Phase 8: symbol to flash (just dropped)
}) {
  const [showAdd, setShowAdd] = useState(false);
  const [addVal, setAddVal] = useState('');
  const [isDragOver, setIsDragOver] = useState(false);
  const [dropResult, setDropResult] = useState(null); // 'success' | 'invalid' | null
  const addRef = useRef(null);

  useEffect(() => {
    if (showAdd && addRef.current) addRef.current.focus();
  }, [showAdd]);

  const handleAdd = () => {
    const sym = addVal.trim().toUpperCase();
    if (sym) {
      onAddTicker?.(subsection.key, sym);
      setAddVal('');
    }
  };

  const color = subsection.color || 'var(--accent)';
  const symbols = subsection.symbols || [];

  return (
    <div>
      {/* Section header */}
      <div
        className={`csb-header${isDragOver ? ' csb-header--drag-over' : ''}${dropResult === 'success' ? ' csb-header--drop-success' : ''}${dropResult === 'invalid' ? ' csb-header--drop-invalid' : ''}`}
        style={{ color }}
        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setIsDragOver(true); }}
        onDragEnter={(e) => { e.preventDefault(); setIsDragOver(true); }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setIsDragOver(false);
          let ticker = null;
          const xTicker = e.dataTransfer?.getData('application/x-ticker');
          if (xTicker) {
            try { const p = JSON.parse(xTicker); ticker = p.symbol || p.name; } catch { ticker = xTicker; }
          }
          if (!ticker) ticker = e.dataTransfer?.getData('text/plain');
          if (ticker) {
            const sym = ticker.trim().toUpperCase();
            if (!symbols.includes(sym) && /^[A-Z0-9.:=\-^]+$/.test(sym)) {
              onAddTicker?.(subsection.key, sym);
              setDropResult('success');
            } else {
              setDropResult('invalid');
            }
            setTimeout(() => setDropResult(null), 1500);
          }
        }}
      >
        <span className="csb-header-label">
          —— {subsection.label} ————————————————————————
        </span>
        <button
          className={`csb-add-header-btn ${showAdd ? 'csb-add-header-btn-active' : ''}`}
          onClick={() => setShowAdd(v => !v)}
          title="Add ticker to this section"
          aria-label={`${showAdd ? 'Hide' : 'Show'} add ticker form for ${subsection.label}`}
          aria-pressed={showAdd}
        >+</button>
      </div>

      {/* Inline add ticker */}
      {showAdd && (
        <div className="csb-add-row">
          <input
            ref={addRef}
            className="csb-add-input"
            style={{ borderColor: `${color}44` }}
            value={addVal}
            onChange={(e) => setAddVal(e.target.value.toUpperCase())}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAdd();
              if (e.key === 'Escape') { setShowAdd(false); setAddVal(''); }
            }}
            placeholder="Type ticker symbol…"
            aria-label={`Add ticker symbol to ${subsection.label}`}
          />
          <button
            className="csb-add-submit-btn"
            onClick={handleAdd}
            style={{ background: color }}
            aria-label={`Add ${addVal || 'ticker'} to ${subsection.label}`}
          >ADD</button>
        </div>
      )}

      {/* Ticker rows */}
      {symbols.map((sym) => (
        <TickerRow
          key={sym}
          sym={sym}
          data={data}
          color={color}
          gridCols={gridCols}
          subsection={subsection}
          onTickerClick={onTickerClick}
          onRemoveTicker={onRemoveTicker}
          onDragStart={onDragStart}
          flash={flashSymbol === sym}
        />
      ))}

      {symbols.length === 0 && (
        <div className="csb-empty">
          Empty section — drag tickers here or click + to add
        </div>
      )}
    </div>
  );
}

export default memo(CustomSubsectionBlock);
