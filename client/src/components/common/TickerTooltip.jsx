// TickerTooltip.jsx — global hover / long-press info popup for any ticker
// Desktop: hover 2 s over any [data-ticker] element to show
// Mobile:  long-press 800 ms over any [data-ticker] element to show
import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

// ── Security descriptions ─────────────────────────────────────────────────────
const DESCRIPTIONS = {
  // World Index ETFs
  SPY:   'SPDR S&P 500 ETF — tracks the S&P 500 index; basket of the 500 largest US-listed companies by market cap.',
  QQQ:   'Invesco QQQ ETF — tracks the NASDAQ-100; top 100 non-financial stocks listed on NASDAQ, heavily tech-weighted.',
  DIA:   'SPDR Dow Jones ETF — tracks the DJIA; 30 blue-chip US stocks, price-weighted index since 1896.',
  IWM:   'iShares Russell 2000 ETF — US small-cap stocks; 2,000 smaller companies, proxy for domestic economic health.',
  EWZ:   'iShares MSCI Brazil ETF — proxy for the Brazilian Ibovespa; holds large/mid-cap BRL-denominated equities.',
  EWW:   'iShares MSCI Mexico ETF — tracks the Mexican IPC equity index; top exporters & domestic consumption plays.',
  EEM:   'iShares MSCI Emerging Markets ETF — broad EM exposure across 24 countries; China, India, Brazil, Taiwan, Korea.',
  EFA:   'iShares MSCI EAFE ETF — Europe, Australasia & Far East developed markets; excludes US & Canada.',
  FXI:   'iShares China Large-Cap ETF — top 50 Hong Kong-listed Chinese companies; SOEs & internet giants.',
  EWJ:   'iShares MSCI Japan ETF — large/mid-cap Japanese equities; exporters, financials, industrials.',
  // US Stocks
  AAPL:  'Apple Inc. — consumer electronics (iPhone, Mac, iPad), services (App Store, iCloud, Apple Pay). ~$3T market cap.',
  MSFT:  'Microsoft Corp. — cloud computing (Azure), Office 365, Windows OS, LinkedIn, Xbox, Bing/Copilot AI.',
  NVDA:  'NVIDIA Corp. — GPUs for AI/ML training & inference, data centers, gaming. Dominant in accelerated computing.',
  GOOGL: 'Alphabet Inc. (Class A) — Google Search, YouTube, Google Cloud (GCP), Android, Waymo autonomous driving.',
  AMZN:  'Amazon.com Inc. — e-commerce marketplace, AWS cloud (leader), Prime Video, Alexa, advertising business.',
  META:  'Meta Platforms — Facebook, Instagram, WhatsApp (3B+ users combined), Reality Labs VR/AR headsets.',
  TSLA:  'Tesla Inc. — electric vehicles (Model S/3/X/Y/Cybertruck), energy storage (Powerwall/Megapack), Full Self-Driving AI.',
  BRKB:  "Berkshire Hathaway B — Warren Buffett's diversified holding co.; insurance (GEICO), BNSF rail, energy, large equity stakes.",
  JPM:   'JPMorgan Chase — largest US bank by assets; investment banking, commercial banking, consumer (Chase), asset mgmt.',
  GS:    'Goldman Sachs — global investment banking, M&A advisory, FICC & equities trading, asset & wealth management.',
  BAC:   'Bank of America — US retail banking (#2), credit cards, Merrill Lynch brokerage & investment banking.',
  V:     'Visa Inc. — global payments network processing 200B+ transactions/year; card issuing, acquiring, digital wallets.',
  MA:    'Mastercard Inc. — global payment technology; card network, data analytics, Vocalink real-time payments.',
  XOM:   'Exxon Mobil — largest US integrated oil & gas co.; upstream exploration, Permian Basin, refining, chemicals.',
  CAT:   'Caterpillar Inc. — world leader in heavy machinery for construction, mining & quarrying, and energy industries.',
  BA:    'Boeing Co. — commercial jets (737 MAX, 787 Dreamliner), defense (F/A-18, KC-46), space systems (Starliner).',
  WMT:   "Walmart Inc. — world's largest retailer by revenue; grocery, e-commerce, Sam's Club, international operations.",
  LLY:   "Eli Lilly — pharma; Mounjaro/Zepbound (GLP-1 for diabetes/obesity), Verzenio (cancer), Kisunla (Alzheimer's).",
  UNH:   'UnitedHealth Group — largest US health insurer by revenue; UnitedHealthcare insurance + Optum health services.',
  // Brazil ADRs
  VALE:  "Vale S.A. — world's largest iron ore & nickel producer; key raw material for global steel & EV batteries.",
  PBR:   "Petrobras — Brazil's state-controlled oil company; offshore pre-salt crude; world's deepwater leader.",
  ITUB:  "Itaú Unibanco — Brazil's largest private bank by market cap; retail, wholesale, digital banking across LatAm.",
  BBD:   "Banco Bradesco — Brazil's second-largest private bank; insurance, asset management, digital channels.",
  ABEV:  "Ambev S.A. — Latin America's largest brewer; Brahma, Skol, Antarctica, Budweiser (BR), Guaraná Antarctica.",
  ERJ:   'Embraer — Brazilian aircraft manufacturer; E-Jet regional jets, Phenom/Praetor executive jets, defense (KC-390).',
  BRFS:  'BRF S.A. — global food producer; Sadia & Perdigão brands; processed poultry, pork & plant-based proteins.',
  SUZ:   "Suzano S.A. — world's largest eucalyptus pulp producer; supplies paper & tissue makers globally.",
  // Brazilian equities (B3)
  'BOVA11.SA': 'Ibovespa ETF (BOVA11) — tracks the Ibovespa index on B3; basket of the most liquid Brazilian stocks.',
  'PETR3.SA':  "Petrobras ON — voting shares of Brazil's state-controlled oil major; offshore pre-salt crude producer.",
  'PETR4.SA':  'Petrobras PN — preferred shares (priority dividends, no voting rights) of Petrobras; most liquid on B3.',
  'VALE3.SA':  "Vale S.A. ON — world's largest iron ore & nickel producer; key raw material for global steel & EV batteries.",
  'ITUB3.SA':  "Itaú Unibanco ON — voting shares of Brazil's largest private bank; retail & digital banking across LatAm.",
  'ITUB4.SA':  "Itaú Unibanco PN — preferred shares of Brazil's largest private bank by market cap.",
  'BBDC3.SA':  "Banco Bradesco ON — voting shares of Brazil's 2nd-largest private bank; insurance & digital channels.",
  'BBDC4.SA':  "Banco Bradesco PN — preferred shares; strong insurance arm (Bradesco Seguros) alongside banking.",
  'BBAS3.SA':  "Banco do Brasil ON — Brazil's largest bank by assets; majority state-owned; agribusiness lending leader.",
  'RENT3.SA':  "Localiza Hertz — Brazil's largest car rental & fleet management company; nationwide footprint.",
  'ONCO3.SA':  "Oncoclínicas — Brazil's largest private oncology care network; cancer treatment & infusion clinics nationwide.",
  'FLRY3.SA':  'Fleury S.A. — leading Brazilian diagnostic medicine & health services group; labs & imaging nationwide.',
  'FLRY3F.SA': 'Fleury S.A. (fractional) — leading Brazilian diagnostic medicine & health services group.',
  'ABEV3.SA':  "Ambev S.A. — Latin America's largest brewer; Brahma, Skol, Antarctica, Budweiser, Guaraná Antarctica.",
  'WEGE3.SA':  'WEG S.A. — global manufacturer of electric motors, drives & transformers; strong Brazilian exporter.',
  'RDOR3.SA':  "Rede D'Or São Luiz — largest private hospital network in Brazil; high-complexity care.",
  'SUZB3.SA':  "Suzano S.A. — world's largest eucalyptus pulp & paper producer; major global tissue/paper supplier.",
  'EMBR3.SA':  'Embraer — Brazilian aircraft manufacturer; E-Jet regional jets, executive jets, defense (KC-390).',
  'TOTS3.SA':  'Totvs S.A. — leading Brazilian ERP & business management software; dominant in SME segment.',
  'HYPE3.SA':  'Hypera Pharma — largest pharmaceutical company in Brazil by revenue; consumer & Rx brands.',
  // FX (keys without C: prefix)
  EURUSD: "Euro / US Dollar — world's most traded FX pair; driven by ECB vs Fed policy divergence.",
  GBPUSD: 'GBP / USD — "Cable"; sensitive to UK growth, BoE policy, and post-Brexit trade dynamics.',
  USDJPY: 'USD / JPY — major risk-sentiment gauge; JPY strengthens in risk-off; driven by BoJ yield-curve control.',
  USDBRL: 'USD / BRL — key EM FX pair; sensitive to Selic rate, commodity prices, fiscal policy & political risk.',
  GBPBRL: 'GBP / BRL — cross derived from GBP/USD × USD/BRL; reflects UK & Brazil macro drivers simultaneously.',
  EURBRL: 'EUR / BRL — cross rate; combines ECB/EU macro (EUR/USD) with Brazilian fiscal & commodity dynamics.',
  USDARS: "USD / ARS — reflects Argentina's multi-tier FX controls, high inflation, and IMF debt restructuring.",
  USDCHF: 'USD / CHF — "Swissie"; CHF is a safe-haven currency; appreciates during global risk-off episodes.',
  USDCNY: 'USD / CNY (onshore) — managed float by the PBOC via daily fixing band; key geopolitical barometer.',
  USDMXN: 'USD / MXN — sensitive to nearshoring investment flows, US trade policy, and Banxico rate decisions.',
  AUDUSD: 'AUD / USD — "Aussie"; commodity & China growth proxy; influenced by iron ore prices & RBA policy.',
  USDCAD: 'USD / CAD — "Loonie"; heavily correlated with crude oil prices; driven by BoC vs Fed policy.',
  // Crypto (keys without X: prefix)
  BTCUSD:  'Bitcoin (BTC) — first & largest cryptocurrency; decentralized, fixed 21M supply, proof-of-work digital store of value.',
  ETHUSD:  'Ethereum (ETH) — smart-contract blockchain; base layer for DeFi protocols, NFTs, and Layer-2 networks.',
  SOLUSD:  'Solana (SOL) — high-throughput L1 blockchain; ~65k TPS, ~400ms finality, low fees; DeFi & memecoins hub.',
  XRPUSD:  "XRP — Ripple's digital payment token; designed for cross-border bank settlements; subject to SEC litigation history.",
  BNBUSD:  'BNB (Binance Coin) — native token of Binance exchange & BNB Smart Chain; used for trading fee discounts.',
  DOGEUSD: 'Dogecoin (DOGE) — meme-origin proof-of-work crypto; unlimited supply; large retail & social media following.',
  // Commodities
  GLD:  'SPDR Gold Shares ETF — tracks gold spot price (equivalent to ~1/10 oz per share); inflation hedge & safe haven.',
  SLV:  'iShares Silver Trust ETF — tracks silver spot; dual role as industrial metal (solar, EVs) and monetary asset.',
  CPER: 'US Copper Index ETF — front-month NYMEX copper futures; key leading indicator of global industrial demand.',
  REMX: 'VanEck Rare Earth/Strategic Metals ETF — miners of REEs (neodymium, dysprosium) critical for EV motors & wind turbines.',
  USO:  'US Oil Fund ETF — front-month NYMEX WTI crude oil futures; global energy benchmark, USD-denominated.',
  UNG:  'US Natural Gas Fund ETF — NYMEX Henry Hub natural gas futures; heating, electricity generation & LNG exports.',
  SOYB: 'Teucrium Soybean ETF — CBOT soybean futures; key global protein crop; major export for Brazil & US.',
  WEAT: 'Teucrium Wheat ETF — CBOT wheat futures; global food security bellwether; affected by weather & geopolitics.',
  CORN: 'Teucrium Corn ETF — CBOT corn futures; ethanol feedstock, animal feed, US/Brazil major export crop.',
  BHP:  "BHP Group ADR — world's largest diversified mining company; iron ore (Pilbara), copper, potash, coal.",
  // CSN Mineracao (B3)
  'CMIN3.SA': 'CSN Mineracao ON - major Brazilian iron ore producer; mines in Minas Gerais supplying global steel markets.',
  // European equity ETFs
  EWG: 'iShares MSCI Germany ETF - tracks German large/mid-cap equities; proxy for DAX performance during NYSE hours.',
  EZU: 'iShares MSCI Eurozone ETF - tracks developed-market equities across the euro area; Euro Stoxx 50 proxy.',
  EWU: 'iShares MSCI United Kingdom ETF - tracks UK large/mid-cap stocks; FTSE 100 proxy traded on NYSE.',
  EWQ: 'iShares MSCI France ETF - tracks French large/mid-cap stocks; CAC 40 proxy traded on NYSE.',
  EWP: 'iShares MSCI Spain ETF - tracks Spanish large/mid-cap equities; IBEX 35 proxy traded on NYSE.',
  EWI: 'iShares MSCI Italy ETF - tracks Italian large/mid-cap stocks; FTSE MIB proxy traded on NYSE.',
};

