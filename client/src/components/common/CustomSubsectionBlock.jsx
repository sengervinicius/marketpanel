/**
 * CustomSubsectionBlock.jsx
 * Renders a user-created custom subsection with its tickers.
 * Includes inline ticker add/remove functionality.
 * Used by StockPanel, ForexPanel, CommoditiesPanel.
 */
import { useState, useRef, useEffect, memo } from 'react';
import { useTickerPrice } from '../../context/PriceContext';

const fmt = (n) => n == null ? '—' : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtPct = (n) => n == null ? '—' : (n >= 0 ? '+' : '') + n.toFixed(2) + '%';

/**
 * Individual ticker row that falls back to PriceContext when the
 * parent snapshot data doesn't contain this symbol's price.
 */
function TickerRow({ sym, data, color, gridCols, subsection, onTickerClick, onOpenDetail, onRemoveTicker, onDragStart }) {
  const d = data[sym] || {};
  const priceCtx = useTickerPrice(d.price != null ? null : sym);

  // Merge: prefer snapshot data, fall back to PriceContext
  const price = d.price ?? priceCtx?.price ?? null;
  const changePct = d.changePct ?? priceCtx?.changePct ?? null;
  const change = d.change ?? priceCtx?.change ?? null;
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
      onDoubleClick={() => onOpenDetail?.(sym)}
      style={{
        display: 'grid',
        gridTemplateColumns: gridCols,
        padding: '3px 8px',
        borderBottom: '1px solid var(--border-subtle)',
        cursor: 'pointer',
        alignItems: 'center',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
    >
      <span style={{ color, fontSize: 'var(--font-base)', fontWeight: 700 }}>{sym}</span>
      <span style={{ color: 'var(--text-faint)', fontSize: 'var(--font-sm)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: 4 }}>
        {name}
      </span>
      <span style={{ color: 'var(--text-primary)', fontSize: 'var(--font-base)', textAlign: 'right', paddingRight: 4 }}>
        {fmt(price)}
      </span>
      <span style={{
        display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4,
      }}>
        <span style={{ color: pos ? 'var(--price-up)' : 'var(--price-down)', fontSize: 'var(--font-base)', fontWeight: 600 }}>
          {fmtPct(changePct)}
        </span>
        <button
          onClick={(e) => { e.stopPropagation(); onRemoveTicker?.(subsection.key, sym); }}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--border-strong)',
            fontSize: 11,
            cursor: 'pointer',
            padding: 0,
            lineHeight: 1,
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--price-down)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--border-strong)'; }}
          title={`Remove ${sym} from ${subsection.label}`}
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
  onOpenDetail,
  onAddTicker,      // (key, symbol) => void
  onRemoveTicker,   // (key, symbol) => void
  onDragStart,      // (e, symbol) => void (for drag from this section)
}) {
  const [showAdd, setShowAdd] = useState(false);
  const [addVal, setAddVal] = useState('');
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
        style={{
          padding: '2px 8px',
          background: 'var(--bg-surface)',
          borderTop: '1px solid var(--border-default)',
          borderBottom: '1px solid var(--border-default)',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}
        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          let ticker = null;
          const xTicker = e.dataTransfer?.getData('application/x-ticker');
          if (xTicker) {
            try { const p = JSON.parse(xTicker); ticker = p.symbol || p.name; } catch { ticker = xTicker; }
          }
          if (!ticker) ticker = e.dataTransfer?.getData('text/plain');
          if (ticker) {
            const sym = ticker.trim().toUpperCase();
            if (!symbols.includes(sym)) onAddTicker?.(subsection.key, sym);
          }
        }}
      >
        <span style={{ color, fontSize: 'var(--font-xs)', fontWeight: 700, letterSpacing: '0.12em', flex: 1 }}>
          —— {subsection.label} ————————————————————————
        </span>
        <button
          onClick={() => setShowAdd(v => !v)}
          style={{
            background: 'none',
            border: `1px solid ${showAdd ? color : 'var(--border-default)'}`,
            color: showAdd ? color : 'var(--text-faint)',
            fontSize: 'var(--font-xs)',
            padding: '0 4px',
            cursor: 'pointer',
            fontFamily: '"Courier New", monospace',
            borderRadius: 'var(--radius-sm)',
            lineHeight: '14px',
          }}
          title="Add ticker to this section"
        >+</button>
      </div>

      {/* Inline add ticker */}
      {showAdd && (
        <div style={{
          padding: '3px 8px',
          display: 'flex',
          gap: 4,
          alignItems: 'center',
          background: 'var(--bg-app)',
          borderBottom: '1px solid var(--border-default)',
        }}>
          <input
            ref={addRef}
            style={{
              flex: 1,
              background: 'var(--bg-app)',
              border: `1px solid ${color}44`,
              color: 'var(--text-primary)',
              fontSize: 'var(--font-sm)',
              padding: '2px 6px',
              fontFamily: '"Courier New", monospace',
              outline: 'none',
              borderRadius: 'var(--radius-sm)',
            }}
            value={addVal}
            onChange={(e) => setAddVal(e.target.value.toUpperCase())}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAdd();
              if (e.key === 'Escape') { setShowAdd(false); setAddVal(''); }
            }}
            placeholder="Type ticker symbol…"
          />
          <button
            onClick={handleAdd}
            style={{
              background: color,
              border: 'none',
              color: '#000',
              fontSize: 'var(--font-xs)',
              fontWeight: 700,
              padding: '2px 8px',
              cursor: 'pointer',
              fontFamily: '"Courier New", monospace',
              borderRadius: 'var(--radius-sm)',
            }}
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
          onOpenDetail={onOpenDetail}
          onRemoveTicker={onRemoveTicker}
          onDragStart={onDragStart}
        />
      ))}

      {symbols.length === 0 && (
        <div style={{
          padding: 'var(--sp-3) var(--sp-4)',
          color: 'var(--border-default)',
          fontSize: 'var(--font-sm)',
          fontStyle: 'italic',
          textAlign: 'center',
        }}>
          Empty section — drag tickers here or click + to add
        </div>
      )}
    </div>
  );
}

export default memo(CustomSubsectionBlock);
