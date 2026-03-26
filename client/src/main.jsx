import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import LoginScreen from './components/auth/LoginScreen.jsx'
import { AuthProvider } from './context/AuthContext.jsx'

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/service-worker.js').catch(() => {}));
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AuthProvider>
      <LoginScreen>
        <App />
      </LoginScreen>
    </AuthProvider>
  </StrictMode>
)
