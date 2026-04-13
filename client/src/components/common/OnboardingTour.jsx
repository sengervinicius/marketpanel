/**
 * OnboardingTour.jsx
 * Custom 5-step spotlight tour for new Senger Market Terminal users.
 *
 * Features:
 * - Full opaque overlay with spotlight cutout on the target element
 * - Floating tooltip positioned intelligently near the spotlight
 * - Bloomberg-dark aesthetic with orange accents
 * - Smooth transitions between steps
 * - Keyboard navigation (Escape to skip, Enter/→ for next, ← for back)
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useSettings } from '../../context/SettingsContext';

// ── Tour Steps ──────────────────────────────────────────────────────────────
const STEPS = [
  {
    target: null, // centered modal, no spotlight
    title: 'Welcome to Particle',
    body: 'Your Bloomberg-style market terminal. Real-time data, AI insights, and deep sector analysis — all in one place.',
    icon: '◆',
  },
  {
    target: '[data-tour="search"]',
    title: 'Smart Search',
    body: 'Type any ticker, company name, or ask AI a market question. Prefix with @ai or end with ? to activate AI mode.',
    icon: '⌕',
    placement: 'bottom',
  },
  {
    target: '[data-tour="sector-screens"]',
    title: 'Sector Screens',
    body: '10 deep-dive sector screens — Defence, Tech, Crypto, Commodities, Fixed Income, and more. Each with its own data tables, charts, and analytics.',
    icon: '◈',
    placement: 'bottom',
  },
  {
    target: '[data-tour="workspace"]',
    title: 'Your Workspace',
    body: 'Drag, resize, and rearrange every panel. Click any ticker to open a full instrument detail with charts, fundamentals, and AI analysis.',
    icon: '⊞',
    placement: 'top',
  },
  {
    target: '[data-tour="layout"]',
    title: 'Customize Layout',
    body: 'Use the Layout button to rearrange panels, toggle visibility, and make the terminal truly yours.',
    icon: '⇄',
    placement: 'bottom',
  },
];

// ── Tooltip placement logic ─────────────────────────────────────────────────
function computeTooltipPosition(targetRect, placement, tooltipW, tooltipH) {
  const PAD = 16;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let top, left;

  if (!targetRect) {
    // Center of screen
    return { top: (vh - tooltipH) / 2, left: (vw - tooltipW) / 2 };
  }

  switch (placement) {
    case 'bottom':
      top = targetRect.bottom + PAD;
      left = targetRect.left + targetRect.width / 2 - tooltipW / 2;
      break;
    case 'top':
      top = targetRect.top - tooltipH - PAD;
      left = targetRect.left + targetRect.width / 2 - tooltipW / 2;
      break;
    case 'right':
      top = targetRect.top + targetRect.height / 2 - tooltipH / 2;
      left = targetRect.right + PAD;
      break;
    case 'left':
      top = targetRect.top + targetRect.height / 2 - tooltipH / 2;
      left = targetRect.left - tooltipW - PAD;
      break;
    default:
      top = targetRect.bottom + PAD;
      left = targetRect.left + targetRect.width / 2 - tooltipW / 2;
  }

  // Clamp to viewport
  if (left < PAD) left = PAD;
  if (left + tooltipW > vw - PAD) left = vw - tooltipW - PAD;
  if (top < PAD) top = PAD;
  if (top + tooltipH > vh - PAD) top = vh - tooltipH - PAD;

  return { top, left };
}

// ── SVG overlay with spotlight cutout ───────────────────────────────────────
function SpotlightOverlay({ rect, onClick }) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const PAD = 8;
  const R = 8;

  if (!rect) {
    // No spotlight — full overlay
    return (
      <div
        onClick={onClick}
        style={{
          position: 'fixed', inset: 0, zIndex: 10000,
          background: 'rgba(0, 0, 0, 0.85)',
          transition: 'opacity 300ms ease',
        }}
      />
    );
  }

  const x = rect.left - PAD;
  const y = rect.top - PAD;
  const w = rect.width + PAD * 2;
  const h = rect.height + PAD * 2;

  return (
    <svg
      onClick={onClick}
      style={{
        position: 'fixed', inset: 0, zIndex: 10000,
        width: '100%', height: '100%',
        transition: 'opacity 300ms ease',
      }}
    >
      <defs>
        <mask id="tour-spotlight-mask">
          <rect x="0" y="0" width={vw} height={vh} fill="white" />
          <rect x={x} y={y} width={w} height={h} rx={R} ry={R} fill="black" />
        </mask>
      </defs>
      <rect
        x="0" y="0" width={vw} height={vh}
        fill="rgba(0, 0, 0, 0.82)"
        mask="url(#tour-spotlight-mask)"
      />
      {/* Spotlight border glow */}
      <rect
        x={x} y={y} width={w} height={h}
        rx={R} ry={R}
        fill="none"
        stroke="rgba(255, 102, 0, 0.35)"
        strokeWidth="2"
      />
    </svg>
  );
}

