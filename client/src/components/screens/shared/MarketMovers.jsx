/**
 * MarketMovers.jsx
 * Shows top gainers and losers side by side.
 * Fetches from /api/market/movers/gainers and /api/market/movers/losers
 */
import { useState, useEffect, useRef, useCallback, memo } from 'react';
import { apiFetch } from '../../../utils/api';

const TOKEN_HEX = {
  textPrimary:   '#e8e8ed',
  textSecondary: '#999999',
  textMuted:     '#555570',
  textFaint:     '#3a3a4a',
  borderDefault: '#1a1a2a',
  accent:        '#ff6600',
  up:            '#22c55e',
  down:          '#ef4444',
};

function MoverRow({ mover, accentColor, isGainer }) {
  const color = isGainer ? TOKEN_HEX.up : TOKEN_HEX.down;
  const changeStr = mover.change >= 0 ? `+${mover.change.toFixed(2)}` : mover.change.toFixed(2);
  const changePctStr = mover.changePercent >= 0 ? `+${mover.changePercent.toFixed(2)}%` : `${mover.changePercent.toFixed(2)}%`;

  return (
    <tr>
      <td style={{
        padding: '6px 8px',
        fontSize: 11,
        fontWeight: 600,
        color: accentColor || TOKEN_HEX.accent,
        fontFamily: 'var(--font-mono, monospace)',
        whiteSpace: 'nowrap',
      }}>
        {mover.ticker}
      </td>
      <td style={{
        padding: '6px 8px',
        fontSize: 10,
        color: TOKEN_HEX.textPrimary,
        fontFamily: 'var(--font-mono, monospace)',
        textAlign: 'right',
        whiteSpace: 'nowrap',
      }}>
        ${mover.price.toFixed(2)}
      </td>
      <td style={{
        padding: '6px 8px',
        fontSize: 10,
        fontWeight: 600,
        color: color,
        fontFamily: 'var(--font-mono, monospace)',
        textAlign: 'right',
        whiteSpace: 'nowrap',
      }}>
        {changeStr}
      </td>
      <td style={{
        padding: '6px 8px',
        fontSize: 10,
        fontWeight: 600,
        color: color,
        fontFamily: 'var(--font-mono, monospace)',
        textAlign: 'right',
        whiteSpace: 'nowrap',
      }}>
        {changePctStr}
      </td>
    </tr>
  );
}

function MoverPanel({ title, movers, limit, accentColor, isGainer }) {
  const displayMovers = movers.slice(0, limit);

  return (
    <div style={{
      flex: 1,
      minWidth: 200,
    }}>
      <div style={{
        fontSize: 9,
        color: accentColor || 'var(--text-muted)',
        marginBottom: 10,
        textTransform: 'uppercase',
        letterSpacing: 1,
        fontWeight: 600,
      }}>
        {title}
      </div>

      {displayMovers.length === 0 ? (
        <div style={{
          height: 100,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: TOKEN_HEX.textMuted,
          fontSize: 10,
        }}>
          No data available
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{
            borderCollapse: 'collapse',
            width: '100%',
            fontSize: 10,
          }}>
            <thead>
              <tr>
                <th style={{
                  padding: '6px 8px',
                  color: TOKEN_HEX.textFaint,
                  fontSize: 8,
                  fontWeight: 500,
                  textAlign: 'left',
                  textTransform: 'uppercase',
                  letterSpacing: 0.3,
                  borderBottom: `1px solid ${TOKEN_HEX.borderDefault}`,
                }}>
                  Ticker
                </th>
                <th style={{
                  padding: '6px 8px',
                  color: TOKEN_HEX.textFaint,
                  fontSize: 8,
                  fontWeight: 500,
                  textAlign: 'right',
                  textTransform: 'uppercase',
                  letterSpacing: 0.3,
                  borderBottom: `1px solid ${TOKEN_HEX.borderDefault}`,
                }}>
                  Price
                </th>
                <th style={{
                  padding: '6px 8px',
                  color: TOKEN_HEX.textFaint,
                  fontSize: 8,
                  fontWeight: 500,
                  textAlign: 'right',
                  textTransform: 'uppercase',
                  letterSpacing: 0.3,
                  borderBottom: `1px solid ${TOKEN_HEX.borderDefault}`,
                }}>
                  Change
                </th>
                <th style={{
                  padding: '6px 8px',
                  color: TOKEN_HEX.textFaint,
                  fontSize: 8,
                  fontWeight: 500,
                  textAlign: 'right',
                  textTransform: 'uppercase',
                  letterSpacing: 0.3,
                  borderBottom: `1px solid ${TOKEN_HEX.borderDefault}`,
                }}>
                  Chg %
                </th>
              </tr>
            </thead>
            <tbody>
              {displayMovers.map((mover, idx) => (
                <tr key={idx}>
                  <MoverRow
                    mover={mover}
                    accentColor={accentColor}
                    isGainer={isGainer}
                  />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export const MarketMovers = memo(function MarketMovers({
  limit = 10,
  accentColor,
}) {
  const [gainers, setGainers] = useState([]);
  const [losers, setLosers] = useState([]);
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);

  const fetchMovers = useCallback(async () => {
    setLoading(true);
    try {
      const [gainRes, loseRes] = await Promise.all([
        apiFetch('/api/market/movers/gainers'),
        apiFetch('/api/market/movers/losers'),
      ]);

      let gainersData = [];
      let losersData = [];

      if (gainRes.ok) {
        const json = await gainRes.json();
        gainersData = json.movers || json.data || [];
      }

      if (loseRes.ok) {
        const json = await loseRes.json();
        losersData = json.movers || json.data || [];
      }

      if (mountedRef.current) {
        setGainers(gainersData);
        setLosers(losersData);
      }
    } catch {
      if (mountedRef.current) {
        setGainers([]);
        setLosers([]);
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    fetchMovers();
    return () => { mountedRef.current = false; };
  }, [fetchMovers]);

  if (loading && gainers.length === 0 && losers.length === 0) {
    return (
      <div style={{
        padding: '8px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: 150,
        color: TOKEN_HEX.textFaint,
        fontSize: 10,
      }}>
        Loading market movers…
      </div>
    );
  }

  return (
    <div style={{ padding: '8px' }}>
      <div style={{
        display: 'flex',
        gap: 16,
      }}>
        <MoverPanel
          title="TOP GAINERS"
          movers={gainers}
          limit={limit}
          accentColor={TOKEN_HEX.up}
          isGainer={true}
        />
        <MoverPanel
          title="TOP LOSERS"
          movers={losers}
          limit={limit}
          accentColor={TOKEN_HEX.down}
          isGainer={false}
        />
      </div>
    </div>
  );
});

export default MarketMovers;
