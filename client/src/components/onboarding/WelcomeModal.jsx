/**
 * WelcomeModal.jsx
 * A friendly welcome modal for new users landing on their home screen.
 * Replaces OnboardingPresets and OnboardingTourOverlay with a simpler, warmer experience.
 *
 * Features:
 * - Dark terminal theme with semi-transparent backdrop
 * - Fade/scale animation on entry
 * - Dismissible via "Got it!" button, ESC key, or clicking outside
 * - All inline styles (no external CSS)
 */

import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';

export default function WelcomeModal({ username: usernameProp, onDismiss }) {
  const { user } = useAuth();
  const [isVisible, setIsVisible] = useState(true);
  const [shouldAnimate, setShouldAnimate] = useState(false);
  const [isButtonHovered, setIsButtonHovered] = useState(false);

  const displayUsername = usernameProp || user?.username || 'Trader';

  // Trigger animation on mount
  useEffect(() => {
    setShouldAnimate(true);
  }, []);

  // Handle ESC key press
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        handleDismiss();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleDismiss = () => {
    setIsVisible(false);
    if (onDismiss) {
      onDismiss();
    }
  };

  const handleBackdropClick = (e) => {
    // Only dismiss if clicking directly on the backdrop, not the card
    if (e.target === e.currentTarget) {
      handleDismiss();
    }
  };

  if (!isVisible) {
    return null;
  }

  return (
    <div
      style={styles.backdrop}
      className={shouldAnimate ? 'animate-fade-in' : ''}
      onClick={handleBackdropClick}
    >
      <style>{`
        @keyframes fadeIn {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }

        @keyframes slideScaleIn {
          from {
            opacity: 0;
            transform: scale(0.95) translateY(-10px);
          }
          to {
            opacity: 1;
            transform: scale(1) translateY(0);
          }
        }

        .animate-fade-in {
          animation: fadeIn 300ms ease-out;
        }

        .animate-fade-in .welcome-card {
          animation: slideScaleIn 400ms ease-out;
        }
      `}</style>

      <div style={styles.card} className="welcome-card">
        {/* Title */}
        <h1 style={styles.title}>
          Welcome to your Home Screen, {displayUsername}!
        </h1>

        {/* Description */}
        <p style={styles.description}>
          This is YOUR workspace — customize it however you like.
        </p>

        {/* Tips */}
        <ul style={styles.tipsList}>
          <li style={styles.tipItem}>
            Drag panels to rearrange your layout
          </li>
          <li style={styles.tipItem}>
            Click ⇄ LAYOUT in the header to add or remove panels
          </li>
          <li style={styles.tipItem}>
            Hit "Sector Screens" to deep-dive into specific markets
          </li>
          <li style={styles.tipItem}>
            Everything auto-saves as you go
          </li>
        </ul>

        {/* Got it Button */}
        <button
          style={{
            ...styles.button,
            ...(isButtonHovered ? {
              background: '#ff7722',
              boxShadow: '0 6px 16px rgba(255, 102, 0, 0.3)',
            } : {}),
          }}
          onClick={handleDismiss}
          onMouseEnter={() => setIsButtonHovered(true)}
          onMouseLeave={() => setIsButtonHovered(false)}
        >
          Got it!
        </button>

        {/* Hint text */}
        <p style={styles.hint}>
          Press ESC or click outside to dismiss
        </p>
      </div>
    </div>
  );
}

const styles = {
  backdrop: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0, 0, 0, 0.65)',
    zIndex: 9999,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '20px',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  },
  card: {
    background: '#111111',
    border: '1px solid #222222',
    borderRadius: '8px',
    padding: '48px 44px 40px',
    maxWidth: '500px',
    width: '100%',
    boxShadow: '0 20px 60px rgba(0, 0, 0, 0.4)',
  },
  title: {
    fontSize: '24px',
    fontWeight: 600,
    color: '#e8e8e8',
    margin: '0 0 16px 0',
    lineHeight: 1.3,
    letterSpacing: '-0.3px',
  },
  description: {
    fontSize: '14px',
    color: '#999999',
    margin: '0 0 28px 0',
    lineHeight: 1.6,
    fontWeight: 400,
  },
  tipsList: {
    listStyle: 'none',
    margin: '0 0 32px 0',
    padding: 0,
  },
  tipItem: {
    fontSize: '13px',
    color: '#b0b0b0',
    margin: '0 0 12px 0',
    lineHeight: 1.5,
    paddingLeft: '20px',
    position: 'relative',
    fontWeight: 400,
  },
  tipItemBullet: {
    position: 'absolute',
    left: '0',
    color: 'var(--color-particle, #F97316)',
    fontWeight: 700,
  },
  button: {
    background: 'var(--color-particle, #F97316)',
    color: '#000000',
    border: 'none',
    padding: '12px 40px',
    fontSize: '14px',
    fontWeight: 600,
    letterSpacing: '0.5px',
    cursor: 'pointer',
    borderRadius: '4px',
    width: '100%',
    marginBottom: '16px',
    transition: 'all 200ms ease-out',
    boxShadow: '0 4px 12px rgba(255, 102, 0, 0.2)',
  },
  hint: {
    fontSize: '11px',
    color: '#666666',
    margin: 0,
    textAlign: 'center',
    letterSpacing: '0.3px',
    textTransform: 'uppercase',
    fontWeight: 500,
  },
};

