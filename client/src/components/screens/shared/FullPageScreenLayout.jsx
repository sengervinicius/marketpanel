/**
 * FullPageScreenLayout.jsx
 * Upgraded version of DeepScreenBase designed for full-page sector screens.
 */
import { Component, useRef, useState, useEffect, memo } from 'react';
import { useIsMobile } from '../../../hooks/useIsMobile';
import { useScreenContext } from '../../../context/ScreenContext';
import { useTickerPrice } from '../../../context/PriceContext';
import AIInsightCard from '../../ai/AIInsightCard';
import VaultInsights from '../../common/VaultInsights';
import './ScreenShared.css';

/* ═══════════════════════════════════════════════════════════════════════
   LiveTickerBanner — Bloomberg TV-style horizontal scrolling ticker strip
   Sits below the screen header, shows ETFs/indices with live prices.
   CSS animation scrolls continuously; data updates in-place via hooks.
   ═══════════════════════════════════════════════════════════════════════ */
const BannerTick = memo(function BannerTick({ ticker, label, accentColor }) {
  const q = useTickerPrice(ticker);
  const isUp = q?.changePct != null ? q.changePct >= 0 : null;
  const displayTicker = (ticker || '')
    .replace(/^C:/, '').replace(/^X:/, '')
    .replace('.SA', '').replace('=F', '');

  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      padding: '0 16px',
      whiteSpace: 'nowrap',
      fontSize: 11,
      fontFamily: 'var(--font-mono)',
      letterSpacing: '0.3px',
    }}>
      <span style={{
        fontWeight: 700,
        color: accentColor || 'var(--text-primary)',
        fontSize: 10,
        letterSpacing: '0.5px',
      }}>
        {label || displayTicker}
      </span>
      <span style={{
        fontWeight: 600,
        color: 'var(--text-primary)',
        fontVariantNumeric: 'tabular-nums',
      }}>
        {q?.price != null
          ? q.price >= 1000
            ? q.price.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
            : q.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
          : '—'}
      </span>
      {q?.changePct != null && (
        <span style={{
          fontWeight: 700,
          fontSize: 10,
          color: isUp ? 'var(--semantic-up)' : 'var(--semantic-down)',
        }}>
          {isUp ? '▲' : '▼'} {Math.abs(q.changePct).toFixed(2)}%
        </span>
      )}
      <span style={{
        color: 'rgba(255,255,255,0.08)',
        fontSize: 8,
        padding: '0 4px',
      }}>│</span>
    </span>
  );
});

function LiveTickerBanner({ tickers = [], accentColor }) {
  if (!tickers || tickers.length === 0) return null;

  // Duplicate tickers for seamless scroll loop
  const tickerItems = tickers.map(t =>
    typeof t === 'string' ? { ticker: t } : t
  );

  return (
    <div style={{
      overflow: 'hidden',
      background: 'rgba(0,0,0,0.3)',
      borderBottom: '1px solid rgba(255,255,255,0.04)',
      height: 28,
      display: 'flex',
      alignItems: 'center',
      position: 'relative',
    }}>
      <div
        className="fsl-ticker-scroll"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          whiteSpace: 'nowrap',
        }}
      >
        {/* Render twice for seamless loop */}
        {[0, 1].map(pass => (
          <span key={pass} style={{ display: 'inline-flex', alignItems: 'center' }}>
            {tickerItems.map((t, i) => (
              <BannerTick
                key={`${pass}-${t.ticker}-${i}`}
                ticker={t.ticker}
                label={t.label}
                accentColor={accentColor}
              />
            ))}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * LazySection component that uses IntersectionObserver for lazy loading.
 * Renders a placeholder until the section enters the viewport (200px margin).
 */
function LazySection({ children }) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '200px' }
    );

    observer.observe(el);

    // Sprint 3: Force render after 5s even if not yet in viewport
    const fallbackTimer = setTimeout(() => setVisible(true), 5000);

    return () => {
      observer.disconnect();
      clearTimeout(fallbackTimer);
    };
  }, []);

  return (
    <div ref={ref}>
      {visible ? (
        children
      ) : (
        <div
          style={{
            minHeight: 120,
            background: 'linear-gradient(90deg, rgba(255,255,255,0.02) 25%, rgba(255,255,255,0.04) 50%, rgba(255,255,255,0.02) 75%)',
            backgroundSize: '200% 100%',
            animation: 'fsl-shimmer 1.8s ease-in-out infinite',
            borderRadius: 4,
            border: '1px solid rgba(255,255,255,0.03)',
          }}
        />
      )}
    </div>
  );
}

/**
 * Section-level error boundary with retry capability.
 * Wraps each individual section so a crash in one doesn't take down the whole screen.
 * Shows the section title, a visible error message, and a Retry button that remounts.
 */
class SectionErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error(`[SectionErrorBoundary] "${this.props.section || 'Unknown'}" crashed:`, error, info);
  }

  render() {
    if (this.state.hasError) {
      const sectionTitle = this.props.section || 'Section';
      return (
        <div style={{
          padding: '20px 16px',
          textAlign: 'center',
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border-subtle)',
          borderLeft: '3px solid var(--border-strong)',
          borderRadius: 4,
          minHeight: 80,
        }}>
          <div style={{
            fontSize: 11,
            fontWeight: 700,
            color: 'var(--text-primary)',
            textTransform: 'uppercase',
            letterSpacing: 0.5,
            marginBottom: 6,
          }}>
            {sectionTitle}
          </div>
          <div style={{ color: 'var(--text-muted)', fontSize: 11, fontWeight: 600, marginBottom: 4 }}>
            Loading issue
          </div>
          <div style={{ color: 'var(--text-secondary)', fontSize: 10, marginBottom: 10, maxWidth: 300, margin: '0 auto 10px' }}>
            Something went wrong loading this section. Try refreshing.
          </div>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            style={{
              background: 'var(--bg-active)',
              border: '1px solid var(--border-strong)',
              color: 'var(--text-secondary)',
              padding: '5px 16px',
              borderRadius: 4,
              cursor: 'pointer',
              fontSize: 10,
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: 0.8,
              transition: 'background 0.15s',
            }}
            onMouseEnter={e => e.target.style.background = 'var(--bg-hover)'}
            onMouseLeave={e => e.target.style.background = 'var(--bg-active)'}
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

/**
 * Section wrapper with sticky header, error boundary, and optional lazy loading.
 */
function ScreenSection({ id, title, badge, span, component: Component, isMobile, lazy, accentColor }) {
  const spanClass = !isMobile && span === 'full' ? 'fsl-section--full' : '';

  const content = (
    <SectionErrorBoundary section={title} accentColor={accentColor}>
      {typeof Component === 'function' || (Component && Component.$$typeof) ? <Component /> : Component}
    </SectionErrorBoundary>
  );

  return (
    <div key={id} className={`fsl-section ${spanClass}`}>
      <div className="fsl-section-head">
        <span className="fsl-section-title">{title}</span>
        {badge && <span className="fsl-section-badge">{badge}</span>}
      </div>
      <div className="fsl-section-body">
        {lazy ? <LazySection>{content}</LazySection> : content}
      </div>
    </div>
  );
}

/**
 * Main layout component for full-page sector screens.
 */
function FullPageScreenLayout({
  title,
  accentColor = '#ff6b00',
  subtitle,
  lastUpdated,
  onBack,
  sections = [],
  children,
  screenKey,
  visibleTickers = [],
  aiType,
  aiContext,
  aiCacheKey,
  tickerBanner,  // Array of { ticker, label } for Bloomberg-style scrolling banner
  vaultSector,   // Sector name for vault insights
}) {
  const isMobile = useIsMobile();
  const { updateScreen } = useScreenContext();

  // Update screen context on mount
  useEffect(() => {
    if (screenKey) {
      updateScreen(screenKey, title, visibleTickers);
    }
  }, [screenKey, title, visibleTickers, updateScreen]);

  const formattedTime = lastUpdated
    ? new Date(lastUpdated).toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    : null;

  return (
    <div className="fsl-screen">
      {/* Header */}
      <div className="fsl-header" style={{ borderLeftColor: accentColor }}>
        <div className="fsl-header-content">
          {onBack && (
            <button
              className="fsl-back-button"
              onClick={onBack}
              title="Back to home"
            >
              ← Back
            </button>
          )}
          <div className="fsl-header-text">
            <div className="fsl-header-title">{title}</div>
            {subtitle && <div className="fsl-header-subtitle">{subtitle}</div>}
          </div>
          {formattedTime && (
            <div className="fsl-header-time">
              Last updated
              <br />
              <span style={{ fontFamily: 'monospace', fontSize: 9 }}>{formattedTime}</span>
            </div>
          )}
        </div>
      </div>

      {/* Bloomberg-style Scrolling Ticker Banner */}
      {tickerBanner && tickerBanner.length > 0 && (
        <LiveTickerBanner tickers={tickerBanner} accentColor={accentColor} />
      )}

      {/* AI Insight — auto-fetch on mount */}
      {aiType && (
        <div style={{ padding: '0 1px', marginBottom: 1 }}>
          <AIInsightCard
            type={aiType}
            context={aiContext}
            cacheKey={aiCacheKey || `${aiType}:${title}`}
            compact={isMobile}
            autoFetch={true}
          />
        </div>
      )}

      {/* Vault Research Insights */}
      {vaultSector && (
        <div style={{ padding: '0 1px', marginBottom: 1 }}>
          <VaultInsights sector={vaultSector} />
        </div>
      )}

      {/* Grid */}
      <div className={`fsl-grid ${isMobile ? 'fsl-grid--mobile' : 'fsl-grid--desktop'}`}>
        {sections.map((sec, idx) => (
          <ScreenSection
            key={sec.id}
            id={sec.id}
            title={sec.title}
            badge={sec.badge}
            span={sec.span}
            component={sec.component}
            isMobile={isMobile}
            lazy={idx >= 2}
            accentColor={accentColor}
          />
        ))}
      </div>

      {/* Children (ETF strips, additional content) */}
      {children && (
        <div className="fsl-children">
          {children}
        </div>
      )}
    </div>
  );
}

export default FullPageScreenLayout;
