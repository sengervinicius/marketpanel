/**
 * TerminalLogo.jsx
 * Brand logo for Terminal — a cool white/silver orb with
 * orbital rings and scattered micro-particles. Data-driven aesthetic.
 * Renders as inline SVG for crisp scaling at any size.
 *
 * Props:
 *   size      — width/height in px (default 32)
 *   glow      — show ambient glow ring (default false)
 *   animated  — enable orbit + breathing animation (default true)
 *   style     — additional inline styles
 *   className — additional CSS class
 */

const TerminalLogo = ({ size = 32, glow = false, animated = true, style, className }) => {
  // Unique IDs to avoid SVG gradient collisions when multiple logos render
  const uid = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID().slice(0, 6)
    : Math.random().toString(36).slice(2, 8);
  const ids = {
    orb: `t-orb-${uid}`,
    hl: `t-hl-${uid}`,
    glow: `t-glow-${uid}`,
    ring: `t-ring-${uid}`,
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
      aria-label="Terminal logo"
    >
      <defs>
        <style>{`
          @keyframes t-breathe-${uid} {
            0%, 100% { transform: scale(1); opacity: 1; }
            50%      { transform: scale(1.06); opacity: 0.92; }
          }
          @keyframes t-orbit-${uid} {
            0%   { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
          @keyframes t-orbit-rev-${uid} {
            0%   { transform: rotate(360deg); }
            100% { transform: rotate(0deg); }
          }
          @keyframes t-pulse-${uid} {
            0%, 100% { opacity: 0.3; }
            50%      { opacity: 0.8; }
          }
          .t-core-${uid} {
            transform-origin: 32px 32px;
            ${animated ? `animation: t-breathe-${uid} 3s ease-in-out infinite;` : ''}
          }
          .t-ring1-${uid} {
            transform-origin: 32px 32px;
            ${animated ? `animation: t-orbit-${uid} 8s linear infinite;` : ''}
          }
          .t-ring2-${uid} {
            transform-origin: 32px 32px;
            ${animated ? `animation: t-orbit-rev-${uid} 12s linear infinite;` : ''}
          }
          .t-dot-${uid} {
            ${animated ? `animation: t-pulse-${uid} 2s ease-in-out infinite;` : ''}
          }
          @media (prefers-reduced-motion: reduce) {
            .t-core-${uid}, .t-ring1-${uid}, .t-ring2-${uid}, .t-dot-${uid} { animation: none !important; }
          }
        `}</style>

        {/* Core orb gradient — cool volumetric white/silver */}
        <radialGradient id={ids.orb} cx="40%" cy="36%" r="55%" fx="38%" fy="34%">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="20%" stopColor="#F0F0F0" />
          <stop offset="45%" stopColor="#D8D8D8" />
          <stop offset="70%" stopColor="#A0A0A0" />
          <stop offset="100%" stopColor="#505050" />
        </radialGradient>

        {/* Specular highlight — ice-blue tint for cool feel */}
        <radialGradient id={ids.hl} cx="36%" cy="30%" r="30%">
          <stop offset="0%" stopColor="#E8F4FD" stopOpacity="0.50" />
          <stop offset="50%" stopColor="#E8F4FD" stopOpacity="0.15" />
          <stop offset="100%" stopColor="#E8F4FD" stopOpacity="0" />
        </radialGradient>

        {/* Ambient glow (optional) */}
        {glow && (
          <radialGradient id={ids.glow} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#B0B0B0" stopOpacity="0.30" />
            <stop offset="40%" stopColor="#B0B0B0" stopOpacity="0.10" />
            <stop offset="70%" stopColor="#B0B0B0" stopOpacity="0.03" />
            <stop offset="100%" stopColor="#B0B0B0" stopOpacity="0" />
          </radialGradient>
        )}
      </defs>

      {/* Ambient glow ring */}
      {glow && (
        <circle cx="32" cy="32" r="31" fill={`url(#${ids.glow})`} />
      )}

      {/* Outer orbital ring 2 — wider, fainter, counter-rotating */}
      <g className={`t-ring2-${uid}`}>
        <ellipse cx="32" cy="32" rx="24" ry="10"
          fill="none" stroke="#B0B0B0" strokeWidth="0.4" strokeOpacity="0.15"
          transform="rotate(-25 32 32)" />
        {/* Orbiting micro-particle on ring 2 */}
        <circle cx="56" cy="32" r="1.2" fill="#D8D8D8" fillOpacity="0.35"
          className={`t-dot-${uid}`} style={{ animationDelay: '0.5s' }}
          transform="rotate(-25 32 32)" />
      </g>

      {/* Orbital ring 1 — inner, brighter */}
      <g className={`t-ring1-${uid}`}>
        <ellipse cx="32" cy="32" rx="19" ry="7"
          fill="none" stroke="#D8D8D8" strokeWidth="0.5" strokeOpacity="0.22"
          transform="rotate(15 32 32)" />
        {/* Orbiting micro-particle on ring 1 */}
        <circle cx="51" cy="32" r="1.5" fill="#E0E0E0" fillOpacity="0.6"
          className={`t-dot-${uid}`}
          transform="rotate(15 32 32)" />
        <circle cx="13" cy="32" r="0.8" fill="#B0B0B0" fillOpacity="0.3"
          className={`t-dot-${uid}`} style={{ animationDelay: '1s' }}
          transform="rotate(15 32 32)" />
      </g>

      {/* Core luminous orb */}
      <g className={`t-core-${uid}`}>
        {/* Soft outer bloom */}
        <circle cx="32" cy="32" r="15" fill="#D8D8D8" fillOpacity="0.08" />
        {/* Main sphere */}
        <circle cx="32" cy="32" r="11" fill={`url(#${ids.orb})`} />
        {/* Specular highlight for 3D depth */}
        <circle cx="29" cy="28" r="7" fill={`url(#${ids.hl})`} />
        {/* Tiny flare — catches the eye with cool tint */}
        <circle cx="27" cy="26" r="1.5" fill="#E8F4FD" fillOpacity="0.35" />
      </g>

      {/* Scattered ambient particles — static sparkle */}
      <circle cx="10" cy="14" r="0.6" fill="#B0B0B0" fillOpacity="0.25"
        className={`t-dot-${uid}`} style={{ animationDelay: '0.3s' }} />
      <circle cx="52" cy="48" r="0.5" fill="#D8D8D8" fillOpacity="0.20"
        className={`t-dot-${uid}`} style={{ animationDelay: '0.8s' }} />
      <circle cx="48" cy="12" r="0.7" fill="#E0E0E0" fillOpacity="0.18"
        className={`t-dot-${uid}`} style={{ animationDelay: '1.5s' }} />
      <circle cx="14" cy="50" r="0.5" fill="#B0B0B0" fillOpacity="0.15"
        className={`t-dot-${uid}`} style={{ animationDelay: '1.2s' }} />
    </svg>
  );
};

export default TerminalLogo;
