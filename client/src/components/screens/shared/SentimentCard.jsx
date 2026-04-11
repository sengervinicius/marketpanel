/**
 * SentimentCard.jsx
 * Displays news sentiment and analyst consensus for sector tickers.
 * Fetches from /api/market/sentiment/:ticker (Eulerpool sentiment API).
 */
import { useState, useEffect, useMemo, memo, useRef, useCallback } from 'react';
import { apiFetch } from '../../../utils/api';

function sentimentColor(score) {
  if (score == null) return 'var(--text-muted)';
  if (score >= 0.3) return 'var(--price-up)';
  if (score <= -0.3) return 'var(--semantic-down)';
  return 'var(--text-muted)';
}

function sentimentLabel(score) {
  if (score == null) return '—';
  if (score >= 0.5) return 'Bullish';
  if (score >= 0.3) return 'Bullish';
  if (score >= 0.1) return 'Bullish';
  if (score > -0.1) return 'Neutral';
  if (score > -0.3) return 'Bearish';
  if (score > -0.5) return 'Bearish';
  return 'Bearish';
}

function TickerSentimentRow({ ticker, data, accentColor }) {
  // Handle multiple field name variations from Eulerpool API
  // The API may return sentiment score as: sentiment_score, sentimentScore, score, or in a nested object
  let score = null;
  if (data) {
    score = data.sentimentScore ?? data.sentiment_score ??
            data.score ??
            data.sentiment?.score ??
            data.sentiment?.sentimentScore ?? null;
    if (score != null) score = parseFloat(score);
  }

  const label = sentimentLabel(score);

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
        fontSize: 10,
        fontWeight: 600,
        color: sentimentColor(score),
      }}>
        {label}
      </td>
      <td style={{
        padding: '4px 8px',
        textAlign: 'right',
        fontSize: 10,
        fontFamily: 'var(--font-mono, monospace)',
        color: 'var(--text-primary)',
        fontWeight: 600,
      }}>
        {score != null ? (score > 0 ? '+' : '') + score.toFixed(2) : '—'}
      </td>
    </tr>
  );
}

export const SentimentCard = memo(function SentimentCard({
  tickers = [],
  accentColor,
}) {
  const [data, setData] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const mountedRef = useRef(true);

  const tickerKey = JSON.stringify(tickers);
  const stableTickers = useMemo(() => tickers.slice(0, 8), [tickerKey]);

  const fetchSentiment = useCallback(async () => {
    if (!stableTickers.length) return;
    setLoading(true);
    setError(null);

    const results = {};
    // Fetch sentiment for each ticker in parallel (Eulerpool endpoint)
    const promises = stableTickers.map(async (ticker) => {
      try {
        const res = await apiFetch(`/api/market/sentiment/${encodeURIComponent(ticker)}`);
        if (!res.ok) { results[ticker] = null; return; }
        const json = await res.json();
        // Server returns { ok, data, source, ticker } — extract inner data
        results[ticker] = json?.data ?? json ?? null;
      } catch (err) {
        // Individual ticker failure is OK — just skip
        results[ticker] = null;
      }
    });

    await Promise.allSettled(promises);
    if (mountedRef.current) {
      setData(results);
      setLoading(false);
    }
  }, [stableTickers]);

  useEffect(() => {
    mountedRef.current = true;
    fetchSentiment();
    return () => { mountedRef.current = false; };
  }, [fetchSentiment]);

  // Check if we have any actual data with real sentiment fields
  const hasData = Object.values(data).some(v => {
    if (v == null) return false;
    // Check if there's at least one real sentiment field
    return (v.sentimentScore ?? v.sentiment_score ?? v.score ??
            v.sentiment?.score ?? v.sentiment?.sentimentScore) != null;
  });

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
        SENTIMENT
      </div>

      {loading ? (
        <div style={{
          height: 80,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-muted)',
          fontSize: 10,
        }}>
          Loading sentiment data…
        </div>
      ) : !hasData ? (
        <div style={{
          height: 60,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-muted)',
          fontSize: 10,
        }}>
          Sentiment data unavailable
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
                  Sentiment
                </th>
                <th style={{
                  padding: '4px 8px',
                  color: 'var(--text-faint)',
                  fontSize: 8,
                  fontWeight: 500,
                  textAlign: 'right',
                  textTransform: 'uppercase',
                  letterSpacing: 0.3,
                  borderBottom: '1px solid var(--border-default)',
                }}>
                  Score
                </th>
              </tr>
            </thead>
            <tbody>
              {stableTickers.map((ticker) => (
                <tr key={ticker}>
                  <TickerSentimentRow
                    ticker={ticker}
                    data={data[ticker]}
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

export default SentimentCard;
