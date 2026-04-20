import React from 'react';
import FreshnessDot from './FreshnessDot';
import './PanelHeader.css';

/**
 * Canonical lower-row panel header.
 *
 *   <PanelHeader title="FLOW" subtitle="SMART MONEY TAPE"
 *                count={clusters.length}
 *                updatedAt={data?.asOf} source="Yahoo"
 *                actions={<button>…</button>} />
 *
 * CIO-note (Phase 8.1): Use this everywhere so lower-row panels read as
 * a single instrument. Only add structural options; do not expose
 * colour/padding overrides — those live in PanelHeader.css.
 *
 * Phase 9.1: added `updatedAt` + `source` props. When passed, the header
 * renders a standardized FreshnessDot (colored dot + age). The legacy
 * `timestamp` string prop still works for panels that render their own
 * format; if both are set, `updatedAt` wins.
 */
export function PanelHeader({
  title,
  subtitle,
  count,
  timestamp,
  updatedAt,
  source,
  actions,
  className = '',
}) {
  const hasFreshness = updatedAt != null;
  return (
    <div className={`pp-header ${className}`.trim()}>
      <div className="pp-header-title">{title}</div>
      {subtitle ? <div className="pp-header-subtitle">{subtitle}</div> : null}
      <div className="pp-header-spacer" />
      {count != null ? (
        <div className="pp-header-count">{count}</div>
      ) : null}
      {hasFreshness ? (
        <FreshnessDot updatedAt={updatedAt} source={source} />
      ) : null}
      {timestamp && !hasFreshness ? (
        <div className="pp-header-ts" data-testid="panel-header-ts">{timestamp}</div>
      ) : null}
      {actions ? <div className="pp-header-right">{actions}</div> : null}
    </div>
  );
}

export default PanelHeader;
