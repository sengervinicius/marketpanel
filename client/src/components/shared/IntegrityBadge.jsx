/**
 * IntegrityBadge — tiny inline warning badge for data integrity issues.
 * Drop into any panel header. Renders nothing when data is clean.
 *
 * Usage:
 *   <IntegrityBadge domain="yield-curves" />
 *   <IntegrityBadge domain="equities" />
 */

import { memo } from 'react';
import { useDataIntegrity } from '../../hooks/useDataIntegrity';

function IntegrityBadge({ domain }) {
  const { getStatus } = useDataIntegrity();
  const status = getStatus(domain);

  if (!status || status.valid !== false) return null;

  const criticalCount = (status.issues || []).filter(i => i.severity === 'critical').length;

  return (
    <span
      className="integrity-badge"
      title={status.summary || 'Data integrity check failed'}
      style={{
        color: '#ff4444',
        fontFamily: 'var(--font-family-mono)',
        fontSize: '6px',
        fontWeight: 700,
        letterSpacing: '0.05em',
        textTransform: 'uppercase',
        animation: 'integrity-pulse 2s ease-in-out infinite',
        cursor: 'help',
        whiteSpace: 'nowrap',
      }}
    >
      {criticalCount > 0 ? 'DATA CHECK FAILED' : 'DATA WARNING'}
    </span>
  );
}

export default memo(IntegrityBadge);
