/**
 * useBehavior.js — Client-side behavior tracking + smart chips (Wave 10)
 *
 * Sends lightweight events to /api/behavior/track (fire-and-forget).
 * Fetches personalized smart chips from /api/behavior/chips.
 */
import { useCallback, useState, useEffect, useRef } from 'react';
import { API_BASE } from '../utils/api';

function getAuthHeaders() {
  const token = localStorage.getItem('token');
  return token
    ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    : { 'Content-Type': 'application/json' };
}

/**
 * Fire-and-forget behavior event sender.
 */
function sendEvent(eventType, payload = {}) {
  const token = localStorage.getItem('token');
  if (!token) return; // Not logged in

  fetch(`${API_BASE}/api/behavior/track`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ eventType, payload }),
  }).catch(() => {}); // Silent
}

/**
 * Hook: behavior tracking utilities.
 */
export function useBehaviorTracker() {
  const trackSearch = useCallback((query) => {
    sendEvent('search', { query });
  }, []);

  const trackTickerView = useCallback((ticker) => {
    sendEvent('ticker_view', { ticker });
  }, []);

  const trackPanelVisit = useCallback((panel) => {
    sendEvent('panel_visit', { panel });
  }, []);

  const trackSectorView = useCallback((sector) => {
    sendEvent('sector_view', { sector });
  }, []);

  const trackChipClick = useCallback((chip) => {
    sendEvent('chip_click', { chip });
  }, []);

  return {
    trackSearch,
    trackTickerView,
    trackPanelVisit,
    trackSectorView,
    trackChipClick,
  };
}

/**
 * Hook: personalized smart chips.
 * Fetches on mount with 5-min refresh. Falls back to static chips.
 */
const STATIC_CHIPS = [
  { label: 'Market overview', query: 'Give me a quick market overview of major indices, sectors, and any notable moves today.' },
  { label: 'Top movers', query: 'What are the top movers in the US stock market right now? Include gainers and losers.' },
  { label: 'Rate cut odds', query: 'What are the current prediction market odds for the next Fed rate cut? Include Kalshi and Polymarket data.' },
  { label: 'Market predictions', query: 'What are the most interesting prediction markets right now? Show me the top markets with their probabilities.' },
];

export function useSmartChips() {
  const [chips, setChips] = useState(STATIC_CHIPS);
  const [loaded, setLoaded] = useState(false);
  const timerRef = useRef(null);

  const fetchChips = useCallback(async () => {
    try {
      const token = localStorage.getItem('token');
      if (!token) return;

      const resp = await fetch(`${API_BASE}/api/behavior/chips`, {
        headers: getAuthHeaders(),
      });
      if (!resp.ok) return;
      const data = await resp.json();
      if (data.chips && data.chips.length >= 2) {
        setChips(data.chips);
        setLoaded(true);
      }
    } catch (e) {
      // Silent — fall back to static chips
    }
  }, []);

  useEffect(() => {
    // Fetch after short delay (don't block initial render)
    const initial = setTimeout(fetchChips, 3000);
    // Refresh every 5 min
    timerRef.current = setInterval(fetchChips, 5 * 60 * 1000);
    return () => {
      clearTimeout(initial);
      clearInterval(timerRef.current);
    };
  }, [fetchChips]);

  return { chips, loaded };
}
