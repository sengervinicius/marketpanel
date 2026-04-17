/**
 * CookieConsentBanner.jsx — W1.1 LGPD-compliant consent UI.
 *
 * LGPD Art. 7º-8º requires granular, specific, informed, and unambiguous
 * consent for non-essential cookies. We split consent into three buckets:
 *
 *   - essential       (always on — auth, CSRF, session)
 *   - analytics       (Sentry perf, future GA)
 *   - marketing       (referral attribution, outbound campaigns)
 *
 * On "Accept all"  → all non-essential buckets ON
 * On "Reject all"  → only essential ON
 * On "Customize"   → user toggles each bucket; saved to localStorage
 *                    under `lgpd_consent_v1` AND synced to server
 *                    via POST /api/privacy/object for the logged-in case.
 *
 * We store the consent version, timestamp, and selections. If the banner
 * version is bumped (new bucket introduced) users are re-prompted.
 *
 * Wire this at the root of App so it appears before any tracking fires.
 */

import React, { useEffect, useMemo, useState } from 'react';

const STORAGE_KEY = 'lgpd_consent_v1';
const BANNER_VERSION = 1;

const DEFAULT_CONSENT = {
  version: BANNER_VERSION,
  essential: true,
  analytics: false,
  marketing: false,
  decidedAt: null,
};

function readConsent() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== BANNER_VERSION) return null;
    return parsed;
  } catch (_) { return null; }
}

function writeConsent(c) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(c));
  } catch (_) { /* storage blocked — fail closed to "not consented" */ }
}

async function syncWithServer(consent) {
  // Best-effort. Requires auth; silently noops for anon users.
  try {
    await fetch('/api/privacy/object', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        marketing: !consent.marketing,
        analytics: !consent.analytics,
      }),
    });
  } catch (_) { /* anonymous user or offline — local consent still wins */ }
}

