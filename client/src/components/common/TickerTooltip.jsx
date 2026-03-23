// TickerTooltip.jsx — global right-click info popup for any ticker
// Usage: dispatch window event from any panel:
//   window.dispatchEvent(new CustomEvent('ticker:rightclick', {
//     detail: { symbol, label, type, x, y }
//   }));
import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';

// ── Security descriptions ─────────────────────────────────────────────────────
const DESCRIPTIONS = {
  // World Index ETFs
  SPY:     'SPDR S&P 500 ETF — tracks the S&P 500 index; basket of the 500 largest US-listed companies by market cap.',
  QQQ:     'Invesco QQQ ETF — tracks the NASDAQ-100; top 100 non-financial stocks listed on NASDAQ, heavily tech-weighted.',
  DIA:     'SPDR Dow Jones ETF — tracks the DJIA; 30 blue-chip US stocks, price-weighted index since 1896.',
  IWM:     'iShares Russell 2000 ETF — US small-cap stocks; 2,000 smaller companies, proxy for domestic economic health.',
  EWZ:     'iShares MSCI Brazil ETF — proxy for the Brazilian Ibovespa; holds large/mid-cap BRL-denominated equities.',
  EWW:     'iShares MSCI Mexico ETF — tracks the Mexican IPC equity index; top exporters & domestic consumption plays.',
  EEM:     'iShares MSCI Emerging Markets ETF — broad EM exposure across 24 countries; China, India, Brazil, Taiwan, Korea.',
  EFA:     'iShares MSCI EAFE ETF — Europe, Australasia & Far East developed markets; excludes US & Canada.',
  FXI:     'iShares China Large-Cap ETF — top 50 Hong Kong-listed Chinese companies; SOEs & internet giants.',
  EWJ:     'iShares MSCI Japan ETF — large/mid-cap Japanese equities; exporters, financials, industrials.',
  // US Stocks
  AAPL:    'Apple Inc. — consumer electronics (iPhone, Mac, iPad), services (App Store, iCloud, Apple Pay). ~$3T market cap.',
  MSFT:    'Microsoft Corp. — cloud computing (Azure), Office 365, Windows OS, LinkedIn, Xbox, Bing/Copilot AI.',
  NVDA:    'NVIDIA Corp. — GPUs for AI/ML training & inference, data centers, gaming. Dominant in accelerated computing.',
  GOOGL:   'Alphabet Inc. (Class A) — Google Search, YouTube, Google Cloud (GCP), Android, Waymo autonomous driving.',
  AMZN:    'Amazon.com Inc. — e-commerce marketplace, AWS cloud (leader), Prime Video, Alexa, advertising business.',
  META:    'Meta Platforms — Facebook, Instagram, WhatsApp (3B+ users combined), Reality Labs VR/AR headsets.',
  TSLA:    'Tesla Inc. — electric vehicles (Model S/3/X/Y/Cybertruck), energy storage (Powerwall/Megapack), Full Self-Driving AI.',
  BRKB:    "Berkshire Hathaway B — Warren Buffett's diversified holding co.; insurance (GEICO), BNSF rail, energy, large equity stakes.",
  JPM:     'JPMorgan Chase — largest US bank by assets; investment banking, commercial banking, consumer (Chase), asset mgmt.',
  GS:      'Goldman Sachs — global investment banking, M&A advisory, FICC & equities trading, asset & wealth management.',
  BAC:     'Bank of America — US retail banking (#2), credit cards, Merrill Lynch brokerage & investment banking.',
  V:       'Visa Inc. — global payments network processing 200B+ transactions/year; card issuing, acquiring, digital wallets.',
  MA:      'Mastercard Inc. — global payment technology; card network, data analytics, Vocalink real-time payments.',
  XOM:     'Exxon Mobil — largest US integrated oil & gas co.; upstream exploration, Permian Basin, refining, chemicals.',
  CAT:     'Caterpillar Inc. — world leader in heavy machinery for construction, mining & quarrying, and energy industries.',
  BA:      'Boeing Co. — commercial jets (737 MAX, 787 Dreamliner), defense (F/A-18, KC-46), space systems (Starliner).',
  WMT:     "Walmart Inc. — world's largest retailer by revenue; grocery, e-commerce, Sam's Club, international operations.",
  LLY:     "Eli Lilly — pharma; Mounjaro/Zepbound (GLP-1 for diabetes/obesity), Verzenio (cancer), Kisunla (Alzheimer's).",
  UNH:     'UnitedHealth Group — largest US health insurer by revenue; UnitedHealthcare insurance + Optum health services.',
  // Brazil ADRs
  VALE:    "Vale S.A. — world's largest iron ore & nickel producer; key raw material for global steel & EV batteries.",
  PBR:     "Petrobras — Brazil's state-controlled oil company; offshore pre-salt crude; world's deepwater leader.",
  ITUB:    "Itaú Unibanco — Brazil's largest private bank by market cap; retail, wholesale, digital banking across LatAm.",
  BBD:     "Banco Bradesco — Brazil's second-largest private bank; insurance, asset management, digital channels.",
  ABEV:    "Ambev S.A. — Latin America's largest brewer; Brahma, Skol, Antarctica, Budweiser (BR), Guaraná Antarctica.",
  ERJ:     'Embraer — Brazilian aircraft manufacturer; E-Jet regional jets, Phenom/Praetor executive jets, defense (KC-390).',
  BRFS:    'BRF S.A. — global food producer; Sadia & Perdigão brands; processed poultry, pork & plant-based proteins.',
  SUZ:     "Suzano S.A. — world's largest eucalyptus pulp producer; supplies paper & tissue makers globally.",
  // FX
  EURUSD:  "Euro / US Dollar — world's most traded FX pair; driven by ECB vs Fed policy divergence.",
  GBPUSD:  'GBP / USD — "Cable"; sensitive to UK growth, BoE policy, and post-Brexit trade dynamics.',
  USDJPY:  'USD / JPY — major risk-sentiment gauge; JPY strengthens in risk-off; driven by BoJ yield-curve control.',
  USDBRL:  'USD / BRL — key EM FX pair; sensitive to Selic rate, commodity prices, fiscal policy & political risk.',
  GBPBRL:  'GBP / BRL — cross derived from GBP/USD × USD/BRL; reflects UK & Brazil macro drivers simultaneously.',
  EURBRL:  'EUR / BRL — cross rate; combines ECB/EU macro (EUR/USD) with Brazilian fiscal & commodity dynamics.',
  USDARS:  "USD / ARS — reflects Argentina's multi-tier FX controls, high inflation, and IMF debt restructuring.",
  USDCHF:  'USD / CHF — "Swissie"; CHF is a safe-haven currency; appreciates during global risk-off episodes.',
  USDCNY:  'USD / CNY (onshore) — managed float by the PBOC via daily fixing band; key geopolitical barometer.',
  USDMXN:  'USD / MXN — sensitive to nearshoring investment flows, US trade policy, and Banxico rate decisions.',
  AUDUSD:  'AUD / USD — "Aussie"; commodity & China growth proxy; influenced by iron ore prices & RBA policy.',
  USDCAD:  'USD / CAD — "Loonie"; heavily correlated with crude oil prices; driven by BoC vs Fed policy.',
  // Crypto
  BTCUSD:  'Bitcoin (BTC) — first & largest cryptocurrency; decentralized, fixed 21M supply, proof-of-work digital store of value.',
  ETHUSD:  'Ethereum (ETH) — smart-contract blockchain; base layer for DeFi protocols, NFTs, and Layer-2 networks.',
  SOLUSD:  'Solana (SOL) — high-throughput L1 blockchain; ~65k TPS, ~400ms finality, low fees; DeFi & memecoins hub.',
  XRPUSD:  "XRP — Ripple's digital payment token; designed for cross-border bank settlements; subject to SEC litigation history.",
  BNBUSD:  'BNB (Binance Coin) — native token of Binance exchange & BNB Smart Chain; used for trading fee discounts.',
  DOGEUSD: 'Dogecoin (DOGE) — meme-origin proof-of-work crypto; unlimited supply; large retail & social media following.',
  // Commodities
  GLD:     'SPDR Gold Shares ETF — tracks gold spot price (equivalent to ~1/10 oz per share); inflation hedge & safe haven.',
  SLV:     'iShares Silver Trust ETF — tracks silver spot; dual role as industrial metal (solar, EVs) and monetary asset.',
  CPER:    'US Copper Index ETF — front-month NYMEX copper futures; key leading indicator of global industrial demand.',
  REMX:    'VanEck Rare Earth/Strategic Metals ETF — miners of REEs (neodymium, dysprosium) critical for EV motors & wind turbines.',
  USO:     'US Oil Fund ETF — front-month NYMEX WTI crude oil futures; global energy benchmark, USD-denominated.',
  UNG:     'US Natural Gas Fund ETF — NYMEX Henry Hub natural gas futures; heating, electricity generation & LNG exports.',
  SOYB:    'Teucrium Soybean ETF — CBOT soybean futures; key global protein crop; major export for Brazil & US.',
  WEAT:    'Teucrium Wheat ETF — CBOT wheat futures; global food security bellwether; affected by weather & geopolitics.',
  CORN:    'Teucrium Corn ETF — CBOT corn futures; ethanol feedstock, animal feed, US/Brazil major export crop.',
  BHP:     "BHP Group ADR — world's largest diversified mining company; iron ore (Pilbara), copper, potash, coal.",
};

