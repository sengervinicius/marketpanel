/**
 * adrPremium.js — ADR vs local-line premium math (P2 item 3).
 *
 * premium% = (adrUSD / (localBRL × ratio / USDBRL) − 1) × 100
 *
 * where `ratio` is the number of LOCAL shares represented by ONE ADR
 * (e.g. 1 PBR = 2 × PETR4 → ratio 2; 1 ERJ = 4 × EMBR3 → ratio 4).
 *
 * Returns null whenever any leg is missing/non-positive or the ratio is
 * unknown — the panel renders "—" instead of EVER showing a wrong number.
 */

/** Curated ADR ↔ B3 local pairs with CORRECT ADR ratios (localPerAdr). */
export const ADR_PAIRS = [
  { adr: 'PBR',  local: 'PETR4', ratio: 2, name: 'Petrobras'   },
  { adr: 'VALE', local: 'VALE3', ratio: 1, name: 'Vale'        },
  { adr: 'ITUB', local: 'ITUB4', ratio: 1, name: 'Itaú'        },
  { adr: 'BBD',  local: 'BBDC4', ratio: 1, name: 'Bradesco'    },
  { adr: 'BBDO', local: 'BBDC3', ratio: 1, name: 'Bradesco ON' },
  { adr: 'ABEV', local: 'ABEV3', ratio: 1, name: 'Ambev'       },
  { adr: 'ERJ',  local: 'EMBR3', ratio: 4, name: 'Embraer'     },
];

const pos = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;

/**
 * @param {number|null} adrUsd   — ADR last price in USD
 * @param {number|null} localBrl — local line last price in BRL
 * @param {number|null} ratio    — local shares per ADR (null = unknown)
 * @param {number|null} usdBrl   — USD/BRL rate
 * @returns {number|null} premium in %, or null when not computable
 */
export function computeAdrPremium(adrUsd, localBrl, ratio, usdBrl) {
  if (!pos(adrUsd) || !pos(localBrl) || !pos(ratio) || !pos(usdBrl)) return null;
  const fairUsd = (localBrl * ratio) / usdBrl;
  if (!pos(fairUsd)) return null;
  return (adrUsd / fairUsd - 1) * 100;
}
