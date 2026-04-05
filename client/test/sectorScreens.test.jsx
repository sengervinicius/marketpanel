/**
 * sectorScreens.test.jsx
 * Smoke tests for the 7 rewritten deep sector screens.
 * Verifies that each screen renders without crashing.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import {
  DefenceScreen,
  CommoditiesScreen,
  GlobalMacroScreen,
  BrazilScreen,
  FxCryptoScreen,
  EnergyScreen,
  TechAIScreen,
} from '../src/components/screens';

// Mock CSS imports (vitest ignores CSS in jsdom, but mock for safety)
vi.mock('../src/components/screens/DeepScreen.css', () => ({}));
vi.mock('../src/components/ai/AIInsightCard.css', () => ({}));

// Mock useIsMobile hook
vi.mock('../src/hooks/useIsMobile', () => ({
  useIsMobile: vi.fn(() => false), // Return false for desktop
}));

// vi.mock factories are hoisted — cannot reference external variables.
// Use inline arrow functions inside each factory.

vi.mock('../src/hooks/useSectionData', () => {
  const fn = vi.fn(() => ({
    data: null, loading: false, error: null, refresh: vi.fn(), lastUpdated: null,
  }));
  return { default: fn, useSectionData: fn };
});

vi.mock('../src/hooks/useAIInsight', () => {
  const fn = vi.fn(() => ({
    loading: false, error: null, insight: null, refresh: vi.fn(),
  }));
  return { default: fn, useAIInsight: fn };
});

vi.mock('../src/components/ai/AIInsightCard', () => ({
  default: () => null,
}));

vi.mock('../src/components/ai', () => ({
  AIInsightCard: () => null,
  AIError: () => null,
}));

vi.mock('../src/context/OpenDetailContext', () => ({
  useOpenDetail: vi.fn(() => vi.fn()),
}));

vi.mock('../src/context/PriceContext', () => ({
  useTickerPrice: vi.fn(() => ({ price: 100, change: 1.5, changePct: 0.5 })),
}));

vi.mock('../src/utils/api', () => ({
  apiFetch: vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })),
}));

// Global fetch mock
global.fetch = vi.fn(() =>
  Promise.resolve({
    ok: true,
    json: () => Promise.resolve({}),
  })
);

describe('Deep Sector Screens', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('renders DefenceScreen without crashing', () => {
    const { container } = render(<DefenceScreen onTickerClick={vi.fn()} />);
    expect(container).toBeTruthy();
    expect(container.firstChild).toBeTruthy();
  });

  it('renders CommoditiesScreen without crashing', () => {
    const { container } = render(<CommoditiesScreen onTickerClick={vi.fn()} />);
    expect(container).toBeTruthy();
    expect(container.firstChild).toBeTruthy();
  });

  it('renders GlobalMacroScreen without crashing', () => {
    const { container } = render(<GlobalMacroScreen onTickerClick={vi.fn()} />);
    expect(container).toBeTruthy();
    expect(container.firstChild).toBeTruthy();
  });

  it('renders BrazilScreen without crashing', () => {
    const { container } = render(<BrazilScreen onTickerClick={vi.fn()} />);
    expect(container).toBeTruthy();
    expect(container.firstChild).toBeTruthy();
  });

  it('renders FxCryptoScreen without crashing', () => {
    const { container } = render(<FxCryptoScreen onTickerClick={vi.fn()} />);
    expect(container).toBeTruthy();
    expect(container.firstChild).toBeTruthy();
  });

  it('renders EnergyScreen without crashing', () => {
    const { container } = render(<EnergyScreen onTickerClick={vi.fn()} />);
    expect(container).toBeTruthy();
    expect(container.firstChild).toBeTruthy();
  });

  it('renders TechAIScreen without crashing', () => {
    const { container } = render(<TechAIScreen onTickerClick={vi.fn()} />);
    expect(container).toBeTruthy();
    expect(container.firstChild).toBeTruthy();
  });
});
