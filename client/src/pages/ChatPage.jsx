/**
 * ChatPage.jsx
 * Standalone page for popped-out chat.
 * Route: /chat  or  /chat/:userId
 *
 * Phase 3B: Migrated to CSS classes + design tokens.
 */

import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { ChatPanel } from '../components/panels/ChatPanel';
import { useAuth } from '../context/AuthContext';

export default function ChatPage() {
  const { userId } = useParams();
  const { user } = useAuth();
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  return (
    <div style={{
      height: '100vh', background: 'var(--bg-app)', overflow: 'hidden',
      display: 'flex', flexDirection: 'column',
      fontFamily: 'var(--font-ui)',
    }}>
      {/* Minimal header */}
      <div className="chat-page-header">
        <span className="chat-page-brand">PARTICLE</span>
        <span className="chat-page-subtitle">MESSAGES</span>
        <div style={{ flex: 1 }} />
        {user && <span className="chat-page-user">{user.username?.toUpperCase()}</span>}
        <button className="btn chat-page-btn"
          onClick={() => { window.location.hash = '#/'; }}
        >{'\u2190'} TERMINAL</button>
        <button className="btn chat-page-btn chat-page-btn--muted"
          onClick={() => {
            if (window.opener) {
              window.close();
            } else {
              window.location.hash = '#/';
            }
          }}
        >CLOSE</button>
      </div>

      {/* Full-size ChatPanel */}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <ChatPanel mobile={isMobile} initialUserId={userId ? Number(userId) : null} />
      </div>
    </div>
  );
}