// ── Main Tour Component ─────────────────────────────────────────────────────
export default function OnboardingTour() {
  const { settings, markTourCompleted } = useSettings();
  const [active, setActive] = useState(false);
  const [stepIdx, setStepIdx] = useState(0);
  const [targetRect, setTargetRect] = useState(null);
  const [tooltipSize, setTooltipSize] = useState({ w: 380, h: 200 });
  const tooltipRef = useRef(null);
  const animFrame = useRef(null);

  // Start tour if not completed — check both server settings AND localStorage fallback
  useEffect(() => {
    if (!settings) return;
    // localStorage fallback: if server settings lost the flag, don't re-show tour
    const localDone = localStorage.getItem('senger_tour_completed') === '1';
    if (localDone || settings.onboardingCompleted) return;
    const t = setTimeout(() => setActive(true), 800);
    return () => clearTimeout(t);
  }, [settings]);

  // Track target element position
  useEffect(() => {
    if (!active) return;

    const step = STEPS[stepIdx];
    if (!step?.target) {
      setTargetRect(null);
      return;
    }

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
  }, [active, stepIdx]);

  // Measure tooltip size for positioning
  useEffect(() => {
    if (tooltipRef.current) {
      const r = tooltipRef.current.getBoundingClientRect();
      setTooltipSize({ w: r.width, h: r.height });
    }
  }, [stepIdx, active]);

  // Keyboard navigation
  useEffect(() => {
    if (!active) return;
    const handler = (e) => {
      if (e.key === 'Escape') handleSkip();
      else if (e.key === 'ArrowRight' || e.key === 'Enter') handleNext();
      else if (e.key === 'ArrowLeft') handleBack();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [active, stepIdx]);

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
    localStorage.setItem('senger_tour_completed', '1');
    await markTourCompleted();
  }, [markTourCompleted]);

  const handleFinish = useCallback(async () => {
    setActive(false);
    localStorage.setItem('senger_tour_completed', '1');
    await markTourCompleted();
  }, [markTourCompleted]);

  if (!active) return null;

  const step = STEPS[stepIdx];
  const isFirst = stepIdx === 0;
  const isLast = stepIdx === STEPS.length - 1;
  const isCentered = !step.target;
  const placement = step.placement || 'bottom';
  const pos = computeTooltipPosition(targetRect, placement, tooltipSize.w, tooltipSize.h);

  return createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex: 10000 }}>
      {/* Opaque overlay with spotlight cutout */}
      <SpotlightOverlay rect={targetRect} onClick={handleSkip} />

      {/* Tooltip card */}
      <div
        ref={tooltipRef}
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'fixed',
          top: pos.top,
          left: pos.left,
          width: isCentered ? 420 : 380,
          zIndex: 10001,
          background: 'linear-gradient(180deg, #1a1a1a 0%, #141414 100%)',
          border: '1px solid #2a2a2a',
          borderRadius: 12,
          padding: 0,
          boxShadow: '0 20px 60px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(255, 102, 0, 0.08)',
          fontFamily: 'var(--font-ui, -apple-system, BlinkMacSystemFont, sans-serif)',
          transition: 'top 300ms ease, left 300ms ease, opacity 200ms ease',
          animation: 'tour-fadein 300ms ease',
        }}
      >
        {/* Progress bar at top */}
        <div style={{
          height: 3, borderRadius: '12px 12px 0 0', overflow: 'hidden',
          background: '#1e1e1e',
        }}>
          <div style={{
            height: '100%',
            width: `${((stepIdx + 1) / STEPS.length) * 100}%`,
            background: 'linear-gradient(90deg, #F97316 0%, #ff8833 100%)',
            transition: 'width 400ms ease',
            borderRadius: '12px 12px 0 0',
          }} />
        </div>

        {/* Content */}
        <div style={{ padding: '20px 24px 16px' }}>
          {/* Step icon + title */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <div style={{
              width: 32, height: 32,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              borderRadius: 8,
              background: 'rgba(249, 115, 22, 0.12)',
              color: 'var(--color-particle, #F97316)',
              fontSize: 16,
              fontWeight: 700,
              flexShrink: 0,
            }}>
              {step.icon}
            </div>
            <div>
              <div style={{
                fontSize: 15, fontWeight: 700, color: '#ffffff',
                letterSpacing: '0.3px', lineHeight: 1.2,
              }}>
                {step.title}
              </div>
              <div style={{
                fontSize: 10, color: '#555', fontWeight: 500,
                letterSpacing: '1px', marginTop: 2,
                fontFamily: 'var(--font-mono, monospace)',
              }}>
                STEP {stepIdx + 1} OF {STEPS.length}
              </div>
            </div>
          </div>

          {/* Body text */}
          <div style={{
            fontSize: 13, lineHeight: 1.65, color: '#999',
            marginBottom: 18,
          }}>
            {step.body}
          </div>

          {/* Actions */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            borderTop: '1px solid #1e1e1e',
            paddingTop: 14,
          }}>
            <button
              onClick={handleSkip}
              style={{
                background: 'none', border: 'none', color: '#444',
                fontSize: 12, cursor: 'pointer', padding: '6px 0',
                fontFamily: 'inherit', letterSpacing: '0.3px',
              }}
              onMouseEnter={e => e.target.style.color = '#888'}
              onMouseLeave={e => e.target.style.color = '#444'}
            >
              Skip tour
            </button>
            <div style={{ flex: 1 }} />
            {!isFirst && (
              <button
                onClick={handleBack}
                style={{
                  background: 'none',
                  border: '1px solid #2a2a2a',
                  color: '#888',
                  fontSize: 12, fontWeight: 600,
                  padding: '7px 16px',
                  borderRadius: 6,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  letterSpacing: '0.3px',
                  transition: 'all 150ms ease',
                }}
                onMouseEnter={e => { e.target.style.borderColor = '#444'; e.target.style.color = '#ccc'; }}
                onMouseLeave={e => { e.target.style.borderColor = '#2a2a2a'; e.target.style.color = '#888'; }}
              >
                Back
              </button>
            )}
            <button
              onClick={isLast ? handleFinish : handleNext}
              style={{
                background: 'linear-gradient(180deg, #F97316 0%, #e55a00 100%)',
                border: 'none',
                color: '#000',
                fontSize: 12, fontWeight: 700,
                padding: '7px 20px',
                borderRadius: 6,
                cursor: 'pointer',
                fontFamily: 'inherit',
                letterSpacing: '0.5px',
                transition: 'all 150ms ease',
                boxShadow: '0 2px 8px rgba(249, 115, 22, 0.25)',
              }}
              onMouseEnter={e => { e.target.style.transform = 'translateY(-1px)'; e.target.style.boxShadow = '0 4px 12px rgba(249, 115, 22, 0.35)'; }}
              onMouseLeave={e => { e.target.style.transform = 'none'; e.target.style.boxShadow = '0 2px 8px rgba(249, 115, 22, 0.25)'; }}
            >
              {isLast ? 'Get Started' : 'Next'}
            </button>
          </div>
        </div>
      </div>

      {/* CSS animation */}
      <style>{`
        @keyframes tour-fadein {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>,
    document.body
  );
}
