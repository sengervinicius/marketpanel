/**
 * ThemeContext.jsx
 * Per-user dark/light theme with CSS variable injection.
 * Persists via /api/settings when user is logged in, otherwise localStorage.
 */

import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../utils/api';
import { swallow } from '../utils/swallow';

const LS_THEME   = 'particle_theme';
const ThemeContext = createContext(null);

// Migrate legacy key (at top level so it runs before component mounts)
try { const v = localStorage.getItem('senger_theme'); if (v !== null) { localStorage.setItem('particle_theme', v); localStorage.removeItem('senger_theme'); } } catch (e) { swallow(e, 'context.theme.ls_migrate'); }

// Variable names must match the :root tokens in styles/tokens.css.
// DESIGN-LINT (2026-07): the dark theme used to re-inject a stale palette
// (old Material orange accent, old muted gray, Material green/red up/down) as inline vars on
// <html>, silently overriding tokens.css for the whole app. Dark is now
// "no overrides" — styles/tokens.css is the single source of truth — and
// only the light theme applies inline overrides.
const THEME_VARS = [
  '--bg-app', '--bg-panel', '--bg-surface', '--bg-elevated', '--bg-hover',
  '--bg-active', '--border-subtle', '--border-default', '--border-strong',
  '--text-primary', '--text-secondary', '--text-muted', '--text-faint',
  '--accent', '--accent-muted', '--accent-text',
  '--price-up', '--price-down', '--price-neutral',
];

const THEMES = {
  // Dark theme = tokens.css defaults; nothing to inject.
  dark: {},
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
  // Clear all managed overrides first so switching back to dark restores
  // the tokens.css values instead of stale inline properties.
  THEME_VARS.forEach((k) => root.style.removeProperty(k));
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
    } catch (e) { swallow(e, 'context.theme.persist'); }
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