// ── Helper to get accent color by asset type ─────────────────────────────────
function accentFor(type) {
  if (!type) return '#ff6600';
  const t = type.toUpperCase();
  if (t === 'FX' || t === 'FOREX')   return '#ce93d8';
  if (t === 'CRYPTO')                return '#f7931a';
  if (t === 'ETF' || t === 'INDEX')  return '#ff6600';
  if (t === 'COMMODITY')             return '#ffd54f';
  if (t === 'EQUITY')                return '#00bcd4';
  if (t === 'BR' || t === 'ADR')     return '#ffa726';
  return '#ff6600';
}

// ── Component ─────────────────────────────────────────────────────────────────
export function TickerTooltip() {
  const [tooltip, setTooltip] = useState(null);

  // Listen for right-click events from panels
  useEffect(() => {
    const show = (e) => setTooltip(e.detail);
    window.addEventListener('ticker:rightclick', show);
    return () => window.removeEventListener('ticker:rightclick', show);
  }, []);

  // Dismiss on next click anywhere
  useEffect(() => {
    if (!tooltip) return;
    const hide = () => setTooltip(null);
    // Small delay so the right-click that opened it doesn't immediately close it
    const timer = setTimeout(() => {
      window.addEventListener('click', hide, { once: true });
      window.addEventListener('keydown', hide, { once: true });
    }, 80);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('click', hide);
      window.removeEventListener('keydown', hide);
    };
  }, [tooltip]);

  if (!tooltip) return null;

  const { symbol, label, type, x, y } = tooltip;
  const desc = DESCRIPTIONS[symbol] || `${label || symbol} — no description on file.`;
  const accent = accentFor(type);

  // Keep within viewport
  const left = Math.min(x, window.innerWidth  - 280);
  const top  = Math.min(y, window.innerHeight - 120);

  return createPortal(
    <div
      style={{
        position:   'fixed',
        left,
        top,
        zIndex:     99999,
        background: '#111',
        border:     `1px solid #2a2a2a`,
        borderLeft: `3px solid ${accent}`,
        borderRadius: 4,
        padding:    '8px 12px',
        maxWidth:   270,
        boxShadow:  '0 6px 24px rgba(0,0,0,0.7)',
        fontFamily: "'IBM Plex Mono','Roboto Mono','Courier New',monospace",
        userSelect: 'text',
        pointerEvents: 'auto',
      }}
      /* Stop click inside from triggering the dismiss listener */
      onClick={e => e.stopPropagation()}
      onContextMenu={e => e.stopPropagation()}
    >
      {/* Symbol + type badge */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 5 }}>
        <span style={{ color: accent, fontSize: 12, fontWeight: 700, letterSpacing: '0.06em' }}>
          {symbol}
        </span>
        {label && label !== symbol && (
          <span style={{ color: '#666', fontSize: 9 }}>{label}</span>
        )}
        {type && (
          <span style={{
            marginLeft: 'auto', background: '#1e1e1e', border: `1px solid ${accent}33`,
            borderRadius: 2, padding: '0 4px', color: accent, fontSize: 8, fontWeight: 700,
            letterSpacing: '0.08em',
          }}>
            {type}
          </span>
        )}
      </div>
      {/* Description */}
      <div style={{ color: '#aaa', fontSize: 10, lineHeight: 1.55 }}>{desc}</div>
    </div>,
    document.body
  );
}
