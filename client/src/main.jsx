import { StrictMode, useEffect, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter, Routes, Route, useNavigate, useLocation } from 'react-router-dom'
import App from './App.jsx'
import InstrumentDetailPage from './pages/InstrumentDetailPage.jsx'
import ChatPage from './pages/ChatPage.jsx'
import LoginScreen from './components/auth/LoginScreen.jsx'
import { AuthProvider, useAuth } from './context/AuthContext.jsx'
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
      fontFamily: "'IBM Plex Mono', monospace", gap: 16,
    }}>
      <div style={{ color: '#ff6600', fontWeight: 700, fontSize: 13, letterSpacing: '3px' }}>SENGER</div>
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

/**
 * DefaultPageRedirect — fires once after settings load.
 * If the user is at the root path "/" and has a non-root defaultStartPage,
 * navigate there. Handles the case where a user prefers to always open on
 * /chat, /detail/:symbol, etc. Uses a ref so it only triggers once per session.
 */
function DefaultPageRedirect() {
  const { settings, loaded } = useSettings();
  const navigate = useNavigate();
  const location = useLocation();
  const didRedirect = useRef(false);

  useEffect(() => {
    if (!loaded || didRedirect.current) return;
    const dest = settings?.defaultStartPage;
    if (!dest || dest === '/' || location.pathname !== '/') return;
    didRedirect.current = true;
    navigate(dest, { replace: true });
  }, [loaded, settings?.defaultStartPage, location.pathname, navigate]);

  return null;
}

// Inner wrapper — has access to AuthContext
function AppShell() {
  const { user, authReady } = useAuth();

  // Show loading screen until the initial /api/auth/me check completes
  if (!authReady) return <AuthLoadingScreen />;

  return (
    <SettingsProvider isAuthenticated={!!user}>
      <ThemeSync>
        <LoginScreen>
          {/* Routing is only mounted after auth check passes and user is logged in */}
          <DefaultPageRedirect />
          <Routes>
            <Route path="/" element={<App />} />
            <Route path="/detail/:symbolKey" element={<InstrumentDetailPage />} />
            <Route path="/chat" element={<ChatPage />} />
            <Route path="/chat/:userId" element={<ChatPage />} />
            {/* Catch-all → main app */}
            <Route path="*" element={<App />} />
          </Routes>
        </LoginScreen>
      </ThemeSync>
    </SettingsProvider>
  );
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <HashRouter>
      <AuthProvider>
        <AppShell />
      </AuthProvider>
    </HashRouter>
  </StrictMode>
)
