/**
 * ToastContainer.jsx
 * Renders active toasts. Place once in the app shell.
 */
import { memo } from 'react';
import { useToast } from '../../context/ToastContext';

function ToastContainer() {
  const { toasts, removeToast } = useToast();
  if (toasts.length === 0) return null;

  return (
    <div className="toast-container">
      {toasts.map(t => (
        <div key={t.id} className="toast-item" onClick={() => removeToast(t.id)}>
          <div className="toast-title">{t.title}</div>
          {t.body && <div className="toast-body">{t.body}</div>}
        </div>
      ))}
    </div>
  );
}

export default memo(ToastContainer);
