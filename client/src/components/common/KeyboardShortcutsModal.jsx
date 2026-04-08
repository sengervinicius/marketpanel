import { useEffect } from 'react';
import './KeyboardShortcutsModal.css';

const SHORTCUTS = [
  { key: 'Cmd/Ctrl + K', description: 'Open AI Chat' },
  { key: '/', description: 'Focus Search' },
  { key: 'Esc', description: 'Close panel / Go back' },
  { key: 'Cmd/Ctrl + 1-9', description: 'Switch sector screens' },
  { key: '?', description: 'Show keyboard shortcuts' },
];

export default function KeyboardShortcutsModal({ onClose }) {
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div className="kb-shortcuts-overlay" onClick={onClose}>
      <div className="kb-shortcuts-modal" onClick={(e) => e.stopPropagation()}>
        <div className="kb-shortcuts-header">
          <h2 className="kb-shortcuts-title">Keyboard Shortcuts</h2>
          <button className="kb-shortcuts-close" onClick={onClose}>×</button>
        </div>

        <div className="kb-shortcuts-list">
          {SHORTCUTS.map((shortcut, idx) => (
            <div key={idx} className="kb-shortcut-item">
              <kbd className="kb-shortcut-key">{shortcut.key}</kbd>
              <span className="kb-shortcut-desc">{shortcut.description}</span>
            </div>
          ))}
        </div>

        <div className="kb-shortcuts-footer">
          <p className="kb-shortcuts-hint">Press <kbd>Esc</kbd> to close</p>
        </div>
      </div>
    </div>
  );
}
