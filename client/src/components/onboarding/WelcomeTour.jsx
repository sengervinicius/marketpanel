/**
 * WelcomeTour.jsx — Cinematic first-login onboarding experience.
 *
 * Shows ONCE on first login. Never again.
 * Persisted via localStorage + server settings.
 *
 * 8 steps (desktop):
 *  1. Cinematic splash — The Particle identity + 3 pillars
 *  2. Spotlight: Terminal mode — the 3 operating modes
 *  3. Spotlight: Search bar — command center
 *  4. Spotlight: Workspace — customizable panels
 *  5. Spotlight: Layout button — drag/resize/rearrange
 *  6. Spotlight: Sector screens — deep-dive research
 *  7. Spotlight: Particle sidebar — AI assistant
 *  8. Ticker selection — build your watchlist
 *
 * Mobile: adapted card-based flow (no spotlights).
 */
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useSettings } from '../../context/SettingsContext';
import { useWatchlist } from '../../context/WatchlistContext';
import { useAuth } from '../../context/AuthContext';
import './WelcomeTour.css';

// ── Suggested tickers ──────────────────────────────────────────────────────
const SUGGESTED_TICKERS = [
  { symbol: 'AAPL',  label: 'Apple' },
  { symbol: 'MSFT',  label: 'Microsoft' },
  { symbol: 'NVDA',  label: 'Nvidia' },
  { symbol: 'GOOGL', label: 'Alphabet' },
  { symbol: 'AMZN',  label: 'Amazon' },
  { symbol: 'TSLA',  label: 'Tesla' },
  { symbol: 'META',  label: 'Meta' },
  { symbol: 'SPY',   label: 'S&P 500' },
  { symbol: 'QQQ',   label: 'Nasdaq 100' },
  { symbol: 'BTC',   label: 'Bitcoin',  full: 'X:BTCUSD' },
  { symbol: 'ETH',   label: 'Ethereum', full: 'X:ETHUSD' },
  { symbol: 'GLD',   label: 'Gold ETF' },
  { symbol: 'XLE',   label: 'Energy' },
  { symbol: 'USDBRL', label: 'USD/BRL', full: 'C:USDBRL' },
  { symbol: 'EURUSD', label: 'EUR/USD', full: 'C:EURUSD' },
  { symbol: 'DIA',   label: 'Dow Jones' },
];

// ── 3 Pillars ──────────────────────────────────────────────────────────────
const PILLARS = [
  {
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
      </svg>
    ),
    color: '#00bcd4',
    label: 'TERMINAL',
    desc: 'Live cross-asset data — equities, FX, crypto, commodities, rates, options — all customizable panels in one workspace.',
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
    desc: 'Your personal market analyst. Ask anything, get morning briefs, deep analyses, and portfolio-aware intelligence.',
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
    desc: 'Upload research PDFs and documents. The AI cross-references your library in every answer and analysis.',
    tag: 'KNOWLEDGE',
  },
];

