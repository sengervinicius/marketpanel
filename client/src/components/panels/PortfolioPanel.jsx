/**
 * PortfolioPanel.jsx — Phase 9.2 compatibility shim.
 *
 * The dedicated Portfolio panel has been killed. Its functionality lives
 * inside the unified, more powerful Watchlist:
 *   - Any watchlist row can be upgraded to a "tracked" position (qty +
 *     entry) via Alt/Ctrl-click or the ✎ icon, surfacing running P&L%.
 *   - The Summary Strip + AI Health Check auto-appear whenever one or
 *     more tracked positions exist.
 *
 * We keep this file so that:
 *   1. AppLayoutHelpers' `portfolio` registry entry (and therefore any
 *      saved user layouts that still reference the old "portfolio" slot)
 *      still resolves to a real panel.
 *   2. Other modules importing `PortfolioPanel` continue to work without
 *      touching the import path.
 *
 * Anything bespoke to the old portfolio view (donut, allocation bar,
 * separate subportfolio filter) was either absorbed into the Watchlist
 * or intentionally retired — see PortfolioPanelWidgets.jsx for shared
 * pieces still in use.
 */

export { default } from './WatchlistPanel';
