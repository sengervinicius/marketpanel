/**
 * WelcomeModal.jsx — Phase 4 Onboarding
 *
 * Multi-step first-session onboarding:
 *   Step 1: Welcome + value proposition (cross-asset terminal + AI + vault)
 *   Step 2: Choose persona (investor type)
 *   Step 3: Add 3-5 tickers to watchlist — see them light up
 *   Step 4: Confirmation + prompt to try AI + vault
 *
 * Shown once for new users. Persisted via localStorage + settings.
 */
import { useEffect, useState, useCallback, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useWatchlist } from '../../context/WatchlistContext';
import { PERSONAS, getAvatarSrc } from '../../config/avatars';
import { apiFetch } from '../../utils/api';

const SUGGESTED_TICKERS = [
  { symbol: 'AAPL',     label: 'Apple' },
  { symbol: 'MSFT',     label: 'Microsoft' },
  { symbol: 'NVDA',     label: 'Nvidia' },
  { symbol: 'GOOGL',    label: 'Alphabet' },
  { symbol: 'AMZN',     label: 'Amazon' },
  { symbol: 'TSLA',     label: 'Tesla' },
  { symbol: 'META',     label: 'Meta' },
  { symbol: 'SPY',      label: 'S&P 500' },
  { symbol: 'QQQ',      label: 'Nasdaq 100' },
  { symbol: 'BTC',      label: 'Bitcoin',  full: 'X:BTCUSD' },
  { symbol: 'GLD',      label: 'Gold ETF' },
  { symbol: 'XLE',      label: 'Energy ETF' },
];

