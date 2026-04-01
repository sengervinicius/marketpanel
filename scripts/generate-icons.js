/**
 * Generate app icon PNGs at all required sizes.
 * Run: node scripts/generate-icons.js
 * Requires: npm install sharp
 */
const sharp = require('sharp');
const path = require('path');

const BG = '#0a0a0f';
const ACCENT = '#e55a00';

// Create an SVG icon at the given size
function iconSvg(size, maskable = false) {
  // For maskable icons, the safe zone is the inner 80% circle
  // So the content should be smaller and centered with more padding
  const padding = maskable ? Math.round(size * 0.2) : Math.round(size * 0.1);
  const fontSize = Math.round((size - padding * 2) * 0.65);
  const cornerRadius = maskable ? 0 : Math.round(size * 0.18);
  const textY = Math.round(size * 0.5 + fontSize * 0.35);

  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${cornerRadius}" fill="${BG}"/>
  <text x="${size / 2}" y="${textY}" text-anchor="middle" font-family="system-ui,-apple-system,Helvetica,Arial,sans-serif" font-weight="800" font-size="${fontSize}" fill="${ACCENT}">S</text>
</svg>`);
}

async function main() {
  const outDir = path.join(__dirname, '..', 'client', 'public');

  const icons = [
    { name: 'icon-192.png', size: 192, maskable: false },
    { name: 'icon-512.png', size: 512, maskable: false },
    { name: 'icon-maskable-192.png', size: 192, maskable: true },
    { name: 'icon-maskable-512.png', size: 512, maskable: true },
    { name: 'icon-1024.png', size: 1024, maskable: false },
  ];

  for (const icon of icons) {
    const svg = iconSvg(icon.size, icon.maskable);
    await sharp(svg)
      .resize(icon.size, icon.size)
      .png()
      .toFile(path.join(outDir, icon.name));
    console.log(`  ✓ ${icon.name} (${icon.size}x${icon.size})`);
  }

  console.log('\nAll icons generated in client/public/');
}

main().catch(err => {
  console.error('Icon generation failed:', err);
  process.exit(1);
});
