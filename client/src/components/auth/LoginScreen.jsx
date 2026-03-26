/**
 * LoginScreen.jsx
 *
 * Full-screen login screen with username/password and access code authentication.
 * Replaces PasswordGate with persistent JWT-based auth.
 */

import { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';

export default function LoginScreen({ children }) {
  const auth = useAuth?.();
  const user = auth?.user;

  // Check for legacy sessionStorage gating or authenticated user
  const [gated, setGated] = useState(() => {
    return sessionStorage.getItem('arc_auth') === '1';
  });

  const [mode, setMode] = useState('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [accessCode, setAccessCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [shake, setShake] = useState(false);

  // If already authenticated or gated, render children
  if (user || gated) {
    return children;
  }

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (!auth?.login) {
        throw new Error('Auth context not configured');
      }
      await auth.login(username, password);
      // On success, auth context will update and user will be set
    } catch (err) {
      setError(err.message || 'Login failed');
      setShake(true);
      setTimeout(() => setShake(false), 600);
    } finally {
      setLoading(false);
    }
  };

  const handleAccessCode = (e) => {
    e.preventDefault();
    setError('');
    if (accessCode === 'ARCScreen') {
      sessionStorage.setItem('arc_auth', '1');
      setGated(true);
    } else {
      setError('Invalid access code');
      setShake(true);
      setTimeout(() => setShake(false), 600);
    }
  };

  const containerStyle = {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#0a0a0f',
    backgroundImage: `
      linear-gradient(90deg, #ff6600 1px, transparent 1px),
      linear-gradient(0deg, #ff6600 1px, transparent 1px)
    `,
    backgroundSize: '40px 40px',
    color: '#e0e0e0',
    fontFamily: 'monospace',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
  };

  const logoStyle = {
    marginBottom: '32px',
    textAlign: 'center',
  };

  const arcBrandStyle = {
    fontSize: '11px',
    color: '#e55a00',
    letterSpacing: '0.25em',
    fontWeight: 'bold',
    marginBottom: '8px',
  };

  const titleStyle = {
    fontSize: '20px',
    color: '#e8e8e8',
    marginBottom: '8px',
    fontWeight: 'bold',
  };

  const subtitleStyle = {
    fontSize: '8px',
    color: '#444',
  };

  const formStyle = {
    width: '280px',
    animation: shake ? 'shake 0.6s' : 'none',
  };

  const inputStyle = {
    width: '100%',
    backgroundColor: '#0d0d0d',
    border: '1px solid #333',
    color: '#e0e0e0',
    padding: '10px 12px',
    fontFamily: 'monospace',
    fontSize: '12px',
    marginBottom: '12px',
    boxSizing: 'border-box',
    outline: 'none',
  };

  const buttonStyle = {
    width: '100%',
    backgroundColor: '#ff6600',
    color: '#000',
    border: 'none',
    padding: '12px',
    cursor: 'pointer',
    fontSize: '11px',
    letterSpacing: '0.1em',
    fontWeight: 'bold',
    fontFamily: 'monospace',
  };

  const buttonDisabledStyle = {
    ...buttonStyle,
    opacity: 0.6,
    cursor: 'not-allowed',
  };

  const errorStyle = {
    color: '#ff4444',
    fontSize: '10px',
    marginBottom: '8px',
    minHeight: '16px',
  };

  const linkStyle = {
    color: '#444',
    fontSize: '10px',
    textAlign: 'center',
    marginTop: '16px',
    cursor: 'pointer',
  };

  const billingStyle = {
    marginTop: '32px',
    textAlign: 'center',
    fontSize: '8px',
    color: '#333',
  };

  const mailLinkStyle = {
    color: '#555',
    textDecoration: 'none',
  };

  return (
    <div style={containerStyle}>
      <style>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(-8px); }
          75% { transform: translateX(8px); }
        }
        input:focus {
          outline: none;
          border-color: #ff6600;
          background-color: #111;
        }
        button:hover:not(:disabled) {
          background-color: #ff7722;
        }
      `}</style>

      <div style={logoStyle}>
        <div style={arcBrandStyle}>ARC CAPITAL</div>
        <div style={titleStyle}>SENGER MARKET SCREEN</div>
        <div style={subtitleStyle}>Professional Market Data Terminal</div>
      </div>

      <div style={formStyle}>
        {mode === 'login' ? (
          <form onSubmit={handleLogin}>
            <div style={errorStyle}>{error}</div>
            <input
              type="text"
              placeholder="USERNAME"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              style={inputStyle}
              disabled={loading}
            />
            <input
              type="password"
              placeholder="PASSWORD"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={inputStyle}
              disabled={loading}
            />
            <button
              type="submit"
              style={loading ? buttonDisabledStyle : buttonStyle}
              disabled={loading}
            >
              {loading ? 'AUTHENTICATING...' : 'LOG IN'}
            </button>
            <div
              style={linkStyle}
              onClick={() => setMode('code')}
            >
              USE ACCESS CODE
            </div>
          </form>
        ) : (
          <form onSubmit={handleAccessCode}>
            <div style={errorStyle}>{error}</div>
            <input
              type="password"
              placeholder="ACCESS CODE"
              value={accessCode}
              onChange={(e) => setAccessCode(e.target.value)}
              style={inputStyle}
              autoFocus
            />
            <button type="submit" style={buttonStyle}>
              VERIFY CODE
            </button>
            <div
              style={linkStyle}
              onClick={() => {
                setMode('login');
                setError('');
                setAccessCode('');
              }}
            >
              BACK TO LOGIN
            </div>
          </form>
        )}

        <div style={billingStyle}>
          SUBSCRIPTION ACCESS — ARC CAPITAL PARTNERS
          <br />
          <a href="mailto:contact@arccapital.com.br" style={mailLinkStyle}>
            REQUEST ACCESS
          </a>
        </div>
      </div>
    </div>
  );
}
