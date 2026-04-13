/**
 * TickerContextMenu.jsx — Wave 13A: Right-click contextual AI for tickers.
 *
 * Intercepts right-click on any element with data-ticker attribute,
 * shows a floating menu with "Ask Particle about $TICKER".
 * Calls onAskParticle(ticker) when selected.
 */
import { useState, useEffect, useCallback } from 'react';
import ParticleLogo from '../ui/ParticleLogo';
import './TickerContextMenu.css';

export default function TickerContextMenu({ onAskParticle }) {
  const [menu, setMenu] = useState(null); // { x, y, ticker }

  const handleContextMenu = useCallback((e) => {
    // Walk up from target to find data-ticker or ticker-like text content
    let el = e.target;
    let ticker = null;

    for (let i = 0; i < 5 && el; i++) {
      // Check data-ticker attribute
      if (el.dataset?.ticker) {
        ticker = el.dataset.ticker;
        break;
      }
      // Check data-symbol attribute (used in many panels)
      if (el.dataset?.symbol) {
        ticker = el.dataset.symbol;
        break;
      }
      // Check if text matches a ticker pattern ($AAPL or just AAPL in a ticker context)
      const text = el.textContent?.trim();
      if (text && /^\$?[A-Z]{1,5}(\.[A-Z]{1,2})?$/.test(text) && el.closest('[data-ticker], [data-symbol], .ticker-cell, .price-row, .hpm-ticker-row')) {
        ticker = text.replace(/^\$/, '');
        break;
      }
      el = el.parentElement;
    }

    if (!ticker) return; // No ticker found — let default context menu show

    e.preventDefault();
    setMenu({
      x: Math.min(e.clientX, window.innerWidth - 220),
      y: Math.min(e.clientY, window.innerHeight - 100),
      ticker: ticker.replace(/^\$/, '').toUpperCase(),
    });
  }, []);

  const handleClick = useCallback(() => {
    setMenu(null);
  }, []);

  useEffect(() => {
    document.addEventListener('contextmenu', handleContextMenu);
    document.addEventListener('click', handleClick);
    document.addEventListener('scroll', handleClick, true);
    return () => {
      document.removeEventListener('contextmenu', handleContextMenu);
      document.removeEventListener('click', handleClick);
      document.removeEventListener('scroll', handleClick, true);
    };
  }, [handleContextMenu, handleClick]);

  if (!menu) return null;

  return (
    <div
      className="tcm-menu"
      style={{ left: menu.x, top: menu.y }}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        className="tcm-item tcm-item--particle"
        onClick={() => {
          onAskParticle(menu.ticker);
          setMenu(null);
        }}
      >
        <ParticleLogo size={16} />
        <span>Ask Particle about <strong>${menu.ticker}</strong></span>
      </button>
      <button
        className="tcm-item"
        onClick={() => {
          onAskParticle(`What's the bear case for $${menu.ticker}?`);
          setMenu(null);
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 2v20M2 12h20" />
        </svg>
        <span>Counter-thesis for <strong>${menu.ticker}</strong></span>
      </button>
      <div className="tcm-divider" />
      <button
        className="tcm-item"
        onClick={() => {
          if (typeof window !== 'undefined') {
            // Copy ticker to clipboard
            navigator.clipboard?.writeText(menu.ticker).catch(() => {});
          }
          setMenu(null);
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
        <span>Copy ticker</span>
      </button>
    </div>
  );
}
