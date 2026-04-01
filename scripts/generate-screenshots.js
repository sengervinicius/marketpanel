/**
 * generate-screenshots.js
 *
 * Generates App Store screenshot placeholder frames at required dimensions.
 * These are dark-themed promotional frames with the Senger brand styling.
 * Actual device-framed screenshots should be captured from Xcode Simulator.
 *
 * Usage: node scripts/generate-screenshots.js
 */

const sharp = require('sharp');
const path  = require('path');

const OUT = path.join(__dirname, '..', 'client', 'public');

// App Store required screenshot sizes
const SCREENSHOTS = [
  // iPhone 6.7" (iPhone 15 Pro Max, 14 Pro Max)
  { name: 'screenshot-iphone-67',  w: 1290, h: 2796 },
  // iPhone 6.5" (iPhone 11 Pro Max, XS Max)
  { name: 'screenshot-iphone-65',  w: 1242, h: 2688 },
  // iPad 12.9" (iPad Pro)
  { name: 'screenshot-ipad-129',   w: 2048, h: 2732 },
  // Generic mobile for manifest.json
  { name: 'screenshot-mobile',     w: 1080, h: 1920 },
  // Generic desktop for manifest.json
  { name: 'screenshot-desktop',    w: 2560, h: 1440 },
];

// Senger brand colors
const BG       = '#0a0a0f';
const ACCENT   = '#e55a00';
const TEXT      = '#e0e0e0';
const SUBTLE    = '#666666';
const SURFACE   = '#1a1a2e';
const GREEN     = '#00c853';
const RED       = '#e74c3c';