// ── Normalise ticker symbol for DESCRIPTIONS lookup ───────────────────────────
// Strips exchange prefixes added by Polygon/TradingView: C:USDBRL → USDBRL, X:BTCUSD → BTCUSD
function descKey(symbol) {
  if (!symbol) return symbol;
  return symbol.replace(/^[CX]:/, '');
}

// ── Accent color by asset type ──────────────────────────────────────────────
function accentFor(type) {
  if (!type) return '#ff6600';
  const t = type.toUpperCase();
  if (t === 'FX' || t === 'FOREX')     return '#ce93d8';
  if (t === 'CRYPTO')                  return '#f7931a';
  if (t === 'ETF' || t === 'INDEX')    return '#ff6600';
  if (t === 'COMMODITY')               return '#ffd54f';
  if (t === 'EQUITY')                  return '#00bcd4';
  if (t === 'BR' || t === 'ADR')       return '#ffa726';
  return '#ff6600';
}

// ── Component ─────────────────────────────────────────────────────────────────
export function TickerTooltip() {
  const [tooltip, setTooltip] = useState(null);
  const activeElRef = useRef(null);

  // Global hover (desktop 2 s) + long-press (mobile 1200 ms) listeners
  useEffect(() => {
    let hoverTimer = null;
    let longTimer  = null;
    let longStartX = 0, longStartY = 0;

    const show = (el, x, y) => {
      if (!el) return;
      activeElRef.current = el;
      setTooltip({
        symbol: el.dataset.ticker,
        label:  el.dataset.tickerLabel || el.dataset.ticker,
        type:   el.dataset.tickerType  || 'EQUITY',
        x, y,
      });
    };

    // ── Desktop: mouseover / mouseout ─────────────────────────────────────
    const onMouseOver = (e) => {
      const el = e.target.closest('[data-ticker]');
      if (!el || el === activeElRef.current) return;
      clearTimeout(hoverTimer);
      const rect = el.getBoundingClientRect();
      hoverTimer = setTimeout(() => show(el, rect.left, rect.bottom + 6), 2000);
    };

    const onMouseOut = (e) => {
      const el = e.target.closest('[data-ticker]');
      if (!el) return;
      if (el.contains(e.relatedTarget)) return; // still inside element
      clearTimeout(hoverTimer);
      if (activeElRef.current === el) {
        activeElRef.current = null;
        setTooltip(null);
      }
    };

    // ── Mobile long-press: fires after 1200 ms, cancelled if finger moves >6px ─
    const handleTouchStart = (e) => {
      const t = e.touches[0];
      longStartX = t.clientX;
      longStartY = t.clientY;
      clearTimeout(longTimer);
      const el = e.target.closest('[data-ticker]');
      if (!el) return;
      longTimer = setTimeout(() => {
        const rect = el.getBoundingClientRect();
        show(el, rect.left, rect.bottom + 6);
      }, 1200);
    };
    const handleTouchMove = (e) => {
      const t = e.touches[0];
      const dx = t.clientX - longStartX;
      const dy = t.clientY - longStartY;
      if (Math.abs(dx) > 6 || Math.abs(dy) > 6) clearTimeout(longTimer);
    };
    const handleTouchEnd = () => clearTimeout(longTimer);

    document.addEventListener('mouseover',   onMouseOver);
    document.addEventListener('mouseout',    onMouseOut);
    document.addEventListener('touchstart',  handleTouchStart, { passive: true });
    document.addEventListener('touchmove',   handleTouchMove,  { passive: true });
    document.addEventListener('touchend',    handleTouchEnd,   { passive: true });
    document.addEventListener('touchcancel', handleTouchEnd,   { passive: true });

    return () => {
      clearTimeout(hoverTimer);
      clearTimeout(longTimer);
      document.removeEventListener('mouseover',   onMouseOver);
      document.removeEventListener('mouseout',    onMouseOut);
      document.removeEventListener('touchstart',  handleTouchStart);
      document.removeEventListener('touchmove',   handleTouchMove);
      document.removeEventListener('touchend',    handleTouchEnd);
      document.removeEventListener('touchcancel', handleTouchEnd);
    };
  }, []);

  // Dismiss on next click / key press
  useEffect(() => {
    if (!tooltip) return;
    const hide = () => { activeElRef.current = null; setTooltip(null); };
    const timer = setTimeout(() => {
      window.addEventListener('click',   hide, { once: true });
      window.addEventListener('keydown', hide, { once: true });
    }, 80);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('click',   hide);
      window.removeEventListener('keydown', hide);
    };
  }, [tooltip]);

  if (!tooltip) return null;

  const { symbol, label, type, x, y } = tooltip;
  const key    = descKey(symbol);
  const desc   = DESCRIPTIONS[key] || DESCRIPTIONS[symbol] || `${label || symbol} — no description on file.`;
  const accent = accentFor(type);

  // Keep within viewport
  const left = Math.min(x, window.innerWidth  - 280);
  const top  = Math.min(y, window.innerHeight - 120);

  return createPortal(
    <div
      style={{
        position:       'fixed',
        left,
        top,
        zIndex:         99999,
        background:     '#111',
        border:        `1px solid #2a2a2a`,
        borderLeft:    `3px solid ${accent}`,
        borderRadius:  4,
        padding:       '8px 12px',
        maxWidth:      270,
        boxShadow:     '0 6px 24px rgba(0,0,0,0.7)',
        fontFamily:    "'IBM Plex Mono','Roboto Mono','Courier New',monospace",
        userSelect:    'text',
        pointerEvents: 'auto',
      }}
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
            marginLeft:    'auto',
            background:    '#1e1e1e',
            border:        `1px solid ${accent}33`,
            borderRadius:  2,
            padding:       '0 4px',
            color:         accent,
            fontSize:      8,
            fontWeight:    700,
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
