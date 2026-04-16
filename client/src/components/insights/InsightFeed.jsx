/**
 * InsightFeed.jsx — Phase 7: Proactive Insights Feed
 *
 * Fetches and displays market insight cards below the Wire in the AI chat.
 * Auto-refreshes every 60 seconds. Shows max 3 cards by default.
 * If 0 insights: renders nothing (no empty state).
 *
 * Props:
 *   onAskAI  — callback(question) to send a question to the AI chat input
 *   maxCards — max visible cards (default 3)
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import { apiJSON } from '../../utils/api';
import InsightCard from './InsightCard';
import './InsightCard.css';

const POLL_INTERVAL_MS = 60_000; // 60 seconds

export default function InsightFeed({ onAskAI, maxCards = 3 }) {
  const { token } = useAuth();
  const [insights, setInsights] = useState([]);
  const [dismissed, setDismissed] = useState(new Set());
  const [showAll, setShowAll] = useState(false);
  const pollRef = useRef(null);

  const fetchInsights = useCallback(async () => {
    if (!token) return;
    try {
      const data = await apiJSON('/api/insights?limit=10');
      if (data?.insights) {
        setInsights(data.insights);
      }
    } catch {
      // Silent — insights are additive, not critical
    }
  }, [token]);

  // Initial fetch + polling
  useEffect(() => {
    fetchInsights();
    pollRef.current = setInterval(fetchInsights, POLL_INTERVAL_MS);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fetchInsights]);

  const handleDismiss = useCallback((id) => {
    setDismissed(prev => new Set([...prev, id]));
    // Fire-and-forget dismiss to server
    try {
      fetch('/api/insights/dismiss', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ insightId: id }),
      }).catch(() => {});
    } catch { /* ignore */ }
  }, [token]);

  // Filter out dismissed insights
  const visibleInsights = insights.filter(i => !dismissed.has(i.id));
  const displayInsights = showAll ? visibleInsights : visibleInsights.slice(0, maxCards);

  // Render nothing if no insights
  if (visibleInsights.length === 0) return null;

  return (
    <div className="insight-feed">
      <div className="insight-feed-header">
        <span className="insight-feed-label">Insights</span>
        {visibleInsights.length > maxCards && !showAll && (
          <button className="insight-feed-seeall" onClick={() => setShowAll(true)}>
            See all ({visibleInsights.length})
          </button>
        )}
        {showAll && visibleInsights.length > maxCards && (
          <button className="insight-feed-seeall" onClick={() => setShowAll(false)}>
            Show less
          </button>
        )}
      </div>
      {displayInsights.map(insight => (
        <InsightCard
          key={insight.id}
          id={insight.id}
          type={insight.type}
          ticker={insight.ticker}
          narrative={insight.narrative}
          severity={insight.severity}
          timestamp={insight.timestamp}
          questions={insight.questions || []}
          onDismiss={handleDismiss}
          onAskAI={onAskAI}
        />
      ))}
    </div>
  );
}
