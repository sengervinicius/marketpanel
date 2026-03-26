/**
 * ChartsPanelMobile.jsx
 *
 * Mobile charts panel with symbol selector bar and synced chart display.
 * Uses settings.charts for symbol list and primary symbol, syncs with desktop.
 */

import { useState } from 'react';
import { useSettings } from '../../context/SettingsContext';
import { ChartPanel } from './ChartPanel';

/**
 * ChartsPanelMobile
 * @param {Object} props
 * @param {Function} props.onOpenDetail - Callback to open detail view for a symbol (optional)
 */
export default function ChartsPanelMobile({ onOpenDetail }) {
  const { settings } = useSettings();

  // Get chart symbols from settings or defaults
  const chartSymbols = settings?.charts?.symbols || ['SPY', 'QQQ'];
  const defaultPrimary = settings?.charts?.primary || chartSymbols[0] || 'SPY';

  const [activeSymbol, setActiveSymbol] = useState(defaultPrimary);

  // Ensure activeSymbol is in the list
  const currentSymbol = chartSymbols.includes(activeSymbol) ? activeSymbol : chartSymbols[0];

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
        padding: '8px',
        gap: 8,
        borderBottom: '1px solid #1e1e1e',
        flexShrink: 0,
      }}>
        {chartSymbols.map((sym) => (
          <button
            key={sym}
            onClick={() => setActiveSymbol(sym)}
            style={{
              padding: '4px 10px',
              fontSize: 10,
              fontFamily: 'monospace',
              background: currentSymbol === sym ? '#ff6600' : '#111',
              color: currentSymbol === sym ? '#000' : '#888',
              border: `1px solid ${currentSymbol === sym ? '#ff6600' : '#2a2a2a'}`,
              borderRadius: 2,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              flexShrink: 0,
              fontWeight: currentSymbol === sym ? 'bold' : 'normal',
              letterSpacing: '0.05em',
              transition: 'all 0.15s',
            }}
          >
            {sym}
          </button>
        ))}
      </div>

      {/* Chart */}
      <div style={{
        flex: 1,
        overflow: 'hidden',
        backgroundColor: '#040508',
      }}>
        <ChartPanel
          ticker={currentSymbol}
          mobile={true}
          onOpenDetail={onOpenDetail}
        />
      </div>
    </div>
  );
}
