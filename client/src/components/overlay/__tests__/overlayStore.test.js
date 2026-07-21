/**
 * overlayStore.test.js — pins the overlay layer's state machine
 * (Phase S §4): one overlay at a time, OPEN replaces, CLOSE returns to
 * terminal, SET_TAB only mutates while an overlay is up.
 */
import { describe, it, expect } from 'vitest';
import { overlayReducer, initialOverlayState } from '../overlayStore';

describe('overlayReducer', () => {
  it('starts closed', () => {
    expect(initialOverlayState).toEqual({ id: null, params: null, tab: null });
  });

  it('OPEN sets id and defaults params/tab to null', () => {
    const s = overlayReducer(initialOverlayState, { type: 'OPEN', id: 'brazil' });
    expect(s).toEqual({ id: 'brazil', params: null, tab: null });
  });

  it('OPEN honours a params.tab deep-link', () => {
    const s = overlayReducer(initialOverlayState, { type: 'OPEN', id: 'brazil', params: { tab: 'FILINGS' } });
    expect(s.tab).toBe('FILINGS');
    expect(s.params).toEqual({ tab: 'FILINGS' });
  });

  it('OPEN with a falsy/non-string id is a no-op', () => {
    expect(overlayReducer(initialOverlayState, { type: 'OPEN', id: '' })).toBe(initialOverlayState);
    expect(overlayReducer(initialOverlayState, { type: 'OPEN', id: 42 })).toBe(initialOverlayState);
    expect(overlayReducer(initialOverlayState, { type: 'OPEN' })).toBe(initialOverlayState);
  });

  it('only one overlay at a time — OPEN replaces the previous overlay and resets tab', () => {
    let s = overlayReducer(initialOverlayState, { type: 'OPEN', id: 'brazil', params: { tab: 'RATES' } });
    s = overlayReducer(s, { type: 'OPEN', id: 'rates' });
    expect(s).toEqual({ id: 'rates', params: null, tab: null });
  });

  it('CLOSE returns to the terminal', () => {
    const open = overlayReducer(initialOverlayState, { type: 'OPEN', id: 'rates' });
    expect(overlayReducer(open, { type: 'CLOSE' })).toEqual(initialOverlayState);
  });

  it('CLOSE while closed returns the same state object (no re-render)', () => {
    expect(overlayReducer(initialOverlayState, { type: 'CLOSE' })).toBe(initialOverlayState);
  });

  it('SET_TAB switches tab while open', () => {
    const open = overlayReducer(initialOverlayState, { type: 'OPEN', id: 'brazil' });
    const s = overlayReducer(open, { type: 'SET_TAB', tab: 'RATES' });
    expect(s).toEqual({ id: 'brazil', params: null, tab: 'RATES' });
  });

  it('SET_TAB is a no-op when closed, when tab is invalid, or when unchanged', () => {
    expect(overlayReducer(initialOverlayState, { type: 'SET_TAB', tab: 'RATES' })).toBe(initialOverlayState);
    const open = overlayReducer(initialOverlayState, { type: 'OPEN', id: 'brazil', params: { tab: 'RATES' } });
    expect(overlayReducer(open, { type: 'SET_TAB', tab: '' })).toBe(open);
    expect(overlayReducer(open, { type: 'SET_TAB', tab: 'RATES' })).toBe(open);
  });

  it('unknown actions return the same state object', () => {
    const open = overlayReducer(initialOverlayState, { type: 'OPEN', id: 'brazil' });
    expect(overlayReducer(open, { type: 'NOPE' })).toBe(open);
    expect(overlayReducer(open, undefined)).toBe(open);
  });
});
