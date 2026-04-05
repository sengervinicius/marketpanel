import { renderHook, act } from '@testing-library/react';
import { useBootSequence } from '../src/hooks/useBootSequence';

describe('useBootSequence', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('reaches READY when auth resolves and no user', () => {
    const { result } = renderHook(() =>
      useBootSequence({
        authReady: true,
        user: null,
        settingsLoaded: false,
      })
    );

    expect(result.current.isReady).toBe(true);
    expect(result.current.bootState).toBe('READY');
  });

  test('reaches READY when auth + user + settings all resolve', () => {
    const { result, rerender } = renderHook(
      ({ authReady, user, settingsLoaded }) =>
        useBootSequence({ authReady, user, settingsLoaded }),
      {
        initialProps: {
          authReady: false,
          user: null,
          settingsLoaded: false,
        },
      }
    );

    // INIT transitions to AUTH_PENDING synchronously in useEffect
    expect(result.current.isReady).toBe(false);

    // Provide all conditions at once
    act(() => {
      rerender({
        authReady: true,
        user: { id: 1 },
        settingsLoaded: true,
      });
    });

    // May need multiple renders to walk through state machine
    // AUTH_PENDING→AUTH_DONE→SETTINGS_PENDING→READY
    expect(result.current.isReady).toBe(true);
    expect(result.current.bootState).toBe('READY');
  });

  test('emergency timeout forces READY after 5s', () => {
    const { result } = renderHook(() =>
      useBootSequence({
        authReady: false,
        user: null,
        settingsLoaded: false,
      })
    );

    expect(result.current.isReady).toBe(false);

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(result.current.isReady).toBe(true);
    expect(result.current.bootState).toBe('READY');
  });
});
