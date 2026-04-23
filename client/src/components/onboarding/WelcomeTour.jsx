/**
 * WelcomeTour.jsx — Narrated, auto-playing demo of The Particle.
 *
 * Design intent (Phase 10.5):
 *   The tour is a ~60s keynote-style walkthrough. It auto-advances scene by
 *   scene and shows SIMULATED demos of the product — fake search bar typing,
 *   fake drag-drop, fake sector tiles cycling, fake vault citation, fake
 *   morning brief card. The user does not need to interact with the real UI
 *   or "try it themselves" — that hand-holding dance was explicitly rejected.
 *   The skip button is prominent from the first frame for users who want
 *   to get straight into the product.
 *
 *   Flow:
 *     SPLASH (held) → auto-play SCENES (modes, search, panels, sectors,
 *     vault, brief) → TICKERS (interactive, final) → done.
 *
 *   Shown ONCE on first login, persisted via localStorage + server settings.
 *   Admin can re-trigger via settings.tourResetAt.
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useSettings } from '../../context/SettingsContext';
import { useWatchlist } from '../../context/WatchlistContext';
import { useAuth } from '../../context/AuthContext';
import { swallow } from '../../utils/swallow';
import './WelcomeTour.css';

// ── Suggested tickers (final interactive step) ────────────────────────────
const SUGGESTED_TICKERS = [
  { symbol: 'AAPL',   label: 'Apple' },
  { symbol: 'MSFT',   label: 'Microsoft' },
  { symbol: 'NVDA',   label: 'Nvidia' },
  { symbol: 'GOOGL',  label: 'Alphabet' },
  { symbol: 'AMZN',   label: 'Amazon' },
  { symbol: 'TSLA',   label: 'Tesla' },
  { symbol: 'META',   label: 'Meta' },
  { symbol: 'SPY',    label: 'S&P 500' },
  { symbol: 'QQQ',    label: 'Nasdaq 100' },
  { symbol: 'BTC',    label: 'Bitcoin',  full: 'X:BTCUSD' },
  { symbol: 'ETH',    label: 'Ethereum', full: 'X:ETHUSD' },
  { symbol: 'GLD',    label: 'Gold ETF' },
  { symbol: 'XLE',    label: 'Energy' },
  { symbol: 'USDBRL', label: 'USD/BRL', full: 'C:USDBRL' },
  { symbol: 'EURUSD', label: 'EUR/USD', full: 'C:EURUSD' },
  { symbol: 'DIA',    label: 'Dow Jones' },
];

// ── 3 Pillars (splash) ────────────────────────────────────────────────────
const PILLARS = [
  {
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
      </svg>
    ),
    color: '#00bcd4',
    label: 'TERMINAL',
    desc: 'Live cross-asset data — equities, FX, crypto, commodities, rates, options — in one workspace.',
    tag: 'REAL-TIME',
  },
  {
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="12" cy="12" r="3" />
        <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
      </svg>
    ),
    color: 'var(--color-accent, #F97316)',
    label: 'PARTICLE AI',
    desc: 'Your personal market analyst. Morning briefs, deep analyses, portfolio-aware intelligence.',
    tag: 'AI-POWERED',
  },
  {
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
      </svg>
    ),
    color: 'var(--color-vault-accent, #c9a84c)',
    label: 'VAULT',
    desc: 'Your research PDFs. AI cites your own library in every answer — your views, at scale.',
    tag: 'KNOWLEDGE',
  },
];

// ── Scene definitions (auto-playing demos) ────────────────────────────────
// duration in ms. Captions are tight, CIO-voice, one-liner.
const SCENES = [
  {
    id: 'modes',
    duration: 6500,
    eyebrow: 'OPERATING MODES',
    title: 'Three modes, one terminal',
    caption: 'Terminal for live markets. Particle AI for analysis. Vault for your research. Switch in one click.',
  },
  {
    id: 'search',
    duration: 10500,
    eyebrow: 'UNIVERSAL SEARCH',
    title: 'Any ticker. Any asset class.',
    caption: 'End a query with a question mark and Particle AI gives you live context — what moved the name, and what matters next.',
  },
  {
    id: 'panels',
    duration: 8500,
    eyebrow: 'YOUR WORKSPACE',
    title: 'Drag anywhere. Resize anything.',
    caption: 'Every panel is yours. Drag tickers between panels, reshape the grid, click any name for a full instrument view.',
  },
  {
    id: 'sectors',
    duration: 8500,
    eyebrow: 'SECTOR SCREENS',
    title: 'Ten sector terminals, one click away',
    caption: 'Tech. Defence. Crypto. Brazil. EU rates. Asia. Each is a curated research desk, not a generic page.',
  },
  {
    id: 'vault',
    duration: 8500,
    eyebrow: 'KNOWLEDGE VAULT',
    title: 'Your research, cited back to you',
    caption: 'Drop your PDFs in the Vault. Every AI answer can pull from your own documents, with source citations inline.',
  },
  {
    id: 'brief',
    duration: 7500,
    eyebrow: 'MORNING BRIEF',
    title: 'The open, before the open',
    caption: 'A personalized brief lands in your inbox each morning — positioning, overnight moves, what to watch.',
  },
];

const TOTAL_SCENES = SCENES.length;

// ── Splash + tickers phases are bookends around SCENES
// phase: 'splash' | 'playing' | 'tickers'

// ═══════════════════════════════════════════════════════════════════════
//   DEMO SCENE COMPONENTS — all mocked visuals, no real data calls
// ═══════════════════════════════════════════════════════════════════════

/** SCENE: Modes — fake terminal header with 3 pills lighting up in sequence */
function ModesDemo() {
  const [highlight, setHighlight] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setHighlight(h => (h + 1) % 3), 1400);
    return () => clearInterval(id);
  }, []);

  const modes = [
    { key: 'ai',       label: 'PARTICLE AI', color: 'var(--color-accent, #e55a00)' },
    { key: 'terminal', label: 'TERMINAL',    color: '#00bcd4' },
    { key: 'vault',    label: 'VAULT',       color: 'var(--color-vault-accent, #c9a84c)' },
  ];

  return (
    <div className="wt-demo wt-demo-modes">
      <div className="wt-chrome">
        <div className="wt-chrome-dots">
          <span /><span /><span />
        </div>
        <div className="wt-chrome-title">the-particle.com</div>
      </div>

      <div className="wt-mode-bar">
        <div className="wt-mode-logo">
          <div className="wt-orb-sm" />
          <span>PARTICLE</span>
        </div>
        <div className="wt-mode-tabs">
          {modes.map((m, i) => (
            <div
              key={m.key}
              className={`wt-mode-tab ${i === highlight ? 'wt-mode-tab--active' : ''}`}
              style={{ '--tab-color': m.color }}
            >
              {m.label}
            </div>
          ))}
        </div>
        <div className="wt-mode-time">09:32:14 ET</div>
      </div>

      <div className="wt-mode-body">
        {highlight === 0 && (
          <div className="wt-mode-pane wt-mode-pane--ai">
            <div className="wt-chat-bubble wt-chat-bubble--user">How's NVDA trading vs. peers this week?</div>
            <div className="wt-chat-bubble wt-chat-bubble--ai">
              NVDA +3.2% w/w, outperforming AMD (+0.9%) and AVGO (-1.1%).<br />
              Options skew suggests institutional accumulation.
            </div>
          </div>
        )}
        {highlight === 1 && (
          <div className="wt-mode-pane wt-mode-pane--terminal">
            <div className="wt-mini-panel"><div className="wt-mini-panel-h">WATCHLIST</div><div className="wt-mini-row"><span>AAPL</span><span className="wt-pos">+1.24%</span></div><div className="wt-mini-row"><span>NVDA</span><span className="wt-pos">+3.18%</span></div><div className="wt-mini-row"><span>SPY</span><span className="wt-neg">-0.42%</span></div></div>
            <div className="wt-mini-panel"><div className="wt-mini-panel-h">RATES</div><div className="wt-mini-row"><span>UST 10Y</span><span className="wt-pos">4.28%</span></div><div className="wt-mini-row"><span>UST 2Y</span><span className="wt-pos">4.61%</span></div><div className="wt-mini-row"><span>DI Jan27</span><span className="wt-neg">13.42%</span></div></div>
            <div className="wt-mini-panel"><div className="wt-mini-panel-h">FX</div><div className="wt-mini-row"><span>USDBRL</span><span className="wt-pos">5.128</span></div><div className="wt-mini-row"><span>EURUSD</span><span className="wt-neg">1.0851</span></div><div className="wt-mini-row"><span>DXY</span><span className="wt-pos">103.42</span></div></div>
          </div>
        )}
        {highlight === 2 && (
          <div className="wt-mode-pane wt-mode-pane--vault">
            <div className="wt-vault-doc"><div className="wt-vault-doc-ico">PDF</div>Goldman_Outlook_2026.pdf</div>
            <div className="wt-vault-doc"><div className="wt-vault-doc-ico">PDF</div>JPM_EM_Allocation_Q2.pdf</div>
            <div className="wt-vault-doc"><div className="wt-vault-doc-ico">PDF</div>BTG_Brazil_Small_Caps.pdf</div>
            <div className="wt-vault-doc"><div className="wt-vault-doc-ico">PDF</div>Morgan_Stanley_Rates_Outlook.pdf</div>
          </div>
        )}
      </div>
    </div>
  );
}

