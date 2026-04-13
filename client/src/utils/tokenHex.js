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
  // Backgrounds
  bgPanel:        '#0a0a0f',
  bgSurface:      '#0d0d14',
  bgElevated:     '#111118',
  bgHover:        '#12121a',
  bgTooltip:      '#111118',

  // Borders
  borderSubtle:   '#141420',
  borderDefault:  '#1a1a2a',
  borderStrong:   '#2a2a3a',

  // Text
  textPrimary:    '#e8e8ed',
  textSecondary:  '#999999',
  textMuted:      '#555570',
  textFaint:      '#3a3a4a',

  // Semantic
  semanticUp:     '#4caf50',
  semanticDown:   '#ef5350',
  semanticWarn:   '#ff9800',

  // Accent
  accent:         '#F97316',

  // Charts
  chartGrid:      'rgba(255,255,255,0.04)',
};
