/**
 * chartGridSelect.test.js — unit tests for the pure "ticker clicked
 * elsewhere in the terminal" grid-update logic used by ChartPanel.
 * Regression for the bug where every ticker click APPENDED a mini-chart
 * and the charts grid grew without bound.
 */
import { describe, it, expect } from 'vitest';
import { selectTickerInGrid } from '../src/utils/chartGridSelect';

describe('selectTickerInGrid', () => {
  const grid = ['SPY', 'QQQ', 'GLD'];

  it('never grows the grid, whatever is clicked', () => {
    for (const sym of ['SPY', 'GLD', 'MSFT', 'X:BTCUSD']) {
      for (const primary of [0, 1, 2, 99, -1]) {
        const res = selectTickerInGrid(grid, primary, sym);
        expect(res.tickers.length).toBe(grid.length);
      }
    }
  });

  it('promotes an existing tile to primary without touching the grid', () => {
    const res = selectTickerInGrid(grid, 0, 'GLD');
    expect(res.changed).toBe(false);
    expect(res.tickers).toBe(grid); // same reference, no re-render churn
    expect(res.primaryIdx).toBe(2);
  });

  it('replaces the primary tile in place when the symbol is not charted', () => {
    const res = selectTickerInGrid(grid, 1, 'MSFT');
    expect(res.changed).toBe(true);
    expect(res.tickers).toEqual(['SPY', 'MSFT', 'GLD']);
    expect(res.primaryIdx).toBe(1);
    expect(grid).toEqual(['SPY', 'QQQ', 'GLD']); // input not mutated
  });

  it('defaults primary to the first tile', () => {
    const res = selectTickerInGrid(grid, 0, 'AAPL');
    expect(res.tickers).toEqual(['AAPL', 'QQQ', 'GLD']);
    expect(res.primaryIdx).toBe(0);
  });

  it('clamps a stale primary index after tiles were removed', () => {
    const res = selectTickerInGrid(['SPY'], 5, 'AAPL');
    expect(res.tickers).toEqual(['AAPL']);
    expect(res.primaryIdx).toBe(0);
  });

  it('is a no-op on an empty grid or empty symbol', () => {
    expect(selectTickerInGrid([], 0, 'AAPL').changed).toBe(false);
    expect(selectTickerInGrid([], 0, 'AAPL').tickers).toEqual([]);
    expect(selectTickerInGrid(grid, 0, '').changed).toBe(false);
    expect(selectTickerInGrid(grid, 0, '').tickers).toBe(grid);
  });

  it('consecutive clicks keep replacing the same primary slot', () => {
    let state = { tickers: ['SPY', 'QQQ'], primaryIdx: 0 };
    state = { ...selectTickerInGrid(state.tickers, state.primaryIdx, 'MSFT') };
    state = { ...selectTickerInGrid(state.tickers, state.primaryIdx, 'NVDA') };
    expect(state.tickers).toEqual(['NVDA', 'QQQ']);
    // clicking an existing tile moves primary there; next new symbol lands in that slot
    state = { ...selectTickerInGrid(state.tickers, state.primaryIdx, 'QQQ') };
    state = { ...selectTickerInGrid(state.tickers, state.primaryIdx, 'PETR4') };
    expect(state.tickers).toEqual(['NVDA', 'PETR4']);
  });
});
