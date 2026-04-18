/**
 * LandingPage.jsx
 *
 * Minimal, aesthetic landing page for Particle Market Terminal.
 * Inspired by Flow and Nine to Five design principles:
 * - Extreme whitespace (dark space in our case)
 * - Bold, oversized typography as hero
 * - Ultra-minimal copy
 * - One clear CTA
 * - Scroll-based reveals
 * - 2-3 colors maximum
 * - No visual noise
 */

import { useEffect, useRef, useState } from 'react';

const COLORS = {
  bg: '#050507',
  textPrimary: '#ffffff',
  textSecondary: '#666666',
  textTertiary: '#333333',
  accent: '#F97316',
};

/**
 * Intersection Observer hook for scroll-based animations
 */
function useScrollReveal() {
  const [visibleIds, setVisibleIds] = useState(new Set());
  const elementRefs = useRef({});

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const newVisible = new Set(visibleIds);
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            newVisible.add(entry.target.id);
          }
        });
        setVisibleIds(newVisible);
      },
      { threshold: 0.15, rootMargin: '0px 0px -100px 0px' }
    );

    Object.values(elementRefs.current).forEach((el) => {
      if (el) observer.observe(el);
    });

    return () => observer.disconnect();
  }, [visibleIds]);

  const registerRef = (id) => (el) => {
    elementRefs.current[id] = el;
  };

  return { visibleIds, registerRef };
}

/**
 * Animated reveal container
 */
function RevealElement({ id, children, delay = 0, visible }) {
  return (
    <div
      id={id}
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(20px)',
        transition: `opacity 0.8s ease ${delay}ms, transform 0.8s ease ${delay}ms`,
      }}
    >
      {children}
    </div>
  );
}

/**
 * Main landing page component
 * Shown to unauthenticated users. The LoginScreen modal is rendered
 * above this page in the component tree and handles authentication.
 */
