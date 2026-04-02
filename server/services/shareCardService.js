/**
 * services/shareCardService.js
 *
 * Server-side share card generation using SVG + sharp PNG rendering.
 * Produces premium dark-theme terminal cards for social sharing.
 *
 * Card types:
 *   1. Portfolio Summary Card  (1200x630)
 *   2. Ticker Snapshot Card    (1200x630)
 *   3. Leaderboard Rank Card   (1200x630)
 *   4. Weekly Competition Card (1200x630)
 */

'use strict';

const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// ── Output directory ─────────────────────────────────────────────────────────
const CARDS_DIR = path.join(__dirname, '..', 'public', 'cards');
const CARD_TTL_MS = 30 * 60 * 1000; // 30 minutes

// Ensure output dir exists
if (!fs.existsSync(CARDS_DIR)) {
  fs.mkdirSync(CARDS_DIR, { recursive: true });
}

// NOTE: Card cleanup is now managed by jobs/cardCleanup.js via the central scheduler.

// ── Design tokens ────────────────────────────────────────────────────────────
const C = {
  bg:       '#0a0a0a',
  surface:  '#151515',
  border:   '#2a2a2a',
  accent:   '#ff6600',
  green:    '#4caf50',
  red:      '#f44336',
  white:    '#e8e8e8',
  muted:    '#999999',
  faint:    '#555555',
  fontMono: "'SF Mono', 'Fira Code', 'Consolas', monospace",
  fontUI:   "'Inter', 'Helvetica Neue', sans-serif",
};

const W = 1200;
const H = 630;

// ── SVG helpers ──────────────────────────────────────────────────────────────

function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

function fmtPct(v) {
  if (v == null || isNaN(v)) return '--';
  const sign = v >= 0 ? '+' : '';
  return `${sign}${Number(v).toFixed(2)}%`;
}

