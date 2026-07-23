/**
 * SpotlightTour.jsx — branded onboarding.
 *
 * Flow: (1) a soft animated "Particle" splash → (2) the three verticals
 * (Particle AI · Terminal · Vault) → (3) a box-by-box spotlight walk of the
 * REAL terminal (anchored via [data-panel-id] and the header search).
 * User-paced (Back/Next/Skip, arrows/ESC), progress dots, degrades to a
 * centered card if a target is hidden. Re-triggerable via settings.tourResetAt.
 */
import { useState, useEffect, useRef, useCallback, useLayoutEffect } from 'react';
import { useSettings } from '../../context/SettingsContext';
import { swallow } from '../../utils/swallow';
import './SpotlightTour.css';

// type: splash | verticals | target | center
const STEPS = [
  { type: 'splash' },
  { type: 'target', nav: 'particle', sel: '[data-tour="mode-particle"]', eyebrow: 'PARTICLE AI', title: 'Ask anything',
    body: 'This is Particle AI — your analyst. Ask about any name, get a thesis, draft research, or generate your morning brief. It reads the live market and your Vault, and cites its sources. This PARTICLE button opens it anytime.' },
  { type: 'target', nav: 'vault', sel: '[data-tour="mode-vault"]', eyebrow: 'THE VAULT', title: 'Your research, remembered',
    body: 'The Vault is your private research library — drop in PDFs, notes and broker research. Particle reads them and cites them back inside every answer. Open it with this VAULT button.' },
  { type: 'target', nav: 'terminal', sel: '[data-tour="mode-terminal"]', eyebrow: 'THE TERMINAL', title: 'Your live workspace',
    body: 'And this is the Terminal — every asset class in one grid you control. Let me walk you through the boxes.' },
  { type: 'target', sel: '.hsb-trigger, .hsb-container', eyebrow: 'SEARCH', title: 'Your command bar',
    body: 'Type any ticker, company or macro theme — or ask Particle AI a question. Press ⌘K from anywhere in the app.' },
  { type: 'target', sel: '[data-panel-id="charts"]', eyebrow: 'CHARTS', title: 'Live charts, every asset class',
    body: 'Indices, FX, gold, crypto — side by side. Click any chart for the full instrument view. And a workspace tip: drag any box by its header to move it, or drag an edge to resize.' },
  { type: 'target', sel: '[data-panel-id="watchlist"]', eyebrow: 'WATCHLIST', title: 'Your names, live',
    body: 'Your tracked tickers in real time. Add names from the search bar; click a row for the deep view.' },
  { type: 'target', sel: '[data-panel-id="globalIndices"]', eyebrow: 'GLOBAL INDEXES', title: 'The world at a glance',
    body: 'Major indices worldwide — folds in futures automatically when cash markets are closed. Hit EDIT to pick your indices.' },
  { type: 'target', sel: '[data-panel-id="forex"]', eyebrow: 'FX / CRYPTO', title: 'Currencies & crypto',
    body: 'Majors, BRL crosses and the main cryptos, DXY pinned. Fully editable — EDIT to choose your pairs.' },
  { type: 'target', sel: '[data-panel-id="commodities"]', eyebrow: 'COMMODITIES', title: 'Metals, energy, ags',
    body: 'Front-month futures across the complex. Fully editable, like FX and US Equities.' },
  { type: 'target', sel: '[data-panel-id="usEquities"]', eyebrow: 'US EQUITIES', title: 'Make it yours',
    body: 'Large-cap US names by default. This box, FX and Commodities are fully editable — EDIT to rename the box and pick your own tickers.' },
  { type: 'target', sel: '[data-panel-id="brazilB3"]', eyebrow: 'IN-DEPTH COUNTRY', title: 'Any country you want',
    body: 'Use the selector to switch country. Brazil loads rich; other countries show their market at a glance. Set your home country here.' },
  { type: 'target', sel: '[data-panel-id="debt"]', eyebrow: 'YIELDS & RATES', title: 'Rates & credit, deep',
    body: 'Sovereign curves, 2s10s, credit spreads and a corporate-bond list. Country chips switch the curve; "+ CURVES" overlays several.' },
  { type: 'target', sel: '[data-panel-id="bloombergTV"]', eyebrow: 'BLOOMBERG TV', title: 'Live TV, in your terminal',
    body: 'Bloomberg business television streams right here — audio and video, always on, no second screen needed.' },
  { type: 'target', sel: '[data-panel-id="movers"]', eyebrow: 'MOVERS & PREDICTIONS', title: "What's moving — and what's priced",
    body: 'Biggest gainers, losers and most-active names, plus live prediction-market odds beneath them.' },
  { type: 'target', sel: '[data-panel-id="news"]', eyebrow: 'NEWS', title: 'The wire',
    body: 'Market headlines as they break. Scope it to just your watchlist when you want signal over noise.' },
  { type: 'target', sel: '[data-panel-id="calendar"]', eyebrow: 'CALENDAR', title: 'What to watch, when',
    body: 'Economic prints and earnings by date and impact — so nothing catches you off guard.' },
  { type: 'target', sel: '[data-panel-id="sectorPulse"]', eyebrow: 'MARKET MAP', title: 'Where leadership is',
    body: 'All 11 sectors ranked best-to-worst on the day, so you read rotation in a glance.' },
  { type: 'target', sel: '[data-panel-id="brief"]', eyebrow: 'DAILY BRIEF', title: 'The open, before the open',
    body: 'A pre-open brief built from your book — positioning, overnight moves, what matters today. Add your email in Settings and it lands in your inbox every morning: bespoke news and the info relevant to you.' },
  { type: 'center', eyebrow: "YOU'RE SET", title: 'Go build your view',
    body: 'Drag any box to rearrange, drag an edge to resize, and hit EDIT on a box to make it yours. Press ⌘K anytime to jump to any ticker, panel or screen.' },
];

