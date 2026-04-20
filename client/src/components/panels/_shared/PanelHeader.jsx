import React from 'react';
import './PanelHeader.css';

/**
 * Canonical lower-row panel header.
 *
 *   <PanelHeader title="FLOW" subtitle="SMART MONEY TAPE"
 *                count={clusters.length} timestamp={lastUpdated}
 *                actions={<button>…</button>} />
 *
 * CIO-note (Phase 8.1): Use this everywhere so lower-row panels read as
 * a single instrument. Only add structural options; do not expose
 * colour/padding overrides — those live in PanelHeader.css.
 */
export function PanelHeader({
  title,
  subtitle,
  count,
  timestamp,
  actions,
  className = '',
}) {
  return (
    <div className={`pp-header ${className}`.trim()}>
      <div className="pp-header-title">{title}</div>
      {subtitle ? <div className="pp-header-subtitle">{subtitle}</div> : null}
      <div className="pp-header-spacer" />
      {count != null ? (
        <div className="pp-header-count">{count}</div>
      ) : null}
      {timestamp ? (
        <div className="pp-header-ts" data-testid="panel-header-ts">{timestamp}</div>
      ) : null}
      {actions ? <div className="pp-header-right">{actions}</div> : null}
    </div>
  );
}

export default PanelHeader;
