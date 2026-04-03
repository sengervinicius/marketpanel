/**
 * PanelErrorBoundary.jsx
 * Lightweight per-panel error boundary that catches render crashes
 * and displays an inline error message instead of crashing the entire app.
 */
import { Component } from 'react';

export default class PanelErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error(
      `[PanelErrorBoundary] ${this.props.name || 'Panel'} crashed:`,
      error,
      errorInfo
    );
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          minHeight: 80,
          gap: 8,
          padding: 16,
          color: '#888',
          fontFamily: 'var(--font-ui, monospace)',
          fontSize: 11,
          textAlign: 'center',
        }}>
          <span style={{ color: '#f44336', fontWeight: 600, fontSize: 12 }}>
            {this.props.name || 'Panel'} crashed
          </span>
          <span style={{ color: '#666', fontSize: 10, maxWidth: 300, wordBreak: 'break-word' }}>
            {this.state.error?.message || 'Unknown error'}
          </span>
          <button
            onClick={this.handleRetry}
            style={{
              marginTop: 4,
              background: 'transparent',
              border: '1px solid #555',
              color: '#aaa',
              padding: '4px 12px',
              borderRadius: 3,
              cursor: 'pointer',
              fontSize: 10,
              letterSpacing: '0.5px',
            }}
          >
            RETRY
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
