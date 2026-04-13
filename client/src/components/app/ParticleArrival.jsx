/**
 * ParticleArrival.jsx — Cinematic first-launch experience
 *
 * Timing sequence:
 *   0ms:     Pure black screen
 *   200ms:   Particle logo fades in over 800ms (fully visible by 1000ms)
 *   2500ms:  Text: "This is Particle." fades in
 *   3300ms:  Second text: "Every market. Every insight. Tailored to you." fades in
 *   4500ms:  Both text lines fade out over 500ms
 *   5500ms:  Search bar slides up from below (200ms animation)
 *   5900ms:  Suggestion text appears below search bar
 *
 * User can:
 *   - Tap anywhere to skip to search bar state
 *   - Type and submit search query to complete the arrival
 */
import { useState, useEffect, useRef } from 'react';
import ParticleLogo from '../ui/ParticleLogo';
import './ParticleArrival.css';

export default function ParticleArrival({ onComplete }) {
  const [phase, setPhase] = useState(0);
  // phase 0: black void
  // phase 1: logo visible
  // phase 2: text visible
  // phase 3: text fading out
  // phase 4: search bar visible (final state)

  const [query, setQuery] = useState('');
  const [hasSkipped, setHasSkipped] = useState(false);
  const searchInputRef = useRef(null);

  // Main timing sequence
  useEffect(() => {
    const timers = [];

    // 200ms: Start logo fade-in (phase 1)
    timers.push(setTimeout(() => setPhase(1), 200));

    // 2500ms: Text appears (phase 2)
    timers.push(setTimeout(() => setPhase(2), 2500));

    // 4500ms: Text starts fading out (phase 3)
    timers.push(setTimeout(() => setPhase(3), 4500));

    // 5500ms: Search bar appears (phase 4)
    timers.push(setTimeout(() => {
      setPhase(4);
      // Focus search input on next tick
      setTimeout(() => searchInputRef.current?.focus(), 50);
    }, 5500));

    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  // Handle tap-anywhere skip to phase 4
  const handleOverlayClick = () => {
    if (phase < 4) {
      setPhase(4);
      setHasSkipped(true);
      setTimeout(() => searchInputRef.current?.focus(), 50);
    }
  };

  // Handle search submission
  const handleSearchSubmit = (e) => {
    e.preventDefault();
    if (query.trim()) {
      onComplete?.();
    }
  };

  return (
    <div
      className="pa-overlay"
      onClick={handleOverlayClick}
      role="presentation"
    >
      {/* Phase 0-3: Logo and text content */}
      {phase < 4 && (
        <div className="pa-content">
          {/* Logo: fades in starting at 200ms, fully visible by 1000ms */}
          <div
            className="pa-logo-wrap"
            style={{
              opacity: phase >= 1 ? 1 : 0,
              transition: phase === 1 ? 'opacity 800ms ease-out' : 'none',
            }}
          >
            <ParticleLogo size={80} glow />
          </div>

          {/* Text: "This is Particle." */}
          <div
            className="pa-text-primary"
            style={{
              opacity: phase >= 2 ? (phase === 3 ? 0 : 1) : 0,
              transition:
                phase === 2 ? 'opacity 400ms ease-out' :
                phase === 3 ? 'opacity 500ms ease-out' :
                'none',
            }}
          >
            This is Particle.
          </div>

          {/* Text: "Every market. Every insight. Tailored to you." */}
          <div
            className="pa-text-secondary"
            style={{
              opacity: phase >= 2 ? (phase === 3 ? 0 : 1) : 0,
              transition:
                phase === 2 ? 'opacity 400ms ease-out 200ms' :
                phase === 3 ? 'opacity 500ms ease-out' :
                'none',
            }}
          >
            Every market. Every insight. Tailored to you.
          </div>
        </div>
      )}

      {/* Phase 4: Search bar state */}
      {phase >= 4 && (
        <div className="pa-search-container">
          <div
            className="pa-search-wrap"
            style={{
              opacity: 1,
              transform: 'translateY(0)',
              transition: phase === 4 ? 'all 200ms ease-out' : 'none',
            }}
          >
            {/* Search bar pill */}
            <form onSubmit={handleSearchSubmit} className="pa-search-form">
              <div className="pa-search-bar">
                <ParticleLogo size={16} glow={false} />
                <input
                  ref={searchInputRef}
                  type="text"
                  className="pa-search-input"
                  placeholder="What is happening in markets today?"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  autoComplete="off"
                />
              </div>
            </form>

            {/* Skip / Enter Terminal link */}
            <button
              className="pa-skip-btn"
              onClick={(e) => { e.stopPropagation(); onComplete?.(); }}
            >
              Skip — Enter Terminal →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
