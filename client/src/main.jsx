import * as Sentry from '@sentry/react';
import { StrictMode, useEffect, Component } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter, Routes, Route } from 'react-router-dom'
import App from './App.jsx'

if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.MODE,
    tracesSampleRate: 0.1,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0.5,
  });
}
// LandingPage removed — LoginScreen IS the landing page
import InstrumentDetailPage from './pages/InstrumentDetailPage.jsx'
import ChatPage from './pages/ChatPage.jsx'
import NotFoundPage from './components/common/NotFoundPage.jsx'
import LoginScreen from './components/auth/LoginScreen.jsx'
import { AuthProvider, useAuth } from './context/AuthContext.jsx'
import { ToastProvider } from './context/ToastContext.jsx'
import { ThemeProvider } from './context/ThemeContext.jsx'
import { SettingsProvider, useSettings } from './context/SettingsContext.jsx'

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/service-worker.js').catch(() => {}));
}

// Minimal loading screen shown while the initial /api/auth/me check runs
function AuthLoadingScreen() {
  return (
    <div style={{
      position: 'fixed', inset: 0, background: '#050505',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      gap: 16,
    }}>
      <div style={{ color: '#F97316', fontWeight: 700, fontSize: 13, letterSpacing: '3px' }}>PARTICLE</div>
      <div style={{ color: '#2a2a2a', fontSize: 9, letterSpacing: '2px' }}>AUTHENTICATING…</div>
    </div>
  );
}

// Bridges settings.theme → ThemeProvider so the user's saved theme is applied
// after /api/settings loads, without requiring a page refresh.
function ThemeSync({ children }) {
  const { settings } = useSettings();
  return (
    <ThemeProvider initialTheme={settings?.theme || 'dark'}>
      {children}
    </ThemeProvider>
  );
}

// DefaultPageRedirect removed — app now uses defaultStartTab (tab-based navigation)

// ── Top-level ErrorBoundary ─────────────────────────────────────────────────
class RootErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { hasError: false, error: null }; }
  static getDerivedStateFromError(error) { return { hasError: true, error }; }
  componentDidCatch(error, info) { console.error('[RootErrorBoundary]', error, info); }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ position:'fixed', inset:0, background:'#0a0a0a', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', color:'#e0e0e0', fontFamily:'monospace', padding:24, gap:16 }}>
          <div style={{ color:'#F97316', fontWeight:700, fontSize:13, letterSpacing:'3px' }}>PARTICLE</div>
          <div style={{ color:'#f44336', fontSize:14, fontWeight:600 }}>Something went wrong</div>
          <div style={{ color:'#ff9900', fontSize:11, maxWidth:600, wordBreak:'break-word', textAlign:'center' }}>{this.state.error?.message || 'Unknown error'}</div>
          <pre style={{ color:'#888', fontSize:9, maxWidth:'90vw', maxHeight:'40vh', overflow:'auto', whiteSpace:'pre-wrap' }}>{this.state.error?.stack || ''}</pre>
          <button onClick={() => window.location.reload()} style={{ background:'var(--color-particle, #F97316)', color:'#fff', border:'none', padding:'8px 24px', borderRadius:4, cursor:'pointer', fontSize:12, letterSpacing:'1px' }}>RELOAD</button>
        </div>
      );
    }
    return this.props.children;
  }
}

// Inner wrapper — has access to AuthContext
function AppShell() {
  const { user, authReady } = useAuth();

  // Show loading screen until the initial /api/auth/me check completes
  if (!authReady) return <AuthLoadingScreen />;

  // Authenticated users see the full app
  if (user) {
    return (
      <SettingsProvider isAuthenticated={!!user}>
        <ThemeSync>
          <LoginScreen>
            {/* Routing is only mounted after auth check passes and user is logged in */}
            <Routes>
              <Route path="/" element={<App />} />
              <Route path="/detail/:symbolKey" element={<InstrumentDetailPage />} />
              <Route path="/chat" element={<ChatPage />} />
              <Route path="/chat/:userId" element={<ChatPage />} />
              {/* Catch-all → 404 page */}
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </LoginScreen>
        </ThemeSync>
      </SettingsProvider>
    );
  }

  // Unauthenticated users see the login screen (which IS the landing page)
  return <LoginScreen />;
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <RootErrorBoundary>
    <HashRouter>
      <AuthProvider>
        <ToastProvider>
          <AppShell />
        </ToastProvider>
      </AuthProvider>
    </HashRouter>
    </RootErrorBoundary>
  </StrictMode>
)
