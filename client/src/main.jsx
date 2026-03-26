import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import LoginScreen from './components/auth/LoginScreen.jsx'
import { AuthProvider, useAuth } from './context/AuthContext.jsx'

import { ThemeProvider } from './context/ThemeContext.jsx'
import { SettingsProvider } from './context/SettingsContext.jsx'

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/service-worker.js').catch(() => {}));
}

// Inner wrapper so useAuth() is available inside AuthProvider
function AppWithProviders() {
  const { user } = useAuth();
  return (
    <SettingsProvider isAuthenticated={!!user}>
      <ThemeProvider>
        <LoginScreen>
          <App />
        </LoginScreen>
      </ThemeProvider>
    </SettingsProvider>
  );
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AuthProvider>
      <AppWithProviders />
    </AuthProvider>
  </StrictMode>
)
