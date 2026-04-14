/**
 * WelcomeTour.jsx — Unified first-login onboarding experience.
 *
 * Replaces the old WelcomeModal (persona picker) + OnboardingTour (spotlight).
 * Single flow: cinematic welcome → spotlight tour → ticker setup → launch.
 *
 * Desktop: spotlight-based tour highlighting actual UI elements.
 * Mobile: full-screen card slideshow (no spotlights — elements are at bottom).
 *
 * Shows ONCE on first login. Persisted via localStorage + server settings.
 */
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useSettings } from '../../context/SettingsContext';
import { useWatchlist } from '../../context/WatchlistContext';
import { useAuth } from '../../context/AuthContext';
import './WelcomeTour.css';

// ── Suggested tickers for the final step ─────────────────────────────────
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
  { symbol: 'GLD',   label: 'Gold ETF' },
  { symbol: 'XLE',   label: 'Energy' },
];

// ── Tour steps ───────────────────────────────────────────────────────────
// Desktop steps with spotlight targets; mobile steps use icons instead.
const DESKTOP_STEPS = [
  {
    id: 'welcome',
    type: 'splash',
    title: 'WELCOME',
    heading: 'Welcome to The Particle',
    sub: 'Your cross-asset market terminal with AI intelligence',
    cta: 'Show me around',
  },
  {
    id: 'search',
    type: 'spotlight',
    target: '[data-tour="search"]',
    title: 'COMMAND CENTER',
    message: 'Type any ticker to pull up live data — equities, FX, crypto, commodities, options. End any query with a question mark and Particle AI will analyze it for you.',
    cta: 'Next',
    placement: 'bottom',
  },
  {
    id: 'workspace',
    type: 'spotlight',
    target: '[data-tour="workspace"]',
    title: 'YOUR WORKSPACE',
    message: 'Drag, resize, and rearrange every panel. Click any ticker across the terminal to drill into fundamentals, charts, and AI analysis. Make it yours.',
    cta: 'Next',
    placement: 'top',
  },
  {
    id: 'sectors',
    type: 'spotlight',
    target: '[data-tour="sector-screens"]',
    title: 'SECTOR INTELLIGENCE',
    message: '10+ deep-dive sector screens — Tech, Defence, Crypto, Commodities, Fixed Income, Brazil, and more. Each is a dedicated research terminal with its own data, charts, and analytics.',
    cta: 'Next',
    placement: 'bottom',
  },
  {
    id: 'ai',
    type: 'card',
    title: 'PARTICLE AI',
    icon: 'ai',
    message: 'Particle AI is everywhere. Ask questions in any search bar, get morning intelligence briefs, and upload research PDFs to your Knowledge Vault — the AI cross-references them automatically.',
    cta: 'Next',
  },
  {
    id: 'tickers',
    type: 'tickers',
    title: 'YOUR WATCHLIST',
    message: 'Pick a few tickers to get started. They\'ll appear across all your panels.',
    cta: 'Launch Terminal',
  },
];

const MOBILE_STEPS = [
  {
    id: 'welcome',
    type: 'splash',
    title: 'WELCOME',
    heading: 'Welcome to The Particle',
    sub: 'Your cross-asset market terminal with AI intelligence',
    cta: 'Show me around',
  },
  {
    id: 'home',
    type: 'card',
    title: 'HOME',
    icon: 'home',
    message: 'Your home feed shows market sentiment, sector screens, and quick access to everything. Swipe through the tabs at the top to explore charts, watchlists, and more.',
    cta: 'Next',
  },
  {
    id: 'ai',
    type: 'card',
    title: 'PARTICLE AI',
    icon: 'ai',
    message: 'Use the search bar to ask Particle AI anything about markets. Upload research PDFs to your Knowledge Vault and the AI will cross-reference them in every answer.',
    cta: 'Next',
  },
  {
    id: 'sectors',
    type: 'card',
    title: 'SECTOR SCREENS',
    icon: 'sectors',
    message: '10+ dedicated screens — Tech, Defence, Crypto, Commodities, Fixed Income, Brazil, and more. Find them in the home feed or the More tab. Each one is a full research terminal.',
    cta: 'Next',
  },
  {
    id: 'tickers',
    type: 'tickers',
    title: 'YOUR WATCHLIST',
    message: 'Pick a few tickers to get started. They\'ll light up across the terminal.',
    cta: 'Launch Terminal',
  },
];

// ── SVG Icons for card steps ─────────────────────────────────────────────
const STEP_ICONS = {
  home: (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  ),
  ai: (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4M12 8h.01" />
    </svg>
  ),
  sectors: (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
      <rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" />
    </svg>
  ),
};

// ── Pillar data for splash step ──────────────────────────────────────────
const PILLARS = [
  {
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
      </svg>
    ),
    color: '#00bcd4',
    label: 'Terminal',
    desc: 'Equities, FX, crypto, commodities, options, rates — all in one workspace',
  },
  {
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" />
      </svg>
    ),
    color: 'var(--color-accent, #e55a00)',
    label: 'Particle AI',
    desc: 'Ask anything — powered by your portfolio, live data, and research docs',
  },
  {
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
      </svg>
    ),
    color: 'var(--color-vault-accent, #c9a84c)',
    label: 'Vault',
    desc: 'Upload research PDFs — your AI gets smarter with every document',
  },
];

