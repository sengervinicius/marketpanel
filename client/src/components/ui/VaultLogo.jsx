/**
 * VaultLogo.jsx
 * Brand logo for Vault — a premium gold orb with
 * orbital rings and scattered micro-particles. Secure, valuable aesthetic.
 * Renders as inline SVG for crisp scaling at any size.
 *
 * Props:
 *   size      — width/height in px (default 32)
 *   glow      — show ambient glow ring (default false)
 *   animated  — enable orbit + breathing animation (default true)
 *   style     — additional inline styles
 *   className — additional CSS class
 */

const VaultLogo = ({ size = 32, glow = false, animated = true, style, className }) => {
  // Unique IDs to avoid SVG gradient collisions when multiple logos render
  const uid = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID().slice(0, 6)
    : Math.random().toString(36).slice(2, 8);
  const ids = {
    orb: `v-orb-${uid}`,
    hl: `v-hl-${uid}`,
    glow: `v-glow-${uid}`,
    ring: `v-ring-${uid}`,
  };

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
      aria-label="Vault logo"
    >
      <defs>
        <style>{`
          @keyframes v-breathe-${uid} {
            0%, 100% { transform: scale(1); opacity: 1; }
            50%      { transform: scale(1.06); opacity: 0.92; }
          }
          @keyframes v-orbit-${uid} {
            0%   { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
          @keyframes v-orbit-rev-${uid} {
            0%   { transform: rotate(360deg); }
            100% { transform: rotate(0deg); }
          }
          @keyframes v-pulse-${uid} {
            0%, 100% { opacity: 0.3; }
            50%      { opacity: 0.8; }
          }
          .v-core-${uid} {
            transform-origin: 32px 32px;
            ${animated ? `animation: v-breathe-${uid} 3s ease-in-out infinite;` : ''}
          }
          .v-ring1-${uid} {
            transform-origin: 32px 32px;
            ${animated ? `animation: v-orbit-${uid} 8s linear infinite;` : ''}
          }
          .v-ring2-${uid} {
            transform-origin: 32px 32px;
            ${animated ? `animation: v-orbit-rev-${uid} 12s linear infinite;` : ''}
          }
          .v-dot-${uid} {
            ${animated ? `animation: v-pulse-${uid} 2s ease-in-out infinite;` : ''}
          }
          @media (prefers-reduced-motion: reduce) {
            .v-core-${uid}, .v-ring1-${uid}, .v-ring2-${uid}, .v-dot-${uid} { animation: none !important; }
          }
        `}</style>

        {/* Core orb gradient — rich volumetric gold */}
        <radialGradient id={ids.orb} cx="40%" cy="36%" r="55%" fx="38%" fy="34%">
          <stop offset="0%" stopColor="#FFE4A0" />
          <stop offset="20%" stopColor="#FFD700" />
          <stop offset="45%" stopColor="#c9a84c" />
          <stop offset="70%" stopColor="#B8860B" />
          <stop offset="100%" stopColor="#8B6914" />
        </radialGradient>

        {/* Specular highlight — warm white-gold for premium feel */}
        <radialGradient id={ids.hl} cx="36%" cy="30%" r="30%">
          <stop offset="0%" stopColor="#FFF8DC" stopOpacity="0.50" />
          <stop offset="50%" stopColor="#FFF8DC" stopOpacity="0.15" />
          <stop offset="100%" stopColor="#FFF8DC" stopOpacity="0" />
        </radialGradient>

        {/* Ambient glow (optional) */}
        {glow && (
          <radialGradient id={ids.glow} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#c9a84c" stopOpacity="0.35" />
            <stop offset="40%" stopColor="#c9a84c" stopOpacity="0.12" />
            <stop offset="70%" stopColor="#c9a84c" stopOpacity="0.04" />
            <stop offset="100%" stopColor="#c9a84c" stopOpacity="0" />
          </radialGradient>
        )}
      </defs>

      {/* Ambient glow ring */}
      {glow && (
        <circle cx="32" cy="32" r="31" fill={`url(#${ids.glow})`} />
      )}

      {/* Outer orbital ring 2 — wider, fainter, counter-rotating */}
      <g className={`v-ring2-${uid}`}>
        <ellipse cx="32" cy="32" rx="24" ry="10"
          fill="none" stroke="#c9a84c" strokeWidth="0.4" strokeOpacity="0.14"
          transform="rotate(-25 32 32)" />
        {/* Orbiting micro-particle on ring 2 */}
        <circle cx="56" cy="32" r="1.2" fill="#c9a84c" fillOpacity="0.35"
          className={`v-dot-${uid}`} style={{ animationDelay: '0.5s' }}
          transform="rotate(-25 32 32)" />
      </g>

      {/* Orbital ring 1 — inner, brighter */}
      <g className={`v-ring1-${uid}`}>
        <ellipse cx="32" cy="32" rx="19" ry="7"
          fill="none" stroke="#FFD700" strokeWidth="0.5" strokeOpacity="0.20"
          transform="rotate(15 32 32)" />
        {/* Orbiting micro-particle on ring 1 */}
        <circle cx="51" cy="32" r="1.5" fill="#FFE4A0" fillOpacity="0.6"
          className={`v-dot-${uid}`}
          transform="rotate(15 32 32)" />
        <circle cx="13" cy="32" r="0.8" fill="#c9a84c" fillOpacity="0.3"
          className={`v-dot-${uid}`} style={{ animationDelay: '1s' }}
          transform="rotate(15 32 32)" />
      </g>

      {/* Core luminous orb */}
      <g className={`v-core-${uid}`}>
        {/* Soft outer bloom */}
        <circle cx="32" cy="32" r="15" fill="#c9a84c" fillOpacity="0.08" />
        {/* Main sphere */}
        <circle cx="32" cy="32" r="11" fill={`url(#${ids.orb})`} />
        {/* Specular highlight for 3D depth */}
        <circle cx="29" cy="28" r="7" fill={`url(#${ids.hl})`} />
        {/* Tiny flare — catches the eye with warm gold tint */}
        <circle cx="27" cy="26" r="1.5" fill="#FFF8DC" fillOpacity="0.35" />
      </g>

      {/* Scattered ambient particles — static sparkle */}
      <circle cx="10" cy="14" r="0.6" fill="#c9a84c" fillOpacity="0.25"
        className={`v-dot-${uid}`} style={{ animationDelay: '0.3s' }} />
      <circle cx="52" cy="48" r="0.5" fill="#FFD700" fillOpacity="0.20"
        className={`v-dot-${uid}`} style={{ animationDelay: '0.8s' }} />
      <circle cx="48" cy="12" r="0.7" fill="#FFE4A0" fillOpacity="0.18"
        className={`v-dot-${uid}`} style={{ animationDelay: '1.5s' }} />
      <circle cx="14" cy="50" r="0.5" fill="#c9a84c" fillOpacity="0.15"
        className={`v-dot-${uid}`} style={{ animationDelay: '1.2s' }} />
    </svg>
  );
};

export default VaultLogo;
