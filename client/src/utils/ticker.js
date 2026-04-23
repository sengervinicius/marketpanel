// src/utils/ticker.js
/**
 * Sanitize ticker symbols for display.
 *
 * #241 / P1.1: delegates to the shared toDisplay() in utils/tickerNormalize
 * (which mirrors server/utils/tickerNormalize.toDisplay). Keeps the legacy
 * "return empty string for null" contract that existing callers expect.
 */
import { toDisplay } from './tickerNormalize';

export function sanitizeTicker(raw) {
  if (!raw) return '';
  return toDisplay(raw);
}
