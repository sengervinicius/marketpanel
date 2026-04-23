#!/usr/bin/env node
/**
 * convertAvatars.js — #248 / P2.6
 *
 * Re-encodes the 11 investor-persona PNGs in `public/avatars/` to:
 *   1. AVIF at 192×192 (primary — modern Chrome/Safari/FF support)
 *   2. WebP at 192×192 (fallback — universal support incl. older Safari)
 *   3. PNG  at 192×192 (deep fallback — oxipng-level optimisation)
 *
 * Why 192×192: UserAvatar renders at a max CSS size of 64×64 and allows
 * an inner image at 92% of the box (≈59px). 192px covers 3× retina with
 * headroom, and keeps assets under 30 KB per the audit target (D4.3).
 *
 * The originals were 1–1.4 MB 1024×1024 PNGs — ~10 MB aggregate — paid
 * on every first-session onboarding visit. After conversion the entire
 * avatar set is ~50 KB in AVIF / ~120 KB in WebP.
 *
 *   node scripts/convertAvatars.js
 *
 * Outputs overwrite any existing files in `public/avatars/` with the
 * same basenames, preserving the PNGs as the deep fallback.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');

const SRC_DIR = path.resolve(__dirname, '..', 'public', 'avatars');
const TARGET_SIZE = 192;

// Encoder settings tuned for chibi-style avatars (flat colour regions
// with strong outlines — AVIF does great, WebP needs a bit more quality).
const AVIF_OPTS = { quality: 55, effort: 4, chromaSubsampling: '4:4:4' };
const WEBP_OPTS = { quality: 82, effort: 4, smartSubsample: true };
const PNG_OPTS  = { compressionLevel: 9, palette: true };

async function main() {
  const files = fs.readdirSync(SRC_DIR).filter(f => /\.png$/i.test(f));
  if (files.length === 0) {
    console.error(`no PNGs found in ${SRC_DIR}`);
    process.exit(1);
  }

  const summary = [];
  for (const file of files.sort()) {
    const srcPath = path.join(SRC_DIR, file);
    const base = file.replace(/\.png$/i, '');
    const before = fs.statSync(srcPath).size;

    // Build a single resized pipeline we can fork into 3 encoders.
    const resized = await sharp(srcPath)
      .resize(TARGET_SIZE, TARGET_SIZE, { fit: 'cover' })
      .toBuffer();

    const [avif, webp, png] = await Promise.all([
      sharp(resized).avif(AVIF_OPTS).toBuffer(),
      sharp(resized).webp(WEBP_OPTS).toBuffer(),
      sharp(resized).png(PNG_OPTS).toBuffer(),
    ]);

    fs.writeFileSync(path.join(SRC_DIR, `${base}.avif`), avif);
    fs.writeFileSync(path.join(SRC_DIR, `${base}.webp`), webp);
    fs.writeFileSync(srcPath, png); // overwrite the original PNG with the
                                    // slim 192×192 fallback

    summary.push({
      name: base,
      before_kb: (before / 1024).toFixed(1),
      avif_kb:   (avif.length / 1024).toFixed(1),
      webp_kb:   (webp.length / 1024).toFixed(1),
      png_kb:    (png.length / 1024).toFixed(1),
    });
  }

  const sum = (k) => summary.reduce((a, r) => a + Number(r[k]), 0).toFixed(1);
  console.log('\nconvertAvatars.js — results (all sizes in KB):\n');
  console.log(' name                 before    avif    webp     png');
  console.log(' ' + '-'.repeat(55));
  for (const r of summary) {
    console.log(
      ' ' + r.name.padEnd(20) +
      String(r.before_kb).padStart(8) +
      String(r.avif_kb).padStart(8) +
      String(r.webp_kb).padStart(8) +
      String(r.png_kb).padStart(8)
    );
  }
  console.log(' ' + '-'.repeat(55));
  console.log(
    ' ' + 'TOTAL'.padEnd(20) +
    String(sum('before_kb')).padStart(8) +
    String(sum('avif_kb')).padStart(8) +
    String(sum('webp_kb')).padStart(8) +
    String(sum('png_kb')).padStart(8)
  );
}

main().catch(e => { console.error(e); process.exit(1); });
