/**
 * paintAllowlist.js — the set of colors allowed to PAINT in the app.
 *
 * Generated from styles/tokens.css + utils/tokenHex.js during the 2026-07
 * design-lint sweep; consumed by tests/e2e/design-lint.spec.js, which walks
 * the rendered home screen and asserts every computed color resolves to an
 * entry here. If you add a token, add its value here too (or regenerate).
 *
 * RULES
 *  - TOKEN_COLORS: values of design tokens. Extend only via tokens.css.
 *  - CHART_EXCEPTIONS: data-viz ramps and residual categorical palettes that
 *    are intentional inside charts/badges. Do not use for UI chrome.
 *  - KNOWN_OFFENDERS: legacy literals we are burning down. The lint test
 *    tolerates them (with a logged count) but fails on anything new.
 */

export const TOKEN_COLORS = [
  '#000000', '#00bcd4', '#00ff88', '#0a0a0a', '#0a0a0f', '#111111',
  '#161616', '#1e1e1e', '#2196f3', '#222222', '#225522', '#22c55e',
  '#26c6da', '#333333', '#374151', '#3b82f6', '#3dd68c', '#3f51b5',
  '#475569', '#4caf50', '#4db854', '#5a5a5a', '#607d8b', '#60a5fa',
  '#666666', '#888888', '#8b93a7', '#9c27b0', '#a0a0a0', '#a855f7',
  '#aaaaaa', '#c084fc', '#c9a84c', '#cc4f00', '#ce93d8', '#d0d0d0',
  '#e05c8a', '#e0e0e0', '#e55a00', '#e8a020', '#e91e63', '#ef4444',
  '#ef5350', '#f0f0f0', '#f59e0b', '#f7931a', '#ff5722', '#ff6b6b',
  '#ff9800', '#ffd700',
];

// rgba() token values (borders, tints, glows) — compared with alpha intact.
export const TOKEN_RGBA = [
  'rgba(0,0,0,0.6)', 'rgba(0,0,0,0.8)', 'rgba(0,0,0,0.9)', 'rgba(10,10,15,0.70)', 'rgba(139,147,167,0.10)', 'rgba(139,147,167,0.22)',
  'rgba(192,132,252,0.12)', 'rgba(192,132,252,0.28)', 'rgba(20,20,30,0.80)', 'rgba(201,168,76,0.04)', 'rgba(201,168,76,0.08)', 'rgba(201,168,76,0.10)',
  'rgba(201,168,76,0.12)', 'rgba(201,168,76,0.18)', 'rgba(201,168,76,0.20)', 'rgba(201,168,76,0.35)', 'rgba(201,168,76,0.60)', 'rgba(206,147,216,0.12)',
  'rgba(224,224,224,0.06)', 'rgba(224,224,224,0.15)', 'rgba(224,92,138,0.12)', 'rgba(224,92,138,0.28)', 'rgba(229,90,0,0.10)', 'rgba(229,90,0,0.15)',
  'rgba(229,90,0,0.20)', 'rgba(229,90,0,0.40)', 'rgba(232,160,32,0.12)', 'rgba(232,160,32,0.28)', 'rgba(239,68,68,0.12)', 'rgba(255,255,255,0.04)',
  'rgba(255,255,255,0.06)', 'rgba(255,255,255,0.08)', 'rgba(255,255,255,0.12)', 'rgba(255,255,255,0.30)', 'rgba(255,255,255,0.35)', 'rgba(255,255,255,0.40)',
  'rgba(255,255,255,0.45)', 'rgba(255,255,255,0.85)', 'rgba(255,255,255,0.90)', 'rgba(34,197,94,0.10)', 'rgba(61,214,140,0.12)', 'rgba(61,214,140,0.28)',
  'rgba(96,165,250,0.12)', 'rgba(96,165,250,0.28)',
];

export const CHART_EXCEPTIONS = [
  '#002a0a', '#03a9f4', '#050508', '#1a0000', '#1a0030', '#1a1400',
  '#1a1a1a', '#1b5e20', '#26a69a', '#2e7d32', '#4fc3f7', '#66bb6a',
  '#7f0000', '#81c784', '#8bc34a', '#90caf9', '#b71c1c', '#cddc39',
  '#f48fb1', '#ffb74d', '#ffc107', '#ffd54f',
];

export const KNOWN_OFFENDERS = [
  '#080808', '#0d0d0d', '#0f0f0f', '#141414', '#1e1e1e', '#222222',
  '#282828', '#2a2a2a', '#333333', '#444444', '#555555', '#5a5a5a',
  '#666666', '#888888', '#aaaaaa', '#b0b0b0', '#bbbbbb', '#d0d0d0',
  '#e6e6e6', '#e8e8e8',
];

// The only font stacks that may paint. First-family match, case-insensitive.
export const ALLOWED_FONT_FAMILIES = [
  'Inter', 'JetBrains Mono', 'Fira Code', 'SF Mono', 'IBM Plex Mono',
  'Playfair Display', 'Georgia', 'Times New Roman', 'monospace', 'serif',
  'sans-serif', 'BlinkMacSystemFont', 'Segoe UI', '-apple-system', 'system-ui',
];

export const ALL_ALLOWED = [...TOKEN_COLORS, ...TOKEN_RGBA, ...CHART_EXCEPTIONS];
