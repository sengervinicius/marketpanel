/**
 * LoginScreen.jsx
 *
 * Full-screen login screen with username/password authentication.
 * Persistent JWT-based auth via AuthContext.
 */

import { useState } from 'react';
import { useAuth } from '../../context/AuthContext';

export default function LoginScreen({ children }) {
  const auth = useAuth?.();
  const user = auth?.user;

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [shake, setShake] = useState(false);

  // If authenticated, render children
  if (user) {
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

  const sengerTitleStyle = {
    fontSize: '48px',
    color: '#ff6600',
    letterSpacing: '0.05em',
    fontWeight: 'bold',
    marginBottom: '8px',
  };

  const subtitleStyle = {
    fontSize: '10px',
    color: '#888',
    letterSpacing: '0.1em',
    fontWeight: 'normal',
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
        <div style={sengerTitleStyle}>SENGER</div>
        <div style={subtitleStyle}>Professional Market Data Terminal</div>
      </div>

      <div style={formStyle}>
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
        </form>

        <div style={billingStyle}>
          SUBSCRIPTION ACCESS — vinicius@arccapital.com.br
          <br />
          <a href="mailto:vinicius@arccapital.com.br" style={mailLinkStyle}>
            REQUEST ACCESS
          </a>
        </div>
      </div>
    </div>
  );
}
