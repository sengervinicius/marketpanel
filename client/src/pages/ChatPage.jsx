/**
 * ChatPage.jsx
 * Standalone page for popped-out chat.
 * Route: /chat  or  /chat/:userId
 *
 * Opens in a separate browser window via:
 *   window.open(window.location.origin + '/#/chat', '_blank', 'width=800,height=600')
 *   window.open(window.location.origin + '/#/chat/42', '_blank', 'width=800,height=600')
 */

import { useParams } from 'react-router-dom';
import { ChatPanel } from '../components/panels/ChatPanel';
import { useAuth } from '../context/AuthContext';

export default function ChatPage() {
  const { userId } = useParams();
  const { user } = useAuth();

  return (
    <div style={{
      height: '100vh', background: '#0a0a0a', overflow: 'hidden',
      display: 'flex', flexDirection: 'column',
      fontFamily: "'IBM Plex Mono', monospace",
    }}>
      {/* Minimal header */}
      <div style={{
        height: 34, flexShrink: 0, display: 'flex', alignItems: 'center',
        background: '#000', borderBottom: '1px solid #1e1e1e',
        padding: '0 12px', gap: 10,
      }}>
        <span style={{ color: '#ff6600', fontWeight: 700, fontSize: 11, letterSpacing: '2px' }}>SENGER</span>
        <span style={{ color: '#2a2a2a', fontSize: 9, letterSpacing: '1px' }}>MESSAGES</span>
        <div style={{ flex: 1 }} />
        {user && <span style={{ color: '#2a2a2a', fontSize: 8 }}>{user.username?.toUpperCase()}</span>}
        <button
          onClick={() => { window.location.hash = '#/'; }}
          style={{
            background: 'none', border: '1px solid #1e1e1e', color: '#ff6600',
            fontSize: 9, padding: '2px 8px', cursor: 'pointer', fontFamily: 'inherit',
          }}
        >← TERMINAL</button>
        <button
          onClick={() => {
            // If this is a popped-out window, close it; otherwise navigate back to terminal
            if (window.opener) {
              window.close();
            } else {
              window.location.hash = '#/';
            }
          }}
          style={{
            background: 'none', border: '1px solid #1e1e1e', color: '#333',
            fontSize: 9, padding: '2px 8px', cursor: 'pointer', fontFamily: 'inherit',
          }}
        >CLOSE</button>
      </div>

      {/* Full-size ChatPanel */}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <ChatPanel initialUserId={userId ? Number(userId) : null} />
      </div>
    </div>
  );
}
