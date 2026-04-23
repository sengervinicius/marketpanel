/**
 * useWire.js — Hook for The Wire (live AI market commentary)
 *
 * Fetches Wire entries from /api/wire and auto-refreshes every 2 min.
 * Also fetches the latest single entry for the Particle welcome screen.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { API_BASE } from '../utils/api';
import { swallow } from '../utils/swallow';

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

/**
 * Morning Brief inbox (Phase 10.7)
 *
 * Polls /api/brief/inbox every 5 minutes and returns the user's 30 most
 * recent briefs plus an unread count (used by the header badge).
 *
 * Exposes:
 *   inbox       — array of { id, briefDate, content, readAt, dismissedAt, ... }
 *   unread      — count of rows with neither readAt nor dismissedAt
 *   loading     — initial-fetch flag
 *   refresh()   — force a refetch (e.g. after user opens the drawer)
 *   markRead(id)    — optimistic + PATCH /inbox/:id/read
 *   dismissItem(id) — optimistic + PATCH /inbox/:id/dismiss
 */
export function useBriefInbox({ pollMs = 5 * 60 * 1000 } = {}) {
  const [inbox, setInbox] = useState([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const timerRef = useRef(null);

  const fetchInbox = useCallback(async () => {
    try {
      const resp = await fetch(`${API_BASE}/api/brief/inbox`, {
        headers: getAuthHeaders(),
      });
      if (!resp.ok) return;
      const data = await resp.json();
      if (Array.isArray(data.inbox)) setInbox(data.inbox);
      if (typeof data.unread === 'number') setUnread(data.unread);
    } catch (_) {
      // Silent — network hiccups shouldn't spam the console.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Don't fetch if there's no auth token — avoids spamming 401s for
    // anonymous visitors on the landing page.
    const token = localStorage.getItem('token');
    if (!token) { setLoading(false); return; }

    fetchInbox();
    timerRef.current = setInterval(fetchInbox, pollMs);
    return () => clearInterval(timerRef.current);
  }, [fetchInbox, pollMs]);

  const markRead = useCallback(async (id) => {
    // Optimistic update first — badge should drop instantly.
    setInbox(prev => prev.map(b => b.id === id && !b.readAt
      ? { ...b, readAt: new Date().toISOString() }
      : b));
    setUnread(u => Math.max(0, u - 1));
    try {
      await fetch(`${API_BASE}/api/brief/inbox/${id}/read`, {
        method: 'PATCH',
        headers: getAuthHeaders(),
      });
    } catch (_) {
      // If the server call fails we'll re-sync on the next poll.
    }
  }, []);

  const dismissItem = useCallback(async (id) => {
    setInbox(prev => prev.map(b => b.id === id
      ? { ...b, dismissedAt: new Date().toISOString(), readAt: b.readAt || new Date().toISOString() }
      : b));
    setUnread(u => Math.max(0, u - 1));
    try {
      await fetch(`${API_BASE}/api/brief/inbox/${id}/dismiss`, {
        method: 'PATCH',
        headers: getAuthHeaders(),
      });
    } catch (e) { swallow(e, 'hook.wire.dismiss_item'); }
  }, []);

  return { inbox, unread, loading, refresh: fetchInbox, markRead, dismissItem };
}
