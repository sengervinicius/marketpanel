import { PANEL_DEFINITIONS } from '../src/config/panels';
import { PANEL_REGISTRY } from '../src/components/app/AppLayoutHelpers';

describe('Panel Registry Sync', () => {
  // All sync gaps resolved in S3 Cleanup — no known exceptions remain
  const PLANNED_NOT_IN_REGISTRY = [];
  const IN_REGISTRY_NOT_DEFINED = [];

  // Core panels that must exist in both
  const CORE_PANELS = [
    'charts',
    'usEquities',
    'forex',
    'commodities',
    'crypto',
    'watchlist',
    'search',
    'news',
    'alerts',
  ];

  // Sector screens that must exist in both
  const SECTOR_SCREENS = [
    'defenceScreen',
    'commoditiesScreen',
    'globalMacroScreen',
    'fixedIncomeScreen',
    'brazilScreen',
    'fxCryptoScreen',
    'energyScreen',
    'techAIScreen',
  ];

  describe('PANEL_DEFINITIONS structure', () => {
    it('should have PANEL_DEFINITIONS exported', () => {
      expect(PANEL_DEFINITIONS).toBeDefined();
      expect(typeof PANEL_DEFINITIONS).toBe('object');
    });

    it('should contain all expected keys', () => {
      const expectedKeys = [
        'charts',
        'usEquities',
        'brazilB3',
        'globalIndices',
        'forex',
        'crypto',
        'commodities',
        'debt',
        'watchlist',
        'alerts',
        'news',
        'sentiment',
        'search',
        'chat',
        'curves',
        'etf',
        'screener',
        'macro',
        'rates',
        'game',
        'leaderboard',
        'missions',
        'referrals',
        'calendar',
        ...SECTOR_SCREENS,
      ];

      expectedKeys.forEach((key) => {
        expect(PANEL_DEFINITIONS).toHaveProperty(key);
      });
    });
  });

  describe('PANEL_REGISTRY structure', () => {
    it('should have PANEL_REGISTRY exported', () => {
      expect(PANEL_REGISTRY).toBeDefined();
      expect(typeof PANEL_REGISTRY).toBe('object');
    });

    it('should contain expected keys', () => {
      const expectedKeys = [
        'charts',
        'usEquities',
        'forex',
        'globalIndices',
        'brazilB3',
        'commodities',
        'crypto',
        'indices',
        'search',
        'watchlist',
        'curves',
        'debt',
        'news',
        'sentiment',
        'chat',
        'alerts',
        'screener',
        'macro',
        'leaderboard',
        'game',
        'referrals',
        'calendar',
        ...SECTOR_SCREENS,
      ];

      expectedKeys.forEach((key) => {
        expect(PANEL_REGISTRY).toHaveProperty(key);
      });
    });
  });

  describe('Sync validation', () => {
    it('every PANEL_REGISTRY key should exist in PANEL_DEFINITIONS (except known exceptions)', () => {
      const missing = Object.keys(PANEL_REGISTRY).filter(
        key => !IN_REGISTRY_NOT_DEFINED.includes(key) && !PANEL_DEFINITIONS[key]
      );
      expect(missing).toEqual([]);
    });

    it('every PANEL_DEFINITIONS key should exist in PANEL_REGISTRY (except known exceptions)', () => {
      const missing = Object.keys(PANEL_DEFINITIONS).filter(
        key => !PLANNED_NOT_IN_REGISTRY.includes(key) && !PANEL_REGISTRY[key]
      );
      expect(missing).toEqual([]);
    });

    it('all core panels must exist in both', () => {
      CORE_PANELS.forEach((panel) => {
        expect(PANEL_DEFINITIONS).toHaveProperty(panel);
        expect(PANEL_REGISTRY).toHaveProperty(panel);
      });
    });

    it('all sector screens must exist in both', () => {
      SECTOR_SCREENS.forEach((screen) => {
        expect(PANEL_DEFINITIONS).toHaveProperty(screen);
        expect(PANEL_REGISTRY).toHaveProperty(screen);
      });
    });
  });

  describe('PANEL_REGISTRY component validation', () => {
    it('every PANEL_REGISTRY entry should have a component property that is a function or React memo object', () => {
      Object.entries(PANEL_REGISTRY).forEach(([key, entry]) => {
        expect(entry).toHaveProperty('component');
        const comp = entry.component;
        // React components can be functions or memo-wrapped objects ($$typeof Symbol)
        const isValid = typeof comp === 'function' || (comp && typeof comp === 'object' && !!comp.$$typeof);
        expect(isValid).toBe(true);
      });
    });
  });

  describe('PANEL_REGISTRY getProps validation', () => {
    it('getProps entries should be callable and return an object (when provided a mock context)', () => {
      const mockContext = {
        user: { id: 'test-user' },
        theme: 'light',
      };

      Object.entries(PANEL_REGISTRY).forEach(([key, entry]) => {
        if (!entry.getProps) {
          // Not all entries need getProps, that's fine
          return;
        }

        expect(typeof entry.getProps).toBe('function');

        // Call getProps with mock context
        const result = entry.getProps(mockContext);

        expect(result).toBeDefined();
        expect(typeof result).toBe('object');
      });
    });
  });

  describe('Full sync validation (no exceptions)', () => {
    it('etf, missions, rates now exist in both PANEL_DEFINITIONS and PANEL_REGISTRY', () => {
      ['etf', 'missions', 'rates'].forEach((key) => {
        expect(PANEL_DEFINITIONS).toHaveProperty(key);
        expect(PANEL_REGISTRY).toHaveProperty(key);
      });
    });

    it('indices now exists in both PANEL_DEFINITIONS and PANEL_REGISTRY', () => {
      expect(PANEL_REGISTRY).toHaveProperty('indices');
      expect(PANEL_DEFINITIONS).toHaveProperty('indices');
    });
  });
});
