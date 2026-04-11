/**
 * MarketMovers.jsx
 * Shows top gainers and losers side by side.
 * Fetches from /api/market/movers/gainers and /api/market/movers/losers
 */
import { useState, useEffect, useRef, useCallback, memo } from 'react';
import { apiFetch } from '../../../utils/api';

function MoverRow({ mover, isGainer }) {
  const changeStr = mover.change >= 0 ? `+${mover.change.toFixed(2)}` : mover.change.toFixed(2);
  const changePctStr = mover.changePercent >= 0 ? `+${mover.changePercent.toFixed(2)}%` : `${mover.changePercent.toFixed(2)}%`;
  const cls = isGainer ? 'ds-up' : 'ds-down';

  return (
    <tr>
      <td className="ds-ticker-col">{mover.ticker}</td>
      <td style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{mover.price.toFixed(2)}</td>
      <td className={cls}>{changeStr}</td>
      <td className={cls}>{changePctStr}</td>
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
        color: 'var(--text-muted)',
        marginBottom: 6,
        textTransform: 'uppercase',
        letterSpacing: 1,
        fontWeight: 700,
      }}>
        {title}
      </div>

      {displayMovers.length === 0 ? (
        <div style={{
          height: 60,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-muted)',
          fontSize: 10,
        }}>
          No data available
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="ds-table">
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Ticker</th>
                <th>Price</th>
                <th>Change</th>
                <th>Chg %</th>
              </tr>
            </thead>
            <tbody>
              {displayMovers.map((mover, idx) => (
                  <MoverRow
                    key={idx}
                    mover={mover}
                    isGainer={isGainer}
                  />
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
        color: 'var(--text-faint)',
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
          isGainer={true}
        />
        <MoverPanel
          title="TOP LOSERS"
          movers={losers}
          limit={limit}
          isGainer={false}
        />
      </div>
    </div>
  );
});

export default MarketMovers;
