/**
 * PanelState.jsx — #292 F2: the ONE loading / empty / error body.
 *
 * "No chart data", "Couldn't load movers — tap retry", "NO CURVE DATA ·
 * RETRY", "—" and "LOADING..." were five vocabularies for three states.
 *
 *   <PanelState kind="loading" />
 *   <PanelState kind="empty"  title="No positions" hint="Add one from search" />
 *   <PanelState kind="error"  title="Feed unavailable" detail={err} onRetry={reload} />
 *   <PanelState kind="unavailable" title="DI curve needs a data contract" detail="brapi Pro or ANBIMA" />
 *
 * `detail` is the honest one-liner from the server (reason / providerError).
 */
import './PanelState.css';

const WORD = { loading: 'LOADING', empty: 'NO DATA', error: 'UNAVAILABLE', unavailable: 'NOT CONFIGURED' };

export default function PanelState({ kind = 'empty', title, detail, hint, onRetry, compact = false }) {
  return (
    <div className={`panel-state panel-state--${kind}${compact ? ' panel-state--compact' : ''}`} role={kind === 'error' ? 'alert' : 'status'}>
      {kind === 'loading' ? <span className="panel-state-bar" aria-hidden="true" /> : null}
      <span className="panel-state-word">{title || WORD[kind]}</span>
      {detail ? <span className="panel-state-detail" title={detail}>{detail}</span> : null}
      {hint ? <span className="panel-state-hint">{hint}</span> : null}
      {onRetry ? (
        <button type="button" className="panel-state-retry" onClick={onRetry}>RETRY</button>
      ) : null}
    </div>
  );
}
