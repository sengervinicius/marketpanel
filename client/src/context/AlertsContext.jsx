/**
 * AlertsContext.jsx
 *
 * Client-side state management for alerts.
 *
 * Provides:
 *   - alerts: all user alerts (active + triggered)
 *   - triggeredAlerts: only triggered, non-dismissed alerts (for badge count)
 *   - createAlert(data): create a new alert via API
 *   - updateAlert(id, data): update an alert via API
 *   - deleteAlert(id): delete an alert via API
 *   - dismissAlert(id): mark a triggered alert as dismissed (hides notification badge)
 *   - refreshAlerts(): re-fetch from server
 *   - loading: boolean
 *
 * Polling:
 *   - Re-fetches alerts every 30s to pick up server-side triggers.
 *   - Also refreshes on navigation events and manual calls.
 */

import { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { apiFetch } from '../utils/api';
import { useAuth } from './AuthContext';

const AlertsCtx = createContext(null);

const POLL_INTERVAL_MS = 30_000; // 30s polling for triggered alerts

export function AlertsProvider({ children }) {
  const { user, authReady } = useAuth();
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(false);
  const pollRef = useRef(null);

  // Fetch all alerts from server
  const refreshAlerts = useCallback(async () => {
    if (!user) return;
    try {
      const res = await apiFetch('/api/alerts');
      if (res.ok) {
        const json = await res.json();
        setAlerts(json.data || []);
      }
    } catch (e) {
      console.warn('[AlertsContext] Failed to fetch alerts:', e.message);
    }
  }, [user]);

  // Initial load when auth is ready
  useEffect(() => {
    if (authReady && user) {
      setLoading(true);
      refreshAlerts().finally(() => setLoading(false));
    } else {
      setAlerts([]);
    }
  }, [authReady, user, refreshAlerts]);

  // Polling for triggered alerts
  useEffect(() => {
    if (!user) return;
    pollRef.current = setInterval(refreshAlerts, POLL_INTERVAL_MS);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [user, refreshAlerts]);

  // Create a new alert
  const createAlertFn = useCallback(async (data) => {
    const res = await apiFetch('/api/alerts', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || 'Failed to create alert');
    }
    const json = await res.json();
    const newAlert = json.data;
    // Optimistic: add to local state
    setAlerts(prev => [newAlert, ...prev]);
    return newAlert;
  }, []);

  // Update an alert
  const updateAlertFn = useCallback(async (alertId, data) => {
    const res = await apiFetch(`/api/alerts/${alertId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || 'Failed to update alert');
    }
    const json = await res.json();
    const updated = json.data;
    setAlerts(prev => prev.map(a => a.id === alertId ? updated : a));
    return updated;
  }, []);

  // Delete an alert
  const deleteAlertFn = useCallback(async (alertId) => {
    const res = await apiFetch(`/api/alerts/${alertId}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || 'Failed to delete alert');
    }
    setAlerts(prev => prev.filter(a => a.id !== alertId));
  }, []);

  // Dismiss a triggered alert (marks it as read/dismissed)
  const dismissAlertFn = useCallback(async (alertId) => {
    const res = await apiFetch(`/api/alerts/${alertId}`, {
      method: 'PATCH',
      body: JSON.stringify({ dismissed: true }),
    });
    if (res.ok) {
      setAlerts(prev => prev.map(a => a.id === alertId ? { ...a, dismissed: true } : a));
    }
  }, []);

  // Derived: triggered but not dismissed alerts (for badge count)
  const triggeredAlerts = useMemo(
    () => alerts.filter(a => a.triggeredAt && !a.dismissed),
    [alerts],
  );

  const value = useMemo(() => ({
    alerts,
    triggeredAlerts,
    createAlert: createAlertFn,
    updateAlert: updateAlertFn,
    deleteAlert: deleteAlertFn,
    dismissAlert: dismissAlertFn,
    refreshAlerts,
    loading,
  }), [alerts, triggeredAlerts, createAlertFn, updateAlertFn, deleteAlertFn, dismissAlertFn, refreshAlerts, loading]);

  return (
    <AlertsCtx.Provider value={value}>
      {children}
    </AlertsCtx.Provider>
  );
}

export function useAlerts() {
  const ctx = useContext(AlertsCtx);
  if (!ctx) throw new Error('useAlerts must be used within AlertsProvider');
  return ctx;
}
