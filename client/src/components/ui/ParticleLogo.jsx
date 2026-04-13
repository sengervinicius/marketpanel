/**
 * ParticleLogo.jsx
 * Brand logo for Particle — a radiant orange sphere with a protrusion
 * at the 1–2 o'clock position (like a cell about to divide),
 * plus a gentle 2.4s breathing animation.
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
      style={{ ...style }}
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

        {/* Main sphere gradient — warm orange with depth */}
        <radialGradient id="p-orb" cx="38%" cy="38%" r="52%" fx="36%" fy="36%">
          <stop offset="0%" stopColor="#FFB347" />
          <stop offset="30%" stopColor="#F97316" />
          <stop offset="65%" stopColor="#EA580C" />
          <stop offset="100%" stopColor="#C2410C" />
        </radialGradient>

        {/* Protrusion gradient — slightly lighter to pop */}
        <radialGradient id="p-prot" cx="40%" cy="35%" r="55%">
          <stop offset="0%" stopColor="#FFB347" />
          <stop offset="40%" stopColor="#F97316" />
          <stop offset="100%" stopColor="#EA580C" />
        </radialGradient>

        {/* Specular highlight */}
        <radialGradient id="p-hl" cx="35%" cy="28%" r="35%">
          <stop offset="0%" stopColor="#FFF" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#FFF" stopOpacity="0" />
        </radialGradient>

        {/* Ambient glow (optional) */}
        {glow && (
          <radialGradient id="p-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#F97316" stopOpacity="0.35" />
            <stop offset="60%" stopColor="#F97316" stopOpacity="0.08" />
            <stop offset="100%" stopColor="#F97316" stopOpacity="0" />
          </radialGradient>
        )}
      </defs>

      {/* Ambient glow ring (optional) */}
      {glow && (
        <circle cx="32" cy="32" r="30" fill="url(#p-glow)" />
      )}

      {/* Main body — sphere + protrusion at ~1:30 o'clock */}
      <g className="particle-body">
        {/* Main sphere */}
        <circle cx="32" cy="32" r="14" fill="url(#p-orb)" />
        {/* Protrusion — smaller sphere offset to upper-right */}
        <circle cx="42" cy="22" r="6" fill="url(#p-prot)" />
        {/* Bridge between main sphere and protrusion for smooth organic shape */}
        <ellipse cx="38" cy="26" rx="7" ry="5.5" fill="url(#p-orb)" transform="rotate(-30 38 26)" />
        {/* Specular highlight for 3D depth */}
        <circle cx="28" cy="28" r="8" fill="url(#p-hl)" />
        {/* Small highlight on protrusion */}
        <circle cx="40" cy="20" r="3" fill="url(#p-hl)" />
      </g>
    </svg>
  );
};

export default ParticleLogo;
