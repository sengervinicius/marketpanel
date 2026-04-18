/**
 * SupportWidget.jsx — W6.7 Crisp chat widget, gated.
 *
 * Two independent gates, both of which must be open:
 *
 *   1. Server flag `support_chat_enabled` — evaluated via useFeatureFlags.
 *      This is the ops kill switch. If the founder is on holiday without a
 *      backup operator they flip it off in the admin dashboard and the
 *      widget disappears for everyone.
 *
 *   2. Client LGPD consent (analytics bucket). Crisp sets its own first-
 *      party cookies for session identity, so we treat it as non-essential
 *      per our cookie notice. No consent → no widget, no SDK.
 *
 * The Crisp SDK is also NOT bundled — we inject its script tag only after
 * both gates open, so first paint and LCP aren't weighed down by a chat
 * SDK the user may never use.
 *
 * To enable:
 *   - Set VITE_CRISP_WEBSITE_ID=<uuid> in client env
 *   - POST /api/admin/flags with {name:"support_chat_enabled", enabled:true}
 *   - User must have accepted analytics cookies
 *
 * To disable cleanly: flip the server flag. This component listens to the
 * flag poll (useFeatureFlags refreshes every 60s) and tears down the SDK
 * automatically.
 */

import { useEffect, useState } from 'react';
import { useFeatureFlags } from '../../hooks/useFeatureFlags';

const CONSENT_KEY = 'lgpd_consent_v1';
const SCRIPT_ID   = 'crisp-sdk';

function analyticsConsented() {
  try {
    const raw = window.localStorage.getItem(CONSENT_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    return Boolean(parsed?.analytics);
  } catch {
    return false;
  }
}

function installCrisp(websiteId) {
  if (document.getElementById(SCRIPT_ID)) return;
  // Crisp's loader expects $crisp and CRISP_WEBSITE_ID on window before the
  // script fetches. We set them here, then append the script tag.
  window.$crisp = window.$crisp || [];
  window.CRISP_WEBSITE_ID = websiteId;
  const s = document.createElement('script');
  s.id = SCRIPT_ID;
  s.src = 'https://client.crisp.chat/l.js';
  s.async = true;
  document.head.appendChild(s);
}

function removeCrisp() {
  // Crisp doesn't expose a clean `destroy`. We hide the chat box if the SDK
  // is up and remove our script tag so a future re-load re-evaluates gates.
  try {
    if (Array.isArray(window.$crisp)) window.$crisp.push(['do', 'chat:hide']);
  } catch {}
  const tag = document.getElementById(SCRIPT_ID);
  if (tag && tag.parentNode) tag.parentNode.removeChild(tag);
  // We intentionally don't delete window.$crisp — the Crisp runtime still
  // holds references to it. Future bootstraps will re-use the array.
}

export default function SupportWidget() {
  const { isOn } = useFeatureFlags();
  const [consented, setConsented] = useState(() => {
    if (typeof window === 'undefined') return false;
    return analyticsConsented();
  });

  // Re-check consent when localStorage changes (e.g. another tab). The
  // CookieConsentBanner in this tab doesn't fire a storage event on its own
  // writes, but it does re-render this tree, which re-runs this hook.
  useEffect(() => {
    function onStorage(ev) {
      if (ev.key === CONSENT_KEY) setConsented(analyticsConsented());
    }
    window.addEventListener('storage', onStorage);
    // Defensive: sync once on mount in case consent was written in the same
    // tab after this component first rendered.
    setConsented(analyticsConsented());
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const websiteId   = import.meta.env?.VITE_CRISP_WEBSITE_ID;
  const flagOn      = isOn('support_chat_enabled', false);
  const shouldLoad  = Boolean(websiteId) && flagOn && consented;

  useEffect(() => {
    if (!shouldLoad) {
      removeCrisp();
      return;
    }
    installCrisp(websiteId);
    // Cleanup on unmount: remove SDK so next mount re-checks gates.
    return () => removeCrisp();
  }, [shouldLoad, websiteId]);

  // No visible DOM — Crisp injects its own floating bubble.
  return null;
}
