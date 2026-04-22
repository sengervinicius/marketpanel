/**
 * providerMatrix.europeSuffixes.test.js — #215 regression guard.
 *
 * Incident (CIO, 2026-04-22): JUMBO.AT (a Greek retailer) rendered
 *   "Historical chart data unavailable — US (NYSE / NASDAQ)"
 * because .AT wasn't in SUFFIX_MAP. detectExchangeGroup() fell through
 * to the 'US' default, routed the quote to polygon_ws (which has no
 * Athens data), and labelled the coverage header with the US group.
 *
 * Fix: add the missing European suffixes (.AT, .LS, .BR, .VI, .WA,
 * .IR, .PR, .IC) to both the client and server SUFFIX_MAP. This
 * suite pins the ones most likely to bite us in customer tickets.
 */

import { describe, it, expect } from 'vitest';
import {
  detectExchangeGroup,
  getProviderRouting,
  COVERAGE,
} from '../src/config/providerMatrix';

describe('#215 — previously-missing European suffixes resolve to EUROPE', () => {
  // (ticker, human readable market) — one per suffix so a regression
  // points a finger at the exact suffix.
  const cases = [
    ['JUMBO.AT',      'Athens (ATHEX)'],
    ['OPAP.AT',       'Athens (ATHEX)'],
    ['EDPR.LS',       'Euronext Lisbon'],
    ['UCB.BR',        'Euronext Brussels'],
    ['VOE.VI',        'Wiener Börse / Vienna'],
    ['PKO.WA',        'Warsaw Stock Exchange'],
    ['KRX.IR',        'Euronext Dublin'],
    ['CEZ.PR',        'Prague Stock Exchange'],
    ['MAREL.IC',      'Nasdaq Iceland'],
  ];

  for (const [ticker, label] of cases) {
    it(`${ticker} (${label}) → EUROPE (was US before #215)`, () => {
      expect(detectExchangeGroup(ticker)).toBe('EUROPE');
      const r = getProviderRouting(ticker);
      expect(r.group).toBe('EUROPE');
      // Europe is a 15-min delay market, so coverage must read DELAYED
      // (not FULL — that would mean we claimed real-time for a tape
      // we don't have a direct feed on).
      expect(r.coverage).toBe(COVERAGE.DELAYED);
      // The display label must not be the US group — that was the bug.
      expect(r.groupInfo.label).not.toMatch(/US \(NYSE \/ NASDAQ\)/);
      expect(r.groupInfo.label).toMatch(/Europe/i);
    });
  }

  it('Brazilian .SA still resolves to B3 — .BR for Brussels does NOT break Brazil routing', () => {
    // Paranoia check: the .BR addition for Brussels could in principle
    // tangle with Brazil if someone normalised ".SA" to ".BR". Pin that
    // .SA is still B3 and .BR is still EUROPE.
    expect(detectExchangeGroup('PETR4.SA')).toBe('B3');
    expect(detectExchangeGroup('UCB.BR')).toBe('EUROPE');
  });

  it('US tickers without a suffix still default to US (unchanged)', () => {
    expect(detectExchangeGroup('AAPL')).toBe('US');
    expect(detectExchangeGroup('NVDA')).toBe('US');
  });
});
