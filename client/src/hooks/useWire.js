/**
 * useWire.js — Hook for The Wire (live AI market commentary)
 *
 * Fetches Wire entries from /api/wire and auto-refreshes every 2 min.
 * Also fetches the latest single entry for the Particle welcome screen.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { API_BASE } from '../utils/api';

const REFRESH_INTERVAL = 2 * 60 * 1000; // 2 minutes

function getAuthHeaders() {
  const token = localStorage.getItem('token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * Full Wire feed (for Wire panel)
 */
export function useWireFeed(limit = 20) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const timerRef = useRef(null);

  const fetchEntries = useCallback(async () => {
    try {
      const resp = await fetch(`${API_BASE}/api/wire?limit=${limit}`, {
        headers: getAuthHeaders(),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      setEntries(data.entries || []);
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [limit]);

  useEffect(() => {
    fetchEntries();
    timerRef.current = setInterval(fetchEntries, REFRESH_INTERVAL);
    return () => clearInterval(timerRef.current);
  }, [fetchEntries]);

  return { entries, loading, error, refresh: fetchEntries };
}

/**
 * Latest single Wire entry (for Particle welcome screen)
 */
export function useWireLatest() {
  const [entry, setEntry] = useState(null);
  const timerRef = useRef(null);

  const fetchLatest = useCallback(async () => {
    try {
      const resp = await fetch(`${API_BASE}/api/wire/latest`, {
        headers: getAuthHeaders(),
      });
      if (!resp.ok) return;
      const data = await resp.json();
      if (data.entry) setEntry(data.entry);
    } catch (e) {
      // Silent fail — Wire is non-critical
    }
  }, []);

  useEffect(() => {
    fetchLatest();
    timerRef.current = setInterval(fetchLatest, REFRESH_INTERVAL);
    return () => clearInterval(timerRef.current);
  }, [fetchLatest]);

  return entry;
}

/**
 * Morning Brief
 */
export function useMorningBrief() {
  const [brief, setBrief] = useState(null);
  const [loading, setLoading] = useState(true);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Check if already dismissed today
    const dismissKey = `brief-dismissed-${new Date().toISOString().slice(0, 10)}`;
    if (localStorage.getItem(dismissKey)) {
      setDismissed(true);
      setLoading(false);
      return;
    }

    async function fetchBrief() {
      try {
        const resp = await fetch(`${API_BASE}/api/wire/brief`, {
          headers: getAuthHeaders(),
        });
        if (!resp.ok) return;
        const data = await resp.json();
        if (data.brief) setBrief(data.brief);
      } catch (e) {
        // Silent
      } finally {
        setLoading(false);
      }
    }
    fetchBrief();
  }, []);

  const dismiss = useCallback(() => {
    setDismissed(true);
    const dismissKey = `brief-dismissed-${new Date().toISOString().slice(0, 10)}`;
    localStorage.setItem(dismissKey, '1');
  }, []);

  return { brief, loading, dismissed, dismiss };
}
