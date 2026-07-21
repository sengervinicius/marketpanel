/**
 * detailWindow.js — open instrument / sector views in a real separate
 * browser window (FEAT-interaction-wave 1b/2).
 *
 * Double-click on a ticker row anywhere in the app opens the standalone
 * #/detail/:symbol route (see pages/InstrumentDetailPage.jsx) in its own
 * window. Single click keeps whatever in-app behavior the panel already
 * had (overlay detail, chart selection, ...).
 */
import { extractSymbol } from './tickerNormalize';

export const DETAIL_WINDOW_FEATURES = 'width=1280,height=860,noopener';

export function openDetailWindow(input) {
  const sym = extractSymbol(input);
  if (!sym) return;
  window.open(
    `${window.location.origin}/#/detail/${encodeURIComponent(sym)}`,
    '_blank',
    DETAIL_WINDOW_FEATURES
  );
}

export function openSectorWindow(etf) {
  const sym = String(etf || '').trim().toUpperCase();
  if (!sym) return;
  window.open(
    `${window.location.origin}/#/sector/${encodeURIComponent(sym)}`,
    '_blank',
    DETAIL_WINDOW_FEATURES
  );
}
