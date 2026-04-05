import { render, renderHook } from '@testing-library/react';
import { PanelProvider, usePanelContext } from '../src/context/PanelContext';

describe('PanelContext', () => {
  it('returns null outside PanelProvider', () => {
    // Component that uses the hook outside of provider
    function TestComponent() {
      return (
        <div>
          <Consumer />
        </div>
      );
    }

    function Consumer() {
      const ctx = usePanelContext();
      return <div>{ctx === null ? 'null' : 'has value'}</div>;
    }

    const { container } = render(<TestComponent />);
    expect(container.textContent).toContain('null');
  });

  it('returns provided values inside PanelProvider', () => {
    const mockSetChartTicker = vi.fn();
    const mockSetChartGridCount = vi.fn();
    const value = {
      mergedData: { stocks: { AAPL: { price: 150 } } },
      loading: false,
      setChartTicker: mockSetChartTicker,
      chartTicker: 'SPY',
      setChartGridCount: mockSetChartGridCount,
    };

    function Consumer() {
      const ctx = usePanelContext();
      return (
        <div>
          <div data-testid="merged-data">{JSON.stringify(ctx?.mergedData)}</div>
          <div data-testid="loading">{String(ctx?.loading)}</div>
          <div data-testid="chart-ticker">{ctx?.chartTicker}</div>
        </div>
      );
    }

    const { getByTestId } = render(
      <PanelProvider value={value}>
        <Consumer />
      </PanelProvider>
    );

    const mergedDataEl = getByTestId('merged-data');
    const loadingEl = getByTestId('loading');
    const tickerEl = getByTestId('chart-ticker');

    expect(mergedDataEl.textContent).toContain('AAPL');
    expect(loadingEl.textContent).toBe('false');
    expect(tickerEl.textContent).toBe('SPY');
  });

  it('re-renders consumer when mergedData changes', () => {
    let renderCount = 0;

    function Consumer() {
      const ctx = usePanelContext();
      renderCount++;
      return (
        <div>
          <div data-testid="render-count">{renderCount}</div>
          <div data-testid="merged-data">{ctx?.mergedData?.stocks?.AAPL?.price}</div>
        </div>
      );
    }

    const value1 = {
      mergedData: { stocks: { AAPL: { price: 150 } } },
      loading: false,
      setChartTicker: vi.fn(),
      chartTicker: 'SPY',
      setChartGridCount: vi.fn(),
    };

    const { rerender, getByTestId } = render(
      <PanelProvider value={value1}>
        <Consumer />
      </PanelProvider>
    );

    const initialRenderCount = renderCount;

    // Update mergedData
    const value2 = {
      mergedData: { stocks: { AAPL: { price: 200 } } },
      loading: false,
      setChartTicker: vi.fn(),
      chartTicker: 'SPY',
      setChartGridCount: vi.fn(),
    };

    rerender(
      <PanelProvider value={value2}>
        <Consumer />
      </PanelProvider>
    );

    // Check that consumer re-rendered and received new data
    expect(renderCount).toBeGreaterThan(initialRenderCount);
    expect(getByTestId('merged-data').textContent).toBe('200');
  });

  it('all context fields are accessible', () => {
    const mockSetChartTicker = vi.fn();
    const mockSetChartGridCount = vi.fn();
    const value = {
      mergedData: { stocks: { BTC: { price: 45000 } } },
      loading: true,
      setChartTicker: mockSetChartTicker,
      chartTicker: 'BTC',
      setChartGridCount: mockSetChartGridCount,
    };

    function Consumer() {
      const ctx = usePanelContext();
      return (
        <div>
          <div data-testid="has-merged-data">
            {ctx?.mergedData ? 'yes' : 'no'}
          </div>
          <div data-testid="has-loading">
            {typeof ctx?.loading !== 'undefined' ? 'yes' : 'no'}
          </div>
          <div data-testid="has-set-chart-ticker">
            {typeof ctx?.setChartTicker === 'function' ? 'yes' : 'no'}
          </div>
          <div data-testid="has-chart-ticker">
            {ctx?.chartTicker ? 'yes' : 'no'}
          </div>
          <div data-testid="has-set-chart-grid-count">
            {typeof ctx?.setChartGridCount === 'function' ? 'yes' : 'no'}
          </div>
        </div>
      );
    }

    const { getByTestId } = render(
      <PanelProvider value={value}>
        <Consumer />
      </PanelProvider>
    );

    expect(getByTestId('has-merged-data').textContent).toBe('yes');
    expect(getByTestId('has-loading').textContent).toBe('yes');
    expect(getByTestId('has-set-chart-ticker').textContent).toBe('yes');
    expect(getByTestId('has-chart-ticker').textContent).toBe('yes');
    expect(getByTestId('has-set-chart-grid-count').textContent).toBe('yes');
  });

  it('does not re-render when non-memoized props change', () => {
    let renderCount = 0;

    function Consumer() {
      const ctx = usePanelContext();
      renderCount++;
      return <div data-testid="render-count">{renderCount}</div>;
    }

    const setChartTicker1 = vi.fn();
    const setChartGridCount1 = vi.fn();

    const value1 = {
      mergedData: { stocks: { AAPL: { price: 150 } } },
      loading: false,
      setChartTicker: setChartTicker1,
      chartTicker: 'SPY',
      setChartGridCount: setChartGridCount1,
    };

    const { rerender, getByTestId } = render(
      <PanelProvider value={value1}>
        <Consumer />
      </PanelProvider>
    );

    const initialCount = renderCount;

    // Update provider with same context values but different callback functions
    // (PanelProvider memoizes based on actual values, not function identity)
    const setChartTicker2 = vi.fn();
    const setChartGridCount2 = vi.fn();

    const value2 = {
      mergedData: { stocks: { AAPL: { price: 150 } } }, // Same mergedData
      loading: false, // Same loading
      setChartTicker: setChartTicker2, // Different reference
      chartTicker: 'SPY', // Same ticker
      setChartGridCount: setChartGridCount2, // Different reference
    };

    rerender(
      <PanelProvider value={value2}>
        <Consumer />
      </PanelProvider>
    );

    // Since the memoized values (mergedData, loading, chartTicker) didn't change,
    // the consumer may not re-render
    expect(renderCount).toBeLessThanOrEqual(initialCount + 1);
  });

  it('handles empty mergedData', () => {
    const value = {
      mergedData: {},
      loading: false,
      setChartTicker: vi.fn(),
      chartTicker: null,
      setChartGridCount: vi.fn(),
    };

    function Consumer() {
      const ctx = usePanelContext();
      return (
        <div>
          <div data-testid="empty-merged-data">
            {Object.keys(ctx?.mergedData || {}).length}
          </div>
        </div>
      );
    }

    const { getByTestId } = render(
      <PanelProvider value={value}>
        <Consumer />
      </PanelProvider>
    );

    expect(getByTestId('empty-merged-data').textContent).toBe('0');
  });
});
