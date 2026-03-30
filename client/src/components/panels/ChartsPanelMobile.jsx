/**
 * ChartsPanelMobile.jsx
 *
 * Mobile charts panel with symbol selector bar and synced chart display.
 * Uses settings.charts for symbol list and primary symbol, syncs with desktop.
 */

import { useState, useRef, memo } from 'react';
import { useSettings } from '../../context/SettingsContext';
import ChartPanel from './ChartPanel';

const MAX_CHART_SYMBOLS = 8;

/**
 * ChartsPanelMobile
 * @param {Object} props
 * @param {Function} props.onOpenDetail - Callback to open detail view for a symbol (optional)
 */
function ChartsPanelMobile({ onOpenDetail }) {
  const { settings, updateSettings } = useSettings();

  // Get chart symbols from settings — no hardcoded fallbacks beyond minimal bootstrap
  const chartSymbols = settings?.charts?.symbols?.length
    ? settings.charts.symbols
    : ['SPY', 'QQQ'];
  const defaultPrimary = settings?.charts?.primary || chartSymbols[0] || 'SPY';

  const [activeSymbol, setActiveSymbol] = useState(defaultPrimary);
  const [adding,       setAdding]       = useState(false);
  const [addInput,     setAddInput]     = useState('');
  const inputRef = useRef(null);

  // Ensure activeSymbol is in the list
  const currentSymbol = chartSymbols.includes(activeSymbol) ? activeSymbol : chartSymbols[0];

  const handleAddSymbol = () => {
    const sym = addInput.trim().toUpperCase();
    if (!sym || chartSymbols.includes(sym) || chartSymbols.length >= MAX_CHART_SYMBOLS) {
      setAdding(false);
      setAddInput('');
      return;
    }
    const next = [...chartSymbols, sym];
    updateSettings({ charts: { ...(settings?.charts || {}), symbols: next } });
    setActiveSymbol(sym);
    setAdding(false);
    setAddInput('');
  };

  const handleRemoveSymbol = (sym) => {
    if (chartSymbols.length <= 1) return; // keep at least one
    const next = chartSymbols.filter(s => s !== sym);
    updateSettings({ charts: { ...(settings?.charts || {}), symbols: next } });
    if (currentSymbol === sym) setActiveSymbol(next[0]);
  };

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      background: '#0a0a0a',
      fontFamily: 'monospace',
    }}>
      {/* Symbol selector bar */}
      <div style={{
        display: 'flex',
        overflowX: 'auto',
        padding: '6px 8px',
        gap: 6,
        borderBottom: '1px solid #1e1e1e',
        flexShrink: 0,
        alignItems: 'center',
        // Hide scrollbar but keep scroll functionality
        scrollbarWidth: 'none',
      }}>
        {chartSymbols.map((sym) => (
          <div
            key={sym}
            style={{
              position: 'relative',
              display: 'inline-flex',
              alignItems: 'center',
              flexShrink: 0,
            }}
          >
            <button
              onClick={() => setActiveSymbol(sym)}
              style={{
                padding: '7px 20px 7px 12px',
                fontSize: 11,
                fontFamily: 'monospace',
                background: currentSymbol === sym ? '#ff6600' : '#111',
                color: currentSymbol === sym ? '#000' : '#888',
                border: `1px solid ${currentSymbol === sym ? '#ff6600' : '#2a2a2a'}`,
                borderRadius: 2,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                fontWeight: currentSymbol === sym ? 'bold' : 'normal',
                letterSpacing: '0.05em',
              }}
            >
              {sym}
            </button>
            {/* Remove × button — shown when 2+ symbols exist */}
            {chartSymbols.length > 1 && (
              <button
                onClick={() => handleRemoveSymbol(sym)}
                style={{
                  position: 'absolute', right: 2, top: '50%', transform: 'translateY(-50%)',
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: currentSymbol === sym ? 'rgba(0,0,0,0.5)' : '#333',
                  fontSize: 10, padding: '2px', lineHeight: 1,
                }}
              >×</button>
            )}
          </div>
        ))}

        {/* "+" add slot */}
        {chartSymbols.length < MAX_CHART_SYMBOLS && !adding && (
          <button
            onClick={() => { setAdding(true); setTimeout(() => inputRef.current?.focus(), 50); }}
            style={{
              padding: '7px 10px',
              fontSize: 14,
              fontFamily: 'monospace',
              background: 'transparent',
              color: '#333',
              border: '1px dashed #222',
              borderRadius: 2,
              cursor: 'pointer',
              flexShrink: 0,
              lineHeight: 1,
            }}
          >+</button>
        )}

        {/* Inline add input */}
        {adding && (
          <form
            onSubmit={e => { e.preventDefault(); handleAddSymbol(); }}
            style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}
          >
            <input
              ref={inputRef}
              value={addInput}
              onChange={e => setAddInput(e.target.value.toUpperCase())}
              placeholder="SYMBOL"
              maxLength={12}
              autoCapitalize="characters"
              style={{
                background: '#111', border: '1px solid #ff6600',
                color: '#ff6600', fontSize: 11, fontFamily: 'monospace',
                padding: '7px 8px', borderRadius: 2, width: 80, outline: 'none',
                letterSpacing: '0.05em',
              }}
            />
            <button type="submit" style={{ background: '#ff6600', border: 'none', color: '#000', fontSize: 10, fontWeight: 'bold', padding: '7px 8px', borderRadius: 2, cursor: 'pointer', fontFamily: 'monospace' }}>✓</button>
            <button type="button" onClick={() => { setAdding(false); setAddInput(''); }} style={{ background: 'none', border: '1px solid #222', color: '#444', fontSize: 10, padding: '7px 6px', borderRadius: 2, cursor: 'pointer' }}>✕</button>
          </form>
        )}
      </div>

      {/* Chart */}
      <div style={{
        flex: 1,
        overflow: 'hidden',
        backgroundColor: '#040508',
      }}>
        {currentSymbol ? (
          <ChartPanel
            ticker={currentSymbol}
            mobile={true}
            onOpenDetail={onOpenDetail}
          />
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#222', fontSize: 11 }}>
            Tap + to add a chart
          </div>
        )}
      </div>
    </div>
  );
}

export default memo(ChartsPanelMobile);
