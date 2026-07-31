/**
 * useEntitlement — ONE resolver for "what plan am I on and how much have I used".
 *
 * The information already existed but was surfaced nowhere: the user could not tell
 * on either platform whether they were on New / Dark / Nuclear Particle, whether a
 * trial was running out, or how close they were to their AI and vault limits.
 *
 * Desktop and mobile both consume this hook so the answer can never differ between
 * them (the same class of drift that gave us two watchlists).
 *
 * Sources:
 *   subscription  — AuthContext (tier, tierLabel, status, trialDaysRemaining)
 *   AI usage      — GET /api/auth/me/ai-usage  { tier, used, limit, remaining, resetAt }
 *   vault usage   — GET /api/vault/quota       { documents: { used, limit, unlimited } }
 */
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../utils/api';
import { swallow } from '../utils/swallow';

const TIER_LABELS = {
  trial: 'Trial',
  new_particle: 'New Particle',
  dark_particle: 'Dark Particle',
  nuclear_particle: 'Nuclear Particle',
};

export function tierLabelFor(tier) {
  if (!tier) return 'Particle';
  return TIER_LABELS[tier] || String(tier).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

const UNLIMITED = v => v === -1 || v === 'admin-bypass' || v === Infinity;

export function useEntitlement() {
  const { subscription, user } = useAuth?.() || {};
  const [ai, setAi] = useState(null);
  const [vault, setVault] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    let alive = true;
    setLoading(true);
    Promise.all([
      apiFetch('/api/auth/me/ai-usage').then(r => (r && r.ok ? r.json() : null)).catch(e => { swallow(e, 'entitlement.ai'); return null; }),
      apiFetch('/api/vault/quota').then(r => (r && r.ok ? r.json() : null)).catch(e => { swallow(e, 'entitlement.vault'); return null; }),
    ]).then(([a, v]) => {
      if (!alive) return;
      if (a) {
        setAi({
          used: a.admin ? 0 : (a.used ?? null),
          limit: a.admin ? 'unlimited' : (UNLIMITED(a.limit) ? 'unlimited' : a.limit ?? null),
          remaining: a.remaining ?? null,
          resetAt: a.resetAt ?? null,
        });
      }
      const d = v?.documents;
      if (d) {
        setVault({
          used: d.used ?? null,
          limit: d.unlimited || UNLIMITED(d.limit) ? 'unlimited' : d.limit ?? null,
        });
      }
      setLoading(false);
    });
    return () => { alive = false; };
  }, []);

  useEffect(() => load(), [load]);

  const tier = subscription?.tier || subscription?.planTier || ai?.tier || null;

  return {
    loading,
    email: user?.email || null,
    username: user?.username || null,
    tier,
    tierLabel: subscription?.tierLabel || tierLabelFor(tier),
    status: subscription?.status || null,                 // active | trial | expired
    trialDaysRemaining: subscription?.trialDaysRemaining ?? null,
    ai,                                                   // { used, limit, remaining, resetAt }
    vault,                                                // { used, limit }
    refresh: load,
  };
}
