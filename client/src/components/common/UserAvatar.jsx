/**
 * UserAvatar.jsx
 * Renders a circular avatar from pre-made 3D chibi avatars with glow ring
 * and subtle breathe animation. Falls back to initial-letter circle.
 *
 * Images are served as a <picture> triple — AVIF > WebP > PNG — so modern
 * browsers land on the ~5 KB AVIF and older Safari/Firefox fall back to
 * WebP, and anything ancient still gets a slim 192×192 PNG. See #248 / P2.6.
 *
 * Props:
 *   user        — { persona: { type }, username }
 *   size        — 'small' | 'medium' | 'large'  (default: 'medium')
 *   interactive — add breathe animation           (default: false)
 */
import { getPersona, getAvatarSources } from '../../config/avatars';
import './UserAvatar.css';

function UserAvatar({ user, size = 'medium', interactive = false }) {
  const personaType = user?.persona?.type || null;
  const persona = getPersona(personaType);
  const sources = personaType ? getAvatarSources(personaType) : null;
  const initial = (user?.username || '?').charAt(0).toUpperCase();

  const classes = [
    'ua',
    `ua--${size}`,
    interactive ? 'ua--interactive' : '',
    !sources ? 'ua--fallback' : '',
  ].join(' ').trim();

  const color = persona?.color || 'var(--accent)';

  if (!sources) {
    return (
      <div className={classes} style={{ '--ua-color': color }}>
        <span className="ua-initial">{initial}</span>
      </div>
    );
  }

  return (
    <div className={classes} style={{ '--ua-color': color }}>
      <div className="ua-ring" />
      <picture>
        <source srcSet={sources.avif} type="image/avif" />
        <source srcSet={sources.webp} type="image/webp" />
        <img
          src={sources.png}
          alt={persona?.label || 'Investor avatar'}
          className="ua-img"
          draggable={false}
          loading="lazy"
          decoding="async"
        />
      </picture>
    </div>
  );
}

export default UserAvatar;
