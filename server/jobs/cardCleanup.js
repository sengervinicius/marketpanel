/**
 * jobs/cardCleanup.js — Share-card temp file cleanup.
 *
 * Removes expired PNG cards from server/public/cards/.
 * Caps total files to prevent unbounded disk growth.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const CARDS_DIR = path.join(__dirname, '..', 'public', 'cards');
const CARD_TTL_MS = 30 * 60 * 1000; // 30 minutes
const MAX_CARD_FILES = 500;          // hard cap

async function cleanupCards() {
  if (!fs.existsSync(CARDS_DIR)) return;

  const files = fs.readdirSync(CARDS_DIR);
  const now = Date.now();
  let removed = 0;

  // Remove expired files
  for (const f of files) {
    try {
      const fp = path.join(CARDS_DIR, f);
      const stat = fs.statSync(fp);
      if (now - stat.mtimeMs > CARD_TTL_MS) {
        fs.unlinkSync(fp);
        removed++;
      }
    } catch { /* silent */ }
  }

  // If still too many, remove oldest first
  const remaining = fs.readdirSync(CARDS_DIR);
  if (remaining.length > MAX_CARD_FILES) {
    const sorted = remaining
      .map(f => ({ name: f, mtime: fs.statSync(path.join(CARDS_DIR, f)).mtimeMs }))
      .sort((a, b) => a.mtime - b.mtime);
    const toRemove = sorted.slice(0, remaining.length - MAX_CARD_FILES);
    for (const { name } of toRemove) {
      try { fs.unlinkSync(path.join(CARDS_DIR, name)); removed++; }
      catch { /* silent */ }
    }
  }

  if (removed > 0) {
    console.log(`[cardCleanup] Removed ${removed} expired/excess card file(s)`);
  }
}

module.exports = { cleanupCards };
