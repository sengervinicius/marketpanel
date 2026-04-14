import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import './CommandPalette.css';

/**
 * CommandPalette.jsx — Keyboard-driven command palette for The Particle
 *
 * Features:
 * - Opens with Cmd+K (Mac) / Ctrl+K (Windows)
 * - Fuzzy search over commands
 * - Keyboard navigation (arrow keys, enter, escape)
 * - Recently used commands appear first
 * - Terminal-style dark theme with green accent
 * - Smooth animations
 * - Shows keyboard shortcuts inline
 */

// Command structure for different categories
const COMMAND_GROUPS = [
  {
    category: 'Navigation',
    icon: '→',
    commands: [
      { id: 'home', label: 'Go to Home', action: 'navigate', target: 'home', shortcut: 'Cmd+H' },
      { id: 'defence', label: 'Go to Defence Screen', action: 'navigate', target: 'defence', shortcut: 'Cmd+1' },
      { id: 'commodities', label: 'Go to Commodities Screen', action: 'navigate', target: 'commodities', shortcut: 'Cmd+2' },
      { id: 'brazil-em', label: 'Go to Brazil EM Screen', action: 'navigate', target: 'brazil-em', shortcut: 'Cmd+3' },
      { id: 'technology', label: 'Go to Technology Screen', action: 'navigate', target: 'technology', shortcut: 'Cmd+4' },
      { id: 'global-macro', label: 'Go to Global Macro Screen', action: 'navigate', target: 'global-macro', shortcut: 'Cmd+5' },
      { id: 'fixed-income', label: 'Go to Fixed Income Screen', action: 'navigate', target: 'fixed-income', shortcut: 'Cmd+6' },
      { id: 'global-retail', label: 'Go to Global Retail Screen', action: 'navigate', target: 'global-retail', shortcut: 'Cmd+7' },
      { id: 'asian-markets', label: 'Go to Asian Markets Screen', action: 'navigate', target: 'asian-markets', shortcut: 'Cmd+8' },
      { id: 'european-markets', label: 'Go to European Markets Screen', action: 'navigate', target: 'european-markets', shortcut: 'Cmd+9' },
      { id: 'crypto', label: 'Go to Crypto Screen', action: 'navigate', target: 'crypto', shortcut: 'Cmd+0' },
    ],
  },
  {
    category: 'AI',
    icon: '✨',
    commands: [
      { id: 'ask-particle', label: 'Ask Particle...', action: 'chat', shortcut: 'Cmd+/' },
      { id: 'deep-analysis', label: 'Deep Analysis', action: 'ai-action', target: 'deep-analysis' },
      { id: 'morning-brief', label: 'Morning Brief', action: 'ai-action', target: 'morning-brief' },
    ],
  },
  {
    category: 'Actions',
    icon: '⚡',
    commands: [
      { id: 'new-alert', label: 'New Alert', action: 'action', target: 'new-alert' },
      { id: 'upload-vault', label: 'Upload to Vault', action: 'action', target: 'upload-vault' },
      { id: 'clear-chat', label: 'Clear Chat History', action: 'action', target: 'clear-chat' },
      { id: 'toggle-theme', label: 'Toggle Theme', action: 'action', target: 'toggle-theme' },
    ],
  },
];

// Flatten commands for searching
function flattenCommands(groups) {
  const flat = [];
  groups.forEach(group => {
    group.commands.forEach(cmd => {
      flat.push({ ...cmd, category: group.category, categoryIcon: group.icon });
    });
  });
  return flat;
}

