/**
 * UserAvatar.jsx
 * Renders the user's persona avatar (PNG) or a fallback initial-letter circle.
 */
import { getAvatarSrc, getPersona } from '../../config/avatars';
import './UserAvatar.css';

function UserAvatar({ user, size = 'medium' }) {
  const type = user?.persona?.type;
  const style = user?.persona?.avatarStyle || 'illustrated';
  const borderStyle = user?.persona?.customization?.borderStyle || 'none';
  const persona = getPersona(type);
  const src = type ? getAvatarSrc(type, style) : null;

  if (!src) {
    const initial = (user?.username || '?').charAt(0).toUpperCase();
    return (
      <div
        className={`ua ua--${size} ua--fallback`}
        style={{ background: persona?.color || 'var(--bg-elevated, #1a1a1a)' }}
        title={user?.username}
      >
        {initial}
      </div>
    );
  }

  return (
    <div
      className={`ua ua--${size} ua--border-${borderStyle}`}
      title={persona?.label || type}
    >
      <img src={src} alt={persona?.label || type} className="ua-img" />
    </div>
  );
}

export default UserAvatar;
