/**
 * AuthContext.jsx
 * Manages user authentication state and provides login/register/logout functions.
 *
 * Stores user info and JWT token in localStorage.
 */

import { createContext, useContext, useState, useCallback } from 'react';

const API_BASE = import.meta.env.VITE_API_URL || '';
const LS_USER = 'arc_user';
const LS_TOKEN = 'arc_token';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  // Load user and token from localStorage on mount
  const [user, setUser] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(LS_USER));
    } catch {
      return null;
    }
  });

  const [token, setToken] = useState(() => {
    return localStorage.getItem(LS_TOKEN) || null;
  });

  /**
   * Login with username and password.
   * @param {string} username
   * @param {string} password
   * @throws {Error} If login fails
   */
  const login = useCallback(async (username, password) => {
    const res = await fetch(`${API_BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Login failed');
    }
    const userObj = { username: data.username };
    setUser(userObj);
    setToken(data.token);
    localStorage.setItem(LS_USER, JSON.stringify(userObj));
    localStorage.setItem(LS_TOKEN, data.token);
    return data;
  }, []);

  /**
   * Register a new user and automatically log them in.
   * @param {string} username
   * @param {string} password
   * @throws {Error} If registration fails
   */
  const register = useCallback(async (username, password) => {
    const res = await fetch(`${API_BASE}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Registration failed');
    }
    // Auto-login after registration
    return login(username, password);
  }, [login]);

  /**
   * Logout the user.
   */
  const logout = useCallback(() => {
    setUser(null);
    setToken(null);
    localStorage.removeItem(LS_USER);
    localStorage.removeItem(LS_TOKEN);
  }, []);

  return (
    <AuthContext.Provider value={{ user, token, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

/**
 * Hook to access auth context.
 */
export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return ctx;
};
