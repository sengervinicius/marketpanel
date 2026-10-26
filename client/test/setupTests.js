import '@testing-library/jest-dom';

// #292 — jsdom shims for browser APIs the screens use. Without these,
// every screen test died with "IntersectionObserver is not defined" and
// the failure was invisible because @testing-library/dom was missing
// and the files never loaded.
class _Observer {
  constructor(cb) { this._cb = cb; }
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() { return []; }
}
if (typeof globalThis.IntersectionObserver === 'undefined') globalThis.IntersectionObserver = _Observer;
if (typeof globalThis.ResizeObserver === 'undefined') globalThis.ResizeObserver = _Observer;
if (typeof window !== 'undefined') {
  if (!window.matchMedia) {
    window.matchMedia = (query) => ({ matches: false, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; } });
  }
  if (!window.scrollTo) window.scrollTo = () => {};
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
}