function SplashCanvas() {
  const ref = useRef(null);
  useEffect(() => {
    const cv = ref.current; if (!cv) return;
    const ctx = cv.getContext('2d');
    const DPR = Math.min(window.devicePixelRatio || 1, 2);
    let raf, t0 = performance.now();
    const W = () => cv.clientWidth, H = () => cv.clientHeight;
    const resize = () => { cv.width = cv.clientWidth * DPR; cv.height = cv.clientHeight * DPR; ctx.setTransform(DPR, 0, 0, DPR, 0, 0); };
    resize(); window.addEventListener('resize', resize);
    const orbits = Array.from({ length: 8 }, (_, i) => ({ a: 0.20 + i * 0.05, b: 0.09 + i * 0.028, rot: ((i * 41) % 180) * Math.PI / 180, speed: 0.15 + Math.random() * 0.5, phase: Math.random() * 7, n: 1 + (i % 3) }));
    const streams = Array.from({ length: 180 }, () => ({ y: Math.random(), x: Math.random(), sp: 0.6 + Math.random() * 1.4, r: Math.random() * 1.4 + 0.3, w: 0.4 + Math.random() * 0.5 }));
    const frame = (now) => {
      const t = (now - t0) / 1000;
      ctx.clearRect(0, 0, W(), H());
      const cx = W() * 0.6, cy = H() * 0.5, R = Math.min(W(), H());
      for (const s of streams) {
        s.x += s.sp * 0.0016; if (s.x > 1.15) s.x = -0.12;
        const px = s.x * W() * 0.72;
        const py = (s.y * s.w + (1 - s.w) / 2) * H() + Math.sin(s.x * 6 + s.y * 12) * 22;
        const d = Math.hypot(px - cx, py - cy);
        const al = Math.max(0, 0.55 - d / (W() * 0.9));
        ctx.fillStyle = `rgba(232,140,32,${0.12 + al})`;
        ctx.beginPath(); ctx.arc(px, py, s.r, 0, 7); ctx.fill();
      }
      for (const o of orbits) {
        ctx.save(); ctx.translate(cx, cy); ctx.rotate(o.rot);
        ctx.strokeStyle = 'rgba(222,120,22,0.16)'; ctx.lineWidth = 0.6;
        ctx.beginPath(); ctx.ellipse(0, 0, o.a * R, o.b * R, 0, 0, 7); ctx.stroke();
        for (let k = 0; k < o.n; k++) {
          const ang = t * o.speed + o.phase + k * 2.1;
          const x = Math.cos(ang) * o.a * R, y = Math.sin(ang) * o.b * R;
          ctx.fillStyle = 'rgba(255,172,52,0.95)'; ctx.shadowColor = 'rgba(255,150,30,0.9)'; ctx.shadowBlur = 9;
          ctx.beginPath(); ctx.arc(x, y, 1.9, 0, 7); ctx.fill(); ctx.shadowBlur = 0;
        }
        ctx.restore();
      }
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.09);
      g.addColorStop(0, 'rgba(255,210,110,1)'); g.addColorStop(0.35, 'rgba(240,140,22,0.85)'); g.addColorStop(1, 'rgba(240,140,22,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R * 0.09, 0, 7); ctx.fill();
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize); };
  }, []);
  return <canvas ref={ref} className="st-splash-canvas" />;
}