function fmtMoney(v) {
  if (v == null || isNaN(v)) return '--';
  if (Math.abs(v) >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (Math.abs(v) >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (Math.abs(v) >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${Number(v).toFixed(2)}`;
}

function pctColor(v) {
  if (v == null) return C.muted;
  return v >= 0 ? C.green : C.red;
}

function brandHeader(y = 40) {
  return `
    <text x="48" y="${y}" fill="${C.accent}" font-family="${C.fontUI}" font-size="16" font-weight="700" letter-spacing="4">SENGER</text>
    <text x="132" y="${y}" fill="${C.faint}" font-family="${C.fontUI}" font-size="12" font-weight="500" letter-spacing="2">MARKET TERMINAL</text>
  `;
}

function cardFooter(subtitle = '') {
  return `
    <line x1="48" y1="${H - 60}" x2="${W - 48}" y2="${H - 60}" stroke="${C.border}" stroke-width="1"/>
    <text x="48" y="${H - 32}" fill="${C.faint}" font-family="${C.fontUI}" font-size="11" letter-spacing="1">senger.market</text>
    ${subtitle ? `<text x="${W - 48}" y="${H - 32}" fill="${C.faint}" font-family="${C.fontUI}" font-size="11" text-anchor="end">${esc(subtitle)}</text>` : ''}
  `;
}

function statBlock(x, y, label, value, valueColor = C.white, valueSize = 28) {
  return `
    <text x="${x}" y="${y}" fill="${C.faint}" font-family="${C.fontUI}" font-size="11" font-weight="600" letter-spacing="1.5">${esc(label)}</text>
    <text x="${x}" y="${y + valueSize + 4}" fill="${valueColor}" font-family="${C.fontMono}" font-size="${valueSize}" font-weight="700">${esc(value)}</text>
  `;
}

function miniSparkline(points, x, y, w, h, color = C.accent) {
  if (!points || points.length < 2) return '';
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const step = w / (points.length - 1);
  const pathData = points.map((p, i) => {
    const px = x + i * step;
    const py = y + h - ((p - min) / range) * h;
    return `${i === 0 ? 'M' : 'L'}${px.toFixed(1)},${py.toFixed(1)}`;
  }).join(' ');
  return `<path d="${pathData}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity="0.7"/>`;
}

// ── Card generators ──────────────────────────────────────────────────────────

/**
 * Generate Portfolio Summary Card.
 */
function portfolioCardSVG(data) {
  const { username, portfolioName, totalValue, totalReturnPct, dayReturnPct, holdings = [], period = '' } = data;

  const holdingsRows = holdings.slice(0, 3).map((h, i) => {
    const hy = 340 + i * 48;
    const pnlColor = pctColor(h.pnlPct);
    return `
      <text x="48" y="${hy}" fill="${C.accent}" font-family="${C.fontMono}" font-size="16" font-weight="600">${esc(h.symbol)}</text>
      <text x="200" y="${hy}" fill="${C.muted}" font-family="${C.fontUI}" font-size="13">${esc(h.name || '').slice(0, 20)}</text>
      <text x="550" y="${hy}" fill="${pnlColor}" font-family="${C.fontMono}" font-size="16" font-weight="600" text-anchor="end">${fmtPct(h.pnlPct)}</text>
      <text x="700" y="${hy}" fill="${C.muted}" font-family="${C.fontMono}" font-size="14" text-anchor="end">${fmtMoney(h.value)}</text>
    `;
  }).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <rect width="${W}" height="${H}" fill="${C.bg}" rx="12"/>
    <rect x="24" y="24" width="${W - 48}" height="${H - 48}" fill="${C.surface}" rx="8" stroke="${C.border}" stroke-width="1"/>
    ${brandHeader()}
    <text x="${W - 48}" y="40" fill="${C.muted}" font-family="${C.fontUI}" font-size="12" text-anchor="end">${esc(username)}'s Portfolio${period ? ` · ${period}` : ''}</text>

    <text x="48" y="90" fill="${C.muted}" font-family="${C.fontUI}" font-size="13" font-weight="600" letter-spacing="1.5">${esc(portfolioName || 'PORTFOLIO')}</text>

    ${statBlock(48, 120, 'TOTAL VALUE', fmtMoney(totalValue), C.white, 36)}
    ${statBlock(400, 120, 'TOTAL RETURN', fmtPct(totalReturnPct), pctColor(totalReturnPct), 36)}
    ${statBlock(700, 120, 'DAY RETURN', fmtPct(dayReturnPct), pctColor(dayReturnPct), 28)}

    <line x1="48" y1="200" x2="${W - 48}" y2="200" stroke="${C.border}" stroke-width="1"/>

    <text x="48" y="300" fill="${C.faint}" font-family="${C.fontUI}" font-size="11" font-weight="600" letter-spacing="1.5">TOP HOLDINGS</text>
    ${holdingsRows}

    ${cardFooter(new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }))}
  </svg>`;
}

/**
 * Generate Ticker Snapshot Card.
 */
function tickerCardSVG(data) {
  const { symbol, name, price, changePct, rangePct, range, keyStat, sparkline } = data;
  const priceStr = price != null ? `$${Number(price).toFixed(2)}` : '--';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <rect width="${W}" height="${H}" fill="${C.bg}" rx="12"/>
    <rect x="24" y="24" width="${W - 48}" height="${H - 48}" fill="${C.surface}" rx="8" stroke="${C.border}" stroke-width="1"/>
    ${brandHeader()}

    <text x="48" y="110" fill="${C.accent}" font-family="${C.fontMono}" font-size="42" font-weight="700" letter-spacing="2">${esc(symbol)}</text>
    <text x="48" y="145" fill="${C.muted}" font-family="${C.fontUI}" font-size="16">${esc((name || '').slice(0, 40))}</text>

    ${statBlock(48, 185, 'PRICE', priceStr, C.white, 48)}
    ${statBlock(420, 185, 'DAY', fmtPct(changePct), pctColor(changePct), 36)}
    ${range ? statBlock(650, 185, range.toUpperCase(), fmtPct(rangePct), pctColor(rangePct), 36) : ''}

    ${keyStat ? `
      <text x="48" y="360" fill="${C.faint}" font-family="${C.fontUI}" font-size="11" font-weight="600" letter-spacing="1.5">${esc(keyStat.label)}</text>
      <text x="48" y="390" fill="${C.muted}" font-family="${C.fontMono}" font-size="22" font-weight="600">${esc(keyStat.value)}</text>
    ` : ''}

    ${miniSparkline(sparkline, 700, 300, 430, 120)}

    ${cardFooter(new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }))}
  </svg>`;
}

/**
 * Generate Leaderboard Rank Card.
 */
function leaderboardCardSVG(data) {
  const { username, rank, board, score, weeklyReturn, level, persona } = data;
  const boardLabel = board === 'weekly' ? 'Weekly Challenge' : board === 'persona' ? 'Persona Board' : 'Global Leaderboard';

  const rankStr = `#${rank}`;
  const rankColor = rank === 1 ? '#ffd700' : rank === 2 ? '#c0c0c0' : rank === 3 ? '#cd7f32' : C.white;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <rect width="${W}" height="${H}" fill="${C.bg}" rx="12"/>
    <rect x="24" y="24" width="${W - 48}" height="${H - 48}" fill="${C.surface}" rx="8" stroke="${C.border}" stroke-width="1"/>
    ${brandHeader()}
    <text x="${W - 48}" y="40" fill="${C.muted}" font-family="${C.fontUI}" font-size="12" text-anchor="end">${esc(boardLabel)}</text>

    <text x="48" y="120" fill="${C.muted}" font-family="${C.fontUI}" font-size="14" font-weight="600" letter-spacing="1">${esc(username)}</text>
    ${persona ? `<text x="48" y="148" fill="${C.faint}" font-family="${C.fontUI}" font-size="12">${esc(persona)}</text>` : ''}

    <text x="48" y="260" fill="${rankColor}" font-family="${C.fontMono}" font-size="96" font-weight="700">${rankStr}</text>
    <text x="48" y="300" fill="${C.faint}" font-family="${C.fontUI}" font-size="14" letter-spacing="2">RANK</text>

    ${statBlock(500, 170, 'SCORE', String(score || 0), C.accent, 36)}
    ${level != null ? statBlock(500, 260, 'LEVEL', String(level), C.muted, 28) : ''}
    ${weeklyReturn != null ? statBlock(750, 170, 'WEEKLY RETURN', fmtPct(weeklyReturn), pctColor(weeklyReturn), 28) : ''}

    ${cardFooter(new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }))}
  </svg>`;
}

/**
 * Generate Weekly Competition Card.
 */
function weeklyCardSVG(data) {
  const { username, weeklyReturn, rank, endsAt, persona, level, xp } = data;
  const rankStr = rank ? `#${rank}` : '--';
  const endLabel = endsAt ? new Date(endsAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <rect width="${W}" height="${H}" fill="${C.bg}" rx="12"/>
    <rect x="24" y="24" width="${W - 48}" height="${H - 48}" fill="${C.surface}" rx="8" stroke="${C.border}" stroke-width="1"/>
    ${brandHeader()}
    <text x="${W - 48}" y="40" fill="${C.faint}" font-family="${C.fontUI}" font-size="12" text-anchor="end">Weekly Challenge${endLabel ? ` · ends ${endLabel}` : ''}</text>

    <text x="48" y="110" fill="${C.muted}" font-family="${C.fontUI}" font-size="16" font-weight="600" letter-spacing="1">${esc(username)}</text>
    ${persona ? `<text x="48" y="138" fill="${C.faint}" font-family="${C.fontUI}" font-size="12">${esc(persona)}</text>` : ''}

    ${statBlock(48, 175, 'WEEKLY RETURN', fmtPct(weeklyReturn), pctColor(weeklyReturn), 56)}
    <text x="500" y="260" fill="${C.white}" font-family="${C.fontMono}" font-size="64" font-weight="700">${rankStr}</text>
    <text x="500" y="295" fill="${C.faint}" font-family="${C.fontUI}" font-size="13" letter-spacing="2">RANK</text>

    ${level != null ? statBlock(750, 175, 'LEVEL', String(level), C.muted, 28) : ''}
    ${xp != null ? statBlock(750, 260, 'XP', String(xp), C.faint, 22) : ''}

    ${cardFooter('senger.market')}
  </svg>`;
}

// ── Concurrency cap ─────────────────────────────────────────────────────
let _activeRenders = 0;
const MAX_CONCURRENT_RENDERS = 5;

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Generate a share card PNG and return its URL path.
 * @param {'portfolio'|'ticker'|'leaderboard'|'weekly'} type
 * @param {object} data
 * @returns {{ imageUrl: string, shareText: string }}
 */
async function generateCard(type, data) {
  if (_activeRenders >= MAX_CONCURRENT_RENDERS) {
    throw new Error('Card generation busy — try again shortly');
  }
  _activeRenders++;

  let svg;
  let shareText = '';

  switch (type) {
    case 'portfolio':
      svg = portfolioCardSVG(data);
      shareText = data.totalReturnPct != null
        ? `${fmtPct(data.totalReturnPct)} on my portfolio. Tracking on Senger Market Terminal.`
        : 'Check out my portfolio on Senger Market Terminal.';
      break;
    case 'ticker':
      svg = tickerCardSVG(data);
      shareText = `${data.symbol} at $${Number(data.price || 0).toFixed(2)} (${fmtPct(data.changePct)} today). Via Senger Market Terminal.`;
      break;
    case 'leaderboard':
      svg = leaderboardCardSVG(data);
      shareText = `Ranked #${data.rank} on the Senger Market Terminal leaderboard!`;
      break;
    case 'weekly':
      svg = weeklyCardSVG(data);
      shareText = `${fmtPct(data.weeklyReturn)} this week, ranked #${data.rank}. Senger Market Terminal.`;
      break;
    default:
      throw new Error(`Unknown card type: ${type}`);
  }

  // Render SVG → PNG using sharp
  try {
    const id = crypto.randomBytes(8).toString('hex');
    const filename = `${type}_${id}.png`;
    const filepath = path.join(CARDS_DIR, filename);

    await sharp(Buffer.from(svg))
      .resize(W, H)
      .png({ quality: 90 })
      .toFile(filepath);

    const imageUrl = `/cards/${filename}`;
    return { imageUrl, shareText };
  } finally {
    _activeRenders--;
  }
}

module.exports = { generateCard };
