/**
 * SectorScreenSelector.jsx
 * Full-width overlay panel showing 10 sector screen options.
 * Displays when user clicks "Sector Screens" button in header.
 *
 * Props:
 *   isOpen: boolean
 *   onClose: () => void
 *   onSelect: (screenId) => void
 *   activeScreen: string|null — currently active screen ID
 */

import { useState, useEffect, useCallback, memo } from 'react';

const SECTOR_SCREENS = [
  {
    id: 'defence',
    label: 'Defence & Aerospace',
    icon: '🛡️',
    thesis: 'NATO spending, Indo-Pacific, Ukraine restocking',
    color: '#66bb6a',
  },
  {
    id: 'commodities',
    label: 'Commodities',
    icon: '⛏️',
    thesis: 'Supercycle: underinvestment, green transition, geopolitics',
    color: '#ffb74d',
  },
  {
    id: 'brazil-em',
    label: 'Brazil & EM',
    icon: '🌎',
    thesis: 'B3, LatAm, ADR arbitrage, EM FX & rates',
    color: '#4caf50',
  },
  {
    id: 'technology',
    label: 'Technology',
    icon: '🤖',
    thesis: 'AI capex, semiconductors, mega-cap dominance',
    color: '#4fc3f7',
  },
  {
    id: 'global-macro',
    label: 'Global Macro',
    icon: '🌐',
    thesis: 'Cross-asset flows, central bank divergence, risk regimes',
    color: '#ce93d8',
  },
  {
    id: 'fixed-income',
    label: 'Fixed Income',
    icon: '📊',
    thesis: 'Yield curves, credit spreads, sovereign debt dynamics',
    color: '#90a4ae',
  },
  {
    id: 'global-retail',
    label: 'Global Retail',
    icon: '🛒',
    thesis: 'Consumer discretionary, staples, luxury, e-commerce',
    color: '#f48fb1',
  },
  {
    id: 'asian-markets',
    label: 'Asian Markets',
    icon: '🏯',
    thesis: 'Japan, China, India, Korea, ASEAN equities & FX',
    color: '#ef5350',
  },
  {
    id: 'european-markets',
    label: 'European Markets',
    icon: '🏰',
    thesis: 'DAX, CAC, FTSE, Nordic, Bund spreads, ECB path',
    color: '#5c6bc0',
  },
  {
    id: 'crypto',
    label: 'Crypto',
    icon: '₿',
    thesis: 'BTC, ETH, on-chain analytics, DeFi, ETF flows',
    color: '#ffa726',
  },
];

