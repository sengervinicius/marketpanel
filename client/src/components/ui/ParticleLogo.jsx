/**
 * ParticleLogo.jsx
 * Brand logo for Particle — an orange circle with a single protrusion
 * at the 1–2 o'clock position, plus a gentle 2.4s breathing animation.
 * Renders as inline SVG for crisp scaling at any size.
 *
 * Props:
 *   size   — width/height in px (default 32)
 *   glow   — show ambient glow ring (default false)
 *   style  — additional inline styles
 *   className — additional CSS class
 */

const ParticleLogo = ({ size = 32, glow = false, style, className }) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={{ color: 'var(--color-particle, #F97316)', ...style }}
      role="img"
      aria-label="Particle logo"
    >
      <defs>
        {/* Breathing animation — scales the main shape subtly */}
        <style>{`
          @keyframes particle-breathe {
            0%, 100% { transform: scale(1); }
            50%      { transform: scale(1.045); }
          }
          .particle-body {
            transform-origin: 32px 32px;
            animation: particle-breathe 2.4s ease-in-out infinite;
          }
          @media (prefers-reduced-motion: reduce) {
            .particle-body { animation: none; }
          }
        `}</style>
        {glow && (
          <radialGradient id="particle-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.25" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </radialGradient>
        )}
      </defs>

      {/* Ambient glow ring (optional) */}
      {glow && (
        <circle cx="32" cy="32" r="30" fill="url(#particle-glow)" />
      )}

      {/* Main body — circle + protrusion at ~1:30 o'clock */}
      <g className="particle-body">
        <circle cx="32" cy="32" r="14" fill="currentColor" />
        {/* Protrusion — a smaller circle offset to the upper-right,
            merged visually via same fill colour */}
        <circle cx="42" cy="22" r="6" fill="currentColor" />
        {/* Bridge between main circle and protrusion for smooth shape */}
        <ellipse cx="38" cy="26" rx="7" ry="5.5" fill="currentColor" transform="rotate(-30 38 26)" />
      </g>
    </svg>
  );
};

export default ParticleLogo;
