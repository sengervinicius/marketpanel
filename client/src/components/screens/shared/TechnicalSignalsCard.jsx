/**
 * TechnicalSignalsCard.jsx
 * Shows key technical indicators for a set of tickers (RSI, MACD signal).
 * Fetches from /api/market/td/technicals/:ticker?indicators=RSI,MACD
 */
import { useState, useEffect, useMemo, memo, useRef, useCallback } from 'react';
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

function RSIBadge({ rsi }) {
  if (rsi == null) return <span style={{ color: TOKEN_HEX.textMuted }}>—</span>;

  let bgColor, textColor, label;
  if (rsi > 70) {
    bgColor = 'rgba(239, 68, 68, 0.15)';
    textColor = TOKEN_HEX.down;
    label = 'OB';
  } else if (rsi < 30) {
    bgColor = 'rgba(34, 197, 94, 0.15)';
    textColor = TOKEN_HEX.up;
    label = 'OS';
  } else {
    bgColor = 'rgba(255, 102, 0, 0.1)';
    textColor = TOKEN_HEX.accent;
    label = 'N';
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <span style={{
        background: bgColor,
        color: textColor,
        padding: '2px 4px',
        borderRadius: 2,
        fontSize: 8,
        fontWeight: 700,
        letterSpacing: 0.3,
      }}>
        {label}
      </span>
      <span style={{
        color: TOKEN_HEX.textPrimary,
        fontFamily: 'var(--font-mono, monospace)',
        fontSize: 10,
      }}>
        {rsi.toFixed(1)}
      </span>
    </div>
  );
}

function MACDSignal({ macd, signal }) {
  if (macd == null || signal == null) {
    return <span style={{ color: TOKEN_HEX.textMuted }}>—</span>;
  }

  const isBullish = macd > signal;
  const color = isBullish ? TOKEN_HEX.up : TOKEN_HEX.down;
  const label = isBullish ? 'BULL' : 'BEAR';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <span style={{
        background: isBullish ? 'rgba(34, 197, 94, 0.15)' : 'rgba(239, 68, 68, 0.15)',
        color: color,
        padding: '2px 4px',
        borderRadius: 2,
        fontSize: 8,
        fontWeight: 700,
        letterSpacing: 0.3,
      }}>
        {label}
      </span>
      <span style={{
        color: TOKEN_HEX.textSecondary,
        fontFamily: 'var(--font-mono, monospace)',
        fontSize: 9,
      }}>
        {(macd - signal).toFixed(3)}
      </span>
    </div>
  );
}

function TechnicalRow({ ticker, technicals, accentColor }) {
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
        {ticker}
      </td>
      <td style={{
        padding: '6px 8px',
        textAlign: 'center',
      }}>
        <RSIBadge rsi={technicals?.rsi} />
      </td>
      <td style={{
        padding: '6px 8px',
        textAlign: 'center',
      }}>
        <MACDSignal macd={technicals?.macd} signal={technicals?.macdSignal} />
      </td>
    </tr>
  );
}

export const TechnicalSignalsCard = memo(function TechnicalSignalsCard({
  tickers = [],
  accentColor,
}) {
  const [technicals, setTechnicals] = useState({});
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);

  const tickerKey = JSON.stringify(tickers);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const tickerList = useMemo(() => tickers.slice(0, 8), [tickerKey]);

  const fetchTechnicals = useCallback(async () => {
    if (tickerList.length === 0) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      // Fetch all tickers in parallel
      const promises = tickerList.map(ticker =>
        apiFetch(`/api/market/td/technicals/${encodeURIComponent(ticker)}?indicators=RSI,MACD`)
          .then(res => res.ok ? res.json() : null)
          .catch(() => null)
      );

      const results = await Promise.all(promises);
      const techMap = {};

      tickerList.forEach((ticker, idx) => {
        const result = results[idx];
        techMap[ticker] = result || { rsi: null, macd: null, macdSignal: null };
      });

      if (mountedRef.current) setTechnicals(techMap);
    } catch {
      if (mountedRef.current) setTechnicals({});
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [tickerList]);

  useEffect(() => {
    mountedRef.current = true;
    fetchTechnicals();
    return () => { mountedRef.current = false; };
  }, [fetchTechnicals]);

  if (tickerList.length === 0) return null;

  return (
    <div style={{ padding: '8px' }}>
      <div style={{
        fontSize: 9,
        color: accentColor || 'var(--text-muted)',
        marginBottom: 10,
        textTransform: 'uppercase',
        letterSpacing: 1,
        fontWeight: 600,
      }}>
        TECHNICAL SIGNALS
      </div>

      {loading ? (
        <div style={{
          height: 100,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: TOKEN_HEX.textFaint,
          fontSize: 10,
        }}>
          Loading technicals…
        </div>
      ) : Object.keys(technicals).length === 0 ? (
        <div style={{
          height: 60,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: TOKEN_HEX.textMuted,
          fontSize: 10,
        }}>
          No technical data available
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{
            borderCollapse: 'collapse',
            width: '100%',
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
                  textAlign: 'center',
                  textTransform: 'uppercase',
                  letterSpacing: 0.3,
                  borderBottom: `1px solid ${TOKEN_HEX.borderDefault}`,
                }}>
                  RSI
                </th>
                <th style={{
                  padding: '6px 8px',
                  color: TOKEN_HEX.textFaint,
                  fontSize: 8,
                  fontWeight: 500,
                  textAlign: 'center',
                  textTransform: 'uppercase',
                  letterSpacing: 0.3,
                  borderBottom: `1px solid ${TOKEN_HEX.borderDefault}`,
                }}>
                  MACD
                </th>
              </tr>
            </thead>
            <tbody>
              {tickerList.map(ticker => (
                <tr key={ticker}>
                  <TechnicalRow
                    ticker={ticker}
                    technicals={technicals[ticker]}
                    accentColor={accentColor}
                  />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Legend */}
      <div style={{
        display: 'flex',
        gap: 12,
        marginTop: 10,
        fontSize: 8,
        color: TOKEN_HEX.textFaint,
      }}>
        <span title="Overbought">OB = Overbought (&gt;70)</span>
        <span title="Oversold">OS = Oversold (&lt;30)</span>
        <span title="Neutral">N = Neutral</span>
      </div>
    </div>
  );
});

export default TechnicalSignalsCard;
