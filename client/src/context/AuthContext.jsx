/**
 * AuthContext.jsx
 * Manages user authentication state. Provides login/register/logout + subscription info.
 */

import { createContext, useContext, useState, useCallback } from 'react';
import { API_BASE } from '../utils/api';

const LS_USER  = 'arc_user';
const LS_TOKEN = 'arc_token';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem(LS_USER)); } catch { return null; }
  });
  const [token, setToken] = useState(() => localStorage.getItem(LS_TOKEN) || null);
  const [subscription, setSubscription] = useState(null);

  const _persist = (userObj, tok, sub) => {
    setUser(userObj);
    setToken(tok);
    setSubscription(sub || null);
    localStorage.setItem(LS_USER,  JSON.stringify(userObj));
    localStorage.setItem(LS_TOKEN, tok);
  };

  const login = useCallback(async (username, password) => {
    const res  = await fetch(`${API_BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Login failed');
    _persist({ id: data.user.id, username: data.user.username }, data.token, data.subscription);
    return data;
  }, []);

  const register = useCallback(async (username, password) => {
    const res  = await fetch(`${API_BASE}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Registration failed');
    _persist({ id: data.user.id, username: data.user.username }, data.token, data.subscription);
    return data;
  }, []);

  const logout = useCallback(() => {
    setUser(null);
    setToken(null);
    setSubscription(null);
    localStorage.removeItem(LS_USER);
    localStorage.removeItem(LS_TOKEN);
  }, []);

  const startCheckout = useCallback(async () => {
    const tok = localStorage.getItem(LS_TOKEN);
    try {
      const res  = await fetch(`${API_BASE}/api/billing/create-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
      });
      const data = await res.json();
      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
      } else {
        alert('Subscription checkout is not yet configured. Please contact support.');
      }
    } catch {
      alert('Could not initiate checkout. Please try again later.');
    }
  }, []);

  return (
    <AuthContext.Provider value={{ user, token, subscription, login, register, logout, startCheckout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
};
