/**
 * SentimentCard.jsx
 * Displays news sentiment and analyst consensus for sector tickers.
 * Fetches from /api/market/sentiment/:ticker (Eulerpool sentiment API).
 */
import { useState, useEffect, useMemo, memo, useRef, useCallback } from 'react';
import { apiFetch } from '../../../utils/api';

const TOKEN_HEX = {
  bgPanel:       '#0a0a0f',
  bgSurface:     '#0d0d14',
  borderDefault: '#1a1a2a',
  textPrimary:   '#e8e8ed',
  textSecondary: '#999999',
  textMuted:     '#555570',
  textFaint:     '#3a3a4a',
  accent:        '#ff6600',
  up:            '#22c55e',
  down:          '#ef4444',
  neutral:       '#eab308',
};

function sentimentColor(score) {
  if (score == null) return TOKEN_HEX.textMuted;
  if (score >= 0.3) return TOKEN_HEX.up;
  if (score <= -0.3) return TOKEN_HEX.down;
  return TOKEN_HEX.neutral;
}

function sentimentLabel(score) {
  if (score == null) return '—';
  if (score >= 0.5) return 'Very Bullish';
  if (score >= 0.3) return 'Bullish';
  if (score >= 0.1) return 'Slightly Bullish';
  if (score > -0.1) return 'Neutral';
  if (score > -0.3) return 'Slightly Bearish';
  if (score > -0.5) return 'Bearish';
  return 'Very Bearish';
}

/** Mini horizontal bar for sentiment score (-1 to +1) */
function SentimentBar({ score, accentColor }) {
  const pct = score != null ? Math.round((score + 1) * 50) : 50;
  const color = sentimentColor(score);
  return (
    <div style={{
      width: '100%',
      height: 6,
      borderRadius: 3,
      background: 'rgba(255,255,255,0.04)',
      position: 'relative',
      overflow: 'hidden',
    }}>
      <div style={{
        position: 'absolute',
        left: 0,
        top: 0,
        height: '100%',
        width: `${pct}%`,
        borderRadius: 3,
        background: color,
        opacity: 0.7,
        transition: 'width 0.4s ease',
      }} />
      {/* center line for neutral */}
      <div style={{
        position: 'absolute',
        left: '50%',
        top: 0,
        width: 1,
        height: '100%',
        background: 'rgba(255,255,255,0.1)',
      }} />
    </div>
  );
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

  // Handle consensus/analyst opinion variations
  let consensus = null;
  if (data) {
    consensus = data.analystConsensus ?? data.analyst_consensus ??
                data.consensus ??
                data.opinion ??
                data.sentiment?.consensus ?? null;
    if (consensus && typeof consensus === 'string') consensus = consensus.trim();
  }

  // Handle news count variations
  let newsCount = null;
  if (data) {
    newsCount = data.newsCount ?? data.news_count ??
                data.articles ?? data.article_count ??
                data.news?.count ?? null;
    if (newsCount != null) newsCount = parseInt(newsCount, 10);
  }

  const label = sentimentLabel(score);

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      padding: '8px 10px',
      borderBottom: `1px solid ${TOKEN_HEX.borderDefault}`,
    }}>
      {/* ticker */}
      <span style={{
        minWidth: 52,
        fontSize: 11,
        fontWeight: 700,
        color: accentColor || TOKEN_HEX.accent,
        fontFamily: 'var(--font-mono, monospace)',
        letterSpacing: '0.5px',
      }}>
        {ticker}
      </span>

      {/* sentiment bar */}
      <div style={{ flex: 1, minWidth: 60 }}>
        <SentimentBar score={score} accentColor={accentColor} />
      </div>

      {/* label */}
      <span style={{
        minWidth: 80,
        fontSize: 10,
        fontWeight: 600,
        color: sentimentColor(score),
        textAlign: 'center',
      }}>
        {label}
      </span>

      {/* score */}
      <span style={{
        minWidth: 36,
        fontSize: 10,
        fontFamily: 'var(--font-mono, monospace)',
        color: sentimentColor(score),
        textAlign: 'right',
        fontWeight: 600,
      }}>
        {score != null ? (score > 0 ? '+' : '') + score.toFixed(2) : '—'}
      </span>

      {/* consensus */}
      <span style={{
        minWidth: 40,
        fontSize: 9,
        color: TOKEN_HEX.textSecondary,
        textAlign: 'right',
        textTransform: 'uppercase',
      }}>
        {consensus || '—'}
      </span>

      {/* news count */}
      {newsCount != null && (
        <span style={{
          fontSize: 8,
          color: TOKEN_HEX.textMuted,
          minWidth: 24,
          textAlign: 'right',
        }}>
          {newsCount} art.
        </span>
      )}
    </div>
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
        if (res && typeof res === 'object') {
          results[ticker] = res;
        }
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

  // Check if we have any actual data
  const hasData = Object.values(data).some(v => v != null);

  return (
    <div style={{
      background: TOKEN_HEX.bgSurface,
      border: `1px solid ${TOKEN_HEX.borderDefault}`,
      borderRadius: 4,
      overflow: 'hidden',
    }}>
      {/* header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '8px 10px',
        borderBottom: `1px solid ${TOKEN_HEX.borderDefault}`,
      }}>
        <span style={{
          fontSize: 9,
          fontWeight: 700,
          letterSpacing: '1.2px',
          color: TOKEN_HEX.textSecondary,
          textTransform: 'uppercase',
        }}>
          News Sentiment
        </span>
        <span style={{ fontSize: 8, color: TOKEN_HEX.textFaint }}>
          EULERPOOL
        </span>
      </div>

      {/* column headers */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '4px 10px',
        borderBottom: `1px solid ${TOKEN_HEX.borderDefault}`,
      }}>
        <span style={{ minWidth: 52, fontSize: 8, color: TOKEN_HEX.textMuted, fontWeight: 600 }}>TICKER</span>
        <span style={{ flex: 1, minWidth: 60, fontSize: 8, color: TOKEN_HEX.textMuted, fontWeight: 600, textAlign: 'center' }}>SENTIMENT</span>
        <span style={{ minWidth: 80, fontSize: 8, color: TOKEN_HEX.textMuted, fontWeight: 600, textAlign: 'center' }}>SIGNAL</span>
        <span style={{ minWidth: 36, fontSize: 8, color: TOKEN_HEX.textMuted, fontWeight: 600, textAlign: 'right' }}>SCORE</span>
        <span style={{ minWidth: 40, fontSize: 8, color: TOKEN_HEX.textMuted, fontWeight: 600, textAlign: 'right' }}>VIEW</span>
      </div>

      {/* body */}
      {loading ? (
        <div style={{ padding: '20px 10px', textAlign: 'center', color: TOKEN_HEX.textMuted, fontSize: 10 }}>
          Loading sentiment data…
        </div>
      ) : !hasData ? (
        <div style={{ padding: '20px 10px', textAlign: 'center', color: TOKEN_HEX.textMuted, fontSize: 10 }}>
          Sentiment data unavailable
        </div>
      ) : (
        stableTickers.map((ticker) => (
          <TickerSentimentRow
            key={ticker}
            ticker={ticker}
            data={data[ticker]}
            accentColor={accentColor}
          />
        ))
      )}
    </div>
  );
});

export default SentimentCard;
