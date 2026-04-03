/**
 * LoginForm.jsx
 * Login and registration form with toggle between modes.
 * Y-003: Distinct error messages from backend (wrong password, user not found, rate limited)
 * Y-004: Forgot password link + reset flow
 */

import { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { apiFetch } from '../../utils/api';
import './LoginForm.css';

function getPasswordStrength(pw) {
  if (!pw) return { label: '', color: 'transparent', width: '0%' };
  let score = 0;
  if (pw.length >= 6) score++;
  if (pw.length >= 10) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  if (score <= 1) return { label: 'Weak', color: '#f44336', width: '33%' };
  if (score <= 3) return { label: 'Fair', color: '#ff9800', width: '66%' };
  return { label: 'Strong', color: '#4caf50', width: '100%' };
}

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
  const [failCount, setFailCount] = useState(0);
  const [lockoutUntil, setLockoutUntil] = useState(null);
  const { login, register } = useAuth();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setInfo(null);

    // Check lockout before proceeding
    if (lockoutUntil && Date.now() < lockoutUntil) {
      const secs = Math.ceil((lockoutUntil - Date.now()) / 1000);
      setError(`Too many attempts. Try again in ${secs}s`);
      return;
    }

    // Email validation
    if (!emailRegex.test(username)) {
      setError('Please enter a valid email address');
      return;
    }

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
        setFailCount(0);
        setLockoutUntil(null);
      } else {
        await login(username, password);
        setFailCount(0);
        setLockoutUntil(null);
      }
    } catch (err) {
      setError(err.message);
      setFailCount(prev => {
        const next = prev + 1;
        if (next >= 3) {
          const delays = [5000, 10000, 30000];
          const delay = delays[Math.min(next - 3, delays.length - 1)] || 30000;
          setLockoutUntil(Date.now() + delay);
        }
        return next;
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!lockoutUntil) return;
    const id = setInterval(() => {
      if (Date.now() >= lockoutUntil) {
        setLockoutUntil(null);
        clearInterval(id);
      }
    }, 1000);
    return () => clearInterval(id);
  }, [lockoutUntil]);

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
        type="email"
        value={username}
        onChange={(e) => setUsername(e.target.value.toLowerCase())}
        placeholder="Email"
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

      {password && (
        <div style={{ marginTop: 4 }}>
          <div style={{ height: 3, background: '#1a1a1a', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: getPasswordStrength(password).width, background: getPasswordStrength(password).color, transition: 'all 0.3s', borderRadius: 2 }} />
          </div>
          <span style={{ fontSize: 10, color: getPasswordStrength(password).color, letterSpacing: '0.5px' }}>{getPasswordStrength(password).label}</span>
        </div>
      )}

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
