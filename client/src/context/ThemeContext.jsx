/**
 * ThemeContext.jsx
 * Per-user dark/light theme with CSS variable injection.
 * Persists via /api/settings when user is logged in, otherwise localStorage.
 */

import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../utils/api';

const LS_THEME   = 'senger_theme';
const ThemeContext = createContext(null);

const THEMES = {
  dark: {
    '--bg-primary':    '#0a0a0a',
    '--bg-secondary':  '#050505',
    '--bg-panel':      '#080808',
    '--bg-hover':      '#111',
    '--border':        '#1e1e1e',
    '--border-bright': '#2a2a2a',
    '--text-primary':  '#e0e0e0',
    '--text-secondary':'#888',
    '--text-dim':      '#444',
    '--text-muted':    '#333',
    '--accent':        '#ff6600',
    '--green':         '#00cc44',
    '--red':           '#cc2200',
    '--blue':          '#3388ff',
  },
  light: {
    '--bg-primary':    '#f4f4f0',
    '--bg-secondary':  '#eeeeea',
    '--bg-panel':      '#f9f9f6',
    '--bg-hover':      '#e8e8e4',
    '--border':        '#d0d0cc',
    '--border-bright': '#bbbbb7',
    '--text-primary':  '#1a1a1a',
    '--text-secondary':'#555',
    '--text-dim':      '#888',
    '--text-muted':    '#aaa',
    '--accent':        '#cc4400',
    '--green':         '#007722',
    '--red':           '#aa1100',
    '--blue':          '#1155cc',
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
