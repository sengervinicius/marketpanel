/**
 * LoginForm.jsx
 * Login and registration form with toggle between modes.
 */

import { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import './LoginForm.css';

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
      className="lf-form"
    >
      <h2 className="lf-title">
        {isRegister ? 'REGISTER' : 'LOGIN'}
      </h2>

      <input
        type="text"
        value={username}
        onChange={(e) => setUsername(e.target.value.toLowerCase())}
        placeholder="Username"
        disabled={loading}
        className="lf-input"
      />

      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Password"
        disabled={loading}
        className="lf-input"
      />

      {error && (
        <div className="lf-error">
          ⚠ {error}
        </div>
      )}

      <button
        type="submit"
        disabled={loading || !username || !password}
        className="lf-submit-btn"
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
        className="lf-toggle-btn"
      >
        {isRegister ? 'Already have an account? LOGIN' : "Don't have an account? REGISTER"}
      </button>
    </form>
  );
}
