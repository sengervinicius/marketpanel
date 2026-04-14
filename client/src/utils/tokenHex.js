/**
 * tokenHex.js — Design token hex values for SVG contexts.
 *
 * SVG elements (fill, stroke, stopColor) cannot resolve CSS custom properties.
 * This module provides hex values that MUST match the values in tokens.css.
 * Import this instead of hardcoding hex values in SVG-heavy components.
 *
 * @see client/src/styles/tokens.css for the single source of truth.
 */
export const TOKEN_HEX = {
  // Brand
  accent:         '#e55a00',
  accentHover:    '#cc4f00',

  // Surfaces
  bgApp:          '#0a0a0a',
  surface1:       '#111111',
  surface2:       '#161616',
  surface3:       '#1e1e1e',

  // Borders
  borderSubtle:   'rgba(255,255,255,0.04)',
  borderDefault:  'rgba(255,255,255,0.08)',
  borderStrong:   'rgba(255,255,255,0.12)',

  // Text
  textPrimary:    '#f0f0f0',
  textSecondary:  '#a0a0a0',
  textMuted:      '#5a5a5a',
  textFaint:      '#333333',

  // Semantic
  up:             '#22c55e',
  down:           '#ef4444',
  neutral:        '#a0a0a0',
  warn:           '#f59e0b',

  // Vault
  vaultAccent:    '#c9a84c',

  // Data viz
  vizHigh:        '#e55a00',
  vizMid:         '#f59e0b',
  vizLow:         '#3b82f6',
  vizNeutral:     '#374151',

  // Charts
  chartGrid:      'rgba(255,255,255,0.04)',

  // Sector accents
  sectorDefence:  '#ef5350',
  sectorTech:     '#00bcd4',
  sectorEurope:   '#3f51b5',
  sectorBrazil:   '#4caf50',
  sectorCrypto:   '#f7931a',
  sectorMacro:    '#9c27b0',
  sectorEnergy:   '#ff5722',

  // Legacy aliases (backward compat)
  bgPanel:        '#111111',
  bgSurface:      '#161616',
  bgElevated:     '#161616',
  bgHover:        '#161616',
  bgTooltip:      '#111111',
  semanticUp:     '#22c55e',
  semanticDown:   '#ef4444',
  semanticWarn:   '#f59e0b',
};
