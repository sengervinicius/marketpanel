/**
 * FreshnessDot.jsx — Phase 9.1 canonical freshness indicator.
 *
 * One small colored dot next to a panel's timestamp slot. Green means
 * we have live data from the last minute, amber 1–5 min, red >5 min or
 * stale, grey unknown. Hover shows "source · 23s ago".
 *
 * Usage:
 *   <FreshnessDot updatedAt={data?.asOf} source="Yahoo" />
 *
 * Designed to be tiny (6px dot, 9px mono text) — lives inside PanelHeader
 * without changing the 22-px header height.
 */
import React, { useState, useEffect } from 'react';
import './FreshnessDot.css';

function ageSeconds(updatedAt) {
  if (!updatedAt) return null;
  const t = updatedAt instanceof Date ? updatedAt : new Date(updatedAt);
  if (Number.isNaN(t.getTime())) return null;
  return Math.max(0, Math.floor((Date.now() - t.getTime()) / 1000));
}

function fmtAge(s) {
  if (s == null) return '—';
  if (s < 60)    return `${s}s`;
  if (s < 3600)  return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

/**
 * Props:
 *   updatedAt: ISO string or Date (required)
 *   source:    e.g. "Yahoo", "Polygon", "BCB", "Finnhub" (optional)
 *   variant:   'dot' (just dot + mono age) | 'full' (dot + source + age) — default 'dot'
 */
export default function FreshnessDot({ updatedAt, source, variant = 'dot' }) {
  // Force periodic re-render so age text doesn't freeze
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick(t => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const age = ageSeconds(updatedAt);
  let level = 'unknown';
  if (age != null) {
    if (age < 60)       level = 'fresh';
    else if (age < 300) level = 'ok';
    else if (age < 900) level = 'stale';
    else                level = 'very-stale';
  }

  const tip = [
    source ? `Source: ${source}` : null,
    age != null ? `Updated: ${fmtAge(age)} ago` : 'Updated: unknown',
  ].filter(Boolean).join('  ·  ');

  return (
    <span className={`pp-fresh pp-fresh-${level}`} title={tip} aria-label={tip}>
      <span className="pp-fresh-dot" />
      {variant === 'full' && source ? <span className="pp-fresh-src">{source}</span> : null}
      <span className="pp-fresh-age">{fmtAge(age)}</span>
    </span>
  );
}
