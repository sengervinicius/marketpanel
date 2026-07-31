import * as Sentry from '@sentry/react';
import { StrictMode, Suspense, useEffect, Component } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter, Routes, Route } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import App from './App.jsx'
import { initAnalytics } from './utils/analytics.js'
import { queryClient } from './lib/queryClient.js'

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

// FEAT-interaction-wave 1a/2 — query-param deep links. The app uses
// HashRouter, so plain-path links like /?detail=AAPL or /?sector=XLK
// would land on the dashboard. Bridge them onto the hash routes here,
// before the router mounts (auth still applies — routes only render
// once the user is logged in).
try {
  const _qs = new URLSearchParams(window.location.search);
  const _detail = _qs.get('detail');
  const _sector = _qs.get('sector');
  if (_detail && !window.location.hash.startsWith('#/detail')) {
    window.location.hash = '#/detail/' + encodeURIComponent(_detail.toUpperCase());
  } else if (_sector && !window.location.hash.startsWith('#/sector')) {
    window.location.hash = '#/sector/' + encodeURIComponent(_sector.toUpperCase());
  }
} catch { /* malformed query string — ignore */ }

// LandingPage removed — LoginScreen IS the landing page
import InstrumentDetailPage from './pages/InstrumentDetailPage.jsx'
import SectorDetailPage from './pages/SectorDetailPage.jsx'
import { lazyWithRetry } from './utils/lazyWithRetry.js'
// Perf (#bundle): ChatPage statically imports ChatPanel — keeping it static
// here would pull the whole chat stack into the eager index chunk.
const ChatPage = lazyWithRetry(() => import('./pages/ChatPage.jsx'))
import NotFoundPage from './components/common/NotFoundPage.jsx'
import LoginScreen from './components/auth/LoginScreen.jsx'
import { AuthProvider, useAuth } from './context/AuthContext.jsx'
import { ToastProvider } from './context/ToastContext.jsx'
import CookieConsentBanner from './components/common/CookieConsentBanner.jsx'
import NewVersionBanner from './components/common/NewVersionBanner.jsx'
import { isNative } from './services/platform'
import SupportWidget from './components/common/SupportWidget.jsx'
import { ThemeProvider } from './context/ThemeContext.jsx'
import { SettingsProvider, useSettings } from './context/SettingsContext.jsx'
import { useFeatureFlags } from './hooks/useFeatureFlags.js'

// Deploy-safety net: when a new deploy replaces content-hashed chunks while a
// session is open, lazy imports of the OLD hashes 404 and hard-crash the app
// ("Failed to fetch dynamically imported module"). Vite emits vite:preloadError
// for exactly this case — recover with ONE full reload (sessionStorage-guarded
// against loops), which picks up the fresh index and chunk graph.
window.addEventListener('vite:preloadError', (event) => {
  const KEY = 'chunkReload_v1';
  const last = Number(sessionStorage.getItem(KEY) || 0);
  if (Date.now() - last > 30_000) {
    sessionStorage.setItem(KEY, String(Date.now()));
    event.preventDefault(); // suppress the crash — we're handling it
    window.location.reload();
  }
});

// Legacy service-worker KILLER. An older build shipped a stale-while-revalidate
// SW that caches index.html + JS chunks. After a deploy it keeps serving an old
// index that points at deleted chunk hashes -> the app crashes ("Failed to
// fetch dynamically imported module") and plain reloads keep hitting the SW's
// cached copy, so the fix never reaches the user. If THIS page is under SW
// control, unregister + clear all caches, then reload ONCE (session-guarded)
// so the next load is network-fresh and SW-free.
if ('serviceWorker' in navigator) {
  (async () => {
    try {
      const regs = await navigator.serviceWorker.getRegistrations();
      const controlled = !!navigator.serviceWorker.controller;
      await Promise.all(regs.map(r => r.unregister()));
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map(k => caches.delete(k)));
      }
      const KEY = 'particle_sw_purged_v1';
      if ((controlled || regs.length) && !sessionStorage.getItem(KEY)) {
        sessionStorage.setItem(KEY, '1');
        window.location.reload();
      }
    } catch { /* best effort — SW/cache APIs unavailable */ }
  })();
}

// Minimal loading screen shown while the initial /api/auth/me check runs
function AuthLoadingScreen() {
  return (
    <div style={{
      position: 'fixed', inset: 0, background: '#050505',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      gap: 16,
    }}>
      <div style={{ color: 'var(--color-accent)', fontWeight: 700, fontSize: 13, letterSpacing: '3px' }}>PARTICLE</div>
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
  componentDidCatch(error, info) {
    console.error('[RootErrorBoundary]', error, info);
    // React error boundaries stop the error before Sentry's global handler, so
    // without this every caught render crash was invisible in production.
    try { Sentry.captureException(error, { contexts: { react: { componentStack: info?.componentStack } } }); } catch (_) { /* never mask the original error */ }
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ position:'fixed', inset:0, background:'var(--color-bg)', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', color:'var(--color-text-primary)', fontFamily:'var(--font-family-mono)', padding:24, gap:16 }}>
          <div style={{ color:'var(--color-accent)', fontWeight:700, fontSize:13, letterSpacing:'3px' }}>PARTICLE</div>
          <div style={{ color:'var(--color-down)', fontSize:14, fontWeight:600 }}>Something went wrong</div>
          <div style={{ color:'#ff9900', fontSize:11, maxWidth:600, wordBreak:'break-word', textAlign:'center' }}>{this.state.error?.message || 'Unknown error'}</div>
          {import.meta.env.DEV && (<pre style={{ color:'#888', fontSize:9, maxWidth:'90vw', maxHeight:'40vh', overflow:'auto', whiteSpace:'pre-wrap' }}>{this.state.error?.stack || ''}</pre>)}
          <button onClick={() => window.location.reload()} style={{ background:'var(--color-particle)', color:'var(--color-text-inverse)', border:'none', padding:'8px 24px', borderRadius:4, cursor:'pointer', fontSize:12, letterSpacing:'1px' }}>RELOAD</button>
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
              <Route path="/sector/:etf" element={<SectorDetailPage />} />
              <Route path="/chat" element={<Suspense fallback={null}><ChatPage /></Suspense>} />
              <Route path="/chat/:userId" element={<Suspense fallback={null}><ChatPage /></Suspense>} />
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
    <QueryClientProvider client={queryClient}>
    <HashRouter>
      <AuthProvider>
        <ToastProvider>
          <AppShell />
          {/* Web only: on native iOS this fixed pt-BR bar sat on the home indicator,
              above the tab bar, before the user had seen the app. */}
          {/* One app-level notice when a deploy invalidated this tab's chunks. */}
          <NewVersionBanner />
          {!isNative() && <CookieConsentBanner locale="pt" />}
          <SupportWidget />
        </ToastProvider>
      </AuthProvider>
    </HashRouter>
    </QueryClientProvider>
    </RootErrorBoundary>
  </StrictMode>
)
