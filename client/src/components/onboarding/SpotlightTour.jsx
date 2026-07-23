/**
 * SpotlightTour.jsx — a guided, box-by-box walkthrough of the real terminal.
 *
 * Replaces the old high-level cinematic slideshow. It dims the terminal and
 * spotlights each ACTUAL box (anchored via [data-panel-id]), explaining what it
 * is and what you can do with it. Research-backed: embedded/spotlight coach
 * marks beat modals for complex dashboards, and user-paced beats auto-advance.
 * If a box is hidden/not found, that step degrades to a centered card.
 *
 * Visibility gating mirrors the old tour: shows once, re-triggerable via
 * settings.tourResetAt (the "Restart Onboarding Tour" button).
 */
import { useState, useEffect, useCallback, useLayoutEffect } from 'react';
import { useSettings } from '../../context/SettingsContext';
import { swallow } from '../../utils/swallow';
import './SpotlightTour.css';

// Ordered walkthrough. panel === null → centered card (intro/outro).
const STEPS = [
  { panel: null, eyebrow: 'WELCOME', title: 'This is your terminal',
    body: 'A 60-second tour of what each box does. Everything here is live, and the whole grid is yours to rearrange.' },
  { panel: 'charts', eyebrow: 'CHARTS', title: 'Live charts, every asset class',
    body: 'Indices, FX, gold, crypto — side by side. Click any chart for the full instrument view; adjust how many you see.' },
  { panel: 'watchlist', eyebrow: 'WATCHLIST', title: 'Your names, live',
    body: 'Your tracked tickers with real-time prices. Add names from the search bar up top; click a row for the deep view.' },
  { panel: 'globalIndices', eyebrow: 'GLOBAL INDEXES', title: 'The world at a glance',
    body: 'Major indices worldwide — and it folds in futures automatically when cash markets are closed. Hit EDIT to pick your indices.' },
  { panel: 'forex', eyebrow: 'FX / CRYPTO', title: 'Currencies & crypto',
    body: 'Majors, BRL crosses and the main cryptos, with DXY pinned. Fully editable — hit EDIT to choose your pairs.' },
  { panel: 'commodities', eyebrow: 'COMMODITIES', title: 'Metals, energy, ags',
    body: 'Front-month futures across the complex. Fully editable via the EDIT button, like FX and US Equities.' },
  { panel: 'usEquities', eyebrow: 'US EQUITIES', title: 'Make it yours',
    body: 'Large-cap US names by default. This box, FX and Commodities are fully editable — hit EDIT to rename the box and pick your own tickers.' },
  { panel: 'brazilB3', eyebrow: 'IN-DEPTH COUNTRY', title: 'Any country you want',
    body: 'Use the selector to switch country. Brazil loads rich — rates, FIIs, ADRs; other countries show their market at a glance. Set your home country here.' },
  { panel: 'debt', eyebrow: 'YIELDS & RATES', title: 'Rates & credit, deep',
    body: 'Sovereign curves, 2s10s, credit spreads and a corporate-bond list. Country chips switch the curve; the "+ CURVES" toggle overlays several.' },
  { panel: 'movers', eyebrow: 'MOVERS & PREDICTIONS', title: "What's moving — and what's priced",
    body: 'Biggest gainers, losers and most-active names, plus live prediction-market odds beneath them.' },
  { panel: 'news', eyebrow: 'NEWS', title: 'The wire',
    body: 'Market headlines as they break. Scope it to just your watchlist when you want signal over noise.' },
  { panel: 'calendar', eyebrow: 'CALENDAR', title: 'What to watch, when',
    body: 'Economic prints and earnings by date and impact — so nothing catches you off guard.' },
  { panel: 'sectorPulse', eyebrow: 'MARKET MAP', title: 'Where leadership is',
    body: 'All 11 sectors ranked best-to-worst on the day, so you read rotation in a glance.' },
  { panel: 'brief', eyebrow: 'DAILY BRIEF', title: 'The open, before the open',
    body: 'A personalized brief built from your book — positioning, overnight moves, what matters today. It also lands in your inbox each morning.' },
  { panel: null, eyebrow: "YOU'RE SET", title: 'Go build your view',
    body: 'Drag any box to rearrange. Hit EDIT on a box to make it yours. And press ⌘K anytime to jump to any ticker, panel or screen.' },
];