function getRect(sel) {
  if (!sel) return null;
  const el = document.querySelector(sel);
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
    const t = setTimeout(() => { setI(0); setActive(true); }, 500);
    return () => clearTimeout(t);
  }, [settings, active]);

  const step = STEPS[i];
  const isTarget = step && step.type === 'target';

  useLayoutEffect(() => {
    if (!active || !isTarget) { setRect(null); return; }
    if (step.nav) { try { document.querySelector(`[data-tour="mode-${step.nav}"]`)?.click(); } catch { /* ok */ } }
    const el = document.querySelector(step.sel);
    if (el) { try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch { /* ok */ } }
    const measure = () => setRect(getRect(step.sel));
    measure();
    const t = setTimeout(measure, 280);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => { clearTimeout(t); window.removeEventListener('resize', measure); window.removeEventListener('scroll', measure, true); };
  }, [active, i, isTarget, step]);

  const markDone = useCallback(async () => {
    localStorage.setItem('particle_tour_completed', '1');
    localStorage.setItem('particle_onboarding_done', '1');
    localStorage.setItem('particle_tour_completed_at', String(Date.now()));
    try { await markTourCompleted(); } catch (e) { swallow(e, 'onboarding.spotlightTour.mark'); }
  }, [markTourCompleted]);

  const close = useCallback(() => { setActive(false); markDone(); }, [markDone]);
  const next = useCallback(() => { setI(v => (v < STEPS.length - 1 ? v + 1 : v)); if (i >= STEPS.length - 1) close(); }, [i, close]);
  const back = useCallback(() => setI(v => (v > 0 ? v - 1 : v)), []);

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

  if (!active || !step) return null;
  const isLast = i === STEPS.length - 1;

  // ── Splash ──
  if (step.type === 'splash') {
    return (
      <div className="st-root st-splash">
        <SplashCanvas />
        <div className="st-splash-content">
          <div className="st-splash-word">PARTICLE</div>
          <div className="st-splash-tag">Your market, resolved into signal.</div>
          <button className="st-next st-splash-btn" onClick={next}>Take the tour →</button>
          <button className="st-skip st-splash-skip" onClick={close}>Skip</button>
        </div>
      </div>
    );
  }

  // ── Target spotlight / centered ──
  const pad = 6;
  const hole = rect ? { top: Math.max(4, rect.top - pad), left: Math.max(4, rect.left - pad), width: rect.width + pad * 2, height: rect.height + pad * 2 } : null;
  const vh = window.innerHeight, vw = window.innerWidth, CARD_W = 344;
  let cardStyle;
  if (hole) {
    const below = hole.top + hole.height + 12;
    const placeBelow = below + 220 < vh;
    const top = placeBelow ? below : Math.max(12, hole.top - 12 - 210);
    let left = hole.left + hole.width / 2 - CARD_W / 2;
    left = Math.min(Math.max(12, left), vw - CARD_W - 12);
    cardStyle = { top, left, width: CARD_W };
  } else {
    cardStyle = { top: vh / 2 - 120, left: vw / 2 - CARD_W / 2, width: CARD_W };
  }

  return (
    <div className="st-root" role="dialog" aria-modal="true">
      {hole ? <div className="st-hole" style={hole} /> : <div className="st-dim-full" />}
      <div className="st-card" style={cardStyle}>
        <div className="st-eyebrow">{step.eyebrow}</div>
        <div className="st-title">{step.title}</div>
        <div className="st-body">{step.body}</div>
        <div className="st-progress">{STEPS.map((_, k) => <span key={k} className={`st-dot${k === i ? ' st-dot--on' : ''}`} />)}</div>
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