export default function CookieConsentBanner({ locale = 'pt' }) {
  const [consent, setConsent] = useState(() => readConsent());
  const [open, setOpen] = useState(() => !readConsent());
  const [customize, setCustomize] = useState(false);
  const [draft, setDraft] = useState(DEFAULT_CONSENT);

  useEffect(() => {
    // Re-check on mount in case it was written in another tab.
    const current = readConsent();
    if (current) { setConsent(current); setOpen(false); }
  }, []);

  const L = useMemo(() => (locale === 'en' ? LOCALE_EN : LOCALE_PT), [locale]);

  if (!open) return null;

  const commit = async (next) => {
    const stamped = { ...next, version: BANNER_VERSION, decidedAt: new Date().toISOString() };
    writeConsent(stamped);
    setConsent(stamped);
    setOpen(false);
    await syncWithServer(stamped);
  };

  const acceptAll  = () => commit({ ...DEFAULT_CONSENT, analytics: true, marketing: true });
  const rejectAll  = () => commit({ ...DEFAULT_CONSENT });
  const saveChoice = () => commit(draft);

  return (
    <div role="dialog" aria-live="polite" aria-label={L.title}
         style={wrapperStyle}>
      <div style={bodyStyle}>
        <h3 style={titleStyle}>{L.title}</h3>
        <p style={textStyle}>{L.lede}{' '}
          <a href="/privacidade" style={linkStyle}>{L.policyLink}</a>
        </p>

        {customize && (
          <div style={gridStyle}>
            <ConsentToggle label={L.essential} sub={L.essentialSub}
                           checked disabled />
            <ConsentToggle label={L.analytics} sub={L.analyticsSub}
                           checked={draft.analytics}
                           onChange={(v) => setDraft({ ...draft, analytics: v })} />
            <ConsentToggle label={L.marketing} sub={L.marketingSub}
                           checked={draft.marketing}
                           onChange={(v) => setDraft({ ...draft, marketing: v })} />
          </div>
        )}

        <div style={btnRowStyle}>
          {!customize ? (
            <>
              <button style={btnSecondaryStyle} onClick={() => setCustomize(true)}>{L.customize}</button>
              <button style={btnSecondaryStyle} onClick={rejectAll}>{L.rejectAll}</button>
              <button style={btnPrimaryStyle} onClick={acceptAll}>{L.acceptAll}</button>
            </>
          ) : (
            <>
              <button style={btnSecondaryStyle} onClick={() => setCustomize(false)}>{L.back}</button>
              <button style={btnPrimaryStyle} onClick={saveChoice}>{L.save}</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ConsentToggle({ label, sub, checked, disabled, onChange }) {
  return (
    <label style={toggleRowStyle}>
      <input
        type="checkbox"
        checked={!!checked}
        disabled={!!disabled}
        onChange={(e) => onChange && onChange(e.target.checked)}
      />
      <span>
        <strong style={{ display: 'block' }}>{label}</strong>
        <span style={{ color: '#9aa', fontSize: 12 }}>{sub}</span>
      </span>
    </label>
  );
}

/** Small helper so other parts of the app can read current consent. */
export function getConsent() { return readConsent() || DEFAULT_CONSENT; }

const LOCALE_PT = {
  title: 'Cookies e privacidade',
  lede:  'Usamos cookies essenciais para manter a sua sessão. Com a sua permissão, também usamos cookies para medir desempenho e personalizar comunicações. Você pode revogar a qualquer momento.',
  policyLink: 'Política de Privacidade',
  essential:    'Essenciais',
  essentialSub: 'Autenticação, CSRF, sessão. Sempre ativos.',
  analytics:    'Analytics',
  analyticsSub: 'Medição de performance e diagnóstico (Sentry).',
  marketing:    'Marketing',
  marketingSub: 'Atribuição de indicações e campanhas. Opcional.',
  acceptAll: 'Aceitar tudo',
  rejectAll: 'Rejeitar tudo',
  customize: 'Personalizar',
  back:      'Voltar',
  save:      'Salvar escolha',
};

const LOCALE_EN = {
  title: 'Cookies & privacy',
  lede:  'We use essential cookies to keep you signed in. With your permission we also use cookies for performance measurement and marketing. You can change this at any time.',
  policyLink: 'Privacy policy',
  essential:    'Essential',
  essentialSub: 'Auth, CSRF, session. Always on.',
  analytics:    'Analytics',
  analyticsSub: 'Performance monitoring (Sentry).',
  marketing:    'Marketing',
  marketingSub: 'Referral attribution and campaigns. Optional.',
  acceptAll: 'Accept all',
  rejectAll: 'Reject all',
  customize: 'Customize',
  back:      'Back',
  save:      'Save choice',
};

const wrapperStyle = {
  position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 9999,
  padding: 16, background: 'rgba(10,14,20,0.97)', borderTop: '1px solid #1f2a3a',
  boxShadow: '0 -4px 24px rgba(0,0,0,0.4)',
};
const bodyStyle    = { maxWidth: 820, margin: '0 auto', color: '#dfe6ef' };
const titleStyle   = { margin: 0, fontSize: 14, letterSpacing: 0.3, textTransform: 'uppercase' };
const textStyle    = { marginTop: 8, marginBottom: 12, fontSize: 13, lineHeight: 1.5, color: '#b9c1cc' };
const linkStyle    = { color: '#63b3ed', textDecoration: 'underline' };
const gridStyle    = { display: 'grid', gap: 10, marginBottom: 12 };
const toggleRowStyle = { display: 'grid', gridTemplateColumns: '20px 1fr', gap: 8, alignItems: 'start' };
const btnRowStyle  = { display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' };
const btnPrimaryStyle = {
  background: '#2563eb', color: '#fff', border: 0, borderRadius: 6,
  padding: '8px 14px', cursor: 'pointer', fontSize: 13, fontWeight: 600,
};
const btnSecondaryStyle = {
  background: 'transparent', color: '#dfe6ef',
  border: '1px solid #2d3a4e', borderRadius: 6,
  padding: '8px 14px', cursor: 'pointer', fontSize: 13,
};
