/**
 * LoginForm.jsx
 * Login and registration form with toggle between modes.
 */

import { useState } from 'react';
import { useAuth } from '../../context/AuthContext';

export function LoginForm() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [isRegister, setIsRegister] = useState(false);
  const { login, register } = useAuth();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (isRegister) {
        await register(username, password);
      } else {
        await login(username, password);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        maxWidth: '300px',
        margin: '0 auto',
        padding: '20px',
        background: '#0d0d0d',
        border: '1px solid #2a2a2a',
        borderRadius: '4px',
        fontFamily: 'var(--font-ui)',
      }}
    >
      <h2 style={{ fontSize: '14px', color: '#ff9900', margin: '0 0 12px 0', fontWeight: 700 }}>
        {isRegister ? 'REGISTER' : 'LOGIN'}
      </h2>

      <input
        type="text"
        value={username}
        onChange={(e) => setUsername(e.target.value.toLowerCase())}
        placeholder="Username"
        disabled={loading}
        style={{
          background: '#0a0a0a',
          border: '1px solid #2a2a2a',
          color: '#e0e0e0',
          fontFamily: 'inherit',
          fontSize: '10px',
          padding: '8px 10px',
          outline: 'none',
          borderRadius: '2px',
        }}
      />

      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Password"
        disabled={loading}
        style={{
          background: '#0a0a0a',
          border: '1px solid #2a2a2a',
          color: '#e0e0e0',
          fontFamily: 'inherit',
          fontSize: '10px',
          padding: '8px 10px',
          outline: 'none',
          borderRadius: '2px',
        }}
      />

      {error && (
        <div style={{ color: '#f44336', fontSize: '9px', fontWeight: 600, padding: '6px', background: '#1a0000', borderRadius: '2px' }}>
          ⚠ {error}
        </div>
      )}

      <button
        type="submit"
        disabled={loading || !username || !password}
        style={{
          background: username && password && !loading ? '#1a0d00' : '#0a0a0a',
          border: '1px solid #ff9900',
          color: username && password && !loading ? '#ff9900' : '#555',
          fontSize: '10px',
          fontWeight: 700,
          padding: '8px 12px',
          cursor: username && password && !loading ? 'pointer' : 'default',
          fontFamily: 'inherit',
          borderRadius: '2px',
          letterSpacing: '0.5px',
        }}
      >
        {loading ? 'PLEASE WAIT...' : isRegister ? 'REGISTER' : 'LOGIN'}
      </button>

      <button
        type="button"
        onClick={() => {
          setIsRegister(!isRegister);
          setError(null);
        }}
        disabled={loading}
        style={{
          background: 'transparent',
          border: '1px solid #555',
          color: '#888',
          fontSize: '8px',
          padding: '6px 10px',
          cursor: 'pointer',
          fontFamily: 'inherit',
          borderRadius: '2px',
          textDecoration: 'underline',
        }}
      >
        {isRegister ? 'Already have an account? LOGIN' : "Don't have an account? REGISTER"}
      </button>
    </form>
  );
}