export default function LandingPage() {
  const { visibleIds, registerRef } = useScrollReveal();
  const [isScrolledPast, setIsScrolledPast] = useState(false);

  // Handle scroll indicator fade
  useEffect(() => {
    const handleScroll = () => {
      setIsScrolledPast(window.scrollY > 50);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Scroll to top to reveal LoginScreen modal
  const handleStartTrial = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div style={{ background: COLORS.bg, color: COLORS.textPrimary, fontFamily: 'system-ui, -apple-system, sans-serif', lineHeight: 1.6 }}>
      {/* ─────────────────────────────────────────────────────────────────────── */}
      {/* SECTION 1: HERO (100vh) */}
      {/* ─────────────────────────────────────────────────────────────────────── */}
      <section
        style={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
          padding: '40px 20px',
        }}
      >
        {/* Header nav */}
        <div
          style={{
            position: 'absolute',
            top: 40,
            left: 0,
            right: 0,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            paddingLeft: 32,
            paddingRight: 32,
            maxWidth: '100%',
            boxSizing: 'border-box',
          }}
        >
          <div style={{ fontSize: 11, letterSpacing: '3px', fontWeight: 700, color: COLORS.accent }}>PARTICLE</div>
          <button
            onClick={handleStartTrial}
            style={{
              background: 'none',
              border: 'none',
              color: COLORS.textSecondary,
              fontSize: 13,
              cursor: 'pointer',
              transition: 'color 0.3s ease',
            }}
            onMouseEnter={(e) => (e.target.style.color = COLORS.textPrimary)}
            onMouseLeave={(e) => (e.target.style.color = COLORS.textSecondary)}
          >
            Sign In
          </button>
        </div>

        {/* Hero content */}
        <div style={{ textAlign: 'center', maxWidth: 800 }}>
          <h1
            ref={registerRef('hero-headline')}
            style={{
              fontSize: 'clamp(36px, 8vw, 56px)',
              fontWeight: 300,
              margin: '0 0 24px 0',
              letterSpacing: '-1px',
              opacity: 1,
              transform: 'translateY(0)',
            }}
          >
            See the market clearly.
          </h1>

          <p
            ref={registerRef('hero-subtitle')}
            style={{
              fontSize: 16,
              color: COLORS.textSecondary,
              margin: '0 0 40px 0',
              fontWeight: 400,
              maxWidth: 600,
              marginLeft: 'auto',
              marginRight: 'auto',
              opacity: visibleIds.has('hero-subtitle') ? 1 : 0,
              transform: visibleIds.has('hero-subtitle') ? 'translateY(0)' : 'translateY(20px)',
              transition: 'opacity 0.8s ease 100ms, transform 0.8s ease 100ms',
            }}
          >
            Real-time terminal. AI insights. Every asset class.
          </p>

          <button
            onClick={handleStartTrial}
            style={{
              background: COLORS.accent,
              color: '#0a0a0f',
              border: 'none',
              padding: '12px 36px',
              fontSize: 14,
              fontWeight: 600,
              borderRadius: 4,
              cursor: 'pointer',
              letterSpacing: '0.5px',
              transition: 'all 0.3s ease',
              boxShadow: `0 0 20px ${COLORS.accent}00`,
              opacity: visibleIds.has('hero-cta') ? 1 : 0,
              transform: visibleIds.has('hero-cta') ? 'translateY(0)' : 'translateY(20px)',
            }}
            ref={registerRef('hero-cta')}
            onMouseEnter={(e) => {
              e.target.style.boxShadow = `0 0 30px ${COLORS.accent}66`;
              e.target.style.transform = 'translateY(-2px)';
            }}
            onMouseLeave={(e) => {
              e.target.style.boxShadow = `0 0 20px ${COLORS.accent}00`;
              e.target.style.transform = 'translateY(0)';
            }}
          >
            Start Free Trial
          </button>
        </div>

        {/* Scroll indicator */}
        <div
          style={{
            position: 'absolute',
            bottom: 40,
            opacity: isScrolledPast ? 0 : 1,
            transition: 'opacity 0.6s ease',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <div style={{ fontSize: 11, color: COLORS.textTertiary, letterSpacing: '1px' }}>SCROLL</div>
          <div
            style={{
              width: 1,
              height: 24,
              background: `linear-gradient(to bottom, ${COLORS.accent}, transparent)`,
              animation: 'scroll-pulse 2s ease-in-out infinite',
            }}
          />
        </div>
      </section>

      {/* ─────────────────────────────────────────────────────────────────────── */}
      {/* SECTION 2: PRODUCT PREVIEW (~90vh) */}
      {/* ─────────────────────────────────────────────────────────────────────── */}
      <section
        style={{
          minHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '80px 20px',
          gap: 32,
        }}
      >
        {/* Terminal mockup */}
        <div
          ref={registerRef('product-mockup')}
          style={{
            width: '100%',
            maxWidth: 1000,
            aspectRatio: '16 / 9',
            background: '#0f0f14',
            border: `1px solid ${COLORS.textTertiary}`,
            borderRadius: 8,
            position: 'relative',
            overflow: 'hidden',
            opacity: visibleIds.has('product-mockup') ? 1 : 0,
            transform: visibleIds.has('product-mockup') ? 'translateY(0)' : 'translateY(40px)',
            transition: 'opacity 0.8s ease 200ms, transform 0.8s ease 200ms, box-shadow 0.6s ease',
            boxShadow: visibleIds.has('product-mockup')
              ? `inset 0 0 1px ${COLORS.accent}30, 0 0 40px ${COLORS.accent}15`
              : `inset 0 0 1px ${COLORS.accent}00, 0 0 40px ${COLORS.accent}00`,
            cursor: 'pointer',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.boxShadow = `inset 0 0 1px ${COLORS.accent}50, 0 0 50px ${COLORS.accent}25`;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.boxShadow = `inset 0 0 1px ${COLORS.accent}30, 0 0 40px ${COLORS.accent}15`;
          }}
        >
          {/* Grid background pattern */}
          <svg
            width="100%"
            height="100%"
            style={{ position: 'absolute', inset: 0 }}
            preserveAspectRatio="none"
          >
            <defs>
              <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#1a1a20" strokeWidth="0.5" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#grid)" />
          </svg>

          {/* Mockup content */}
          <div style={{ position: 'relative', zIndex: 1, padding: 24, height: '100%', display: 'flex', flexDirection: 'column' }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 24, paddingBottom: 16, borderBottom: `1px solid ${COLORS.textTertiary}` }}>
              <div style={{ fontSize: 11, color: COLORS.textSecondary, letterSpacing: '1px' }}>MARKET TERMINAL</div>
              <div style={{ fontSize: 11, color: COLORS.accent, fontWeight: 700 }}>LIVE</div>
            </div>

            {/* Data panels grid */}
            <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, minHeight: 0 }}>
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div
                  key={i}
                  style={{
                    background: 'rgba(255, 102, 0, 0.04)',
                    border: `1px solid ${COLORS.textTertiary}`,
                    borderRadius: 4,
                    padding: 12,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                  }}
                >
                  <div style={{ height: 4, background: COLORS.accent, borderRadius: 2, width: '40%', opacity: 0.3 }} />
                  <div style={{ height: 2, background: COLORS.textTertiary, borderRadius: 1, width: '100%', opacity: 0.2 }} />
                  <div style={{ height: 2, background: COLORS.textTertiary, borderRadius: 1, width: '80%', opacity: 0.2 }} />
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Description */}
        <p
          ref={registerRef('product-desc')}
          style={{
            fontSize: 13,
            color: COLORS.textSecondary,
            textAlign: 'center',
            margin: 0,
            fontFamily: "'SF Mono', Menlo, monospace",
            letterSpacing: '0.5px',
            opacity: visibleIds.has('product-desc') ? 1 : 0,
            transform: visibleIds.has('product-desc') ? 'translateY(0)' : 'translateY(20px)',
            transition: 'opacity 0.8s ease 300ms, transform 0.8s ease 300ms',
          }}
        >
          10 sector screens. Live feeds. AI-powered search.
        </p>
      </section>

      {/* ─────────────────────────────────────────────────────────────────────── */}
      {/* SECTION 3: FEATURES (compact, no cards) */}
      {/* ─────────────────────────────────────────────────────────────────────── */}
      <section
        style={{
          minHeight: '80vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '80px 20px',
        }}
      >
        <div style={{ maxWidth: 600, width: '100%' }}>
          {[
            'Real-time data across equities, FX, crypto, commodities, and fixed income',
            'AI chat that understands your portfolio context',
            'Bloomberg-grade sector screens with deep analytics',
            'Customize every panel — your workspace, your rules',
          ].map((feature, idx) => (
            <div
              key={idx}
              ref={registerRef(`feature-${idx}`)}
              style={{
                display: 'flex',
                gap: 16,
                marginBottom: 48,
                opacity: visibleIds.has(`feature-${idx}`) ? 1 : 0,
                transform: visibleIds.has(`feature-${idx}`) ? 'translateY(0)' : 'translateY(20px)',
                transition: `opacity 0.8s ease ${200 + idx * 100}ms, transform 0.8s ease ${200 + idx * 100}ms`,
              }}
            >
              <div
                style={{
                  minWidth: 6,
                  height: 6,
                  background: COLORS.accent,
                  borderRadius: '50%',
                  marginTop: 8,
                  flexShrink: 0,
                }}
              />
              <p style={{ fontSize: 16, color: COLORS.textSecondary, margin: 0, lineHeight: 1.6 }}>
                {feature}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* ─────────────────────────────────────────────────────────────────────── */}
      {/* SECTION 4: SOCIAL PROOF / TRUST */}
      {/* ─────────────────────────────────────────────────────────────────────── */}
      <section
        style={{
          minHeight: '60vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '80px 20px',
          textAlign: 'center',
        }}
      >
        <div
          ref={registerRef('trust-headline')}
          style={{
            opacity: visibleIds.has('trust-headline') ? 1 : 0,
            transform: visibleIds.has('trust-headline') ? 'translateY(0)' : 'translateY(20px)',
            transition: 'opacity 0.8s ease 200ms, transform 0.8s ease 200ms',
          }}
        >
          <p style={{ fontSize: 16, color: COLORS.textSecondary, margin: '0 0 16px 0' }}>
            Used by traders in 40+ countries
          </p>
          <p
            style={{
              fontSize: 12,
              color: COLORS.textTertiary,
              margin: 0,
              letterSpacing: '0.5px',
            }}
          >
            Independent Traders • Hedge Funds • Family Offices
          </p>
        </div>
      </section>

      {/* ─────────────────────────────────────────────────────────────────────── */}
      {/* SECTION 5: FINAL CTA + FOOTER */}
      {/* ─────────────────────────────────────────────────────────────────────── */}
      <section
        style={{
          minHeight: '50vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '80px 20px',
          gap: 40,
          borderTop: `1px solid ${COLORS.textTertiary}`,
        }}
      >
        <div ref={registerRef('final-headline')} style={{ textAlign: 'center' }}>
          <h2
            style={{
              fontSize: 'clamp(32px, 6vw, 48px)',
              fontWeight: 300,
              margin: 0,
              letterSpacing: '-0.5px',
              color: COLORS.textPrimary,
              opacity: visibleIds.has('final-headline') ? 1 : 0,
              transform: visibleIds.has('final-headline') ? 'translateY(0)' : 'translateY(20px)',
              transition: 'opacity 0.8s ease 200ms, transform 0.8s ease 200ms',
            }}
          >
            Your edge starts here.
          </h2>
        </div>

        <button
          onClick={handleStartTrial}
          ref={registerRef('final-cta')}
          style={{
            background: COLORS.accent,
            color: '#0a0a0f',
            border: 'none',
            padding: '12px 36px',
            fontSize: 14,
            fontWeight: 600,
            borderRadius: 4,
            cursor: 'pointer',
            letterSpacing: '0.5px',
            transition: 'all 0.3s ease',
            boxShadow: `0 0 20px ${COLORS.accent}00`,
            opacity: visibleIds.has('final-cta') ? 1 : 0,
            transform: visibleIds.has('final-cta') ? 'translateY(0)' : 'translateY(20px)',
          }}
          onMouseEnter={(e) => {
            e.target.style.boxShadow = `0 0 30px ${COLORS.accent}66`;
            e.target.style.transform = 'translateY(-2px)';
          }}
          onMouseLeave={(e) => {
            e.target.style.boxShadow = `0 0 20px ${COLORS.accent}00`;
            e.target.style.transform = 'translateY(0)';
          }}
        >
          Start Free Trial
        </button>

        {/* Footer */}
        <footer
          style={{
            textAlign: 'center',
            fontSize: 11,
            color: COLORS.textTertiary,
            marginTop: 40,
            paddingTop: 40,
            borderTop: `1px solid ${COLORS.textTertiary}`,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            width: '100%',
          }}
        >
          <div>© 2026 Particle</div>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 16, flexWrap: 'wrap' }}>
            <a
              href="/privacy"
              style={{
                color: COLORS.textTertiary,
                textDecoration: 'none',
                transition: 'color 0.3s ease',
              }}
              onMouseEnter={(e) => (e.target.style.color = COLORS.textSecondary)}
              onMouseLeave={(e) => (e.target.style.color = COLORS.textTertiary)}
            >
              Privacy
            </a>
            <a
              href="/terms"
              style={{
                color: COLORS.textTertiary,
                textDecoration: 'none',
                transition: 'color 0.3s ease',
              }}
              onMouseEnter={(e) => (e.target.style.color = COLORS.textSecondary)}
              onMouseLeave={(e) => (e.target.style.color = COLORS.textTertiary)}
            >
              Terms
            </a>
            <a
              href="https://status.particle.investments"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                color: COLORS.textTertiary,
                textDecoration: 'none',
                transition: 'color 0.3s ease',
              }}
              onMouseEnter={(e) => (e.target.style.color = COLORS.textSecondary)}
              onMouseLeave={(e) => (e.target.style.color = COLORS.textTertiary)}
            >
              Status
            </a>
            <a
              href="https://roadmap.particle.investments"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                color: COLORS.textTertiary,
                textDecoration: 'none',
                transition: 'color 0.3s ease',
              }}
              onMouseEnter={(e) => (e.target.style.color = COLORS.textSecondary)}
              onMouseLeave={(e) => (e.target.style.color = COLORS.textTertiary)}
            >
              Roadmap
            </a>
          </div>
        </footer>
      </section>

      {/* ─────────────────────────────────────────────────────────────────────── */}
      {/* STYLES (keyframes) */}
      {/* ─────────────────────────────────────────────────────────────────────── */}
      <style>{`
        @keyframes scroll-pulse {
          0%, 100% {
            opacity: 1;
            transform: translateY(0);
          }
          50% {
            opacity: 0.4;
            transform: translateY(4px);
          }
        }

        * {
          box-sizing: border-box;
        }

        html, body {
          margin: 0;
          padding: 0;
          scroll-behavior: smooth;
        }

        a {
          color: inherit;
        }

        button {
          font-family: inherit;
        }
      `}</style>
    </div>
  );
}