// ── Desktop steps ──────────────────────────────────────────────────────────
const DESKTOP_STEPS = [
  {
    id: 'splash',
    type: 'splash',
  },
  {
    id: 'modes',
    type: 'spotlight',
    target: '[data-tour="header"]',
    label: 'OPERATING MODES',
    title: '3 Modes, 1 Terminal',
    message: 'Switch between Particle AI for conversational intelligence, Terminal for your full market workspace, and Vault for your research library. Each mode is designed for a different workflow.',
    cta: 'Next',
    placement: 'bottom',
    hint: 'Click any mode tab to switch instantly',
  },
  {
    id: 'search',
    type: 'spotlight',
    target: '[data-tour="search"]',
    label: 'COMMAND CENTER',
    title: 'Universal Search',
    message: 'Type any ticker — stocks, FX pairs, crypto, ETFs, commodities — for instant quotes and charts. End any query with ? and Particle AI will analyze it. Drag results directly into panels or chart spaces.',
    cta: 'Next',
    placement: 'bottom',
    hint: 'Try: "AAPL?" for AI analysis',
  },
  {
    id: 'workspace',
    type: 'spotlight',
    target: '[data-tour="workspace"]',
    label: 'YOUR WORKSPACE',
    title: 'Fully Customizable Panels',
    message: 'Every panel is yours to customize. Right-click headers to add subsections, drag tickers between panels, and click any ticker to open a full instrument detail view with charts, fundamentals, and AI analysis.',
    cta: 'Next',
    placement: 'top',
    hint: 'Right-click any panel header for options',
  },
  {
    id: 'layout',
    type: 'spotlight',
    target: '[data-tour="layout"]',
    label: 'LAYOUT EDITOR',
    title: 'Drag, Resize, Rearrange',
    message: 'Click LAYOUT to enter edit mode. Drag panel borders to resize, use arrow keys to reposition, or drag entire panels to swap their places. Reset to default any time. Your layout persists across sessions.',
    cta: 'Next',
    placement: 'bottom',
    hint: 'Drag panels to swap their positions',
  },
  {
    id: 'sectors',
    type: 'spotlight',
    target: '[data-tour="sector-screens"]',
    label: 'SECTOR INTELLIGENCE',
    title: 'Deep-Dive Research Screens',
    message: '10+ dedicated sector screens — Tech, Defence, Crypto, Commodities, Fixed Income, European Markets, Asian Markets, Brazil, and more. Each is a full research terminal with curated data, charts, analytics, and sector-specific intelligence.',
    cta: 'Next',
    placement: 'bottom',
    hint: 'Each screen is a specialized terminal',
  },
  {
    id: 'sidebar',
    type: 'spotlight',
    target: '[data-tour="particle-sidebar"]',
    label: 'PARTICLE SIDEBAR',
    title: 'AI Always Within Reach',
    message: 'The orange orb is your Particle AI sidebar. Click to expand and ask anything about your current screen, portfolio, or any market question. It reads your home screen context to give you relevant insights.',
    cta: 'Next',
    placement: 'left',
    hint: 'Click the orb any time for AI help',
  },
  {
    id: 'tickers',
    type: 'tickers',
    label: 'BUILD YOUR WATCHLIST',
    title: 'Pick Your Instruments',
    message: 'Select tickers you want to track. They will populate your panels, charts, and AI context. You can always add more later from the search bar.',
    cta: 'Launch The Particle',
  },
];

// ── Mobile steps (card-based, no spotlights) ───────────────────────────────
const MOBILE_STEPS = [
  { id: 'splash', type: 'splash' },
  {
    id: 'modes',
    type: 'card',
    icon: 'modes',
    label: 'OPERATING MODES',
    title: '3 Modes, 1 Terminal',
    message: 'Swipe through the bottom tabs to switch between Particle AI, your market workspace, charts, watchlist, and more. Each mode is built for a different workflow.',
    cta: 'Next',
  },
  {
    id: 'ai',
    type: 'card',
    icon: 'ai',
    label: 'PARTICLE AI',
    title: 'Your Market Analyst',
    message: 'Ask Particle AI anything about markets. It reads your portfolio, live data, and uploaded research documents to give you context-aware intelligence. Try ending any search with ? for instant analysis.',
    cta: 'Next',
  },
  {
    id: 'sectors',
    type: 'card',
    icon: 'sectors',
    label: 'SECTOR SCREENS',
    title: 'Deep-Dive Research',
    message: '10+ dedicated sector screens with curated data, charts, and analytics. Find them in the home feed or More tab. Tech, Crypto, Fixed Income, Brazil, European Markets, and beyond.',
    cta: 'Next',
  },
  {
    id: 'vault',
    type: 'card',
    icon: 'vault',
    label: 'KNOWLEDGE VAULT',
    title: 'Your Research Library',
    message: 'Upload PDFs and research documents to the Vault. Particle AI cross-references your entire library in every answer, making it smarter with every document you add.',
    cta: 'Next',
  },
  {
    id: 'tickers',
    type: 'tickers',
    label: 'BUILD YOUR WATCHLIST',
    title: 'Pick Your Instruments',
    message: 'Select tickers to track. They will appear across all your panels and charts.',
    cta: 'Launch The Particle',
  },
];

