/**
 * DesktopOnlyPlaceholder.jsx — Phase 10.6
 *
 * Polished fallback shown on mobile for panels/screens that are genuinely
 * unusable on small viewports (dense tables, wide charts, side-by-side
 * grids). Rather than letting the panel break, we render a branded card
 * explaining what the panel offers and pointing the user to open it on
 * desktop. Consistent particle-terminal aesthetic throughout.
 *
 * Usage:
 *   <DesktopOnlyPlaceholder
 *     title="Options Flow"
 *     subtitle="Large-lot options activity across the market"
 *     features={["Strike / expiry heatmaps", "Call/put skew", "Unusual premium flags"]}
 *     onBack={handleGoHome}
 *   />
 */
import './DesktopOnlyPlaceholder.css';

export default function DesktopOnlyPlaceholder({
  title,
  subtitle,
  features = [],
  onBack,
  backLabel = 'Back',
}) {
  return (
    <div className="dop-wrap">
      <div className="dop-card">
        <div className="dop-icon-col">
          <div className="dop-orb-wrap">
            <div className="dop-orb" />
            <div className="dop-orb-ring dop-orb-ring--1" />
            <div className="dop-orb-ring dop-orb-ring--2" />
          </div>
        </div>

        <div className="dop-eyebrow">BEST ON DESKTOP</div>
        {title && <div className="dop-title">{title}</div>}
        {subtitle && <div className="dop-subtitle">{subtitle}</div>}

        <div className="dop-note">
          This view packs dense tables and wide charts that need room to breathe.
          Open <strong>the-particle.com</strong> on a larger screen for the full
          experience.
        </div>

        {features.length > 0 && (
          <div className="dop-features">
            <div className="dop-features-head">WHAT YOU'LL SEE</div>
            <ul>
              {features.map((f, i) => (
                <li key={i}>
                  <span className="dop-bullet" />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {onBack && (
          <button type="button" className="dop-back" onClick={onBack}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
            {backLabel}
          </button>
        )}
      </div>
    </div>
  );
}
