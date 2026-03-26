import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import PasswordGate from './components/auth/PasswordGate.jsx'
import { AuthProvider } from './context/AuthContext.jsx'

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/service-worker.js').catch(() => {}));
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AuthProvider>
      <PasswordGate>
        <App />
      </PasswordGate>
    </AuthProvider>
  </StrictMode>
)
