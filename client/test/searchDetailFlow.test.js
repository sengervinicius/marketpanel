import { resolveAlias, INSTRUMENT_ALIASES } from '../src/config/instrumentAliases';

describe('SearchDetailFlow - Alias Resolution', () => {
  describe('resolveAlias function', () => {
    it('resolves commodity aliases', () => {
      expect(resolveAlias('WTI')).toBe('CL=F');
      expect(resolveAlias('GOLD')).toBe('GC=F');
      expect(resolveAlias('BRENT')).toBe('BZ=F');
      expect(resolveAlias('SILVER')).toBe('SI=F');
    });

    it('passes through regular tickers unchanged', () => {
      expect(resolveAlias('AAPL')).toBe('AAPL');
      expect(resolveAlias('SPY')).toBe('SPY');
      expect(resolveAlias('EURUSD')).toBe('EURUSD');
      expect(resolveAlias('BTCUSD')).toBe('BTCUSD');
    });

    it('is case-insensitive', () => {
      expect(resolveAlias('wti')).toBe('CL=F');
      expect(resolveAlias('Gold')).toBe('GC=F');
      expect(resolveAlias('SILVER')).toBe('SI=F');
      expect(resolveAlias('brent')).toBe('BZ=F');
    });

    it('handles whitespace in input', () => {
      expect(resolveAlias(' gold ')).toBe('GC=F');
      expect(resolveAlias('  wti  ')).toBe('CL=F');
      expect(resolveAlias('\tsilver\n')).toBe('SI=F');
    });

    it('handles null/undefined/empty gracefully', () => {
      expect(resolveAlias(null)).toBe(null);
      expect(resolveAlias(undefined)).toBe(undefined);
      expect(resolveAlias('')).toBe('');
    });

    it('handles non-string input gracefully', () => {
      expect(resolveAlias(123)).toBe(123);
      expect(resolveAlias({})).toEqual({});
      expect(resolveAlias([])).toEqual([]);
    });

    it('all aliases resolve to valid futures symbols ending in =F', () => {
      Object.values(INSTRUMENT_ALIASES).forEach((symbol) => {
        expect(symbol).toMatch(/=F$/);
      });
    });

    it('all alias keys are uppercase strings', () => {
      Object.keys(INSTRUMENT_ALIASES).forEach((key) => {
        expect(key).toBe(key.toUpperCase());
        expect(typeof key).toBe('string');
      });
    });
  });

  describe('Search result → selectItem flow', () => {
    it('resolves aliases when selecting a commodity search result', () => {
      // Simulate HeaderSearchBar.selectItem with a WTI crude oil search result
      const searchItem = {
        symbolKey: 'WTI',
        name: 'WTI Crude',
        category: 'commodities'
      };

      const resolvedSymbol = resolveAlias(searchItem.symbolKey);
      expect(resolvedSymbol).toBe('CL=F');
    });

    it('passes through regular stock tickers when selecting search results', () => {
      // Simulate HeaderSearchBar.selectItem with a stock search result
      const searchItem = {
        symbolKey: 'AAPL',
        name: 'Apple Inc.',
        category: 'stocks'
      };

      const resolvedSymbol = resolveAlias(searchItem.symbolKey);
      expect(resolvedSymbol).toBe('AAPL');
    });

    it('handles multiple search result selections in sequence', () => {
      const searchResults = [
        { symbolKey: 'WTI', name: 'WTI Crude' },
        { symbolKey: 'GOLD', name: 'Gold Futures' },
        { symbolKey: 'AAPL', name: 'Apple Inc.' },
        { symbolKey: 'BRENT', name: 'Brent Crude' }
      ];

      const expectedResolutions = ['CL=F', 'GC=F', 'AAPL', 'BZ=F'];

      searchResults.forEach((item, index) => {
        const resolved = resolveAlias(item.symbolKey);
        expect(resolved).toBe(expectedResolutions[index]);
      });
    });

    it('resolves aliases with lowercase input from search suggestions', () => {
      // Simulate user typing 'gold' in search, getting lowercase suggestion
      const searchItem = {
        symbolKey: 'gold',
        name: 'Gold Futures',
        category: 'commodities'
      };

      const resolvedSymbol = resolveAlias(searchItem.symbolKey);
      expect(resolvedSymbol).toBe('GC=F');
    });

    it('validates resolved symbol is suitable for chart navigation', () => {
      const commoditiesWithAliases = [
        { input: 'WTI', expectedSymbol: 'CL=F' },
        { input: 'GOLD', expectedSymbol: 'GC=F' },
        { input: 'SILVER', expectedSymbol: 'SI=F' },
        { input: 'BRENT', expectedSymbol: 'BZ=F' }
      ];

      commoditiesWithAliases.forEach(({ input, expectedSymbol }) => {
        const resolved = resolveAlias(input);
        // Valid chart symbols should be strings
        expect(typeof resolved).toBe('string');
        // Resolved symbol should match expected value
        expect(resolved).toBe(expectedSymbol);
        // Should be able to use in a URL or chart context
        expect(resolved.length).toBeGreaterThan(0);
      });
    });
  });
});