/** SCENE: Search — typewriter query + AI response materializes */
function SearchDemo() {
  const query = 'PETR4?';
  const [typed, setTyped] = useState('');
  const [showResp, setShowResp] = useState(false);

  useEffect(() => {
    let i = 0;
    let respTimer;
    const typer = setInterval(() => {
      i++;
      setTyped(query.slice(0, i));
      if (i >= query.length) {
        clearInterval(typer);
        respTimer = setTimeout(() => setShowResp(true), 450);
      }
    }, 180);
    return () => { clearInterval(typer); if (respTimer) clearTimeout(respTimer); };
  }, []);

  return (
    <div className="wt-demo wt-demo-search">
      <div className="wt-chrome">
        <div className="wt-chrome-dots"><span /><span /><span /></div>
        <div className="wt-chrome-title">Search anything</div>
      </div>

      <div className="wt-search-bar">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
        </svg>
        <span className="wt-search-input">{typed}<span className="wt-cursor" /></span>
      </div>

      {showResp && (
        <div className="wt-search-results wt-fade-in">
          <div className="wt-search-ticker-card">
            <div className="wt-search-ticker-top">
              <div>
                <div className="wt-search-ticker-sym">PETR4</div>
                <div className="wt-search-ticker-name">Petrobras PN · B3</div>
              </div>
              <div className="wt-search-ticker-px">
                <div className="wt-search-px-main">R$ 38.42</div>
                <div className="wt-neg wt-search-px-chg">-1.24 (-3.13%)</div>
              </div>
            </div>
            <div className="wt-search-spark">
              <svg viewBox="0 0 100 28" preserveAspectRatio="none">
                <polyline points="0,8 10,10 22,6 34,12 46,9 58,15 70,13 82,18 94,22 100,24"
                  fill="none" stroke="#d64545" strokeWidth="1.5" />
              </svg>
            </div>
          </div>

          <div className="wt-ai-reply wt-fade-in-delay">
            <div className="wt-ai-reply-header">
              <div className="wt-orb-xs" />
              <span>PARTICLE AI</span>
            </div>
            <div className="wt-ai-reply-body">
              Petrobras down <strong>3.1%</strong> on Brent weakness (-2.4% to $78.10) and
              renewed dividend-policy chatter. Brazil sovereign curve flattened +6bp,
              BRL at 5.13. Positioning: fast money has trimmed longs; options skew
              richening on the downside. <strong>Catalyst watch:</strong> Q1 capex
              guidance May 8.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** SCENE: Panels — 3-panel workspace with a ticker being dragged */
function PanelsDemo() {
  const [dragging, setDragging] = useState(false);
  const [landed, setLanded] = useState(false);

  useEffect(() => {
    const t1 = setTimeout(() => setDragging(true), 900);
    const t2 = setTimeout(() => { setDragging(false); setLanded(true); }, 3100);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

  return (
    <div className="wt-demo wt-demo-panels">
      <div className="wt-chrome">
        <div className="wt-chrome-dots"><span /><span /><span /></div>
        <div className="wt-chrome-title">Your workspace</div>
      </div>

      <div className="wt-workspace">
        <div className="wt-ws-panel wt-ws-panel--tall">
          <div className="wt-ws-h">RESEARCH</div>
          <div className="wt-ws-body">
            <div className={`wt-ws-chip ${dragging ? 'wt-ws-chip--drag' : ''} ${landed ? 'wt-ws-chip--hidden' : ''}`}>
              <span className="wt-ws-chip-sym">MGLU3</span>
              <span className="wt-ws-chip-label">Magazine Luiza</span>
            </div>
            <div className="wt-ws-chip-static"><span className="wt-ws-chip-sym">VALE3</span><span className="wt-ws-chip-label">Vale</span></div>
            <div className="wt-ws-chip-static"><span className="wt-ws-chip-sym">ITUB4</span><span className="wt-ws-chip-label">Itaú</span></div>
          </div>
        </div>

        <div className="wt-ws-right">
          <div className="wt-ws-panel">
            <div className="wt-ws-h">WATCHLIST</div>
            <div className="wt-ws-body">
              <div className="wt-ws-row"><span>PETR4</span><span className="wt-neg">-3.13%</span></div>
              <div className="wt-ws-row"><span>BBAS3</span><span className="wt-pos">+0.82%</span></div>
              {landed && (
                <div className="wt-ws-row wt-fade-in"><span>MGLU3</span><span className="wt-pos">+1.95%</span></div>
              )}
            </div>
          </div>

          <div className="wt-ws-panel">
            <div className="wt-ws-h">CHART — IBOV</div>
            <svg className="wt-ws-chart" viewBox="0 0 200 60" preserveAspectRatio="none">
              <polyline points="0,40 20,35 40,42 60,28 80,30 100,22 120,25 140,18 160,20 180,12 200,14"
                fill="none" stroke="var(--color-accent, #e55a00)" strokeWidth="1.5" />
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}

/** SCENE: Sectors — cycle through sector terminal tiles */
function SectorsDemo() {
  const [idx, setIdx] = useState(0);
  const sectors = [
    { name: 'TECH', color: '#4a9eff', headline: 'Semis hitting new highs as AI capex accelerates', sparkColor: '#4a9eff', points: [30,28,26,24,22,20,16,12,10,8] },
    { name: 'DEFENCE', color: '#7a9e4a', headline: 'LMT + RTX leading after Pentagon FY27 preview', sparkColor: '#7a9e4a', points: [25,22,28,20,18,22,16,14,12,10] },
    { name: 'CRYPTO', color: '#c9a84c', headline: 'BTC reclaims 92k; ETF inflows turn positive', sparkColor: '#c9a84c', points: [35,32,28,25,30,22,18,20,15,12] },
    { name: 'BRAZIL', color: '#2ea344', headline: 'Fiscal headline risk weighing on long end', sparkColor: '#d64545', points: [12,15,18,22,20,25,28,30,32,35] },
  ];

  useEffect(() => {
    const id = setInterval(() => setIdx(i => (i + 1) % sectors.length), 1900);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const s = sectors[idx];

  return (
    <div className="wt-demo wt-demo-sectors">
      <div className="wt-chrome">
        <div className="wt-chrome-dots"><span /><span /><span /></div>
        <div className="wt-chrome-title">Sector screens</div>
      </div>

      <div className="wt-sector-tabs">
        {sectors.map((sec, i) => (
          <div key={sec.name} className={`wt-sector-tab ${i === idx ? 'wt-sector-tab--active' : ''}`} style={{ '--sec-color': sec.color }}>
            {sec.name}
          </div>
        ))}
      </div>

      <div className="wt-sector-body wt-fade-in" key={s.name}>
        <div className="wt-sector-badge" style={{ color: s.color, borderColor: s.color }}>{s.name} SCREEN</div>
        <div className="wt-sector-headline">{s.headline}</div>
        <div className="wt-sector-grid">
          <div className="wt-sector-cell">
            <div className="wt-sector-cell-h">Top movers</div>
            <div className="wt-sector-row"><span>AAA</span><span className="wt-pos">+2.8%</span></div>
            <div className="wt-sector-row"><span>BBB</span><span className="wt-pos">+1.9%</span></div>
            <div className="wt-sector-row"><span>CCC</span><span className="wt-neg">-0.4%</span></div>
          </div>
          <div className="wt-sector-cell">
            <div className="wt-sector-cell-h">Sector index</div>
            <svg viewBox="0 0 200 50" preserveAspectRatio="none" className="wt-sector-spark">
              <polyline
                points={s.points.map((y, i) => `${(i/(s.points.length-1))*200},${y}`).join(' ')}
                fill="none" stroke={s.sparkColor} strokeWidth="1.5"
              />
            </svg>
          </div>
          <div className="wt-sector-cell">
            <div className="wt-sector-cell-h">Flow</div>
            <div className="wt-sector-row"><span>Net $ flow</span><span className="wt-pos">+$842M</span></div>
            <div className="wt-sector-row"><span>Call/Put</span><span className="wt-pos">1.42</span></div>
            <div className="wt-sector-row"><span>Short int</span><span>3.1%</span></div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** SCENE: Vault — PDF drops in, AI cites it */
function VaultDemo() {
  const [dropped, setDropped] = useState(false);
  const [cite, setCite] = useState(false);

  useEffect(() => {
    const t1 = setTimeout(() => setDropped(true), 1200);
    const t2 = setTimeout(() => setCite(true), 3400);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

  return (
    <div className="wt-demo wt-demo-vault">
      <div className="wt-chrome">
        <div className="wt-chrome-dots"><span /><span /><span /></div>
        <div className="wt-chrome-title">Knowledge vault</div>
      </div>

      <div className="wt-vault-grid">
        <div className="wt-vault-left">
          <div className="wt-vault-ph">DROP ZONE</div>
          <div className={`wt-vault-drop ${dropped ? 'wt-vault-drop--done' : ''}`}>
            <div className="wt-vault-pdf-ico">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
            </div>
            <div className="wt-vault-fname">Goldman_Outlook_2026.pdf</div>
            <div className={`wt-vault-bar ${dropped ? 'wt-vault-bar--done' : ''}`}>
              <div className="wt-vault-bar-fill" />
            </div>
            <div className="wt-vault-status">{dropped ? 'Indexed · 48 pages · 312 citations ready' : 'Uploading...'}</div>
          </div>
        </div>

        <div className="wt-vault-right">
          <div className="wt-chat-bubble wt-chat-bubble--user">What's Goldman's year-end S&P target?</div>
          {cite && (
            <div className="wt-chat-bubble wt-chat-bubble--ai wt-fade-in">
              Goldman carries a <strong>year-end S&P 500 target of 6,500</strong>, up
              from 6,200, on stronger earnings revisions and margin resilience.
              <div className="wt-citation">
                <span className="wt-citation-dot" />
                <span>Goldman_Outlook_2026.pdf · p. 12</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** SCENE: Morning Brief — brief card fades in */
function BriefDemo({ firstName }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShow(true), 500);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="wt-demo wt-demo-brief">
      <div className="wt-chrome">
        <div className="wt-chrome-dots"><span /><span /><span /></div>
        <div className="wt-chrome-title">Morning brief · 06:45 ET</div>
      </div>

      <div className={`wt-brief-card ${show ? 'wt-fade-in' : 'wt-invisible'}`}>
        <div className="wt-brief-top">
          <div className="wt-brief-eyebrow">THE OPEN</div>
          <div className="wt-brief-date">Monday, April 21</div>
        </div>
        <div className="wt-brief-hello">
          Good morning{firstName ? `, ${firstName}` : ''}.
        </div>
        <div className="wt-brief-lede">
          Futures firmer on Fed minutes; tech leading, rates bid, Brent -1.2%.
        </div>
        <ul className="wt-brief-list">
          <li>
            <span className="wt-brief-bullet" />
            <div><strong>Your book:</strong> NVDA +2.1% pre-mkt, leading your
            watchlist. Brent weakness weighing on PETR4 exposure.</div>
          </li>
          <li>
            <span className="wt-brief-bullet" />
            <div><strong>Overnight:</strong> BOJ held, Nikkei +0.8%. China LPR
            unchanged. EM FX mixed; BRL firmer.</div>
          </li>
          <li>
            <span className="wt-brief-bullet" />
            <div><strong>Watch:</strong> Powell at 10:00 ET. TSLA earnings
            after close. US 20y auction at 13:00.</div>
          </li>
        </ul>
      </div>
    </div>
  );
}

// ── Scene dispatcher ─────────────────────────────────────────────────────
function SceneVisual({ scene, firstName }) {
  switch (scene?.id) {
    case 'modes':   return <ModesDemo />;
    case 'search':  return <SearchDemo />;
    case 'panels':  return <PanelsDemo />;
    case 'sectors': return <SectorsDemo />;
    case 'vault':   return <VaultDemo />;
    case 'brief':   return <BriefDemo firstName={firstName} />;
    default: return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════
//   MAIN TOUR
// ═══════════════════════════════════════════════════════════════════════
export default function WelcomeTour() {
  const { settings, markTourCompleted } = useSettings();
  const { user } = useAuth();
  const { addToWatchlist } = useWatchlist();

  const [active, setActive] = useState(false);
  const [phase, setPhase] = useState('splash'); // splash | playing | tickers
  const [sceneIdx, setSceneIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const [elapsed, setElapsed] = useState(0); // ms within current scene
  const [selectedTickers, setSelectedTickers] = useState([]);
  const [addingTickers, setAddingTickers] = useState(false);
  const displayNameRaw = user?.displayName || user?.name || user?.username || '';
  const firstName = useMemo(() => {
    if (!displayNameRaw) return '';
    const clean = String(displayNameRaw).split('@')[0].trim();
    return clean ? clean.split(/\s+/)[0] : '';
  }, [displayNameRaw]);

  // ── Should we show the tour? ─────────────────────────────────────────
  useEffect(() => {
    if (!settings) return;
    const resetAt = Number(settings.tourResetAt || 0);
    const localAt = Number(localStorage.getItem('particle_tour_completed_at') || 0);
    const clearedByReset = resetAt > 0 && resetAt > localAt;

    const serverDone = settings.onboardingCompleted === true;
    const localDone  = localStorage.getItem('particle_tour_completed') === '1';
    const legacyDone = localStorage.getItem('particle_onboarding_done') === '1';
    if (!clearedByReset && (serverDone || localDone || legacyDone)) return;

    const t = setTimeout(() => setActive(true), 700);
    return () => clearTimeout(t);
  }, [settings]);

  // ── Auto-advance timer for SCENES ────────────────────────────────────
  useEffect(() => {
    if (phase !== 'playing' || paused) return;
    const scene = SCENES[sceneIdx];
    if (!scene) return;
    const startedAt = Date.now() - elapsed;
    const tick = setInterval(() => {
      const e = Date.now() - startedAt;
      if (e >= scene.duration) {
        clearInterval(tick);
        if (sceneIdx < TOTAL_SCENES - 1) {
          setSceneIdx(i => i + 1);
          setElapsed(0);
        } else {
          setPhase('tickers');
          setElapsed(0);
        }
      } else {
        setElapsed(e);
      }
    }, 60);
    return () => clearInterval(tick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, paused, sceneIdx]);

  // Reset elapsed whenever scene changes
  useEffect(() => { setElapsed(0); }, [sceneIdx, phase]);

  // ── Keyboard nav ─────────────────────────────────────────────────────
  const handleBack = useCallback(() => {
    if (phase === 'playing') {
      if (sceneIdx > 0) { setSceneIdx(i => i - 1); setElapsed(0); }
      else { setPhase('splash'); }
    } else if (phase === 'tickers') {
      setPhase('playing');
      setSceneIdx(TOTAL_SCENES - 1);
      setElapsed(0);
    }
  }, [phase, sceneIdx]);

  const handleNext = useCallback(() => {
    if (phase === 'splash') { setPhase('playing'); setSceneIdx(0); setElapsed(0); return; }
    if (phase === 'playing') {
      if (sceneIdx < TOTAL_SCENES - 1) { setSceneIdx(i => i + 1); setElapsed(0); }
      else { setPhase('tickers'); setElapsed(0); }
    }
  }, [phase, sceneIdx]);

  const markDone = useCallback(async () => {
    localStorage.setItem('particle_tour_completed', '1');
    localStorage.setItem('particle_onboarding_done', '1');
    localStorage.setItem('particle_tour_completed_at', String(Date.now()));
    try { await markTourCompleted(); } catch (e) { swallow(e, 'onboarding.welcomeTour.mark_completed'); }
  }, [markTourCompleted]);

  const handleSkip = useCallback(async () => {
    setActive(false);
    await markDone();
  }, [markDone]);

  const handleFinish = useCallback(async () => {
    if (selectedTickers.length > 0) {
      setAddingTickers(true);
      for (const sym of selectedTickers) {
        const full = SUGGESTED_TICKERS.find(s => s.symbol === sym)?.full || sym;
        try { await addToWatchlist(full); } catch (e) { swallow(e, 'onboarding.welcomeTour.add_watchlist'); }
      }
      setAddingTickers(false);
    }
    setActive(false);
    await markDone();
  }, [selectedTickers, addToWatchlist, markDone]);

  const toggleTicker = useCallback((sym) => {
    setSelectedTickers(prev =>
      prev.includes(sym) ? prev.filter(s => s !== sym) : [...prev, sym]
    );
  }, []);

  // Keyboard handlers
  useEffect(() => {
    if (!active) return;
    const handler = (e) => {
      if (e.key === 'Escape') handleSkip();
      else if (e.key === 'ArrowRight') handleNext();
      else if (e.key === 'ArrowLeft')  handleBack();
      else if (e.key === ' ' && phase === 'playing') {
        e.preventDefault();
        setPaused(p => !p);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [active, phase, handleSkip, handleNext, handleBack]);

  if (!active) return null;

  const scene = SCENES[sceneIdx];
  const progressPct = phase === 'playing' && scene
    ? Math.min(100, (elapsed / scene.duration) * 100)
    : phase === 'tickers' ? 100 : 0;

  // Scenes are 1..N in the progress indicator; splash is 0; tickers is last+1
  const segTotal = TOTAL_SCENES + 2; // splash + scenes + tickers
  const segCurrent = phase === 'splash' ? 0
                  : phase === 'playing' ? sceneIdx + 1
                  : segTotal - 1;

  // ══════ RENDER ══════
  return createPortal(
    <div className="wt-root">
      <div className="wt-backdrop" />

      {/* Skip button — always visible, top-right */}
      {phase !== 'splash' && (
        <button className="wt-skip-floating" onClick={handleSkip}>
          Skip tour
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button>
      )}

      {/* ── SPLASH ── */}
      {phase === 'splash' && (
        <div className="wt-splash wt-entering">
          <div className="wt-orb-container">
            <div className="wt-orb" />
            <div className="wt-orb-ring wt-orb-ring--1" />
            <div className="wt-orb-ring wt-orb-ring--2" />
          </div>

          <div className="wt-splash-eyebrow">WELCOME TO</div>
          <h1 className="wt-splash-heading">
            The Particle{firstName ? <span className="wt-splash-name">, {firstName}</span> : ''}
          </h1>
          <p className="wt-splash-sub">
            A professional terminal for portfolio managers, traders, and CIOs.
          </p>

          <div className="wt-version-badge">60-second tour · auto-playing</div>

          <div className="wt-pillars">
            {PILLARS.map((p, i) => (
              <div key={i} className="wt-pillar" style={{ '--pillar-color': p.color }}>
                <div className="wt-pillar-tag">{p.tag}</div>
                <div className="wt-pillar-icon">{p.icon}</div>
                <div className="wt-pillar-label">{p.label}</div>
                <div className="wt-pillar-desc">{p.desc}</div>
              </div>
            ))}
          </div>

          <button className="wt-primary-btn" onClick={handleNext}>
            <span>Start the tour</span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
          </button>
          <button className="wt-skip-btn" onClick={handleSkip}>
            Skip — I'll explore on my own
          </button>
        </div>
      )}

      {/* ── PLAYING (auto-advancing demos) ── */}
      {phase === 'playing' && scene && (
        <div className="wt-stage">
          <div className="wt-stage-head">
            <div className="wt-stage-identity">
              <div className="wt-orb-sm" />
              <div className="wt-stage-eyebrow">{scene.eyebrow}</div>
              <div className="wt-stage-counter">
                {String(sceneIdx + 1).padStart(2, '0')} <span className="wt-stage-counter-sep">/</span> {String(TOTAL_SCENES).padStart(2, '0')}
              </div>
            </div>
          </div>

          <div className="wt-stage-body">
            <div className="wt-stage-visual wt-fade-in" key={scene.id}>
              <SceneVisual scene={scene} firstName={firstName} />
            </div>

            <div className="wt-stage-caption">
              <div className="wt-stage-title">{scene.title}</div>
              <p className="wt-stage-desc">{scene.caption}</p>
            </div>
          </div>

          {/* Controls */}
          <div className="wt-stage-controls">
            <button className="wt-ctrl wt-ctrl--ghost" onClick={handleBack} aria-label="Back">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
            </button>

            <button className="wt-ctrl wt-ctrl--pause" onClick={() => setPaused(p => !p)} aria-label={paused ? 'Play' : 'Pause'}>
              {paused ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 4 20 12 6 20 6 4"/></svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
              )}
            </button>

            <div className="wt-stage-segs">
              {SCENES.map((_, i) => (
                <div key={i} className={`wt-stage-seg ${i < sceneIdx ? 'wt-stage-seg--done' : ''} ${i === sceneIdx ? 'wt-stage-seg--current' : ''}`}>
                  <div className="wt-stage-seg-fill" style={{
                    width: i < sceneIdx ? '100%' : i === sceneIdx ? `${progressPct}%` : '0%'
                  }} />
                </div>
              ))}
            </div>

            <button className="wt-ctrl wt-ctrl--next" onClick={handleNext} aria-label="Next">
              Next
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
            </button>
          </div>
        </div>
      )}

      {/* ── TICKERS (final interactive) ── */}
      {phase === 'tickers' && (
        <div className="wt-stage wt-entering">
          <div className="wt-stage-head">
            <div className="wt-stage-identity">
              <div className="wt-orb-sm" />
              <div className="wt-stage-eyebrow">BUILD YOUR WATCHLIST</div>
              <div className="wt-stage-counter">
                {String(TOTAL_SCENES + 1).padStart(2, '0')} <span className="wt-stage-counter-sep">/</span> {String(TOTAL_SCENES + 1).padStart(2, '0')}
              </div>
            </div>
          </div>

          <div className="wt-tickers-wrap">
            <div className="wt-tickers-title">Pick your instruments</div>
            <p className="wt-tickers-desc">
              We'll seed your watchlist with these. You can always add more from the search bar.
            </p>

            <div className="wt-ticker-grid">
              {SUGGESTED_TICKERS.map(t => {
                const sel = selectedTickers.includes(t.symbol);
                return (
                  <button
                    key={t.symbol}
                    className={`wt-ticker-chip ${sel ? 'wt-ticker-chip--selected' : ''}`}
                    onClick={() => toggleTicker(t.symbol)}
                  >
                    <span className="wt-ticker-sym">{t.symbol}</span>
                    <span className="wt-ticker-label">{t.label}</span>
                    {sel && <span className="wt-ticker-check">&#10003;</span>}
                  </button>
                );
              })}
            </div>
            {selectedTickers.length > 0 && (
              <div className="wt-ticker-count">
                {selectedTickers.length} instrument{selectedTickers.length > 1 ? 's' : ''} selected
              </div>
            )}
          </div>

          <div className="wt-stage-controls">
            <button className="wt-ctrl wt-ctrl--ghost" onClick={handleBack} aria-label="Back">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
              Back
            </button>

            <div className="wt-stage-segs">
              {Array.from({ length: TOTAL_SCENES + 1 }).map((_, i) => (
                <div key={i} className="wt-stage-seg wt-stage-seg--done">
                  <div className="wt-stage-seg-fill" style={{ width: '100%' }} />
                </div>
              ))}
            </div>

            <button
              className="wt-primary-btn wt-primary-btn--sm"
              onClick={handleFinish}
              disabled={addingTickers}
            >
              {addingTickers ? 'Launching...' : 'Launch The Particle'}
              {!addingTickers && (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
              )}
            </button>
          </div>
        </div>
      )}
    </div>,
    document.body
  );
}