// ── Typewriter hook ──────────────────────────────────────────────────────
function useTypewriter(text, speed = 18) {
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

// ── Glow Highlight ───────────────────────────────────────────────────────
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

// ── Cutout Backdrop (spotlight effect) ───────────────────────────────────
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
      <rect width="100%" height="100%" fill="rgba(0,0,0,0.75)" mask="url(#wt-spotlight-mask)" />
    </svg>
  );
}

// ── Progress Bar ─────────────────────────────────────────────────────────
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

// ── Main Tour Component ──────────────────────────────────────────────────
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
  const { displayed, done: typeDone, skip: skipType } = useTypewriter(typewriterText, 16);

  // ── Should we show the tour? ──────────────────────────────────────────
  useEffect(() => {
    if (!settings) return;
    // Check all possible completion flags
    const serverDone = settings.onboardingCompleted === true;
    const localDone = localStorage.getItem('particle_tour_completed') === '1';
    const legacyDone = localStorage.getItem('particle_onboarding_done') === '1';
    if (serverDone || localDone || legacyDone) return;

    const t = setTimeout(() => {
      setActive(true);
      setEntering(true);
    }, 600);
    return () => clearTimeout(t);
  }, [settings]);

  // ── Track target element position ─────────────────────────────────────
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

  // ── Keyboard navigation ───────────────────────────────────────────────
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

  // ── Actions ───────────────────────────────────────────────────────────
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
    try { await markTourCompleted(); } catch {}
  }, [markTourCompleted]);

  const handleFinish = useCallback(async () => {
    // Add selected tickers before closing
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

  // ── RENDER ────────────────────────────────────────────────────────────
  return createPortal(
    <div className="wt-root">
      {/* Backdrop — spotlight cutout for spotlight steps, plain for others */}
      {step.type === 'spotlight' && targetRect ? (
        <SpotlightBackdrop
          targetRect={targetRect}
          onClick={() => { if (!typeDone) skipType(); }}
        />
      ) : (
        <div className="wt-backdrop" onClick={() => { if (!typeDone && step.type !== 'splash') skipType(); }} />
      )}

      {/* Glow highlight for spotlight steps */}
      {step.type === 'spotlight' && <GlowHighlight targetRect={targetRect} />}

      {/* ── SPLASH STEP (step 0) ── */}
      {step.type === 'splash' && (
        <div className={`wt-splash ${entering ? 'wt-entering' : ''}`}>
          {/* Particle orb */}
          <div className="wt-orb" />

          <h1 className="wt-splash-heading">
            {step.heading}{displayName ? `, ${displayName}` : ''}
          </h1>
          <p className="wt-splash-sub">{step.sub}</p>

          {/* 3 Pillars */}
          <div className="wt-pillars">
            {PILLARS.map((p, i) => (
              <div key={i} className="wt-pillar">
                <div className="wt-pillar-icon" style={{ color: p.color }}>{p.icon}</div>
                <div className="wt-pillar-label">{p.label}</div>
                <div className="wt-pillar-desc">{p.desc}</div>
              </div>
            ))}
          </div>

          <button className="wt-primary-btn" onClick={handleNext}>
            {step.cta}
          </button>
          <button className="wt-skip-btn" onClick={handleSkip}>
            Skip tour
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
          {/* Particle identity header */}
          <div className="wt-card-identity">
            <div className="wt-orb-sm" />
            <div className="wt-card-step-title">{step.title}</div>
            <div className="wt-card-counter">{stepIdx + 1}/{steps.length}</div>
          </div>

          {/* Content card */}
          <div className="wt-card">
            {/* Icon for card-type steps */}
            {step.type === 'card' && step.icon && (
              <div className="wt-card-icon">
                {STEP_ICONS[step.icon]}
              </div>
            )}

            {/* Typewriter message */}
            {(step.type === 'spotlight' || step.type === 'card') && (
              <div className="wt-card-message">
                {displayed}
                {!typeDone && <span className="wt-cursor" />}
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
                      </button>
                    );
                  })}
                </div>
              </>
            )}

            {/* Actions row */}
            <div className="wt-card-actions">
              <button className="wt-exit-btn" onClick={handleSkip}>
                {isFirst ? 'SKIP' : 'EXIT'}
              </button>

              <div className="wt-card-actions-center">
                <ProgressBar current={stepIdx} total={steps.length} />
              </div>

              <div className="wt-card-actions-right">
                {!isFirst && (
                  <button className="wt-back-btn" onClick={handleBack}>
                    Back
                  </button>
                )}
                <button
                  className={`wt-next-btn ${(typeDone || step.type === 'tickers') ? 'wt-next-btn--ready' : ''}`}
                  onClick={() => {
                    if (step.type === 'tickers') {
                      handleFinish();
                    } else if (!typeDone) {
                      skipType();
                    } else {
                      handleNext();
                    }
                  }}
                  disabled={addingTickers}
                >
                  {addingTickers ? 'Adding...' : (
                    (!typeDone && step.type !== 'tickers') ? 'Skip typing' : step.cta
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