function SectorScreenSelector({ isOpen, onClose, onSelect, activeScreen }) {
  const [mounted, setMounted] = useState(false);

  // Handle ESC key
  useEffect(() => {
    if (!isOpen) return;

    const handleEsc = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [isOpen, onClose]);

  // Track mount state for animation
  useEffect(() => {
    if (isOpen) {
      setMounted(true);
    } else {
      // Delay unmount to allow exit animation
      const timer = setTimeout(() => setMounted(false), 150);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  // ALL hooks must be called before any early return
  const handleCardClick = useCallback(
    (screenId) => {
      onSelect(screenId);
    },
    [onSelect],
  );

  if (!mounted) return null;

  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div
      style={styles.overlay}
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-label="Sector Screens Selector"
    >
      <div style={styles.panel}>
        {/* Header */}
        <div style={styles.header}>
          <div style={styles.headerTitle}>SECTOR SCREENS</div>
          <button
            style={styles.closeButton}
            onClick={onClose}
            aria-label="Close sector screens"
            type="button"
          >
            ✕
          </button>
        </div>

        {/* Grid of screens */}
        <div style={styles.grid}>
          {SECTOR_SCREENS.map((screen) => {
            const isActive = activeScreen === screen.id;
            return (
              <button
                key={screen.id}
                style={{
                  ...styles.card,
                  ...(isActive ? styles.cardActive : styles.cardInactive),
                }}
                onClick={() => handleCardClick(screen.id)}
                onMouseEnter={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.background = '#1a1a1a';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.background = '#0d0d0d';
                  }
                }}
                type="button"
              >
                {/* Icon */}
                <div style={styles.iconWrapper}>
                  <div style={styles.icon}>{screen.icon}</div>
                </div>

                {/* Label */}
                <div style={styles.labelText}>{screen.label}</div>

                {/* Thesis */}
                <div style={styles.thesis}>{screen.thesis}</div>

                {/* Active indicator */}
                {isActive && (
                  <div
                    style={{
                      ...styles.indicator,
                      background: screen.color,
                    }}
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const styles = {
  // Overlay backdrop
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(0, 0, 0, 0.5)',
    display: 'flex',
    flexDirection: 'column',
    zIndex: 999,
    animation: 'sss-fade-in 0.15s ease-out',
  },

  // Main panel
  panel: {
    background: '#0d0d0d',
    borderBottom: '1px solid #1a1a1a',
    maxHeight: '80vh',
    overflowY: 'auto',
    animation: 'sss-slide-down 0.25s ease-out',
    borderLeft: '1px solid #1a1a1a',
    borderRight: '1px solid #1a1a1a',
  },

  // Header row
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '16px 20px',
    borderBottom: '1px solid #1a1a1a',
    background: '#0d0d0d',
    position: 'sticky',
    top: 0,
    zIndex: 10,
  },

  headerTitle: {
    fontSize: '13px',
    fontWeight: 700,
    letterSpacing: '0.8px',
    color: '#e0e0e0',
    fontFamily: 'var(--font-mono, \'IBM Plex Mono\', monospace)',
  },

  closeButton: {
    background: 'none',
    border: 'none',
    color: '#666',
    fontSize: '20px',
    cursor: 'pointer',
    padding: '0 4px',
    lineHeight: 1,
    transition: 'color 0.12s',
  },

  // Grid container
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: '12px',
    padding: '16px 20px',

    // Desktop: 5 columns
    '@media (min-width: 1200px)': {
      gridTemplateColumns: 'repeat(5, 1fr)',
    },
    // Tablet: 3 columns
    '@media (min-width: 768px) and (max-width: 1199px)': {
      gridTemplateColumns: 'repeat(3, 1fr)',
    },
    // Mobile: 2 columns
    '@media (max-width: 767px)': {
      gridTemplateColumns: 'repeat(2, 1fr)',
      gap: '10px',
      padding: '12px 12px',
    },
  },

  // Card button
  card: {
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '16px 12px',
    background: '#0d0d0d',
    border: '1px solid #1a1a1a',
    borderRadius: '6px',
    cursor: 'pointer',
    transition: 'all 0.15s ease-out',
    outline: 'none',
    textAlign: 'center',
  },

  cardInactive: {
    background: '#0d0d0d',
  },

  cardActive: {
    background: '#1a1a1a',
    borderColor: 'var(--accent, #ff6600)',
    boxShadow: '0 0 8px rgba(255, 102, 0, 0.2)',
  },

  // Icon wrapper
  iconWrapper: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: '8px',
    height: '40px',
  },

  icon: {
    fontSize: '28px',
    lineHeight: 1,
  },

  // Label (screen name)
  labelText: {
    fontSize: '12px',
    fontWeight: 600,
    color: '#e0e0e0',
    marginBottom: '6px',
    lineHeight: '1.2',
    minHeight: '24px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Thesis
  thesis: {
    fontSize: '10px',
    color: '#888',
    fontFamily: 'var(--font-mono, \'IBM Plex Mono\', monospace)',
    lineHeight: '1.3',
    minHeight: '24px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Active indicator (colored dot)
  indicator: {
    position: 'absolute',
    top: '6px',
    right: '6px',
    width: '8px',
    height: '8px',
    borderRadius: '50%',
  },
};

// Inject keyframe animations via a style tag
if (typeof document !== 'undefined' && !document.getElementById('sss-keyframes')) {
  const styleEl = document.createElement('style');
  styleEl.id = 'sss-keyframes';
  styleEl.textContent = `
    @keyframes sss-fade-in {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    @keyframes sss-slide-down {
      from { transform: translateY(-20px); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }
  `;
  document.head.appendChild(styleEl);
}

export default memo(SectorScreenSelector);
