/**
 * TechnicalSignalsCard.jsx
 * Shows key technical indicators for a set of tickers (RSI, MACD signal).
 * Fetches from /api/market/td/technicals/:ticker?indicators=RSI,MACD
 */
import { useState, useEffect, useMemo, memo, useRef, useCallback } from 'react';
import { apiFetch } from '../../../utils/api';

function RSIBadge({ rsi }) {
  if (rsi == null || isNaN(rsi)) return <span style={{ color: 'var(--text-muted)' }}>—</span>;

  let textColor, label;
  if (rsi > 70) {
    textColor = 'var(--semantic-down)';
    label = 'Overbought';
  } else if (rsi < 30) {
    textColor = 'var(--price-up)';
    label = 'Oversold';
  } else {
    textColor = 'var(--text-muted)';
    label = 'Neutral';
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{
        color: textColor,
        fontFamily: 'var(--font-mono, monospace)',
        fontSize: 10,
        fontWeight: 600,
      }}>
        {label}
      </span>
      <span style={{
        color: 'var(--text-primary)',
        fontFamily: 'var(--font-mono, monospace)',
        fontSize: 10,
      }}>
        {rsi.toFixed(1)}
      </span>
    </div>
  );
}

function MACDSignal({ macd, signal }) {
  if (macd == null || signal == null || isNaN(macd) || isNaN(signal)) {
    return <span style={{ color: 'var(--text-muted)' }}>—</span>;
  }

  const isBullish = macd > signal;
  const color = isBullish ? 'var(--price-up)' : 'var(--semantic-down)';
  const label = isBullish ? 'Bullish' : 'Bearish';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{
        color: color,
        fontFamily: 'var(--font-mono, monospace)',
        fontSize: 10,
        fontWeight: 600,
      }}>
        {label}
      </span>
      <span style={{
        color: 'var(--text-secondary)',
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
        padding: '4px 8px',
        fontSize: 11,
        fontWeight: 700,
        color: accentColor || 'var(--accent)',
        fontFamily: 'var(--font-mono, monospace)',
        whiteSpace: 'nowrap',
      }}
      className="ds-ticker-col">
        {ticker}
      </td>
      <td style={{
        padding: '4px 8px',
        textAlign: 'center',
      }}>
        <RSIBadge rsi={technicals?.rsi} />
      </td>
      <td style={{
        padding: '4px 8px',
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
        let rsi = null;
        let macd = null;
        let macdSignal = null;

        if (result && result.data) {
          // Extract RSI: API returns { RSI: { indicator, interval, ticker, values: [...] } }
          // We want the latest RSI value
          if (result.data.RSI && Array.isArray(result.data.RSI.values) && result.data.RSI.values.length > 0) {
            const rsiValues = result.data.RSI.values;
            const latest = rsiValues[rsiValues.length - 1];
            // TwelveData returns objects like { datetime, rsi: "42.5" }
            // Try multiple possible field names for robustness
            const rsiRaw = latest?.rsi ?? latest?.value ?? latest?.RSI;
            rsi = (typeof rsiRaw === 'number') ? rsiRaw : parseFloat(rsiRaw);
            if (isNaN(rsi)) rsi = null;
          }

          // Extract MACD: API returns { MACD: { indicator, interval, ticker, values: [...] } }
          // MACD values are typically { macd, macd_signal, macd_histogram } objects
          if (result.data.MACD && Array.isArray(result.data.MACD.values) && result.data.MACD.values.length > 0) {
            const macdValues = result.data.MACD.values;
            const latestMacd = macdValues[macdValues.length - 1];
            macd = parseFloat(latestMacd.macd);
            macdSignal = parseFloat(latestMacd.macd_signal);
          }
        }

        techMap[ticker] = { rsi, macd, macdSignal };
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
    <div style={{ padding: '4px' }}>
      <div style={{
        fontSize: 9,
        color: accentColor || 'var(--text-muted)',
        marginBottom: 8,
        textTransform: 'uppercase',
        letterSpacing: 1,
        fontWeight: 700,
      }}>
        TECHNICAL SIGNALS
      </div>

      {loading ? (
        <div style={{
          height: 100,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-faint)',
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
          color: 'var(--text-muted)',
          fontSize: 10,
        }}>
          No technical data available
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }} className="ds-table">
          <table style={{
            borderCollapse: 'collapse',
            width: '100%',
          }}>
            <thead>
              <tr>
                <th style={{
                  padding: '4px 8px',
                  color: 'var(--text-faint)',
                  fontSize: 8,
                  fontWeight: 500,
                  textAlign: 'left',
                  textTransform: 'uppercase',
                  letterSpacing: 0.3,
                  borderBottom: '1px solid var(--border-default)',
                }}>
                  Ticker
                </th>
                <th style={{
                  padding: '4px 8px',
                  color: 'var(--text-faint)',
                  fontSize: 8,
                  fontWeight: 500,
                  textAlign: 'center',
                  textTransform: 'uppercase',
                  letterSpacing: 0.3,
                  borderBottom: '1px solid var(--border-default)',
                }}>
                  RSI
                </th>
                <th style={{
                  padding: '4px 8px',
                  color: 'var(--text-faint)',
                  fontSize: 8,
                  fontWeight: 500,
                  textAlign: 'center',
                  textTransform: 'uppercase',
                  letterSpacing: 0.3,
                  borderBottom: '1px solid var(--border-default)',
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
    </div>
  );
});

export default TechnicalSignalsCard;
