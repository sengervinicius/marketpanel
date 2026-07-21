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

/* FIX-popup-adaptive — open the popout BIG and screen-relative rather than
 * at a fixed 1280x860 that starves the chart on large monitors. Computed at
 * call time so it tracks the user's actual screen. Capped so it never
 * exceeds a sensible max, and centered on the available screen area. The
 * `popup` token keeps it a real chromeless window (not a tab). */
function detailWindowFeatures() {
  const w = Math.min(1600, Math.round(screen.availWidth * 0.92));
  const h = Math.min(1000, Math.round(screen.availHeight * 0.92));
  const left = Math.round((screen.availWidth - w) / 2);
  const top = Math.round((screen.availHeight - h) / 2);
  return 'popup,noopener,width=' + w + ',height=' + h + ',left=' + left + ',top=' + top;
}

export function openDetailWindow(input) {
  const sym = extractSymbol(input);
  if (!sym) return;
  window.open(
    `${window.location.origin}/#/detail/${encodeURIComponent(sym)}`,
    '_blank',
    detailWindowFeatures()
  );
}

export function openSectorWindow(etf) {
  const sym = String(etf || '').trim().toUpperCase();
  if (!sym) return;
  window.open(
    `${window.location.origin}/#/sector/${encodeURIComponent(sym)}`,
    '_blank',
    detailWindowFeatures()
  );
}
