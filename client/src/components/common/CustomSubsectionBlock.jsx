/**
 * CustomSubsectionBlock.jsx
 * Renders a user-created custom subsection with its tickers.
 * Includes inline ticker add/remove functionality.
 * Used by StockPanel, ForexPanel, CommoditiesPanel.
 */
import { useState, useRef, useEffect, memo } from 'react';

const fmt = (n) => n == null ? '—' : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtPct = (n) => n == null ? '—' : (n >= 0 ? '+' : '') + n.toFixed(2) + '%';

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

  const color = subsection.color || '#ff6600';
  const symbols = subsection.symbols || [];

  return (
    <div>
      {/* Section header */}
      <div
        style={{
          padding: '2px 8px',
          background: '#0c0c0c',
          borderTop: '1px solid #1a1a1a',
          borderBottom: '1px solid #1a1a1a',
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
        <span style={{ color, fontSize: 7, fontWeight: 700, letterSpacing: '0.12em', flex: 1 }}>
          —— {subsection.label} ————————————————————————
        </span>
        <button
          onClick={() => setShowAdd(v => !v)}
          style={{
            background: 'none',
            border: `1px solid ${showAdd ? color : '#1a1a1a'}`,
            color: showAdd ? color : '#333',
            fontSize: 8,
            padding: '0 4px',
            cursor: 'pointer',
            fontFamily: '"Courier New", monospace',
            borderRadius: 2,
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
          background: '#0a0a0a',
          borderBottom: '1px solid #1a1a1a',
        }}>
          <input
            ref={addRef}
            style={{
              flex: 1,
              background: '#080808',
              border: `1px solid ${color}44`,
              color: '#e0e0e0',
              fontSize: 9,
              padding: '2px 6px',
              fontFamily: '"Courier New", monospace',
              outline: 'none',
              borderRadius: 2,
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
              fontSize: 8,
              fontWeight: 700,
              padding: '2px 8px',
              cursor: 'pointer',
              fontFamily: '"Courier New", monospace',
              borderRadius: 2,
            }}
          >ADD</button>
        </div>
      )}

      {/* Ticker rows */}
      {symbols.map((sym) => {
        const d = data[sym] || {};
        const pos = (d.changePct ?? 0) >= 0;
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
              borderBottom: '1px solid #141414',
              cursor: 'pointer',
              alignItems: 'center',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = '#141414'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
          >
            <span style={{ color, fontSize: '10px', fontWeight: 700 }}>{sym}</span>
            <span style={{ color: '#555', fontSize: '9px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: 4 }}>
              {d.name || sym}
            </span>
            <span style={{ color: '#ccc', fontSize: '10px', textAlign: 'right', paddingRight: 4 }}>
              {fmt(d.price)}
            </span>
            <span style={{
              display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4,
            }}>
              <span style={{ color: pos ? '#4caf50' : '#f44336', fontSize: '10px', fontWeight: 600 }}>
                {fmtPct(d.changePct)}
              </span>
              <button
                onClick={(e) => { e.stopPropagation(); onRemoveTicker?.(subsection.key, sym); }}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#2a2a2a',
                  fontSize: 11,
                  cursor: 'pointer',
                  padding: 0,
                  lineHeight: 1,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.color = '#f44336'; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = '#2a2a2a'; }}
                title={`Remove ${sym} from ${subsection.label}`}
              >×</button>
            </span>
          </div>
        );
      })}

      {symbols.length === 0 && (
        <div style={{
          padding: '8px 12px',
          color: '#222',
          fontSize: 9,
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
