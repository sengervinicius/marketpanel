// src/utils/ticker.js
/**
 * Sanitize ticker symbols for display.
 * Strips Polygon.io prefix formats (X:, I:, C:, O:) and exchange suffixes.
 */
export function sanitizeTicker(raw) {
  if (!raw) return '';
  // Strip Polygon.io prefix formats: X:, I:, C:, O:
  return raw.replace(/^[A-Z]:/, '');
}