export default function WelcomeModal({ onClose, onComplete }) {
  const { user } = useAuth();
  const { watchlist, addToWatchlist } = useWatchlist();
  const [step, setStep] = useState(1);
  const [visible, setVisible] = useState(true);
  const [animate, setAnimate] = useState(false);
  const [selectedPersona, setSelectedPersona] = useState(null);
  const [savingPersona, setSavingPersona] = useState(false);
  const [selectedTickers, setSelectedTickers] = useState([]);
  const [addingTickers, setAddingTickers] = useState(false);

  const displayName = user?.username || user?.name || 'there';

  useEffect(() => { setAnimate(true); }, []);

  const handleDismiss = useCallback(() => {
    setVisible(false);
    try { localStorage.setItem('particle_onboarding_done', '1'); } catch {}
    onClose?.();
    onComplete?.();
  }, [onClose, onComplete]);

  const handleSelectPersona = useCallback(async (type) => {
    setSelectedPersona(type);
    setSavingPersona(true);
    try {
      await apiFetch('/api/users/persona', {
        method: 'PATCH',
        body: JSON.stringify({ type }),
      });
    } catch {}
    setSavingPersona(false);
    setStep(3);
  }, []);

  const toggleTicker = useCallback((sym) => {
    setSelectedTickers(prev =>
      prev.includes(sym) ? prev.filter(s => s !== sym) : [...prev, sym]
    );
  }, []);

  const handleAddTickers = useCallback(async () => {
    setAddingTickers(true);
    for (const t of selectedTickers) {
      const full = SUGGESTED_TICKERS.find(s => s.symbol === t)?.full || t;
      try { await addToWatchlist(full); } catch {}
    }
    setAddingTickers(false);
    setStep(4);
  }, [selectedTickers, addToWatchlist]);

  if (!visible) return null;

  return (
    <div style={styles.backdrop} onClick={(e) => e.target === e.currentTarget && step === 4 && handleDismiss()}>
      <style>{`
        @keyframes ob-fade { from { opacity: 0; } to { opacity: 1; } }
        @keyframes ob-slide { from { opacity: 0; transform: translateY(12px) scale(0.97); } to { opacity: 1; transform: translateY(0) scale(1); } }
        .ob-animate { animation: ob-fade 300ms ease-out; }
        .ob-animate .ob-card { animation: ob-slide 400ms ease-out; }
        .ob-persona-card { transition: all 0.15s; cursor: pointer; }
        .ob-persona-card:hover { border-color: rgba(255,102,0,0.5) !important; background: rgba(255,255,255,0.03) !important; }
        .ob-ticker-chip { transition: all 0.12s; cursor: pointer; }
        .ob-ticker-chip:hover { border-color: rgba(255,255,255,0.2) !important; }
      `}</style>

      <div style={styles.card} className={`ob-card ${animate ? 'ob-animate' : ''}`}>
        {/* Progress indicator */}
        <div style={styles.progress}>
          {[1,2,3,4].map(s => (
            <div key={s} style={{
              ...styles.progressDot,
              background: s <= step ? 'var(--color-particle, #F97316)' : 'rgba(255,255,255,0.1)',
            }} />
          ))}
        </div>

        {/* ── Step 1: Welcome ── */}
        {step === 1 && (
          <div>
            <h1 style={styles.title}>Welcome to The Particle{displayName !== 'there' ? `, ${displayName}` : ''}</h1>
            <p style={styles.subtitle}>Your cross-asset market terminal with AI intelligence</p>

            <div style={styles.pillars}>
              <div style={styles.pillar}>
                <div style={{ ...styles.pillarIcon, color: '#00bcd4' }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12" /></svg>
                </div>
                <div style={styles.pillarLabel}>Terminal</div>
                <div style={styles.pillarDesc}>Equities, FX, crypto, commodities, options, rates — all in one workspace</div>
              </div>
              <div style={styles.pillar}>
                <div style={{ ...styles.pillarIcon, color: '#F97316' }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
                </div>
                <div style={styles.pillarLabel}>Particle AI</div>
                <div style={styles.pillarDesc}>Ask anything — powered by your portfolio, live data, and research docs</div>
              </div>
              <div style={styles.pillar}>
                <div style={{ ...styles.pillarIcon, color: 'var(--color-vault-accent)' }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
                </div>
                <div style={styles.pillarLabel}>Vault</div>
                <div style={styles.pillarDesc}>Upload research PDFs — your AI gets smarter with every document</div>
              </div>
            </div>

            <button style={styles.primaryBtn} onClick={() => setStep(2)}>
              Set up your workspace
            </button>
            <button style={styles.skipBtn} onClick={handleDismiss}>
              Skip for now
            </button>
          </div>
        )}

        {/* ── Step 2: Choose Persona ── */}
        {step === 2 && (
          <div>
            <h2 style={styles.stepTitle}>What kind of investor are you?</h2>
            <p style={styles.stepSub}>This helps us personalize your experience</p>

            <div style={styles.personaGrid}>
              {(PERSONAS || []).slice(0, 6).map(p => (
                <div
                  key={p.type}
                  className="ob-persona-card"
                  style={{
                    ...styles.personaCard,
                    borderColor: selectedPersona === p.type ? 'var(--color-particle, #F97316)' : 'rgba(255,255,255,0.06)',
                    background: selectedPersona === p.type ? 'rgba(255,102,0,0.06)' : 'transparent',
                  }}
                  onClick={() => handleSelectPersona(p.type)}
                >
                  <div style={styles.personaEmoji}>{p.emoji || '📊'}</div>
                  <div style={styles.personaLabel}>{p.label}</div>
                </div>
              ))}
            </div>

            <button style={styles.skipBtn} onClick={() => setStep(3)}>
              Skip this step
            </button>
          </div>
        )}

        {/* ── Step 3: Add Tickers ── */}
        {step === 3 && (
          <div>
            <h2 style={styles.stepTitle}>Add tickers to your watchlist</h2>
            <p style={styles.stepSub}>Select 3-5 to see them light up across the terminal</p>

            <div style={styles.tickerGrid}>
              {SUGGESTED_TICKERS.map(t => {
                const isSelected = selectedTickers.includes(t.symbol);
                return (
                  <div
                    key={t.symbol}
                    className="ob-ticker-chip"
                    style={{
                      ...styles.tickerChip,
                      borderColor: isSelected ? 'var(--color-particle, #F97316)' : 'rgba(255,255,255,0.08)',
                      background: isSelected ? 'rgba(255,102,0,0.1)' : 'rgba(255,255,255,0.02)',
                      color: isSelected ? '#F97316' : '#ccc',
                    }}
                    onClick={() => toggleTicker(t.symbol)}
                  >
                    <span style={{ fontWeight: 700, fontSize: 13 }}>{t.symbol}</span>
                    <span style={{ fontSize: 9, color: isSelected ? 'rgba(255,102,0,0.7)' : '#666', marginTop: 1 }}>{t.label}</span>
                  </div>
                );
              })}
            </div>

            <button
              style={{
                ...styles.primaryBtn,
                opacity: selectedTickers.length < 1 ? 0.4 : 1,
                pointerEvents: selectedTickers.length < 1 || addingTickers ? 'none' : 'auto',
              }}
              onClick={handleAddTickers}
            >
              {addingTickers ? 'Adding...' : `Add ${selectedTickers.length} ticker${selectedTickers.length !== 1 ? 's' : ''} to watchlist`}
            </button>
            <button style={styles.skipBtn} onClick={() => setStep(4)}>
              Skip for now
            </button>
          </div>
        )}

        {/* ── Step 4: Done — prompt AI + Vault ── */}
        {step === 4 && (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 40, marginBottom: 16 }}>✓</div>
            <h2 style={styles.stepTitle}>You're all set!</h2>
            <p style={styles.stepSub}>
              {selectedTickers.length > 0
                ? `${selectedTickers.join(', ')} are now in your watchlist — you'll see them across all panels.`
                : 'Your workspace is ready.'}
            </p>

            <div style={styles.nextSteps}>
              <div style={styles.nextStep}>
                <span style={{ color: '#F97316', fontWeight: 700 }}>Try Particle AI →</span>
                <span style={{ fontSize: 11, color: '#888' }}>Ask "What's happening in markets today?"</span>
              </div>
              <div style={styles.nextStep}>
                <span style={{ color: 'var(--color-vault-accent)', fontWeight: 700 }}>Upload a PDF →</span>
                <span style={{ fontSize: 11, color: '#888' }}>Your AI answers become grounded in your research</span>
              </div>
            </div>

            <button style={styles.primaryBtn} onClick={handleDismiss}>
              Start exploring
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

const styles = {
  backdrop: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 10000,
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    fontFamily: 'var(--font-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif)',
  },
  card: {
    background: '#0d0d0d', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12,
    padding: '36px 32px 32px', maxWidth: 520, width: '100%',
    boxShadow: '0 24px 64px rgba(0,0,0,0.5)', maxHeight: '90vh', overflowY: 'auto',
  },
  progress: {
    display: 'flex', gap: 6, justifyContent: 'center', marginBottom: 28,
  },
  progressDot: {
    width: 32, height: 3, borderRadius: 2, transition: 'background 0.3s',
  },
  title: {
    fontSize: 22, fontWeight: 700, color: '#e8e8e8', margin: '0 0 8px', lineHeight: 1.3,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 13, color: '#888', margin: '0 0 28px', textAlign: 'center', lineHeight: 1.5,
  },
  pillars: {
    display: 'flex', gap: 16, marginBottom: 28, flexWrap: 'wrap', justifyContent: 'center',
  },
  pillar: {
    flex: '1 1 140px', maxWidth: 160, padding: '16px 12px', textAlign: 'center',
    background: 'rgba(255,255,255,0.02)', borderRadius: 8,
    border: '1px solid rgba(255,255,255,0.04)',
  },
  pillarIcon: { marginBottom: 8, display: 'flex', justifyContent: 'center' },
  pillarLabel: { fontSize: 12, fontWeight: 700, color: '#ddd', marginBottom: 4, letterSpacing: '0.3px' },
  pillarDesc: { fontSize: 10, color: '#777', lineHeight: 1.5 },
  primaryBtn: {
    width: '100%', padding: '12px 24px', background: 'var(--color-particle, #F97316)',
    color: '#000', border: 'none', borderRadius: 6, fontSize: 14, fontWeight: 600,
    cursor: 'pointer', letterSpacing: '0.3px', marginBottom: 8,
    transition: 'opacity 0.15s, transform 0.1s',
  },
  skipBtn: {
    width: '100%', padding: '8px 16px', background: 'transparent', border: 'none',
    color: '#555', fontSize: 12, cursor: 'pointer', letterSpacing: '0.3px',
  },
  stepTitle: {
    fontSize: 18, fontWeight: 700, color: '#e8e8e8', margin: '0 0 6px', textAlign: 'center',
  },
  stepSub: {
    fontSize: 12, color: '#888', margin: '0 0 20px', textAlign: 'center', lineHeight: 1.5,
  },
  personaGrid: {
    display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 20,
  },
  personaCard: {
    padding: '14px 8px', textAlign: 'center', borderRadius: 8,
    border: '1px solid rgba(255,255,255,0.06)',
  },
  personaEmoji: { fontSize: 24, marginBottom: 6 },
  personaLabel: { fontSize: 11, fontWeight: 600, color: '#ccc' },
  tickerGrid: {
    display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 20,
  },
  tickerChip: {
    padding: '10px 8px', textAlign: 'center', borderRadius: 8,
    border: '1px solid rgba(255,255,255,0.08)', display: 'flex', flexDirection: 'column',
    alignItems: 'center', gap: 2,
  },
  nextSteps: {
    display: 'flex', flexDirection: 'column', gap: 12, margin: '20px 0 24px',
    textAlign: 'left', padding: '0 8px',
  },
  nextStep: {
    display: 'flex', flexDirection: 'column', gap: 2,
    padding: '10px 14px', background: 'rgba(255,255,255,0.02)', borderRadius: 8,
    border: '1px solid rgba(255,255,255,0.04)',
  },
};
