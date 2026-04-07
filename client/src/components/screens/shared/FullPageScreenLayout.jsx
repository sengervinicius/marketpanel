/**
 * FullPageScreenLayout.jsx
 * Upgraded version of DeepScreenBase designed for full-page sector screens.
 */
import { Component, useRef, useState, useEffect } from 'react';
import { useIsMobile } from '../../../hooks/useIsMobile';
import './ScreenShared.css';

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
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref}>
      {visible ? (
        children
      ) : (
        <div
          style={{
            minHeight: 120,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div style={{ textAlign: 'center' }}>
            <div style={{
              width: 24, height: 24, margin: '0 auto 8px',
              border: '2px solid #333', borderTopColor: '#888',
              borderRadius: '50%',
              animation: 'fsl-spin 0.8s linear infinite',
            }} />
            <span style={{
              color: '#888',
              fontSize: 9,
              fontWeight: 600,
              letterSpacing: '0.5px',
              textTransform: 'uppercase',
            }}>
              Loading...
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Section-level error boundary with retry capability.
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
    console.error(`[FullPageScreenLayout] ${this.props.section || 'Section'} error:`, error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: '12px 8px',
          color: '#888',
          fontSize: 10,
          textAlign: 'center',
          background: '#0a0a0a',
        }}>
          <span style={{ color: '#ef5350' }}>Failed to load section</span>
          <div style={{ color: '#555', marginTop: 4, fontSize: 9 }}>
            {this.state.error?.message || 'Unknown error'}
          </div>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            style={{
              marginTop: 6,
              background: 'transparent',
              border: '1px solid #444',
              color: '#aaa',
              padding: '3px 10px',
              borderRadius: 3,
              cursor: 'pointer',
              fontSize: 9,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: 0.5,
            }}
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
function ScreenSection({ id, title, badge, span, component: Component, isMobile, lazy }) {
  const spanClass = !isMobile && span === 'full' ? 'fsl-section--full' : '';

  const content = (
    <SectionErrorBoundary section={title}>
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
}) {
  const isMobile = useIsMobile();

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
