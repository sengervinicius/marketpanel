/**
 * ToastContext.jsx
 * Lightweight toast notification system for achievement/XP toasts and
 * action confirmations (success / info / warning / error).
 */
import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';

const ToastContext = createContext(null);

let toastId = 0;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timersRef = useRef(new Map());

  const addToast = useCallback(({ title, body, variant = 'info', duration = 4500 }) => {
    const id = ++toastId;
    setToasts(prev => [...prev, { id, title, body, variant }]);

    const timer = setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
      timersRef.current.delete(id);
    }, duration);

    timersRef.current.set(id, timer);
    return id;
  }, []);

  // Convenience overload used throughout the app: showToast('message', 'success')
  const showToast = useCallback((message, variant = 'info', duration = 4500) => {
    return addToast({ title: message, variant, duration });
  }, [addToast]);

  const removeToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
    const timer = timersRef.current.get(id);
    if (timer) { clearTimeout(timer); timersRef.current.delete(id); }
  }, []);

  // Global event bridge so non-React code (event handlers in App.jsx particle:action,
  // or background utilities) can surface toasts without prop-drilling the context.
  useEffect(() => {
    const handler = (e) => {
      const { message, title, body, variant, duration } = e.detail || {};
      if (!message && !title && !body) return;
      addToast({ title: message || title, body, variant, duration });
    };
    window.addEventListener('particle:toast', handler);
    return () => window.removeEventListener('particle:toast', handler);
  }, [addToast]);

  return (
    <ToastContext.Provider value={{ toasts, addToast, showToast, removeToast }}>
      {children}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}