function createSVG(w, h, variant) {
  const isMobile = h > w;
  const isIPad   = w === 2048;
  const scale    = Math.min(w / 1290, h / 2796) * (isMobile ? 1 : 0.8);

  // Responsive sizing
  const titleSize    = Math.round(isMobile ? 52 * scale : 48 * scale);
  const subtitleSize = Math.round(isMobile ? 28 * scale : 24 * scale);
  const headerH      = Math.round(h * 0.12);
  const footerH      = Math.round(h * 0.06);

  // Mock terminal content area
  const contentY = headerH;
  const contentH = h - headerH - footerH;
  const contentW = w - Math.round(w * 0.08);
  const contentX = Math.round(w * 0.04);

  // Chart area dimensions
  const chartW = Math.round(contentW * 0.45);
  const chartH = Math.round(contentH * 0.25);
  const panelW = Math.round(contentW * 0.25);

  if (variant === 'home') {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="${w}" height="${h}" fill="${BG}"/>

  <!-- Top status bar -->
  <rect x="0" y="0" width="${w}" height="${Math.round(h*0.04)}" fill="${BG}"/>

  <!-- Header -->
  <text x="${w/2}" y="${headerH*0.55}" text-anchor="middle" font-family="SF Pro Display, -apple-system, sans-serif" font-size="${titleSize}" font-weight="800" fill="${ACCENT}" letter-spacing="4">SENGER MARKET</text>
  <text x="${w/2}" y="${headerH*0.85}" text-anchor="middle" font-family="SF Pro Text, -apple-system, sans-serif" font-size="${subtitleSize}" fill="${SUBTLE}">Real-Time Financial Terminal</text>

  <!-- Market summary cards row -->
  ${[0,1,2].map((i) => {
    const cardW = Math.round((contentW - 40*scale) / 3);
    const cardX = contentX + i * (cardW + Math.round(20*scale));
    const cardY = contentY + Math.round(20*scale);
    const cardH = Math.round(contentH * 0.12);
    const tickers = [['SPY', '657.25', '+1.07%'], ['BTC', '68,785', '+2.87%'], ['EUR/USD', '1.1616', '+0.51%']];
    const t = tickers[i];
    return `<rect x="${cardX}" y="${cardY}" width="${cardW}" height="${cardH}" rx="${Math.round(12*scale)}" fill="${SURFACE}"/>
    <text x="${cardX + Math.round(16*scale)}" y="${cardY + Math.round(cardH*0.38)}" font-family="SF Mono, monospace" font-size="${Math.round(22*scale)}" font-weight="700" fill="${TEXT}">${t[0]}</text>
    <text x="${cardX + Math.round(16*scale)}" y="${cardY + Math.round(cardH*0.68)}" font-family="SF Mono, monospace" font-size="${Math.round(20*scale)}" fill="${TEXT}">${t[1]}</text>
    <text x="${cardX + cardW - Math.round(16*scale)}" y="${cardY + Math.round(cardH*0.68)}" text-anchor="end" font-family="SF Mono, monospace" font-size="${Math.round(18*scale)}" fill="${GREEN}">${t[2]}</text>`;
  }).join('\n')}

  <!-- Charts area -->
  ${[0,1].map((row) => {
    return [0,1,2].map((col) => {
      const cW = Math.round((contentW - 40*scale) / 3);
      const cH = Math.round(contentH * 0.18);
      const cX = contentX + col * (cW + Math.round(20*scale));
      const cY = contentY + Math.round(contentH * 0.16) + row * (cH + Math.round(12*scale));
      const labels = [['SPY', '+1.07%'], ['BOVA11', '-0.55%'], ['QQQ', '+1.57%'], ['AAPL', '+0.29%'], ['GOOGL', '+3.97%'], ['TSLA', '+2.68%']];
      const l = labels[row*3+col];
      const color = l[1].startsWith('+') ? GREEN : RED;
      // Generate a random-ish chart line
      const points = Array.from({length: 20}, (_, i) => {
        const x = cX + Math.round(10*scale) + i * Math.round((cW - 20*scale) / 19);
        const baseY = cY + cH * 0.7;
        const amp = cH * 0.3 * (l[1].startsWith('+') ? 1 : -0.5);
        const y = baseY - amp * (0.3 + 0.7 * Math.sin(i * 0.3 + col + row * 2) * Math.cos(i * 0.15));
        return `${x},${Math.round(y)}`;
      }).join(' ');
      return `<rect x="${cX}" y="${cY}" width="${cW}" height="${cH}" rx="${Math.round(8*scale)}" fill="${SURFACE}"/>
      <text x="${cX + Math.round(10*scale)}" y="${cY + Math.round(18*scale)}" font-family="SF Mono, monospace" font-size="${Math.round(14*scale)}" font-weight="600" fill="${TEXT}">${l[0]}</text>
      <text x="${cX + cW - Math.round(10*scale)}" y="${cY + Math.round(18*scale)}" text-anchor="end" font-family="SF Mono, monospace" font-size="${Math.round(12*scale)}" fill="${color}">${l[1]}</text>
      <polyline points="${points}" fill="none" stroke="${color}" stroke-width="${Math.round(2*scale)}" stroke-linecap="round" stroke-linejoin="round"/>`;
    }).join('\n');
  }).join('\n')}

  <!-- Data panels -->
  ${[0,1,2,3].map((i) => {
    const pW = Math.round((contentW - 60*scale) / 4);
    const pX = contentX + i * (pW + Math.round(20*scale));
    const pH = Math.round(contentH * 0.35);
    const pY = h - footerH - pH - Math.round(20*scale);
    const headers = ['Global Indexes', 'Brazil B3', 'Commodities', 'Portfolio'];
    const rows = [
      [['SPY','657.25','+1.07%'],['QQQ','506.34','+1.57%'],['DIA','467.47','+0.92%'],['EWZ','38.59','+0.52%']],
      [['VALE3','82.95','+8.50%'],['PETR4','46.97','-3.60%'],['ITUB4','43.93','+1.87%'],['BBDC4','19.52','+1.83%']],
      [['GLD','439.47','+2.13%'],['SLV','68.49','+8.65%'],['USO','124.86','-1.88%'],['UNG','11.82','-1.82%']],
      [['SPY','—','657.25'],['AAPL','—','254.53'],['MSFT','—','372.09'],['NVDA','—','176.85']],
    ];
    return `<rect x="${pX}" y="${pY}" width="${pW}" height="${pH}" rx="${Math.round(8*scale)}" fill="${SURFACE}"/>
    <text x="${pX + Math.round(12*scale)}" y="${pY + Math.round(22*scale)}" font-family="SF Pro Text, sans-serif" font-size="${Math.round(14*scale)}" font-weight="700" fill="${ACCENT}">${headers[i]}</text>
    ${rows[i].map((r, ri) => {
      const ry = pY + Math.round(42*scale) + ri * Math.round(24*scale);
      const color = r[2].startsWith('+') ? GREEN : r[2].startsWith('-') ? RED : TEXT;
      return `<text x="${pX + Math.round(12*scale)}" y="${ry}" font-family="SF Mono, monospace" font-size="${Math.round(12*scale)}" fill="${ACCENT}">${r[0]}</text>
      <text x="${pX + pW - Math.round(12*scale)}" y="${ry}" text-anchor="end" font-family="SF Mono, monospace" font-size="${Math.round(12*scale)}" fill="${color}">${r[2]}</text>`;
    }).join('\n')}`;
  }).join('\n')}

  <!-- Bottom bar -->
  <rect x="0" y="${h - footerH}" width="${w}" height="${footerH}" fill="${SURFACE}" opacity="0.5"/>
  <circle cx="${w*0.2}" cy="${h - footerH/2}" r="${Math.round(4*scale)}" fill="${GREEN}"/>
  <text x="${w*0.2 + Math.round(10*scale)}" y="${h - footerH/2 + Math.round(5*scale)}" font-family="SF Mono, monospace" font-size="${Math.round(11*scale)}" fill="${SUBTLE}">STOCKS</text>
  <circle cx="${w*0.4}" cy="${h - footerH/2}" r="${Math.round(4*scale)}" fill="${GREEN}"/>
  <text x="${w*0.4 + Math.round(10*scale)}" y="${h - footerH/2 + Math.round(5*scale)}" font-family="SF Mono, monospace" font-size="${Math.round(11*scale)}" fill="${SUBTLE}">FX</text>
  <circle cx="${w*0.6}" cy="${h - footerH/2}" r="${Math.round(4*scale)}" fill="${GREEN}"/>
  <text x="${w*0.6 + Math.round(10*scale)}" y="${h - footerH/2 + Math.round(5*scale)}" font-family="SF Mono, monospace" font-size="${Math.round(11*scale)}" fill="${SUBTLE}">CRYPTO</text>
</svg>`;
  }

  if (variant === 'mobile') {
    const tabH = Math.round(h * 0.08);
    const headerHeight = Math.round(h * 0.07);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="${w}" height="${h}" fill="${BG}"/>

  <!-- Status bar -->
  <rect x="0" y="0" width="${w}" height="${Math.round(h*0.035)}" fill="${BG}"/>

  <!-- Header -->
  <rect x="0" y="${Math.round(h*0.035)}" width="${w}" height="${headerHeight}" fill="${SURFACE}"/>
  <text x="${w/2}" y="${Math.round(h*0.035) + headerHeight*0.65}" text-anchor="middle" font-family="SF Pro Display, -apple-system, sans-serif" font-size="${Math.round(36*scale)}" font-weight="800" fill="${ACCENT}" letter-spacing="3">SENGER MARKET</text>

  <!-- Search bar -->
  <rect x="${Math.round(w*0.04)}" y="${Math.round(h*0.12)}" width="${Math.round(w*0.92)}" height="${Math.round(52*scale)}" rx="${Math.round(12*scale)}" fill="${SURFACE}"/>
  <text x="${Math.round(w*0.08)}" y="${Math.round(h*0.12) + Math.round(34*scale)}" font-family="SF Pro Text, sans-serif" font-size="${Math.round(18*scale)}" fill="${SUBTLE}">Search ticker or company...</text>

  <!-- Market cards -->
  ${['US Indexes', 'FX', 'Crypto', 'Commodities'].map((section, si) => {
    const secY = Math.round(h*0.17) + si * Math.round(h*0.18);
    const cardPad = Math.round(w*0.04);
    return `<text x="${cardPad}" y="${secY}" font-family="SF Pro Text, sans-serif" font-size="${Math.round(16*scale)}" font-weight="600" fill="${SUBTLE}" letter-spacing="1">${section.toUpperCase()}</text>
    ${[0,1,2].map((ci) => {
      const cardW = Math.round((w - cardPad*4) / 3);
      const cardX = cardPad + ci * (cardW + cardPad);
      const cardY = secY + Math.round(10*scale);
      const cardH = Math.round(h*0.12);
      const data = [
        [['SPY','657.25','+1.07%'],['QQQ','506.34','+1.57%'],['DIA','467.47','+0.92%']],
        [['EUR/USD','1.1616','+0.51%'],['USD/BRL','5.15','-0.73%'],['USD/JPY','150.65','-0.84%']],
        [['BTC','68,785','+2.87%'],['ETH','2,133','+3.78%'],['SOL','83.57','+3.55%']],
        [['GLD','439.47','+2.13%'],['USO','124.86','-1.88%'],['SLV','68.49','+8.65%']],
      ];
      const d = data[si][ci];
      const color = d[2].startsWith('+') ? GREEN : RED;
      // Mini sparkline
      const pts = Array.from({length:10}, (_,i) => {
        const x = cardX + Math.round(8*scale) + i * Math.round((cardW - 16*scale)/9);
        const y = cardY + cardH*0.75 - Math.round(cardH*0.2 * Math.sin(i*0.5 + ci + si));
        return `${x},${Math.round(y)}`;
      }).join(' ');
      return `<rect x="${cardX}" y="${cardY}" width="${cardW}" height="${cardH}" rx="${Math.round(10*scale)}" fill="${SURFACE}"/>
      <text x="${cardX + Math.round(10*scale)}" y="${cardY + Math.round(22*scale)}" font-family="SF Mono, monospace" font-size="${Math.round(14*scale)}" font-weight="600" fill="${TEXT}">${d[0]}</text>
      <text x="${cardX + Math.round(10*scale)}" y="${cardY + Math.round(40*scale)}" font-family="SF Mono, monospace" font-size="${Math.round(18*scale)}" font-weight="700" fill="${TEXT}">${d[1]}</text>
      <text x="${cardX + cardW - Math.round(10*scale)}" y="${cardY + Math.round(22*scale)}" text-anchor="end" font-family="SF Mono, monospace" font-size="${Math.round(13*scale)}" fill="${color}">${d[2]}</text>
      <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="${Math.round(1.5*scale)}" opacity="0.6"/>`;
    }).join('\n')}`;
  }).join('\n')}

  <!-- Tab bar -->
  <rect x="0" y="${h - tabH}" width="${w}" height="${tabH}" fill="${SURFACE}"/>
  ${['Home','Search','Portfolio','Alerts','More'].map((tab, ti) => {
    const tx = Math.round(w * (ti + 0.5) / 5);
    const ty = h - tabH/2;
    const isActive = ti === 0;
    return `<text x="${tx}" y="${ty + Math.round(6*scale)}" text-anchor="middle" font-family="SF Pro Text, sans-serif" font-size="${Math.round(12*scale)}" font-weight="${isActive ? '700' : '400'}" fill="${isActive ? ACCENT : SUBTLE}">${tab}</text>`;
  }).join('\n')}
</svg>`;
  }

  // Default: desktop variant
  return createSVG(w, h, 'home');
}

async function main() {
  console.log('Generating App Store screenshots...\n');

  for (const { name, w, h } of SCREENSHOTS) {
    const isMobile = h > w;
    const variant = isMobile ? 'mobile' : 'home';
    const svg = createSVG(w, h, variant);
    const outPath = path.join(OUT, `${name}.png`);

    await sharp(Buffer.from(svg))
      .png()
      .toFile(outPath);

    console.log(`  ${name}.png  (${w}x${h})`);
  }

  console.log('\nDone! Screenshots saved to client/public/');
}

main().catch(console.error);