function getRect(panelId) {
  if (!panelId) return null;
  const el = document.querySelector(`[data-panel-id="${panelId}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width < 8 || r.height < 8) return null;
  return r;
}

export default function SpotlightTour() {
  const { settings, markTourCompleted } = useSettings();
  const [active, setActive] = useState(false);
  const [i, setI] = useState(0);
  const [rect, setRect] = useState(null);

  // ── should we show it? (mirrors the old gating) ──
  useEffect(() => {
    if (!settings) return;
    const resetAt = Number(settings.tourResetAt || 0);
    const localAt = Number(localStorage.getItem('particle_tour_completed_at') || 0);
    const clearedByReset = resetAt > 0 && resetAt > localAt;
    const done = settings.onboardingCompleted === true
      || localStorage.getItem('particle_tour_completed') === '1'
      || localStorage.getItem('particle_onboarding_done') === '1';
    if (!clearedByReset && done) return;
    if (active) return;
    const t = setTimeout(() => { setI(0); setActive(true); }, 650);
    return () => clearTimeout(t);
  }, [settings, active]);

  const step = STEPS[i];

  // ── measure/scroll the current target ──
  useLayoutEffect(() => {
    if (!active) return;
    const el = step.panel ? document.querySelector(`[data-panel-id="${step.panel}"]`) : null;
    if (el) { try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch { /* ok */ } }
    const measure = () => setRect(getRect(step.panel));
    measure();
    const t = setTimeout(measure, 260); // after scroll settles
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => { clearTimeout(t); window.removeEventListener('resize', measure); window.removeEventListener('scroll', measure, true); };
  }, [active, i, step.panel]);

  const markDone = useCallback(async () => {
    localStorage.setItem('particle_tour_completed', '1');
    localStorage.setItem('particle_onboarding_done', '1');
    localStorage.setItem('particle_tour_completed_at', String(Date.now()));
    try { await markTourCompleted(); } catch (e) { swallow(e, 'onboarding.spotlightTour.mark'); }
  }, [markTourCompleted]);

  const close = useCallback(() => { setActive(false); markDone(); }, [markDone]);
  const next = useCallback(() => { if (i < STEPS.length - 1) setI(i + 1); else close(); }, [i, close]);
  const back = useCallback(() => { if (i > 0) setI(i - 1); }, [i]);

  useEffect(() => {
    if (!active) return;
    const onKey = (e) => {
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowRight' || e.key === 'Enter') next();
      else if (e.key === 'ArrowLeft') back();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, next, back, close]);

  if (!active) return null;

  const pad = 6;
  const hole = rect ? {
    top: Math.max(4, rect.top - pad), left: Math.max(4, rect.left - pad),
    width: rect.width + pad * 2, height: rect.height + pad * 2,
  } : null;

  // card placement: below the box if room, else above; centered when no target
  const vh = window.innerHeight, vw = window.innerWidth;
  const CARD_W = 340;
  let cardStyle;
  if (hole) {
    const below = hole.top + hole.height + 12;
    const placeBelow = below + 210 < vh;
    const top = placeBelow ? below : Math.max(12, hole.top - 12 - 200);
    let left = hole.left + hole.width / 2 - CARD_W / 2;
    left = Math.min(Math.max(12, left), vw - CARD_W - 12);
    cardStyle = { top, left, width: CARD_W };
  } else {
    cardStyle = { top: vh / 2 - 120, left: vw / 2 - CARD_W / 2, width: CARD_W };
  }

  const isLast = i === STEPS.length - 1;
  const progress = STEPS.filter(s => true).length;

  return (
    <div className="st-root" role="dialog" aria-modal="true">
      {hole ? (
        <div className="st-hole" style={hole} />
      ) : (
        <div className="st-dim-full" />
      )}

      <div className="st-card" style={cardStyle}>
        <div className="st-eyebrow">{step.eyebrow}</div>
        <div className="st-title">{step.title}</div>
        <div className="st-body">{step.body}</div>

        <div className="st-progress">
          {STEPS.map((_, k) => <span key={k} className={`st-dot${k === i ? ' st-dot--on' : ''}`} />)}
        </div>

        <div className="st-actions">
          <button className="st-skip" onClick={close}>{isLast ? '' : 'Skip tour'}</button>
          <div className="st-nav">
            {i > 0 && <button className="st-back" onClick={back}>Back</button>}
            <button className="st-next" onClick={next}>{isLast ? "Let's go →" : 'Next →'}</button>
          </div>
        </div>
        <div className="st-count">{i + 1} / {STEPS.length}</div>
      </div>
    </div>
  );
}
