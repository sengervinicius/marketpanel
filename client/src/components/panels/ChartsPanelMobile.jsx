/**
 * ChartsPanelMobile.jsx
 *
 * Mobile charts panel with symbol selector bar and synced chart display.
 * Reads chart symbols from the server's chartGrid field (synced from desktop).
 */

import { useState, useEffect, useRef, memo } from 'react';
import { apiFetch } from '../../utils/api';
import ChartPanel from './ChartPanel';

const MAX_CHART_SYMBOLS = 8;
const SYNC_INTERVAL = 30000; // Refresh every 30 seconds

/**
 * ChartsPanelMobile
 * @param {Object} props
 * @param {Function} props.onOpenDetail - Callback to open detail view for a symbol (optional)
 */
function ChartsPanelMobile({ onOpenDetail }) {
  const [chartSymbols, setChartSymbols] = useState(['SPY', 'QQQ']);
  const [activeSymbol, setActiveSymbol] = useState(() => {
    try {
      return sessionStorage.getItem('activeChartSymbol') || 'SPY';
    } catch {
      return 'SPY';
    }
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const syncTimerRef = useRef(null);

  // Fetch chartGrid from server on mount and periodically
  useEffect(() => {
    const fetchChartGrid = async () => {
      try {
        setError(null);
        const res = await apiFetch('/api/settings');
        if (res.ok) {
          const data = await res.json();
          const grid = data.settings?.chartGrid;
          if (Array.isArray(grid) && grid.length > 0) {
            setChartSymbols(grid);
            // Set active symbol to the first in the grid if not already set
            if (!grid.includes(activeSymbol)) {
              setActiveSymbol(grid[0]);
            }
          }
        } else {
          setError('Failed to load charts');
        }
      } catch (err) {
        setError('Unable to fetch chart data');
      } finally {
        setLoading(false);
      }
    };

    fetchChartGrid();

    // Set up periodic refresh
    syncTimerRef.current = setInterval(fetchChartGrid, SYNC_INTERVAL);
    return () => clearInterval(syncTimerRef.current);
  }, []);

  // Persist active symbol to sessionStorage
  useEffect(() => {
    try {
      sessionStorage.setItem('activeChartSymbol', activeSymbol);
    } catch {
      // Ignore sessionStorage errors
    }
  }, [activeSymbol]);

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
      {/* Error message */}
      {error && (
        <div style={{
          padding: '8px 12px',
          backgroundColor: '#3a1010',
          borderBottom: '1px solid #6a2020',
          color: '#ff6666',
          fontSize: 10,
          flexShrink: 0,
        }}>
          {error}
        </div>
      )}

      {/* Symbol selector bar — read-only, tap to switch displayed chart */}
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
        {loading ? (
          <div style={{ color: '#444', fontSize: 10, padding: '4px 12px' }}>Loading charts…</div>
        ) : (
          chartSymbols.map((sym) => (
            <button
              key={sym}
              onClick={() => setActiveSymbol(sym)}
              style={{
                padding: '7px 12px',
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
                flexShrink: 0,
              }}
            >
              {sym}
            </button>
          ))
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
