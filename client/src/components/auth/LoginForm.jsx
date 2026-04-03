/**
 * LoginForm.jsx
 * Login and registration form with toggle between modes.
 * Y-003: Distinct error messages from backend (wrong password, user not found, rate limited)
 * Y-004: Forgot password link + reset flow
 */

import { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { apiFetch } from '../../utils/api';
import './LoginForm.css';

export function LoginForm() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState(null);
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(false);
  const [isRegister, setIsRegister] = useState(false);
  const [showForgot, setShowForgot] = useState(false);
  const [forgotUsername, setForgotUsername] = useState('');
  const { login, register } = useAuth();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    if (isRegister && password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    if (isRegister && password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }
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

  const handleForgotPassword = async (e) => {
    e.preventDefault();
    if (!forgotUsername.trim()) {
      setError('Please enter your username');
      return;
    }
    setLoading(true);
    setError(null);
    setInfo(null);
    try {
      const res = await apiFetch('/api/auth/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: forgotUsername.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setInfo(data.message || 'If an account exists, a reset link has been sent.');
        setTimeout(() => { setShowForgot(false); setInfo(null); }, 4000);
      } else {
        setError(data.error || 'Failed to process request');
      }
    } catch (err) {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // ── Forgot password view ──
  if (showForgot) {
    return (
      <form onSubmit={handleForgotPassword} className="lf-form">
        <h2 className="lf-title">RESET PASSWORD</h2>
        <p className="lf-subtitle">Enter your username and we'll send a reset link.</p>

        <input
          type="text"
          value={forgotUsername}
          onChange={(e) => setForgotUsername(e.target.value.toLowerCase())}
          placeholder="Username"
          disabled={loading}
          className="lf-input"
          autoFocus
        />

        {error && <div className="lf-error">{error}</div>}
        {info && <div className="lf-info">{info}</div>}

        <button
          type="submit"
          disabled={loading || !forgotUsername}
          className="lf-submit-btn"
        >
          {loading ? 'PLEASE WAIT...' : 'SEND RESET LINK'}
        </button>

        <button
          type="button"
          onClick={() => { setShowForgot(false); setError(null); setInfo(null); }}
          disabled={loading}
          className="lf-toggle-btn"
        >
          Back to LOGIN
        </button>
      </form>
    );
  }

  // ── Main login/register view ──
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

      {isRegister && (
        <input
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          placeholder="Confirm Password"
          disabled={loading}
          className="lf-input"
        />
      )}

      {error && (
        <div className="lf-error">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={loading || !username || !password || (isRegister && !confirmPassword)}
        className="lf-submit-btn"
      >
        {loading ? 'PLEASE WAIT...' : isRegister ? 'REGISTER' : 'LOGIN'}
      </button>

      {!isRegister && (
        <button
          type="button"
          onClick={() => { setShowForgot(true); setForgotUsername(username); setError(null); }}
          className="lf-forgot-btn"
        >
          Forgot password?
        </button>
      )}

      <button
        type="button"
        onClick={() => {
          setIsRegister(!isRegister);
          setError(null);
          setConfirmPassword('');
        }}
        disabled={loading}
        className="lf-toggle-btn"
      >
        {isRegister ? 'Already have an account? LOGIN' : "Don't have an account? REGISTER"}
      </button>
    </form>
  );
}
