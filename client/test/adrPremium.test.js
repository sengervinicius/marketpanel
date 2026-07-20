/**
 * adrPremium.test.js — pins the ADR-premium math (P2 item 3).
 *
 * premium% = (adrUSD / (localBRL × ratio / USDBRL) − 1) × 100 and the
 * curated pair table with CORRECT ADR ratios. Any missing leg or unknown
 * ratio must yield null (panel renders "—", never a wrong number).
 */
import { describe, it, expect } from 'vitest';
import { ADR_PAIRS, computeAdrPremium } from '../src/utils/adrPremium';

describe('computeAdrPremium', () => {
  it('computes the premium against the ratio-adjusted local line', () => {
    // 1 PBR = 2 × PETR4. PETR4 R$38.00, USDBRL 5.40 → fair = 38×2/5.4 = 14.074
    // ADR at 13.50 → premium = 13.5/14.074 − 1 = −4.08%
    const p = computeAdrPremium(13.5, 38.0, 2, 5.4);
    expect(p).toBeCloseTo((13.5 / ((38.0 * 2) / 5.4) - 1) * 100, 10);
    expect(p).toBeCloseTo(-4.08, 1);
  });

  it('ratio 1 pairs: premium is a pure FX-adjusted price gap', () => {
    // VALE 1:1. VALE3 R$60.00, USDBRL 5.00 → fair $12.00; ADR $12.24 → +2%
    expect(computeAdrPremium(12.24, 60.0, 1, 5.0)).toBeCloseTo(2.0, 6);
  });

  it('ratio 4 (ERJ = 4 × EMBR3) parity means 0%', () => {
    // EMBR3 R$65, USDBRL 5.2 → fair = 65×4/5.2 = $50; ADR at 50 → 0%
    expect(computeAdrPremium(50, 65, 4, 5.2)).toBeCloseTo(0, 6);
  });

  it('returns null when ANY leg is missing or non-positive (renders "—")', () => {
    expect(computeAdrPremium(null, 38, 2, 5.4)).toBeNull();
    expect(computeAdrPremium(13.5, null, 2, 5.4)).toBeNull();
    expect(computeAdrPremium(13.5, 38, null, 5.4)).toBeNull(); // unknown ratio
    expect(computeAdrPremium(13.5, 38, 2, null)).toBeNull();   // no USDBRL
    expect(computeAdrPremium(0, 38, 2, 5.4)).toBeNull();
    expect(computeAdrPremium(13.5, 0, 2, 5.4)).toBeNull();
    expect(computeAdrPremium(13.5, 38, 2, 0)).toBeNull();
    expect(computeAdrPremium(NaN, 38, 2, 5.4)).toBeNull();
  });

  it('pins the curated pair table (CORRECT ADR ratios)', () => {
    const byAdr = Object.fromEntries(ADR_PAIRS.map(p => [p.adr, p]));
    expect(byAdr.PBR).toMatchObject({ local: 'PETR4', ratio: 2 });
    expect(byAdr.VALE).toMatchObject({ local: 'VALE3', ratio: 1 });
    expect(byAdr.ITUB).toMatchObject({ local: 'ITUB4', ratio: 1 });
    expect(byAdr.BBD).toMatchObject({ local: 'BBDC4', ratio: 1 });
    expect(byAdr.BBDO).toMatchObject({ local: 'BBDC3', ratio: 1 });
    expect(byAdr.ABEV).toMatchObject({ local: 'ABEV3', ratio: 1 });
    expect(byAdr.ERJ).toMatchObject({ local: 'EMBR3', ratio: 4 });
    // No PBR-A — the CIO approved PBR/PETR4 only for Petrobras.
    expect(byAdr['PBR-A']).toBeUndefined();
  });
});
