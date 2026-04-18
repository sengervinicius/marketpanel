import { useState, useEffect } from 'react';
import { LoginForm } from './LoginForm';
import { useAuth } from '../../context/AuthContext';
import './PasswordGate.css';

export default function PasswordGate({ children }) {
  const [auth, setAuth] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [shake, setShake] = useState(false);
  const [useUserAuth, setUseUserAuth] = useState(false);
  const { user } = useAuth();

  useEffect(() => {
    // If user is logged in via AuthContext, skip the gate
    if (user) {
      setAuth(true);
      return;
    }
    if (sessionStorage.getItem('arc_auth') === '1') setAuth(true);
  }, [user]);

  const handleSubmit = (e) => {
    e.preventDefault();
    const expectedPassword = import.meta.env.VITE_ACCESS_PASSWORD || 'ARCScreen';
    if (password === expectedPassword) {
      sessionStorage.setItem('arc_auth', '1');
      setAuth(true);
    } else {
      setError('ACCESS DENIED — INVALID CREDENTIALS');
      setShake(true);
      setPassword('');
      setTimeout(() => { setError(''); setShake(false); }, 2500);
    }
  };

  if (auth) return children;

  return (
    <div className="pg-container">
      {/* Background grid lines */}
      <div className="pg-grid-background" />

      <div className="pg-wrapper">
        {/* Logo / branding */}
        <div className="pg-branding">
          <div className="pg-logo-label">
            THE PARTICLE
          </div>
          <div className="pg-logo-title">
            MARKET TERMINAL
          </div>
          <div className="pg-logo-subtitle">
            Professional Market Data Terminal
          </div>
          <div className="pg-logo-divider" />
        </div>

        {/* User auth toggle */}
        {!useUserAuth && (
          <div className="pg-auth-toggle">
            <button
              type="button"
              onClick={() => setUseUserAuth(true)}
              className="pg-auth-toggle-btn"
            >
              USER AUTHENTICATION
            </button>
          </div>
        )}

        {/* Show either user auth form or access code form */}
        {useUserAuth ? (
          <LoginForm />
        ) : (
          <>
          <form onSubmit={handleSubmit} className={`pg-form ${shake ? 'pg-shake' : ''}`}>
          <div className="pg-form-label">
            Authentication Required
          </div>

          <div className="pg-field-group">
            <div className="pg-field-label">
              Access Code
            </div>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Enter access code"
              autoFocus
              className="pg-input"
              onFocus={e => e.target.style.borderColor = '#e55a00'}
              onBlur={e => e.target.style.borderColor = '#222'}
            />
          </div>

          {error && (
            <div className="pg-error">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }}><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>{error}
            </div>
          )}

          <button
            type="submit"
            className="pg-submit-btn"
            onMouseEnter={e => { e.target.style.background = '#e55a00'; e.target.style.color = '#000'; }}
            onMouseLeave={e => { e.target.style.background = 'linear-gradient(135deg, #1a0800, #2a1000)'; e.target.style.color = '#e55a00'; }}
          >
            ACCESS TERMINAL
          </button>
        </form>

        <div className="pg-footer">
          AUTHORIZED USERS ONLY · CONFIDENTIAL
        </div>
          </>
        )}
      </div>

      <style>{`
        @keyframes shake {
          0%,100%{transform:translateX(0)}
          20%{transform:translateX(-8px)}
          40%{transform:translateX(8px)}
          60%{transform:translateX(-6px)}
          80%{transform:translateX(6px)}
        }
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@300;400;500;600&display=swap');
      `}</style>
    </div>
  );
}
