/* ================================================================
 * Numeric formatting helpers — canonical for every lower-row panel.
 * CIO-note (Phase 8.1): ban ad-hoc toFixed(2) in panels. All panels
 * must route numeric output through these helpers so USD/pct/delta
 * rendering is consistent everywhere.
 * ================================================================ */

/**
 * Format a dollar amount with scale suffix.
 * 1_245_000   -> "$1.2M"
 * 12_450_000  -> "$12M"
 * 2.1e9       -> "$2.1B"
 * -340_000    -> "-$340K"
 * 0           -> "$0"
 */
export function fmtUSD(n, { sign = false, digits = null } = {}) {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  const s = n < 0 ? '-' : sign && n > 0 ? '+' : '';
  const abs = Math.abs(n);
  let val, suffix;
  if (abs >= 1e12) { val = abs / 1e12; suffix = 'T'; }
  else if (abs >= 1e9)  { val = abs / 1e9;  suffix = 'B'; }
  else if (abs >= 1e6)  { val = abs / 1e6;  suffix = 'M'; }
  else if (abs >= 1e3)  { val = abs / 1e3;  suffix = 'K'; }
  else                  { val = abs;        suffix = ''; }
  const d = digits != null ? digits : (val >= 100 ? 0 : val >= 10 ? 1 : 2);
  const rounded = val.toFixed(d);
  const trimmed = d > 0 ? rounded.replace(/\.?0+$/, '') : rounded;
  return `${s}$${trimmed}${suffix}`;
}

/**
 * Format a percentage.
 * 0.0421 -> "4.21%"  (input as decimal by default)
 * Pass { fromPct: true } if your input is already in %.
 */
export function fmtPct(n, { digits = 2, sign = false, fromPct = false } = {}) {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  const v = fromPct ? n : n * 100;
  const s = v < 0 ? '-' : sign && v > 0 ? '+' : '';
  return `${s}${Math.abs(v).toFixed(digits)}%`;
}

/**
 * Format a delta (value change with explicit +/- sign).
 * 1234 -> "+1,234"
 * -42  -> "-42"
 */
export function fmtDelta(n, { digits = 0 } = {}) {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  const s = n > 0 ? '+' : n < 0 ? '-' : '';
  const v = Math.abs(n).toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  return `${s}${v}`;
}

/**
 * Format a basis-point value with sign: 14 -> "+14bp", -8 -> "-8bp".
 */
export function fmtBp(n, { sign = true } = {}) {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  const v = Math.round(n);
  const s = v > 0 && sign ? '+' : '';
  return `${s}${v}bp`;
}

/**
 * Format a count with scale suffix. 2400 -> "2.4K", 120_000 -> "120K".
 */
export function fmtCount(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  const s = n < 0 ? '-' : '';
  if (abs >= 1e9) return `${s}${(abs / 1e9).toFixed(1).replace(/\.0$/, '')}B`;
  if (abs >= 1e6) return `${s}${(abs / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
  if (abs >= 1e3) return `${s}${(abs / 1e3).toFixed(1).replace(/\.0$/, '')}K`;
  return `${s}${abs}`;
}

/**
 * Short relative time: "12s", "4m", "3h", "2d".
 */
export function fmtAgo(ts, now = Date.now()) {
  if (!ts) return '—';
  const t = typeof ts === 'string' ? Date.parse(ts) : ts;
  if (!Number.isFinite(t)) return '—';
  const d = Math.max(0, (now - t) / 1000);
  if (d < 60) return `${Math.floor(d)}s`;
  if (d < 3600) return `${Math.floor(d / 60)}m`;
  if (d < 86400) return `${Math.floor(d / 3600)}h`;
  return `${Math.floor(d / 86400)}d`;
}
