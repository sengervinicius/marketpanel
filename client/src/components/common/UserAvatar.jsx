/**
 * UserAvatar.jsx
 * Renders a circular avatar from pre-made 3D chibi PNGs with glow ring
 * and subtle breathe animation. Falls back to initial-letter circle.
 *
 * Props:
 *   user        — { persona: { type }, username }
 *   size        — 'small' | 'medium' | 'large'  (default: 'medium')
 *   interactive — add breathe animation           (default: false)
 */
import { getPersona, getAvatarSrc } from '../../config/avatars';
import './UserAvatar.css';

function UserAvatar({ user, size = 'medium', interactive = false }) {
  const personaType = user?.persona?.type || null;
  const persona = getPersona(personaType);
  const src = personaType ? getAvatarSrc(personaType) : null;
  const initial = (user?.username || '?').charAt(0).toUpperCase();

  const classes = [
    'ua',
    `ua--${size}`,
    interactive ? 'ua--interactive' : '',
    !src ? 'ua--fallback' : '',
  ].join(' ').trim();

  const color = persona?.color || 'var(--accent)';

  if (!src) {
    return (
      <div className={classes} style={{ '--ua-color': color }}>
        <span className="ua-initial">{initial}</span>
      </div>
    );
  }

  return (
    <div className={classes} style={{ '--ua-color': color }}>
      <div className="ua-ring" />
      <img
        src={src}
        alt={persona?.label || 'Investor avatar'}
        className="ua-img"
        draggable={false}
      />
    </div>
  );
}

export default UserAvatar;
