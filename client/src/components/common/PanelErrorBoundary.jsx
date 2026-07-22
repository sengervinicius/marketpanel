/**
 * PanelErrorBoundary.jsx
 * Lightweight per-panel error boundary that catches render crashes
 * and displays an inline error message instead of crashing the entire app.
 *
 * Chunk-aware: a stale-deploy chunk 404 ("Failed to fetch dynamically imported
 * module") is NOT a panel bug — the tab holds old chunk hashes after a new
 * client deploy. The old RETRY button just re-imported the same dead chunk, so
 * every panel stayed broken until a manual hard-refresh. Now we auto-reload
 * once (short guard against loops) and the button does a real page reload.
 */
import { Component } from 'react';

function isChunkLoadError(err) {
  if (!err) return false;
  const name = err.name || '';
  const msg = String(err.message || '');
  return (
    name === 'ChunkLoadError' ||
    /Failed to fetch dynamically imported module/i.test(msg) ||
    /Loading chunk [\d]+ failed/i.test(msg) ||
    /Importing a module script failed/i.test(msg) ||
    /dynamically imported module/i.test(msg)
  );
}

const RELOAD_KEY = 'particle_boundary_reload';
function reloadedRecently() {
  try { return Date.now() - Number(sessionStorage.getItem(RELOAD_KEY) || 0) < 20000; }
  catch { return false; }
}
function markReload() {
  try { sessionStorage.setItem(RELOAD_KEY, String(Date.now())); } catch { /* storage off */ }
}

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
    // Stale-deploy chunk 404 -> fetch the fresh bundle. Guarded so a genuinely
    // missing chunk can't spin a reload loop (after one reload we fall through
    // to the RELOAD button instead).
    if (isChunkLoadError(error) && !reloadedRecently()) {
      markReload();
      window.location.reload();
    }
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      const chunk = isChunkLoadError(this.state.error);
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
          fontFamily: 'var(--font-ui)',
          fontSize: 11,
          textAlign: 'center',
        }}>
          <span style={{ color: 'var(--color-text-secondary)', fontWeight: 600, fontSize: 12 }}>
            {chunk ? 'Updating to the latest version…' : `${this.props.name || 'Panel'} — loading issue`}
          </span>
          <span style={{ color: '#666', fontSize: 10, maxWidth: 300, wordBreak: 'break-word' }}>
            {chunk
              ? 'A new version was deployed. Reload to get the update.'
              : (this.state.error?.message || 'Something went wrong. Try refreshing this panel.')}
          </span>
          {!chunk && this.state.error?.stack && (
            <details style={{ marginTop: 4, maxWidth: 400, textAlign: 'left' }}>
              <summary style={{ cursor: 'pointer', color: 'var(--color-text-muted)', fontSize: 9 }}>Stack trace</summary>
              <pre style={{ color: 'var(--color-text-muted)', fontSize: 8.5, whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 120, overflow: 'auto', marginTop: 4 }}>
                {this.state.error.stack.split('\n').slice(0, 8).join('\n')}
              </pre>
            </details>
          )}
          <button
            onClick={chunk ? () => window.location.reload() : this.handleRetry}
            style={{
              marginTop: 4,
              background: chunk ? 'var(--accent, #e55a00)' : 'transparent',
              border: chunk ? 'none' : '1px solid var(--color-border-strong)',
              color: chunk ? '#fff' : '#aaa',
              padding: '4px 12px',
              borderRadius: 3,
              cursor: 'pointer',
              fontSize: 10,
              letterSpacing: '0.5px',
            }}
          >
            {chunk ? 'RELOAD' : 'RETRY'}
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
