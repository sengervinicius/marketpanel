import { createContext, useContext, useMemo } from 'react';

/**
 * PanelContext — shared "environment" props that most panels need.
 *
 * Instead of threading mergedData, loading, setChartTicker, chartTicker,
 * and setChartGridCount through makePanelRenderer → every panel, components
 * can consume them directly from context via usePanelContext().
 *
 * For now, makePanelRenderer still uses getProps resolvers that read from the
 * ctx object passed by App.jsx.  PanelContext is an opt-in path:
 *   – Panels that already receive these as explicit props keep working.
 *   – New panels (or panels migrated in S3) can use usePanelContext() instead.
 *
 * Provided values:
 *   mergedData      – REST snapshot merged with live WS overlay
 *   loading         – whether the initial REST fetch is still in progress
 *   setChartTicker  – callback to change the primary chart ticker
 *   chartTicker     – currently focused chart ticker
 *   setChartGridCount – callback to change the chart grid size
 */

const PanelContext = createContext(null);

export function PanelProvider({ children, value }) {
  // Memoize to prevent unnecessary re-renders when parent re-renders
  // but none of the actual values changed.
  const memo = useMemo(() => value, [
    value.mergedData,
    value.loading,
    value.setChartTicker,
    value.chartTicker,
    value.setChartGridCount,
  ]);

  return (
    <PanelContext.Provider value={memo}>
      {children}
    </PanelContext.Provider>
  );
}

/**
 * usePanelContext — access shared panel environment.
 * Returns null when used outside PanelProvider (safe for pop-out windows).
 */
export function usePanelContext() {
  return useContext(PanelContext);
}

export default PanelContext;
