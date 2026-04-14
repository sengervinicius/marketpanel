import { useState, useCallback, useEffect } from 'react';

/**
 * useKeyboardShortcuts — Global keyboard shortcut handler for The Particle
 *
 * Manages:
 * - Cmd+K / Ctrl+K → Open command palette
 * - Cmd+/ / Ctrl+/ → Focus AI chat input
 * - Escape → Close current modal/panel
 * - 1-9 (when no input focused) → Quick switch to screen by number
 * - Cmd+Shift+P → Open portfolio
 * - Cmd+Shift+V → Open vault
 * - Cmd+Shift+N → Open news
 * - Cmd+H / Ctrl+H → Go home
 * - ? → Open keyboard shortcuts help
 *
 * Returns:
 * - isCommandPaletteOpen: boolean
 * - setCommandPaletteOpen: function to toggle command palette
 * - executeCommand: function to execute a command from the palette
 */

export function useKeyboardShortcuts() {
  const [isCommandPaletteOpen, setCommandPaletteOpen] = useState(false);

  const isInputFocused = useCallback(() => {
    const active = document.activeElement;
    return (
      active?.tagName === 'INPUT' ||
      active?.tagName === 'TEXTAREA' ||
      active?.getAttribute('contenteditable') === 'true'
    );
  }, []);

  const executeCommand = useCallback((command) => {
    // Dispatch custom event that App.jsx can listen for
    window.dispatchEvent(
      new CustomEvent('particle-command-execute', { detail: command })
    );
  }, []);

  // Register keyboard event listeners
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Cmd+K / Ctrl+K → Open command palette (works even from inputs)
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setCommandPaletteOpen(prev => !prev);
        return;
      }

      // Don't trigger shortcuts when in input/textarea
      if (isInputFocused()) {
        return;
      }

      // Cmd+/ / Ctrl+/ → Focus AI chat (or open chat)
      if ((e.ctrlKey || e.metaKey) && e.key === '/') {
        e.preventDefault();
        const chatInput = document.querySelector('[data-particle-chat-input]');
        if (chatInput) {
          chatInput.focus();
        } else {
          window.dispatchEvent(new CustomEvent('particle-open-chat'));
        }
        return;
      }

      // 1-9 → Quick switch to screen (only when not in input)
      if (e.key >= '1' && e.key <= '9' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        const screenMap = [
          'defence',
          'commodities',
          'brazil-em',
          'technology',
          'global-macro',
          'fixed-income',
          'global-retail',
          'asian-markets',
          'european-markets',
        ];
        const idx = parseInt(e.key) - 1;
        if (idx < screenMap.length) {
          window.dispatchEvent(
            new CustomEvent('particle-navigate-screen', { detail: { screen: screenMap[idx] } })
          );
        }
        return;
      }

      // 0 → Crypto screen
      if (e.key === '0' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        window.dispatchEvent(
          new CustomEvent('particle-navigate-screen', { detail: { screen: 'crypto' } })
        );
        return;
      }

      // Cmd+Shift+P → Open portfolio (alternative)
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'P') {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('particle-open-portfolio'));
        return;
      }

      // Cmd+Shift+V → Open vault
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'V') {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('particle-open-vault'));
        return;
      }

      // Cmd+Shift+N → Open news
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'N') {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('particle-open-news'));
        return;
      }

      // Cmd+H / Ctrl+H → Go home
      if ((e.ctrlKey || e.metaKey) && e.key === 'h') {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('particle-go-home'));
        return;
      }

      // ? → Open keyboard shortcuts help
      if (e.key === '?') {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('particle-show-shortcuts'));
        return;
      }

      // Escape → Close command palette
      if (e.key === 'Escape') {
        setCommandPaletteOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isInputFocused]);

  return {
    isCommandPaletteOpen,
    setCommandPaletteOpen,
    executeCommand,
  };
}
