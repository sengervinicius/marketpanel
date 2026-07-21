/**
 * curveTape.test.js — fix/bug-wave3 BUG 1a: the RATES & CREDIT tape follows
 * the selected curve. These helpers derive <COUNTRY> 10Y and a client-side
 * 2s10s from /api/yield-curves points; missing tenors must yield null ("—"),
 * never a nearest-neighbour guess.
 */
import { describe, it, expect } from 'vitest';
import { tenorMonths, yieldAtMonths, slope2s10sBps, slopeRegimeWord } from '../curveTape';

const UK = [
  { tenor: '1Y', yield: 4.10 },
  { tenor: '2Y', yield: 4.00 },
  { tenor: '5Y', yield: 4.20 },
  { tenor: '10Y', yield: 4.55 },
  { tenor: '20Y', yield: 5.00 },
];

// BR-style bucketed curve: DI anchor, no literal 2Y/10Y tenors.
const BR_SPARSE = [
  { tenor: 'DI', yield: 14.75 },
  { tenor: '3Y', yield: 13.10 },
  { tenor: '7Y', yield: 13.60 },
];

describe('tenorMonths', () => {
  it('maps M/Y tenors and the DI anchor', () => {
    expect(tenorMonths('3M')).toBe(3);
    expect(tenorMonths('2Y')).toBe(24);
    expect(tenorMonths('10Y')).toBe(120);
    expect(tenorMonths('DI')).toBe(0.5);
    expect(tenorMonths('junk')).toBe(null);
    expect(tenorMonths(null)).toBe(null);
  });
});

describe('yieldAtMonths', () => {
  it('returns the exact tenor only', () => {
    expect(yieldAtMonths(UK, 120)).toBe(4.55);
    expect(yieldAtMonths(UK, 24)).toBe(4.00);
    // 9Y-ish curves must NOT be rounded to 10Y
    expect(yieldAtMonths(BR_SPARSE, 120)).toBe(null);
    expect(yieldAtMonths(BR_SPARSE, 24)).toBe(null);
  });
  it('tolerates junk input', () => {
    expect(yieldAtMonths(null, 120)).toBe(null);
    expect(yieldAtMonths([{ tenor: '10Y', yield: NaN }], 120)).toBe(null);
  });
});

describe('slope2s10sBps', () => {
  it('computes 10Y-2Y in bps', () => {
    expect(slope2s10sBps(UK)).toBe(55); // (4.55 - 4.00) * 100
  });
  it('returns null when either leg is missing (renders "—")', () => {
    expect(slope2s10sBps(BR_SPARSE)).toBe(null);
    expect(slope2s10sBps([])).toBe(null);
  });
  it('handles inversion sign', () => {
    expect(slope2s10sBps([{ tenor: '2Y', yield: 5.0 }, { tenor: '10Y', yield: 4.4 }])).toBe(-60);
  });
});

describe('slopeRegimeWord', () => {
  it('classifies inverted / steep / flat', () => {
    expect(slopeRegimeWord(-10)).toBe('INVERTED');
    expect(slopeRegimeWord(60)).toBe('STEEP');
    expect(slopeRegimeWord(20)).toBe('FLAT');
    expect(slopeRegimeWord(null)).toBe(null);
  });
});

// fix/rates-earnings-popout item 1 — full country-aware tape.
import { vsUstSpreadBps, isCountryTape, countryTapeCells } from '../curveTape';

const US = [
  { tenor: '2Y',  yield: 4.20 },
  { tenor: '10Y', yield: 4.55 },
  { tenor: '30Y', yield: 4.80 },
];

describe('vsUstSpreadBps', () => {
  it('computes (country 10Y − US 10Y) in bps', () => {
    // UK 10Y 4.55 vs US 10Y 4.55 → 0bp
    expect(vsUstSpreadBps(UK, US)).toBe(0);
    // A wider country: 5.55 vs 4.55 → +100bp
    expect(vsUstSpreadBps([{ tenor: '10Y', yield: 5.55 }], US)).toBe(100);
  });
  it('returns null when either curve lacks a literal 10Y', () => {
    expect(vsUstSpreadBps(BR_SPARSE, US)).toBe(null);
    expect(vsUstSpreadBps(UK, BR_SPARSE)).toBe(null);
  });
});

describe('isCountryTape', () => {
  it('US and ALL use the US FRED tape; countries use the country tape', () => {
    expect(isCountryTape('US')).toBe(false);
    expect(isCountryTape('ALL')).toBe(false);
    expect(isCountryTape('BR')).toBe(true);
    expect(isCountryTape('EU')).toBe(true);
    expect(isCountryTape('UK')).toBe(true);
    expect(isCountryTape(null)).toBe(false);
  });
});

describe('countryTapeCells', () => {
  it('derives all four country cells from the curves payload', () => {
    const cells = countryTapeCells({ code: 'UK', regionPoints: UK, usPoints: US, delta1mBps: -12 });
    expect(cells).toEqual({
      code: 'UK',
      y10: 4.55,
      slopeBps: 55,       // (4.55 - 4.00) * 100
      delta1mBps: -12,
      vsUstBps: 0,        // 4.55 vs 4.55
    });
  });
  it('degrades missing tenors / missing Δ1M to null', () => {
    const cells = countryTapeCells({ code: 'BR', regionPoints: BR_SPARSE, usPoints: US });
    expect(cells.y10).toBe(null);
    expect(cells.slopeBps).toBe(null);
    expect(cells.vsUstBps).toBe(null);
    expect(cells.delta1mBps).toBe(null);
  });
});