// ── SVG Icons for card steps ───────────────────────────────────────────────
const STEP_ICONS = {
  modes: (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="20" height="14" rx="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  ),
  ai: (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
    </svg>
  ),
  sectors: (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" />
    </svg>
  ),
  vault: (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </svg>
  ),
};

// ── Typewriter hook ────────────────────────────────────────────────────────
function useTypewriter(text, speed = 14) {
  const [displayed, setDisplayed] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    setDisplayed('');
    setDone(false);
    if (!text) { setDone(true); return; }
    let i = 0;
    const timer = setInterval(() => {
      i++;
      setDisplayed(text.slice(0, i));
      if (i >= text.length) { clearInterval(timer); setDone(true); }
    }, speed);
    return () => clearInterval(timer);
  }, [text, speed]);

  const skip = useCallback(() => { setDisplayed(text || ''); setDone(true); }, [text]);
  return { displayed, done, skip };
}

// ── Glow Highlight ─────────────────────────────────────────────────────────
function GlowHighlight({ targetRect }) {
  if (!targetRect) return null;
  const PAD = 8;
  return (
    <div
      className="wt-glow"
      style={{
        top: targetRect.top - PAD,
        left: targetRect.left - PAD,
        width: targetRect.width + PAD * 2,
        height: targetRect.height + PAD * 2,
      }}
    />
  );
}

// ── Cutout Backdrop ────────────────────────────────────────────────────────
function SpotlightBackdrop({ targetRect, onClick }) {
  if (!targetRect) {
    return <div className="wt-backdrop" onClick={onClick} />;
  }
  const PAD = 12;
  const t = targetRect.top - PAD;
  const l = targetRect.left - PAD;
  const w = targetRect.width + PAD * 2;
  const h = targetRect.height + PAD * 2;
  const r = 12;

  return (
    <svg className="wt-backdrop-svg" onClick={onClick} width="100%" height="100%">
      <defs>
        <mask id="wt-spotlight-mask">
          <rect width="100%" height="100%" fill="white" />
          <rect x={l} y={t} width={w} height={h} rx={r} ry={r} fill="black" />
        </mask>
      </defs>
      <rect width="100%" height="100%" fill="rgba(0,0,0,0.82)" mask="url(#wt-spotlight-mask)" />
    </svg>
  );
}

// ── Progress Bar ───────────────────────────────────────────────────────────
function ProgressBar({ current, total }) {
  return (
    <div className="wt-progress">
      {Array.from({ length: total }, (_, i) => (
        <div
          key={i}
          className={`wt-progress-seg ${i <= current ? 'wt-progress-seg--active' : ''} ${i === current ? 'wt-progress-seg--current' : ''}`}
        />
      ))}
    </div>
  );
}

