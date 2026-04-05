import { renderHook, act, waitFor } from '@testing-library/react';
import { useAIInsight } from '../src/hooks/useAIInsight';

// Mock the API
vi.mock('../src/utils/api', () => ({
  apiFetch: vi.fn(),
}));

import { apiFetch } from '../src/utils/api';

describe('useAIInsight - Cache Expiry', () => {
  beforeEach(() => {
    apiFetch.mockClear();
  });

  afterEach(() => {
    apiFetch.mockClear();
  });

  it('first call fetches from endpoint', async () => {
    apiFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          ok: true,
          insight: 'test insight',
          generatedAt: new Date().toISOString(),
        }),
    });

    const { result } = renderHook(() =>
      useAIInsight({
        type: 'macro',
        context: {},
        cacheKey: 'test1-' + Date.now(),
        autoFetch: false,
      })
    );

    expect(result.current.loading).toBe(false);
    expect(result.current.insight).toBeNull();
    expect(apiFetch).not.toHaveBeenCalled();

    act(() => {
      result.current.refresh();
    });

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledTimes(1);
    });

    expect(apiFetch).toHaveBeenCalledWith('/api/search/macro-insight', expect.objectContaining({
      method: 'POST',
    }));
  });

  it('second call within TTL uses cache', async () => {
    const cacheKey = 'test2-' + Date.now();

    apiFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          ok: true,
          insight: 'test insight',
          generatedAt: new Date().toISOString(),
        }),
    });

    // First hook instance - fetch
    const { result: result1 } = renderHook(() =>
      useAIInsight({
        type: 'macro',
        context: {},
        cacheKey,
        autoFetch: false,
      })
    );

    act(() => {
      result1.current.refresh();
    });

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledTimes(1);
    });

    // Wait for fetch to complete
    await waitFor(() => {
      expect(result1.current.insight).not.toBeNull();
    });

    const firstInsight = result1.current.insight;

    apiFetch.mockClear();

    // Second hook instance - should use cache
    const { result: result2 } = renderHook(() =>
      useAIInsight({
        type: 'macro',
        context: {},
        cacheKey,
        ttlMs: 300000,
        autoFetch: false,
      })
    );

    // Should have cached data immediately
    expect(result2.current.insight).toEqual(firstInsight);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('different cacheKey bypasses cache', async () => {
    apiFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          ok: true,
          insight: 'first insight',
          generatedAt: new Date().toISOString(),
        }),
    });

    // First hook with cacheKey1
    const { result: result1 } = renderHook(() =>
      useAIInsight({
        type: 'macro',
        context: {},
        cacheKey: 'key1',
        autoFetch: false,
      })
    );

    act(() => {
      result1.current.refresh();
    });

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledTimes(1);
    });

    apiFetch.mockClear();

    apiFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          ok: true,
          insight: 'second insight',
          generatedAt: new Date().toISOString(),
        }),
    });

    // Second hook with different cacheKey2 - should fetch again
    const { result: result2 } = renderHook(() =>
      useAIInsight({
        type: 'macro',
        context: {},
        cacheKey: 'key2',
        autoFetch: false,
      })
    );

    act(() => {
      result2.current.refresh();
    });

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledTimes(1);
    });
  });

  it('handles API errors gracefully', async () => {
    const cacheKey = 'test5-' + Date.now();

    apiFetch.mockResolvedValue({
      ok: false,
      status: 500,
    });

    const { result } = renderHook(() =>
      useAIInsight({
        type: 'macro',
        context: {},
        cacheKey,
        autoFetch: false,
      })
    );

    act(() => {
      result.current.refresh();
    });

    await waitFor(() => {
      expect(result.current.error).toBeTruthy();
    });

    expect(result.current.insight).toBeNull();
  });

  it('unknown insight type returns error', async () => {
    const cacheKey = 'test6-' + Date.now();

    const { result } = renderHook(() =>
      useAIInsight({
        type: 'unknown-type',
        context: {},
        cacheKey,
        autoFetch: false,
      })
    );

    act(() => {
      result.current.refresh();
    });

    await waitFor(() => {
      expect(result.current.error).toContain('Unknown AI insight type');
    });
  });

  it('autoFetch=true triggers fetch on mount', async () => {
    apiFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          ok: true,
          insight: 'auto-fetched insight',
          generatedAt: new Date().toISOString(),
        }),
    });

    const cacheKey = 'auto-fetch-' + Date.now();

    renderHook(() =>
      useAIInsight({
        type: 'macro',
        context: { test: true },
        cacheKey,
        autoFetch: true,
      })
    );

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledTimes(1);
    });
  });

  it('normalizes different insight types correctly', async () => {
    apiFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          title: 'Sector Brief',
          summary: 'Tech sector is strong',
          bullets: ['Point 1', 'Point 2'],
          generatedAt: new Date().toISOString(),
        }),
    });

    const { result } = renderHook(() =>
      useAIInsight({
        type: 'sector',
        context: {},
        cacheKey: 'sector-' + Date.now(),
        autoFetch: false,
      })
    );

    act(() => {
      result.current.refresh();
    });

    await waitFor(() => {
      expect(result.current.insight).not.toBeNull();
    });

    expect(result.current.insight.title).toBe('Sector Brief');
    expect(result.current.insight.body).toBe('Tech sector is strong');
    expect(result.current.insight.bullets).toEqual(['Point 1', 'Point 2']);
  });

  it('cacheKey=null disables caching', async () => {
    apiFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          ok: true,
          insight: 'uncached insight',
          generatedAt: new Date().toISOString(),
        }),
    });

    const { result } = renderHook(() =>
      useAIInsight({
        type: 'macro',
        context: {},
        cacheKey: null,
        autoFetch: false,
      })
    );

    act(() => {
      result.current.refresh();
    });

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledTimes(1);
    });

    apiFetch.mockClear();

    // Second call with same null cacheKey - should fetch again
    const { result: result2 } = renderHook(() =>
      useAIInsight({
        type: 'macro',
        context: {},
        cacheKey: null,
        autoFetch: false,
      })
    );

    act(() => {
      result2.current.refresh();
    });

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledTimes(1);
    });
  });
});
