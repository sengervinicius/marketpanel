import { memo } from 'react';

function EmptyState({ icon = '', title, message }) {
  return (
    <div className="empty-state">
      {icon && <div className="empty-state-icon">{icon}</div>}
      {title && <div style={{ fontWeight: 600 }}>{title}</div>}
      <div className="empty-state-text">{message}</div>
    </div>
  );
}

export default memo(EmptyState);
