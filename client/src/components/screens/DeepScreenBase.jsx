/**
 * DeepScreenBase.jsx — S3.B
 * Configurable layout grid for deep sector/thematic screens.
 * Each section component fetches its own data via useSectionData.
 */
import { memo, Component, useState, useEffect } from 'react';
import { useIsMobile } from '../../hooks/useIsMobile';
import { useScreenContext } from '../../context/ScreenContext';
import { sanitizeTicker } from '../../utils/ticker';
import AIInsightCard from '../ai/AIInsightCard';
import VaultInsights from '../common/VaultInsights';
import './DeepScreen.css';

/* ── Section-level error boundary ───────────────────────────────────────── */
class SectionErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { hasError: false, error: null }; }
  static getDerivedStateFromError(error) { return { hasError: true, error }; }
  componentDidCatch(error, info) { console.error(`[DeepScreen] ${this.props.section || 'Section'} error:`, error, info); }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '12px 8px', color: 'var(--text-secondary)', fontSize: 10, textAlign: 'center' }}>
          <span style={{ color: 'var(--text-muted)' }}>Section loading issue</span>
          <div style={{ color: 'var(--text-faint)', marginTop: 4 }}>Something went wrong. Try refreshing.</div>
          <button onClick={() => this.setState({ hasError: false, error: null })}
            style={{ marginTop: 6, background: 'transparent', border: '1px solid var(--border-strong)', color: 'var(--text-secondary)', padding: '3px 10px', borderRadius: 3, cursor: 'pointer', fontSize: 9 }}>
            RETRY
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

/* ── Section chrome — wraps each section component ───────────────────────── */
export function DeepSection({ title, badge, children }) {
  return (
    <div className="ds-section">
      <div className="ds-section-head">
        <span className="ds-section-title">{title}</span>
        {badge && <span className="ds-section-badge">{badge}</span>}
      </div>
      <div className="ds-section-body">
        {children}
      </div>
    </div>
  );
}

/* ── Skeleton loader ─────────────────────────────────────────────────────── */
export function DeepSkeleton({ rows = 6 }) {
  return (
    <div className="ds-skeleton">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="ds-skeleton-row" style={{ width: `${90 - i * 5}%` }} />
      ))}
    </div>
  );
}

/* ── Error banner ────────────────────────────────────────────────────────── */
/**
 * Sanitise technical error strings so users never see raw HTTP/JSON/
 * stack-trace text. Legacy callers pass `Error: ${err.message}` which can
 * surface things like "Error: HTTP 500" or "Error: NetworkError". We collapse
 * those into a single human line while keeping dev visibility via the DOM
 * data attribute (inspectable but not rendered).
 */
function humanizeDeepError(raw) {
  if (!raw) return 'Data temporarily unavailable.';
  const text = String(raw);
  const technicalMarkers = [
    /^Error:\s*/i,
    /^HTTP\s*\d+/i,
    /NetworkError/i,
    /TypeError/i,
    /Failed to fetch/i,
    /\{.*\}/, // raw JSON leaked through
  ];
  if (technicalMarkers.some(rx => rx.test(text))) {
    return 'Data temporarily unavailable — retrying shortly.';
  }
  return text;
}

export function DeepError({ message, onRetry }) {
  const friendly = humanizeDeepError(message);
  return (
    <div className="ds-error" data-raw-error={message || ''}>
      {friendly}
      {onRetry && (
        <button onClick={onRetry}
          style={{ marginLeft: 10, background: 'transparent', border: '1px solid var(--border-strong)', color: 'var(--text-secondary)', padding: '2px 8px', borderRadius: 3, cursor: 'pointer', fontSize: 9 }}>
          RETRY
        </button>
      )}
    </div>
  );
}

/* ── Stats load gate — shows skeleton/error/children based on useDeepScreenData state ── */
/* Sprint 3: 12s timeout — if still loading after 12s, show error card with Retry */
export function StatsLoadGate({ statsMap, loading, error, refresh, rows = 6, children }) {
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    if (!loading) { setTimedOut(false); return; }
    const timer = setTimeout(() => setTimedOut(true), 12000);
    return () => clearTimeout(timer);
  }, [loading]);

  const hasData = statsMap && statsMap.size > 0;

  if (timedOut && !hasData) {
    return <DeepError message="Loading market data... This may take a moment." onRetry={() => { setTimedOut(false); refresh?.(); }} />;
  }
  if (loading && !hasData) {
    return <DeepSkeleton rows={rows} />;
  }
  if (error && !hasData) {
    return <DeepError message="Loading data..." onRetry={refresh} />;
  }
  return children;
}

/* ── Ticker chip with click ──────────────────────────────────────────────── */
export function TickerCell({ symbol, label, price, changePct, onClick }) {
  const displaySym = sanitizeTicker(symbol || '')
    .replace('.SA', '').replace('=F', '');

  return (
    <div
      className="ds-ticker-cell"
      onClick={() => onClick?.(symbol)}
      title={label || symbol}
    >
      <span className="ds-ticker-sym">{displaySym}</span>
      {price != null && (
        <span className="ds-ticker-price">
          {price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </span>
      )}
      {changePct != null && (
        <span className={`ds-ticker-chg ${changePct >= 0 ? 'up' : 'down'}`}>
          {changePct >= 0 ? '+' : ''}{changePct.toFixed(2)}%
        </span>
      )}
    </div>
  );
}

/* ── Main DeepScreenBase ─────────────────────────────────────────────────── */
function DeepScreenBase({ title, accentColor, sections, aiType, aiContext, aiCacheKey, children, screenKey, visibleTickers = [], vaultSector }) {
  const isMobile = useIsMobile();
  const { updateScreen } = useScreenContext();

  // Update screen context on mount
  useEffect(() => {
    updateScreen(screenKey, title, visibleTickers);
  }, [screenKey, title, visibleTickers, updateScreen]);

  return (
    <div className="ds-screen">
      {/* Header */}
      <div className="ds-header">
        <div className="ds-header-accent" style={{ background: accentColor || '#ff6b00' }} />
        <div className="ds-header-title">{title}</div>
      </div>

      {/* AI Insight — auto-fetch enabled */}
      {aiType && (
        <div className="ds-ai-slot">
          <AIInsightCard
            type={aiType}
            context={aiContext}
            cacheKey={aiCacheKey || `${aiType}:${title}`}
            compact={isMobile}
            autoFetch={true}
          />
        </div>
      )}

      {/* Vault Research Insights (cross-pillar integration) */}
      {vaultSector && (
        <div className="ds-vault-slot" style={{ padding: '0 12px 8px' }}>
          <VaultInsights sector={vaultSector} />
        </div>
      )}

      {/* Section Grid */}
      <div className={`ds-grid ${isMobile ? 'ds-grid--mobile' : ''}`}>
        {sections && sections.map((sec) => (
          <DeepSection key={sec.id} title={sec.title} badge={sec.badge}>
            <SectionErrorBoundary section={sec.title}>
              <sec.component />
            </SectionErrorBoundary>
          </DeepSection>
        ))}
      </div>

      {/* Extra content (e.g., ETF strips) */}
      {children}
    </div>
  );
}

export default memo(DeepScreenBase);
