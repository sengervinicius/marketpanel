/**
 * AIQuotaChip.jsx — #291 W3.3
 *
 * Compact "47 / 200" chip showing today's AI-query consumption. Hits
 * GET /api/auth/me/ai-usage on mount and accepts a `refreshKey` prop so
 * the parent (ChatPanel) can re-poll after every AI reply.
 *
 * 404-safe: if the endpoint isn't deployed yet (older server) we render
 * nothing rather than a broken chip.
 *
 * Admin-safe: when the server reports `admin: true` we render a discreet
 * "∞" chip so founders see they're bypassing the limit.
 *
 * Visually mirrors PersonaPickerChip — same chip-style language so the
 * header row stays consistent.
 */

'use strict';

import { useEffect, useState, useRef, useCallback } from 'react';
import { API_BASE } from '../../utils/api';

export default function AIQuotaChip({ refreshKey = 0 }) {
  const [stats, setStats] = useState(null);
  const [open, setOpen] = useState(false);
  const [available, setAvailable] = useState(true);
  const wrapRef = useRef(null);

  const fetchUsage = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/auth/me/ai-usage`, {
        method: 'GET',
        credentials: 'include',
      });
      if (res.status === 404) {
        // Endpoint not deployed → hide the chip.
        setAvailable(false);
        return;
      }
      if (!res.ok) return; // transient — keep last known stats
      const data = await res.json();
      setStats(data);
      setAvailable(true);
    } catch {
      // Network blip — leave the previous value visible.
    }
  }, []);

  useEffect(() => { fetchUsage(); }, [fetchUsage, refreshKey]);

  // Outside-click closes the tooltip.
  useEffect(() => {
    if (!open) return undefined;
    function onDocClick(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  if (!available || !stats) return null;

  const isAdmin = stats.admin === true;
  const isUnlimited = stats.limit === 'unlimited';
  const used = Number(stats.used) || 0;
  const limit = typeof stats.limit === 'number' ? stats.limit : null;
  const remaining = typeof stats.remaining === 'number' ? stats.remaining : null;

  // Choose a tone: green normal, amber 75%+, red 95%+.
  let tone = 'normal';
  if (limit && remaining != null) {
    const pctUsed = used / limit;
    if (pctUsed >= 0.95) tone = 'critical';
    else if (pctUsed >= 0.75) tone = 'warn';
  }

  const colorByTone = {
    normal:   'var(--text-secondary, #999)',
    warn:     'var(--accent-warn, #d4a017)',
    critical: 'var(--accent-danger, #d54a3f)',
  };

  const chipStyle = {
    background: 'none',
    border: '1px solid var(--border, #2a2a2a)',
    cursor: 'pointer',
    padding: '4px 10px',
    marginRight: 6,
    borderRadius: 4,
    color: isAdmin ? 'var(--accent, #2e5a9e)' : colorByTone[tone],
    fontSize: 12,
    fontVariantNumeric: 'tabular-nums',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    whiteSpace: 'nowrap',
  };

  const popStyle = {
    position: 'absolute',
    top: 'calc(100% + 4px)',
    right: 0,
    minWidth: 220,
    background: 'var(--bg-panel, #1a1a1a)',
    border: '1px solid var(--border, #2a2a2a)',
    borderRadius: 4,
    padding: 10,
    boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
    zIndex: 20,
    fontSize: 12,
    color: 'var(--text, #e6e6e6)',
    lineHeight: 1.5,
  };

  const label = isAdmin
    ? 'Admin · ∞'
    : isUnlimited
      ? `${used} · ∞`
      : `${used} / ${limit}`;

  const resetLine = (() => {
    if (isAdmin || isUnlimited || !stats.resetAt) return null;
    try {
      const d = new Date(stats.resetAt);
      const hh = String(d.getUTCHours()).padStart(2, '0');
      const mm = String(d.getUTCMinutes()).padStart(2, '0');
      // Show UTC since that's what the server resets on.
      return `Resets ${hh}:${mm} UTC`;
    } catch { return null; }
  })();

  const titleText = isAdmin
    ? 'Admin bypass — no daily AI limit'
    : isUnlimited
      ? 'Unlimited AI queries on your tier'
      : `AI queries today: ${used} / ${limit}` + (resetLine ? ` · ${resetLine.toLowerCase()}` : '');

  return (
    <div ref={wrapRef} style={{ position: 'relative', marginRight: 6 }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={titleText}
        style={chipStyle}
        aria-label={titleText}
      >
        <span aria-hidden="true" style={{ fontSize: 10, opacity: 0.7 }}>{'AI'}</span>
        <span>{label}</span>
      </button>
      {open && (
        <div style={popStyle} role="dialog">
          <div style={{ fontWeight: 600, marginBottom: 4 }}>
            AI usage today
          </div>
          {isAdmin && (
            <div style={{ color: 'var(--accent, #2e5a9e)' }}>
              Admin bypass — no daily limit.
            </div>
          )}
          {!isAdmin && isUnlimited && (
            <div>Unlimited queries on your tier. Used {used} today.</div>
          )}
          {!isAdmin && !isUnlimited && (
            <>
              <div>
                {used} used &nbsp;/&nbsp; {limit} per day
              </div>
              {remaining != null && (
                <div style={{ color: colorByTone[tone], marginTop: 2 }}>
                  {remaining} remaining
                </div>
              )}
              {resetLine && (
                <div style={{ color: 'var(--text-secondary, #999)', marginTop: 6, fontSize: 11 }}>
                  {resetLine}
                </div>
              )}
              {stats.tier && (
                <div style={{ color: 'var(--text-secondary, #999)', marginTop: 2, fontSize: 11 }}>
                  Tier: {stats.tier}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
