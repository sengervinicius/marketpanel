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
