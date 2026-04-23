import * as Sentry from '@sentry/react';
import { StrictMode, useEffect, Component } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter, Routes, Route } from 'react-router-dom'
import App from './App.jsx'
import { initAnalytics } from './utils/analytics.js'

// W0.3 — Sentry release tag via VITE_SENTRY_RELEASE (injected by CI from the
// git SHA). Do NOT enable sendDefaultPii; we tag user.id only, never username
// or email. PII redaction on the server is the other half of this guarantee.
if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.MODE,
    release: import.meta.env.VITE_SENTRY_RELEASE || undefined,
    tracesSampleRate: Number(import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE || 0.1),
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0.5,
    sendDefaultPii: false,
    beforeSend(event) {
      try {
        if (event?.request?.headers) {
          for (const k of Object.keys(event.request.headers)) {
            const lk = k.toLowerCase();
            if (lk === 'authorization' || lk === 'cookie') event.request.headers[k] = '[REDACTED]';
          }
        }
      } catch { /* never throw from beforeSend */ }
      return event;
    },
  });
}

// W6.5 — Product analytics (PostHog). No-op unless VITE_POSTHOG_KEY is set
// AND the user has granted the 'analytics' consent bucket.
initAnalytics();

// LandingPage removed — LoginScreen IS the landing page
import InstrumentDetailPage from './pages/InstrumentDetailPage.jsx'
import ChatPage from './pages/ChatPage.jsx'
import NotFoundPage from './components/common/NotFoundPage.jsx'
import LoginScreen from './components/auth/LoginScreen.jsx'
import { AuthProvider, useAuth } from './context/AuthContext.jsx'
import { ToastProvider } from './context/ToastContext.jsx'
import CookieConsentBanner from './components/common/CookieConsentBanner.jsx'
import SupportWidget from './components/common/SupportWidget.jsx'
import { ThemeProvider } from './context/ThemeContext.jsx'
import { SettingsProvider, useSettings } from './context/SettingsContext.jsx'
import { useFeatureFlags } from './hooks/useFeatureFlags.js'

// Unregister legacy service worker — it uses stale-while-revalidate caching
// which serves old JS bundles, preventing bug fixes from reaching users.
// Vite's content-hashed filenames + standard HTTP caching are sufficient.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(registrations => {
    registrations.forEach(r => r.unregister());
  });
  // Purge the old service worker cache
  if ('caches' in window) {
    caches.keys().then(keys => keys.forEach(k => caches.delete(k)));
  }
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
//
// #239 / P1.5: the light_theme_enabled feature flag gates the whole light
// path until per-component [data-theme="light"] CSS ships. If the flag is
// OFF we force initialTheme='dark' regardless of what the user has in
// settings.theme — otherwise a user whose DB row is already 'light' would
// land on the broken half-themed state the flag exists to prevent.
// Fail-closed: if /api/flags errors, isOn returns the defaultValue (false),
// so we force dark.
function ThemeSync({ children }) {
  const { settings } = useSettings();
  const { isOn } = useFeatureFlags();
  const lightThemeEnabled = isOn('light_theme_enabled', false);
  const savedTheme = settings?.theme || 'dark';
  const effectiveTheme = lightThemeEnabled ? savedTheme : 'dark';
  return (
    <ThemeProvider initialTheme={effectiveTheme}>
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
          <CookieConsentBanner locale="pt" />
          <SupportWidget />
        </ToastProvider>
      </AuthProvider>
    </HashRouter>
    </RootErrorBoundary>
  </StrictMode>
)