// ── Main Tour Component ────────────────────────────────────────────────────
export default function WelcomeTour() {
  const { settings, markTourCompleted } = useSettings();
  const { user } = useAuth();
  const { addToWatchlist } = useWatchlist();

  const [active, setActive] = useState(false);
  const [stepIdx, setStepIdx] = useState(0);
  const [targetRect, setTargetRect] = useState(null);
  const [selectedTickers, setSelectedTickers] = useState([]);
  const [addingTickers, setAddingTickers] = useState(false);
  const [entering, setEntering] = useState(true);
  const animFrame = useRef(null);

  const isMobile = useMemo(() => window.innerWidth <= 768, []);
  const steps = isMobile ? MOBILE_STEPS : DESKTOP_STEPS;
  const step = steps[stepIdx];
  const displayName = user?.username || user?.name || '';

  const typewriterText = active && step?.message ? step.message : '';
  const { displayed, done: typeDone, skip: skipType } = useTypewriter(typewriterText, 14);

  // ── Should we show the tour? ────────────────────────────────────────────
  useEffect(() => {
    if (!settings) return;
    // Server-side admin reset stamps settings.tourResetAt. If the user's
    // last completion was before that timestamp (or there's no recorded
    // local completion time), we treat the tour as NOT done and re-run it.
    // This is how `POST /api/admin/reset-user/:email` re-triggers the
    // onboarding for a user whose localStorage still has the legacy '1' flag.
    const resetAt = Number(settings.tourResetAt || 0);
    const localAt = Number(localStorage.getItem('particle_tour_completed_at') || 0);
    const localeClearedByReset = resetAt > 0 && resetAt > localAt;

    const serverDone = settings.onboardingCompleted === true;
    const localDone = localStorage.getItem('particle_tour_completed') === '1';
    const legacyDone = localStorage.getItem('particle_onboarding_done') === '1';
    if (!localeClearedByReset && (serverDone || localDone || legacyDone)) return;

    const t = setTimeout(() => {
      setActive(true);
      setEntering(true);
    }, 800);
    return () => clearTimeout(t);
  }, [settings]);

  // ── Track target element position ───────────────────────────────────────
  useEffect(() => {
    if (!active) return;
    if (step?.type !== 'spotlight' || !step?.target) { setTargetRect(null); return; }
    const measure = () => {
      const el = document.querySelector(step.target);
      if (el) {
        const r = el.getBoundingClientRect();
        setTargetRect({ top: r.top, left: r.left, width: r.width, height: r.height });
      } else {
        setTargetRect(null);
      }
      animFrame.current = requestAnimationFrame(measure);
    };
    measure();
    return () => cancelAnimationFrame(animFrame.current);
  }, [active, stepIdx, step?.target, step?.type]);

  // ── Keyboard navigation ─────────────────────────────────────────────────
  useEffect(() => {
    if (!active) return;
    const handler = (e) => {
      if (e.key === 'Escape') handleSkip();
      else if (e.key === 'ArrowRight' || e.key === 'Enter') {
        if (step?.type === 'splash') handleNext();
        else if (!typeDone) skipType();
        else handleNext();
      }
      else if (e.key === 'ArrowLeft') handleBack();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });

  // Entrance animation reset per step
  useEffect(() => {
    if (!active) return;
    setEntering(true);
    const t = setTimeout(() => setEntering(false), 500);
    return () => clearTimeout(t);
  }, [stepIdx, active]);

  // ── Actions ─────────────────────────────────────────────────────────────
  const handleNext = useCallback(() => {
    if (stepIdx < steps.length - 1) setStepIdx(s => s + 1);
    else handleFinish();
  }, [stepIdx, steps.length]);

  const handleBack = useCallback(() => {
    if (stepIdx > 0) setStepIdx(s => s - 1);
  }, [stepIdx]);

  const handleSkip = useCallback(async () => {
    setActive(false);
    localStorage.setItem('particle_tour_completed', '1');
    localStorage.setItem('particle_onboarding_done', '1');
    // Stamp completion time so a future admin reset (which writes
    // settings.tourResetAt) can deterministically re-trigger the tour.
    localStorage.setItem('particle_tour_completed_at', String(Date.now()));
    try { await markTourCompleted(); } catch {}
  }, [markTourCompleted]);

  const handleFinish = useCallback(async () => {
    if (selectedTickers.length > 0) {
      setAddingTickers(true);
      for (const sym of selectedTickers) {
        const full = SUGGESTED_TICKERS.find(s => s.symbol === sym)?.full || sym;
        try { await addToWatchlist(full); } catch {}
      }
      setAddingTickers(false);
    }
    setActive(false);
    localStorage.setItem('particle_tour_completed', '1');
    localStorage.setItem('particle_onboarding_done', '1');
    localStorage.setItem('particle_tour_completed_at', String(Date.now()));
    try { await markTourCompleted(); } catch {}
  }, [selectedTickers, addToWatchlist, markTourCompleted]);

  const toggleTicker = useCallback((sym) => {
    setSelectedTickers(prev =>
      prev.includes(sym) ? prev.filter(s => s !== sym) : [...prev, sym]
    );
  }, []);

  if (!active) return null;

  const isFirst = stepIdx === 0;
  const isLast = stepIdx === steps.length - 1;

  // ── RENDER ──────────────────────────────────────────────────────────────
  return createPortal(
    <div className="wt-root">
      {/* Backdrop */}
      {step.type === 'spotlight' && targetRect ? (
        <SpotlightBackdrop
          targetRect={targetRect}
          onClick={() => { if (!typeDone) skipType(); }}
        />
      ) : (
        <div className="wt-backdrop" onClick={() => { if (!typeDone && step.type !== 'splash') skipType(); }} />
      )}

      {/* Glow highlight */}
      {step.type === 'spotlight' && <GlowHighlight targetRect={targetRect} />}

      {/* ── SPLASH STEP ── */}
      {step.type === 'splash' && (
        <div className={`wt-splash ${entering ? 'wt-entering' : ''}`}>
          {/* Animated particle orb */}
          <div className="wt-orb-container">
            <div className="wt-orb" />
            <div className="wt-orb-ring wt-orb-ring--1" />
            <div className="wt-orb-ring wt-orb-ring--2" />
          </div>

          <div className="wt-splash-eyebrow">WELCOME TO</div>
          <h1 className="wt-splash-heading">
            The Particle{displayName ? <span className="wt-splash-name">, {displayName}</span> : ''}
          </h1>
          <p className="wt-splash-sub">
            Professional-grade market intelligence terminal
          </p>

          {/* Version badge */}
          <div className="wt-version-badge">v2.0 — Cross-Asset Terminal + AI</div>

          {/* 3 Pillars */}
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
            <span>Begin Tour</span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
          </button>
          <button className="wt-skip-btn" onClick={handleSkip}>
            Skip tour — I know my way around
          </button>

          <ProgressBar current={stepIdx} total={steps.length} />
        </div>
      )}

      {/* ── SPOTLIGHT / CARD / TICKERS STEPS ── */}
      {step.type !== 'splash' && (
        <div
          className={`wt-card-container ${entering ? 'wt-entering' : ''}`}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Identity header */}
          <div className="wt-card-identity">
            <div className="wt-orb-sm" />
            <div className="wt-card-label">{step.label}</div>
            <div className="wt-card-counter">
              <span className="wt-card-counter-current">{stepIdx + 1}</span>
              <span className="wt-card-counter-sep">/</span>
              <span>{steps.length}</span>
            </div>
          </div>

          {/* Content card */}
          <div className="wt-card">
            {/* Icon for card-type steps */}
            {step.type === 'card' && step.icon && (
              <div className="wt-card-icon">
                {STEP_ICONS[step.icon]}
              </div>
            )}

            {/* Title */}
            {step.title && (
              <div className="wt-card-title">{step.title}</div>
            )}

            {/* Typewriter message */}
            {(step.type === 'spotlight' || step.type === 'card') && (
              <div className="wt-card-message">
                {displayed}
                {!typeDone && <span className="wt-cursor" />}
              </div>
            )}

            {/* Hint badge for spotlight steps */}
            {step.hint && typeDone && (
              <div className="wt-card-hint">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
                {step.hint}
              </div>
            )}

            {/* TICKERS STEP */}
            {step.type === 'tickers' && (
              <>
                <div className="wt-card-message wt-card-message--static">
                  {step.message}
                </div>
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
              </>
            )}

            {/* Actions row */}
            <div className="wt-card-actions">
              <button className="wt-exit-btn" onClick={handleSkip}>
                {isFirst ? 'SKIP' : 'EXIT TOUR'}
              </button>

              <div className="wt-card-actions-center">
                <ProgressBar current={stepIdx} total={steps.length} />
              </div>

              <div className="wt-card-actions-right">
                {!isFirst && (
                  <button className="wt-back-btn" onClick={handleBack}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
                  </button>
                )}
                <button
                  className={`wt-next-btn ${(typeDone || step.type === 'tickers') ? 'wt-next-btn--ready' : ''}`}
                  onClick={() => {
                    if (step.type === 'tickers') handleFinish();
                    else if (!typeDone) skipType();
                    else handleNext();
                  }}
                  disabled={addingTickers}
                >
                  {addingTickers ? 'Setting up...' : (
                    (!typeDone && step.type !== 'tickers') ? 'Skip' : step.cta
                  )}
                  {(typeDone || step.type === 'tickers') && !addingTickers && (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body
  );
}
