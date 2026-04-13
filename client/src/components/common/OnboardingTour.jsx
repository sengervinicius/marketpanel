/**
 * OnboardingTour.jsx — "Mission Control" AI-narrated onboarding.
 *
 * Instead of boring tooltip bubbles, Particle herself narrates the tour
 * through a cinematic chat-style interface. Each step highlights a UI
 * element with a breathing glow animation while Particle "types" a
 * message explaining the feature.
 *
 * Features:
 * - Typewriter effect for each message (feels like Particle is talking)
 * - Subtle spotlight glow on target elements (no harsh overlay)
 * - Progress orbs at bottom (fills as you advance)
 * - User can click "Show me" to advance or "Skip" to exit
 * - Interactive sandbox step: pre-loads a sample ticker
 * - Keyboard: Enter/→ next, ← back, Escape skip
 * - Persists completion to both localStorage and server settings
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useSettings } from '../../context/SettingsContext';

// ── Tour Steps — Particle narrates ────────────────────────────────────────
const STEPS = [
  {
    target: null,
    title: 'PARTICLE ONLINE',
    message: "I'm Particle — your AI-powered market terminal. I track real-time prices, run deep analysis on any stock, and learn your trading style over time. Let me show you around.",
    cta: 'Show me',
    glow: false,
  },
  {
    target: '[data-tour="search"]',
    title: 'COMMAND CENTER',
    message: "This is your command center. Type any ticker like AAPL or NVDA to pull up live data. Ask me anything — end with a ? and I'll run AI analysis. Try: \"Is NVDA overvalued?\"",
    cta: 'Next',
    placement: 'bottom',
    glow: true,
  },
  {
    target: '[data-tour="sector-screens"]',
    title: 'SECTOR INTELLIGENCE',
    message: "10 deep-dive sector screens — Defence, Tech, Crypto, Commodities, Fixed Income, and more. Each one is a dedicated research terminal with its own data tables, charts, and analytics.",
    cta: 'Next',
    placement: 'bottom',
    glow: true,
  },
  {
    target: '[data-tour="workspace"]',
    title: 'YOUR WORKSPACE',
    message: "Every panel here is yours to command. Drag them, resize them, click any ticker to drill down into fundamentals, charts, and AI analysis. Make this terminal truly yours.",
    cta: 'Next',
    placement: 'top',
    glow: true,
  },
  {
    target: null,
    title: 'KNOWLEDGE VAULT',
    message: "Upload research PDFs to your Knowledge Vault and I'll read them. When you ask me about a stock, I'll cross-reference your research automatically. Your vault, your edge.",
    cta: 'Next',
    glow: false,
  },
  {
    target: null,
    title: 'READY FOR LAUNCH',
    message: "That's the essentials. I'll send you morning intelligence briefs, track your portfolio mood, and get smarter the more you use me. Welcome aboard.",
    cta: 'Launch Terminal',
    glow: false,
    final: true,
  },
];

// ── Typewriter hook ────────────────────────────────────────────────────────
function useTypewriter(text, speed = 18) {
  const [displayed, setDisplayed] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    setDisplayed('');
    setDone(false);
    if (!text) return;
    let i = 0;
    const timer = setInterval(() => {
      i++;
      setDisplayed(text.slice(0, i));
      if (i >= text.length) {
        clearInterval(timer);
        setDone(true);
      }
    }, speed);
    return () => clearInterval(timer);
  }, [text, speed]);

  const skip = useCallback(() => {
    setDisplayed(text);
    setDone(true);
  }, [text]);

  return { displayed, done, skip };
}

// ── Glow highlight on target element ──────────────────────────────────────
function GlowHighlight({ targetRect }) {
  if (!targetRect) return null;
  const PAD = 8;
  return (
    <div
      style={{
        position: 'fixed',
        top: targetRect.top - PAD,
        left: targetRect.left - PAD,
        width: targetRect.width + PAD * 2,
        height: targetRect.height + PAD * 2,
        borderRadius: 10,
        border: '1px solid rgba(249, 115, 22, 0.4)',
        boxShadow: '0 0 20px rgba(249, 115, 22, 0.15), 0 0 60px rgba(249, 115, 22, 0.08), inset 0 0 20px rgba(249, 115, 22, 0.05)',
        animation: 'tour-glow-pulse 2s ease-in-out infinite',
        pointerEvents: 'none',
        zIndex: 10000,
        transition: 'all 400ms cubic-bezier(0.4, 0, 0.2, 1)',
      }}
    />
  );
}

// ── Progress Orbs ─────────────────────────────────────────────────────────
function ProgressOrbs({ current, total }) {
  return (
    <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
      {Array.from({ length: total }, (_, i) => (
        <div
          key={i}
          style={{
            width: i === current ? 20 : 6,
            height: 6,
            borderRadius: 3,
            background: i <= current
              ? 'linear-gradient(90deg, #F97316, #ff8833)'
              : 'rgba(255,255,255,0.1)',
            transition: 'all 300ms ease',
          }}
        />
      ))}
    </div>
  );
}

// ── Main Tour Component ─────────────────────────────────────────────────
export default function OnboardingTour() {
  const { settings, markTourCompleted } = useSettings();
  const [active, setActive] = useState(false);
  const [stepIdx, setStepIdx] = useState(0);
  const [targetRect, setTargetRect] = useState(null);
  const animFrame = useRef(null);

  const step = STEPS[stepIdx];
  const { displayed, done, skip: skipTypewriter } = useTypewriter(
    active ? step.message : '', 18
  );

  // Start tour if not completed — check server settings FIRST, then localStorage as fast cache
  useEffect(() => {
    // Migrate legacy key
    try { const v = localStorage.getItem('senger_tour_completed'); if (v !== null) { localStorage.setItem('particle_tour_completed', v); localStorage.removeItem('senger_tour_completed'); } } catch {}
    if (!settings) return;
    // Either server OR localStorage says done → skip the tour
    const serverDone = settings.onboardingCompleted === true;
    const localDone = localStorage.getItem('particle_tour_completed') === '1';
    if (serverDone || localDone) return;
    const t = setTimeout(() => setActive(true), 800);
    return () => clearTimeout(t);
  }, [settings]);

  // Track target element position
  useEffect(() => {
    if (!active) return;
    if (!step?.target) { setTargetRect(null); return; }
    const measure = () => {
      const el = document.querySelector(step.target);
      if (el) {
        const r = el.getBoundingClientRect();
        setTargetRect({ top: r.top, left: r.left, width: r.width, height: r.height, bottom: r.bottom, right: r.right });
      } else {
        setTargetRect(null);
      }
      animFrame.current = requestAnimationFrame(measure);
    };
    measure();
    return () => cancelAnimationFrame(animFrame.current);
  }, [active, stepIdx, step?.target]);

  // Keyboard navigation
  useEffect(() => {
    if (!active) return;
    const handler = (e) => {
      if (e.key === 'Escape') handleSkip();
      else if (e.key === 'ArrowRight' || e.key === 'Enter') {
        if (!done) skipTypewriter();
        else handleNext();
      }
      else if (e.key === 'ArrowLeft') handleBack();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });

  const handleNext = useCallback(() => {
    if (stepIdx < STEPS.length - 1) {
      setStepIdx(s => s + 1);
    } else {
      handleFinish();
    }
  }, [stepIdx]);

  const handleBack = useCallback(() => {
    if (stepIdx > 0) setStepIdx(s => s - 1);
  }, [stepIdx]);

  const handleSkip = useCallback(async () => {
    setActive(false);
    localStorage.setItem('particle_tour_completed', '1');
    await markTourCompleted();
  }, [markTourCompleted]);

  const handleFinish = useCallback(async () => {
    setActive(false);
    localStorage.setItem('particle_tour_completed', '1');
    await markTourCompleted();
  }, [markTourCompleted]);

  if (!active) return null;

  const isFirst = stepIdx === 0;
  const isLast = stepIdx === STEPS.length - 1;

  return createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex: 10000 }}>
      {/* Semi-transparent backdrop — lighter than before */}
      <div
        onClick={() => { if (!done) skipTypewriter(); }}
        style={{
          position: 'fixed', inset: 0,
          background: 'rgba(0, 0, 0, 0.7)',
          backdropFilter: 'blur(4px)',
          transition: 'opacity 400ms ease',
        }}
      />

      {/* Glow highlight on target element */}
      {step.glow && <GlowHighlight targetRect={targetRect} />}

      {/* Chat-style message card */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'fixed',
          bottom: 40,
          left: '50%',
          transform: 'translateX(-50%)',
          width: 'min(520px, calc(100vw - 32px))',
          zIndex: 10001,
          animation: 'tour-slide-up 400ms cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        {/* Particle identity header */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          marginBottom: 12,
        }}>
          {/* Particle orb */}
          <div style={{
            width: 32, height: 32, borderRadius: '50%',
            background: 'radial-gradient(circle at 40% 40%, #F97316, #c2410c)',
            boxShadow: '0 0 16px rgba(249, 115, 22, 0.4)',
            animation: 'tour-orb-pulse 2s ease-in-out infinite',
          }} />
          <div style={{
            fontSize: 10, fontWeight: 700, letterSpacing: '2px',
            color: 'rgba(249, 115, 22, 0.8)',
            fontFamily: 'var(--font-mono, monospace)',
          }}>
            {step.title}
          </div>
          <div style={{ flex: 1 }} />
          <div style={{
            fontSize: 10, color: 'rgba(255,255,255,0.25)',
            fontFamily: 'var(--font-mono, monospace)',
          }}>
            {stepIdx + 1}/{STEPS.length}
          </div>
        </div>

        {/* Message card */}
        <div style={{
          background: 'linear-gradient(180deg, rgba(26, 26, 26, 0.95) 0%, rgba(18, 18, 18, 0.95) 100%)',
          border: '1px solid rgba(255, 255, 255, 0.06)',
          borderRadius: 16,
          padding: '24px 28px 20px',
          boxShadow: '0 24px 80px rgba(0, 0, 0, 0.6), 0 0 1px rgba(249, 115, 22, 0.1)',
        }}>
          {/* Typewriter message */}
          <div style={{
            fontSize: 15, lineHeight: 1.7,
            color: 'rgba(255, 255, 255, 0.85)',
            minHeight: 60,
            fontFamily: 'var(--font-ui, -apple-system, BlinkMacSystemFont, sans-serif)',
          }}>
            {displayed}
            {!done && (
              <span style={{
                display: 'inline-block',
                width: 2, height: 16,
                background: '#F97316',
                marginLeft: 2,
                verticalAlign: 'text-bottom',
                animation: 'tour-cursor-blink 0.8s ease-in-out infinite',
              }} />
            )}
          </div>

          {/* Actions + Progress */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 12,
            marginTop: 20,
            paddingTop: 16,
            borderTop: '1px solid rgba(255, 255, 255, 0.04)',
          }}>
            <button
              onClick={handleSkip}
              style={{
                background: 'none', border: 'none',
                color: 'rgba(255, 255, 255, 0.25)',
                fontSize: 11, cursor: 'pointer',
                fontFamily: 'var(--font-mono, monospace)',
                letterSpacing: '0.5px',
                padding: '6px 0',
                transition: 'color 150ms',
              }}
              onMouseEnter={e => e.target.style.color = 'rgba(255,255,255,0.5)'}
              onMouseLeave={e => e.target.style.color = 'rgba(255,255,255,0.25)'}
            >
              {isFirst ? 'SKIP' : 'EXIT'}
            </button>

            <div style={{ flex: 1 }}>
              <ProgressOrbs current={stepIdx} total={STEPS.length} />
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              {!isFirst && (
                <button
                  onClick={handleBack}
                  style={{
                    background: 'none',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    color: 'rgba(255, 255, 255, 0.5)',
                    fontSize: 12, fontWeight: 600,
                    padding: '8px 16px',
                    borderRadius: 8,
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    transition: 'all 150ms ease',
                  }}
                  onMouseEnter={e => { e.target.style.borderColor = 'rgba(255,255,255,0.15)'; e.target.style.color = 'rgba(255,255,255,0.7)'; }}
                  onMouseLeave={e => { e.target.style.borderColor = 'rgba(255,255,255,0.08)'; e.target.style.color = 'rgba(255,255,255,0.5)'; }}
                >
                  Back
                </button>
              )}
              <button
                onClick={() => { if (!done) skipTypewriter(); else handleNext(); }}
                style={{
                  background: done
                    ? 'linear-gradient(135deg, #F97316 0%, #ea580c 100%)'
                    : 'rgba(249, 115, 22, 0.15)',
                  border: done ? 'none' : '1px solid rgba(249, 115, 22, 0.3)',
                  color: done ? '#000' : '#F97316',
                  fontSize: 12, fontWeight: 700,
                  padding: '8px 20px',
                  borderRadius: 8,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  letterSpacing: '0.3px',
                  transition: 'all 200ms ease',
                  boxShadow: done ? '0 4px 16px rgba(249, 115, 22, 0.3)' : 'none',
                }}
                onMouseEnter={e => {
                  if (done) { e.target.style.transform = 'translateY(-1px)'; e.target.style.boxShadow = '0 6px 20px rgba(249, 115, 22, 0.4)'; }
                }}
                onMouseLeave={e => {
                  e.target.style.transform = 'none';
                  e.target.style.boxShadow = done ? '0 4px 16px rgba(249, 115, 22, 0.3)' : 'none';
                }}
              >
                {!done ? 'Skip typing' : step.cta}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* CSS animations */}
      <style>{`
        @keyframes tour-slide-up {
          from { opacity: 0; transform: translateX(-50%) translateY(30px); }
          to   { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
        @keyframes tour-cursor-blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
        @keyframes tour-orb-pulse {
          0%, 100% { box-shadow: 0 0 16px rgba(249, 115, 22, 0.4); }
          50% { box-shadow: 0 0 24px rgba(249, 115, 22, 0.6), 0 0 48px rgba(249, 115, 22, 0.2); }
        }
        @keyframes tour-glow-pulse {
          0%, 100% {
            box-shadow: 0 0 20px rgba(249, 115, 22, 0.15), 0 0 60px rgba(249, 115, 22, 0.08), inset 0 0 20px rgba(249, 115, 22, 0.05);
            border-color: rgba(249, 115, 22, 0.4);
          }
          50% {
            box-shadow: 0 0 30px rgba(249, 115, 22, 0.25), 0 0 80px rgba(249, 115, 22, 0.12), inset 0 0 30px rgba(249, 115, 22, 0.08);
            border-color: rgba(249, 115, 22, 0.6);
          }
        }
      `}</style>
    </div>,
    document.body
  );
}