// Simple fuzzy search function
function fuzzySearch(query, commands) {
  if (!query.trim()) return commands;

  const q = query.toLowerCase();
  return commands
    .map(cmd => {
      const label = cmd.label.toLowerCase();
      const categoryMatch = cmd.category.toLowerCase();

      // Exact match scores highest
      if (label === q) return { cmd, score: 1000 };
      if (label.startsWith(q)) return { cmd, score: 100 };
      if (categoryMatch.includes(q)) return { cmd, score: 50 };

      // Fuzzy match: check if all query chars appear in order
      let queryIdx = 0;
      let score = 0;
      for (let i = 0; i < label.length && queryIdx < q.length; i++) {
        if (label[i] === q[queryIdx]) {
          queryIdx++;
          score += 10;
        }
      }

      if (queryIdx === q.length) return { cmd, score };
      return null;
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)
    .map(({ cmd }) => cmd);
}

export default function CommandPalette({ isOpen, onClose, onCommand }) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef(null);
  const paletteRef = useRef(null);

  const allCommands = useMemo(() => flattenCommands(COMMAND_GROUPS), []);

  // Get recently used from localStorage
  const recentlyUsed = useMemo(() => {
    try {
      const stored = localStorage.getItem('particle_recent_commands');
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  }, []);

  const filteredCommands = useMemo(() => {
    const results = fuzzySearch(query, allCommands);

    // If no query, show recently used first
    if (!query.trim() && recentlyUsed.length > 0) {
      const recent = results.filter(cmd => recentlyUsed.includes(cmd.id));
      const rest = results.filter(cmd => !recentlyUsed.includes(cmd.id));
      return [...recent.slice(0, 5), ...rest];
    }

    return results;
  }, [query, allCommands, recentlyUsed]);

  // Reset selection when filtered results change
  useEffect(() => {
    setSelectedIndex(0);
  }, [filteredCommands]);

  // Focus input when palette opens
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  // Keyboard navigation
  const handleKeyDown = useCallback((e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => (prev + 1) % filteredCommands.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => (prev - 1 + filteredCommands.length) % filteredCommands.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filteredCommands[selectedIndex]) {
        executeSelectedCommand();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  }, [filteredCommands, selectedIndex]);

  const executeSelectedCommand = useCallback(() => {
    const cmd = filteredCommands[selectedIndex];
    if (!cmd) return;

    // Save to recently used
    try {
      let recent = JSON.parse(localStorage.getItem('particle_recent_commands') || '[]');
      recent = recent.filter(id => id !== cmd.id);
      recent.unshift(cmd.id);
      localStorage.setItem('particle_recent_commands', JSON.stringify(recent.slice(0, 10)));
    } catch {}

    // Execute command
    onCommand(cmd);
    onClose();
  }, [filteredCommands, selectedIndex, onCommand, onClose]);

  if (!isOpen) return null;

  return (
    <div className="command-palette-overlay" onClick={onClose}>
      <div className="command-palette" ref={paletteRef} onClick={e => e.stopPropagation()}>
        {/* Search input */}
        <div className="command-palette-input-wrapper">
          <span className="command-palette-icon">⌘</span>
          <input
            ref={inputRef}
            type="text"
            placeholder="Search commands..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            className="command-palette-input"
          />
          {query && (
            <button
              className="command-palette-clear"
              onClick={() => {
                setQuery('');
                inputRef.current?.focus();
              }}
            >
              ✕
            </button>
          )}
        </div>

        {/* Commands list */}
        <div className="command-palette-list">
          {filteredCommands.length > 0 ? (
            filteredCommands.map((cmd, idx) => (
              <div
                key={cmd.id}
                className={`command-palette-item ${idx === selectedIndex ? 'selected' : ''}`}
                onClick={() => {
                  setSelectedIndex(idx);
                  executeSelectedCommand();
                }}
                onMouseEnter={() => setSelectedIndex(idx)}
              >
                <div className="command-palette-item-content">
                  <div className="command-palette-item-header">
                    <span className="command-palette-item-icon">{cmd.categoryIcon}</span>
                    <span className="command-palette-item-label">{cmd.label}</span>
                  </div>
                  <span className="command-palette-item-category">{cmd.category}</span>
                </div>
                {cmd.shortcut && (
                  <span className="command-palette-item-shortcut">{cmd.shortcut}</span>
                )}
              </div>
            ))
          ) : (
            <div className="command-palette-empty">
              <p>No commands found</p>
              <span className="command-palette-empty-hint">Try a different search</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="command-palette-footer">
          <span className="command-palette-footer-item">
            <kbd>↑↓</kbd> to navigate
          </span>
          <span className="command-palette-footer-item">
            <kbd>Enter</kbd> to select
          </span>
          <span className="command-palette-footer-item">
            <kbd>Esc</kbd> to close
          </span>
        </div>
      </div>
    </div>
  );
}
