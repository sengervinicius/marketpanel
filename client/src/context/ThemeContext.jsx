/**
 * ThemeContext.jsx
 * Per-user dark/light theme with CSS variable injection.
 * Persists via /api/settings when user is logged in, otherwise localStorage.
 */

import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../utils/api';

const LS_THEME   = 'particle_theme';
const ThemeContext = createContext(null);

// Migrate legacy key (at top level so it runs before component mounts)
try { const v = localStorage.getItem('senger_theme'); if (v !== null) { localStorage.setItem('particle_theme', v); localStorage.removeItem('senger_theme'); } } catch {}

// Variable names must match the :root tokens in App.css
const THEMES = {
  dark: {
    '--bg-app':        '#0a0a0a',
    '--bg-panel':      '#0a0a0a',
    '--bg-surface':    '#0d0d0d',
    '--bg-elevated':   '#111111',
    '--bg-hover':      '#141414',
    '--bg-active':     '#1a1a1a',
    '--border-subtle': '#141414',
    '--border-default':'#1a1a1a',
    '--border-strong': '#2a2a2a',
    '--text-primary':  '#e0e0e0',
    '--text-secondary':'#999999',
    '--text-muted':    '#555555',
    '--text-faint':    '#333333',
    '--accent':        '#F97316',
    '--accent-muted':  '#ff990033',
    '--accent-text':   '#ff9900',
    '--price-up':      '#4caf50',
    '--price-down':    '#f44336',
    '--price-neutral': '#888888',
  },
  light: {
    '--bg-app':        '#f4f4f0',
    '--bg-panel':      '#f9f9f6',
    '--bg-surface':    '#eeeeea',
    '--bg-elevated':   '#e8e8e4',
    '--bg-hover':      '#ddddd8',
    '--bg-active':     '#d0d0cc',
    '--border-subtle': '#d8d8d4',
    '--border-default':'#c8c8c4',
    '--border-strong': '#b0b0ac',
    '--text-primary':  '#1a1a1a',
    '--text-secondary':'#444444',
    '--text-muted':    '#888888',
    '--text-faint':    '#aaaaaa',
    '--accent':        '#cc4400',
    '--accent-muted':  '#cc440033',
    '--accent-text':   '#cc5500',
    '--price-up':      '#007722',
    '--price-down':    '#aa1100',
    '--price-neutral': '#666666',
  },
};

function applyTheme(theme) {
  const vars = THEMES[theme] || THEMES.dark;
  const root = document.documentElement;
  Object.entries(vars).forEach(([k, v]) => root.style.setProperty(k, v));
  document.body.setAttribute('data-theme', theme);
}

export function ThemeProvider({ children, initialTheme }) {
  const [theme, setThemeState] = useState(() => {
    return initialTheme || localStorage.getItem(LS_THEME) || 'dark';
  });

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // Sync if initialTheme changes (from settings load)
  useEffect(() => {
    if (initialTheme && initialTheme !== theme) {
      setThemeState(initialTheme);
    }
  }, [initialTheme]);

  const setTheme = useCallback(async (t) => {
    setThemeState(t);
    localStorage.setItem(LS_THEME, t);
    // Persist to server if logged in
    try {
      await apiFetch('/api/settings', {
        method: 'POST',
        body: JSON.stringify({ theme: t }),
      });
    } catch {}
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  }, [theme, setTheme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
};
