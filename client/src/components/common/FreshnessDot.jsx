/**
 * FreshnessDot.jsx — #289 part 2
 *
 * 7px coloured dot that tells you whether the price for `symbol` is
 * actually live. Reads from /api/data-freshness/:symbol via useFreshness.
 *
 * Visual encoding:
 *   green  — last upstream write within 30s
 *   amber  — last write 30s – 5m ago
 *   red    — last write > 5m ago (frozen / upstream silent)
 *   grey   — no record yet (server just booted or symbol not subscribed)
 *
 * Hovering reveals a tooltip with the source + age, so a user can answer
 * "why is this red?" without leaving the page.
 */

import { memo } from 'react';
import { useFreshness, freshnessColor } from '../../hooks/useFreshness';

function fmtAge(ageMs) {
  if (ageMs == null) return '—';
  const s = Math.round(ageMs / 1000);
  if (s < 60)    return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60)    return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24)    return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

function FreshnessDot({ symbol, size = 7, style }) {
  const fresh = useFreshness(symbol);
  if (!symbol) return null;
  const colour = freshnessColor(fresh.level);
  const tip = fresh.level === 'unknown'
    ? `${symbol} — no upstream record yet`
    : `${symbol} — ${fresh.level.toUpperCase()} · ${fmtAge(fresh.ageMs)} ago · source: ${fresh.source || 'unknown'}`;
  return (
    <span
      title={tip}
      aria-label={tip}
      style={{
        display: 'inline-block',
        width: size,
        height: size,
        borderRadius: '50%',
        background: colour,
        // soft glow for live ticking; flat for stale / unknown so the
        // colour change is unmistakable.
        boxShadow: fresh.level === 'fresh' ? `0 0 4px ${colour}` : 'none',
        ...style,
      }}
    />
  );
}

export default memo(FreshnessDot);
