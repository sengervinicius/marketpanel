/**
 * InstrumentDetailPage.jsx
 * Standalone page for popped-out instrument detail.
 * Route: /detail/:symbolKey
 *
 * Opens in a separate browser window via:
 *   window.open(window.location.origin + '/#/detail/AAPL', '_blank', 'width=1100,height=700')
 */

import { lazy, Suspense } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
const InstrumentDetail = lazy(() => import('../components/common/InstrumentDetail'));
import { useAuth } from '../context/AuthContext';

export default function InstrumentDetailPage() {
  const { symbolKey } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();

  const decodedSymbol = symbolKey ? decodeURIComponent(symbolKey) : null;

  if (!decodedSymbol) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100vh', background: '#0a0a0a', color: '#444',
        fontSize: 11,
      }}>
        No symbol specified.
      </div>
    );
  }

  return (
    <div style={{
      height: '100vh', background: '#0a0a0a', overflow: 'hidden',
      display: 'flex', flexDirection: 'column',
      fontFamily: 'var(--font-ui)',
    }}>
      {/* Minimal header for the pop-out window */}
      <div style={{
        height: 34, flexShrink: 0, display: 'flex', alignItems: 'center',
        background: '#000', borderBottom: '1px solid #1e1e1e',
        padding: '0 12px', gap: 10,
      }}>
        <span style={{ color: '#ff6600', fontWeight: 700, fontSize: 11, letterSpacing: '2px' }}>SENGER</span>
        <span style={{ color: '#2a2a2a', fontSize: 9, letterSpacing: '1px' }}>INSTRUMENT DETAIL</span>
        <div style={{ flex: 1 }} />
        {user && <span style={{ color: '#2a2a2a', fontSize: 8 }}>{user.username?.toUpperCase()}</span>}
        <button className="btn"
          onClick={() => window.close()}
          style={{
            background: 'none', border: '1px solid #1e1e1e', color: '#333',
            fontSize: 9, padding: '2px 8px', }}
        >CLOSE</button>
      </div>

      {/* Full InstrumentDetail in page mode (no overlay backdrop) */}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <Suspense fallback={<div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#555', fontSize: 11 }}>Loading...</div>}>
          <InstrumentDetail
            ticker={decodedSymbol}
            onClose={() => window.close()}
            asPage
          />
        </Suspense>
      </div>
    </div>
  );
}
