/**
 * LoginScreen.jsx
 *
 * Full-screen login/register screen.
 * Persistent JWT-based auth via AuthContext.
 */

import { useState } from 'react';
import { useAuth } from '../../context/AuthContext';

export default function LoginScreen({ children }) {
  const auth = useAuth?.();
  const user = auth?.user;

  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [shake, setShake] = useState(false);

  // If authenticated, render children
  if (user) {
    return children;
  }

  const triggerShake = (msg) => {
    setError(msg);
    setShake(true);
    setTimeout(() => setShake(false), 600);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (mode === 'login') {
        if (!auth?.login) throw new Error('Auth context not configured');
        await auth.login(username, password);
      } else {
        if (!auth?.register) throw new Error('Auth context not configured');
        await auth.register(username, password);
      }
    } catch (err) {
      triggerShake(err.message || (mode === 'login' ? 'Login failed' : 'Registration failed'));
    } finally {
      setLoading(false);
    }
  };

  const switchMode = () => {
    setMode(m => m === 'login' ? 'register' : 'login');
    setError('');
  };

  const containerStyle = {
    position: 'fixed',
    top: 0, left: 0, right: 0, bottom: 0,
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

  const logoStyle    = { marginBottom: '32px', textAlign: 'center' };
  const titleStyle   = { fontSize: '48px', color: '#ff6600', letterSpacing: '0.05em', fontWeight: 'bold', marginBottom: '8px' };
  const subtitleStyle= { fontSize: '10px', color: '#888', letterSpacing: '0.1em' };

  const formStyle = { width: '280px', animation: shake ? 'shake 0.6s' : 'none' };

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

  const buttonDisabledStyle = { ...buttonStyle, opacity: 0.6, cursor: 'not-allowed' };

  const errorStyle = { color: '#ff4444', fontSize: '10px', marginBottom: '8px', minHeight: '16px' };

  const switchStyle = {
    color: '#444', fontSize: '10px', textAlign: 'center',
    marginTop: '16px', cursor: 'pointer',
  };

  const billingStyle = {
    marginTop: '32px', textAlign: 'center', fontSize: '8px', color: '#333',
  };

  const mailLinkStyle = { color: '#555', textDecoration: 'none' };

  return (
    <div style={containerStyle}>
      <style>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(-8px); }
          75% { transform: translateX(8px); }
        }
        input:focus { outline: none; border-color: #ff6600; background-color: #111; }
        button:hover:not(:disabled) { background-color: #ff7722; }
      `}</style>

      <div style={logoStyle}>
        <div style={titleStyle}>SENGER</div>
        <div style={subtitleStyle}>Professional Market Data Terminal</div>
      </div>

      <div style={formStyle}>
        {/* Mode label */}
        <div style={{ color: '#555', fontSize: '8px', letterSpacing: '0.2em', marginBottom: '12px', textAlign: 'center' }}>
          {mode === 'login' ? 'SIGN IN' : 'CREATE ACCOUNT'}
        </div>

        <form onSubmit={handleSubmit}>
          <div style={errorStyle}>{error}</div>
          <input
            type="text"
            placeholder="USERNAME"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            style={inputStyle}
            disabled={loading}
            autoFocus
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
            {loading
              ? (mode === 'login' ? 'AUTHENTICATING...' : 'CREATING ACCOUNT...')
              : (mode === 'login' ? 'LOG IN' : 'CREATE ACCOUNT')
            }
          </button>
        </form>

        <div style={switchStyle} onClick={switchMode}>
          {mode === 'login' ? 'CREATE NEW ACCOUNT' : 'BACK TO LOGIN'}
        </div>

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
