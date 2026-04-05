import { renderHook, act } from '@testing-library/react';
import { useWebSocketTicks } from '../src/hooks/useWebSocketTicks';

describe('useWebSocketTicks', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('initial feedStatus is connecting for all feeds', () => {
    const { result } = renderHook(() => useWebSocketTicks({}));

    expect(result.current.feedStatus).toEqual({
      stocks: 'connecting',
      forex: 'connecting',
      crypto: 'connecting',
    });
  });

  it('status message updates feedStatus', () => {
    const { result } = renderHook(() => useWebSocketTicks({}));

    act(() => {
      result.current.handleWsMessage({
        type: 'status',
        feed: 'stocks',
        level: 'connected',
      });
    });

    expect(result.current.feedStatus.stocks).toBe('connected');
    expect(result.current.feedStatus.forex).toBe('connecting');
  });

  it('snapshot message populates mergedData overlay', () => {
    const restData = {
      stocks: {
        AAPL: { price: 150, change: 2 },
      },
      forex: {},
      crypto: {},
    };

    const { result } = renderHook(() => useWebSocketTicks(restData));

    expect(result.current.mergedData.stocks.AAPL.price).toBe(150);

    act(() => {
      result.current.handleWsMessage({
        type: 'snapshot',
        data: {
          stocks: {
            AAPL: { price: 200 },
          },
        },
      });
    });

    expect(result.current.mergedData.stocks.AAPL.price).toBe(200);
    expect(result.current.mergedData.stocks.AAPL.change).toBe(2);
  });

  it('tick message is buffered and flushed', () => {
    const restData = {
      stocks: {
        AAPL: { price: 150, change: 2 },
      },
      forex: {},
      crypto: {},
    };

    const { result } = renderHook(() => useWebSocketTicks(restData));

    act(() => {
      result.current.handleWsMessage({
        type: 'tick',
        symbol: 'AAPL',
        category: 'stocks',
        data: { price: 201 },
      });
    });

    // Before timer fires, batchTicks should still be empty
    expect(result.current.batchTicks).toEqual([]);

    act(() => {
      vi.advanceTimersByTime(250);
    });

    // After 250ms, tick should be flushed
    expect(result.current.batchTicks).toEqual([
      {
        category: 'stocks',
        symbol: 'AAPL',
        data: { price: 201 },
      },
    ]);

    // mergedData should reflect the update
    expect(result.current.mergedData.stocks.AAPL.price).toBe(201);
  });

  it('graceful handling of unknown message types', () => {
    const { result } = renderHook(() => useWebSocketTicks({}));

    expect(() => {
      act(() => {
        result.current.handleWsMessage({ type: 'unknown' });
      });
    }).not.toThrow();

    expect(result.current.feedStatus.stocks).toBe('connecting');
  });

  it('feedHealth message updates feedStatus with detailed info', () => {
    const { result } = renderHook(() => useWebSocketTicks({}));

    act(() => {
      result.current.handleWsMessage({
        type: 'feedHealth',
        feeds: [
          {
            feed: 'stocks',
            level: 'connected',
            latencyMs: 45,
            lastTickAt: '2026-04-05T12:00:00Z',
            reconnects: 2,
            lastError: null,
          },
          {
            feed: 'crypto',
            level: 'degraded',
            latencyMs: 150,
          },
        ],
      });
    });

    expect(result.current.feedStatus.stocks).toEqual({
      level: 'connected',
      latencyMs: 45,
      lastTickAt: '2026-04-05T12:00:00Z',
      reconnects: 2,
      lastError: null,
    });

    expect(result.current.feedStatus.crypto).toEqual({
      level: 'degraded',
      latencyMs: 150,
      lastTickAt: null,
      reconnects: 0,
      lastError: null,
    });
  });

  it('multiple ticks are batched and flushed together', () => {
    const restData = {
      stocks: {
        AAPL: { price: 150 },
        MSFT: { price: 300 },
      },
      forex: {},
      crypto: {},
    };

    const { result } = renderHook(() => useWebSocketTicks(restData));

    act(() => {
      result.current.handleWsMessage({
        type: 'tick',
        symbol: 'AAPL',
        category: 'stocks',
        data: { price: 151 },
      });
      result.current.handleWsMessage({
        type: 'tick',
        symbol: 'MSFT',
        category: 'stocks',
        data: { price: 301 },
      });
    });

    expect(result.current.batchTicks).toEqual([]);

    act(() => {
      vi.advanceTimersByTime(250);
    });

    expect(result.current.batchTicks).toHaveLength(2);
    expect(result.current.batchTicks[0].symbol).toBe('AAPL');
    expect(result.current.batchTicks[1].symbol).toBe('MSFT');
  });

  it('quote message is treated same as tick', () => {
    const restData = {
      forex: {
        EURUSD: { price: 1.08 },
      },
      stocks: {},
      crypto: {},
    };

    const { result } = renderHook(() => useWebSocketTicks(restData));

    act(() => {
      result.current.handleWsMessage({
        type: 'quote',
        symbol: 'EURUSD',
        category: 'forex',
        data: { price: 1.09 },
      });
    });

    act(() => {
      vi.advanceTimersByTime(250);
    });

    expect(result.current.batchTicks).toHaveLength(1);
    expect(result.current.batchTicks[0].type).toBeUndefined();
    expect(result.current.mergedData.forex.EURUSD.price).toBe(1.09);
  });
});
