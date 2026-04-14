import { useEffect } from 'react';
import './KeyboardShortcutsHelp.css';

/**
 * KeyboardShortcutsHelp.jsx — Terminal-style keyboard shortcuts help modal
 *
 * Shows all available shortcuts in grouped categories
 * Opens with ? key
 * Styled to match The Particle's terminal aesthetic
 */

const SHORTCUTS = [
  {
    category: 'Command Palette',
    icon: '⌘',
    shortcuts: [
      { keys: 'Cmd+K', description: 'Open command palette' },
      { keys: '?', description: 'Show this help' },
    ],
  },
  {
    category: 'Navigation',
    icon: '→',
    shortcuts: [
      { keys: 'Cmd+H', description: 'Go to home' },
      { keys: 'Cmd+1-9', description: 'Jump to sector screens' },
      { keys: 'Cmd+0', description: 'Jump to crypto screen' },
      { keys: 'Esc', description: 'Go back / close modal' },
    ],
  },
  {
    category: 'AI & Chat',
    icon: '✨',
    shortcuts: [
      { keys: 'Cmd+/', description: 'Focus AI chat input' },
    ],
  },
  {
    category: 'Panels',
    icon: '⚡',
    shortcuts: [
      { keys: 'Cmd+Shift+P', description: 'Open portfolio' },
      { keys: 'Cmd+Shift+V', description: 'Open vault' },
      { keys: 'Cmd+Shift+N', description: 'Open news' },
    ],
  },
  {
    category: 'Keyboard Shortcuts',
    icon: '⌨',
    shortcuts: [
      { keys: '↑ ↓', description: 'Navigate in command palette' },
      { keys: 'Enter', description: 'Select command' },
      { keys: 'Esc', description: 'Close palette / dialog' },
    ],
  },
];

export default function KeyboardShortcutsHelp({ isOpen, onClose }) {
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="shortcuts-help-overlay" onClick={onClose}>
      <div className="shortcuts-help-modal" onClick={(e) => e.stopPropagation()}>
        <div className="shortcuts-help-header">
          <h2 className="shortcuts-help-title">⌨ Keyboard Shortcuts</h2>
          <button
            className="shortcuts-help-close"
            onClick={onClose}
            aria-label="Close help"
          >
            ✕
          </button>
        </div>

        <div className="shortcuts-help-content">
          {SHORTCUTS.map((group, groupIdx) => (
            <div key={groupIdx} className="shortcuts-help-group">
              <div className="shortcuts-help-group-header">
                <span className="shortcuts-help-group-icon">{group.icon}</span>
                <h3 className="shortcuts-help-group-title">{group.category}</h3>
              </div>

              <div className="shortcuts-help-list">
                {group.shortcuts.map((shortcut, idx) => (
                  <div key={idx} className="shortcuts-help-item">
                    <div className="shortcuts-help-keys">
                      {shortcut.keys.split(' ').map((key, keyIdx) => (
                        <span key={keyIdx}>
                          {keyIdx > 0 && <span className="shortcuts-help-separator">+</span>}
                          <kbd className="shortcuts-help-key">{key}</kbd>
                        </span>
                      ))}
                    </div>
                    <span className="shortcuts-help-desc">{shortcut.description}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="shortcuts-help-footer">
          <p className="shortcuts-help-footer-text">
            Press <kbd>Esc</kbd> to close • Use <kbd>Cmd+K</kbd> to access the command palette anytime
          </p>
        </div>
      </div>
    </div>
  );
}
