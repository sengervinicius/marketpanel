/**
 * dropHelper.js — shared drag-drop utilities for panels
 * Makes entire panels accept ticker drops (not just the header).
 */

/** Parse a ticker from a DragEvent's dataTransfer */
export function parseDrop(e) {
  let ticker = null;
  const xTicker = e.dataTransfer?.getData('application/x-ticker');
  if (xTicker) {
    try {
      const parsed = JSON.parse(xTicker);
      ticker = parsed.symbol || parsed.name;
    } catch {
      ticker = xTicker;
    }
  }
  if (!ticker) ticker = e.dataTransfer?.getData('text/plain');
  return ticker?.trim().toUpperCase() || null;
}

/** onDragOver handler — allows drop */
export function handlePanelDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
}

/** Create a drop handler that calls handleDropTicker */
export function makePanelDropHandler(handleDropTicker) {
  return (e) => {
    e.preventDefault();
    const ticker = parseDrop(e);
    if (ticker) handleDropTicker(ticker);
  };
}
