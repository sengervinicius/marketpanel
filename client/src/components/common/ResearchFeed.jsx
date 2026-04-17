/**
 * ResearchFeed.jsx — Central Vault Research Feed
 *
 * Shows recently added global vault documents as a scrollable feed.
 * Users can browse and interact with professional research.
 */

import { useState, useEffect } from 'react';
import { API_BASE } from '../../utils/api';
import { useAuth } from '../../context/AuthContext';
import VaultDocChat from '../app/VaultDocChat';
import AIDisclaimer from './AIDisclaimer';
import './ResearchFeed.css';

export default function ResearchFeed() {
  const { token } = useAuth();
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedDocId, setSelectedDocId] = useState(null);
  const [selectedDocFilename, setSelectedDocFilename] = useState(null);

  const headers = token ? { Authorization: `Bearer ${token}` } : {};

  useEffect(() => {
    const fetchFeed = async () => {
      try {
        setLoading(true);
        const res = await fetch(`${API_BASE}/api/vault/feed`, {
          headers,
          credentials: 'include',
        });

        if (!res.ok) {
          throw new Error('Failed to fetch research feed');
        }

        const data = await res.json();
        setDocuments(data.documents || []);
        setError(null);
      } catch (err) {
        setError(err.message);
        setDocuments([]);
      } finally {
        setLoading(false);
      }
    };

    if (token) {
      fetchFeed();
      // Refresh feed every 5 minutes
      const timer = setInterval(fetchFeed, 5 * 60 * 1000);
      return () => clearInterval(timer);
    }
  }, [token]);

  const formatDate = (dateStr) => {
    try {
      const date = new Date(dateStr);
      const now = new Date();
      const diffMs = now - date;
      const diffMins = Math.floor(diffMs / 60000);
      const diffHours = Math.floor(diffMs / 3600000);
      const diffDays = Math.floor(diffMs / 86400000);

      if (diffMins < 60) return `${diffMins}m ago`;
      if (diffHours < 24) return `${diffHours}h ago`;
      if (diffDays < 7) return `${diffDays}d ago`;

      return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      });
    } catch {
      return dateStr?.split('T')[0] || '';
    }
  };

  const handleDocumentClick = (doc) => {
    setSelectedDocId(doc.id);
    setSelectedDocFilename(doc.filename);
  };

  const handleCloseChat = () => {
    setSelectedDocId(null);
    setSelectedDocFilename(null);
  };

  if (!token) {
    return (
      <div className="research-feed">
        <div className="research-feed-empty">
          <p>Sign in to access the Research Feed</p>
        </div>
      </div>
    );
  }

  return (
    <div className="research-feed">
      <div className="research-feed-header">
        <div className="research-feed-header-badge">📚 From the Vault</div>
        <h2 className="research-feed-title">Research Feed</h2>
        <p className="research-feed-subtitle">
          Latest professional research curated by Particle
        </p>
      </div>

      {error && (
        <div className="research-feed-error">
          <p>{error}</p>
        </div>
      )}

      {loading && (
        <div className="research-feed-loading">
          <div className="research-feed-spinner">⧖</div>
          <p>Loading research feed...</p>
        </div>
      )}

      {!loading && documents.length === 0 && !error && (
        <div className="research-feed-empty">
          <p>No documents in the research feed yet</p>
        </div>
      )}

      {!loading && documents.length > 0 && (
        <div className="research-feed-list">
          {documents.map((doc) => (
            <article
              key={doc.id}
              className="research-feed-item"
              onClick={() => handleDocumentClick(doc)}
              role="button"
              tabIndex={0}
            >
              <div className="research-feed-item-header">
                <h3 className="research-feed-item-title">{doc.filename}</h3>
                <span className="research-feed-item-date">
                  {formatDate(doc.createdAt)}
                </span>
              </div>

              <div className="research-feed-item-meta">
                {doc.bank && (
                  <span className="research-feed-item-bank">{doc.bank}</span>
                )}
                {doc.sector && (
                  <span className="research-feed-item-sector">{doc.sector}</span>
                )}
                {doc.docType && (
                  <span className="research-feed-item-type">{doc.docType}</span>
                )}
              </div>

              {doc.tickers && doc.tickers.length > 0 && (
                <div className="research-feed-item-tickers">
                  {doc.tickers.map((ticker, idx) => (
                    <span key={idx} className="research-feed-item-ticker">
                      ${ticker}
                    </span>
                  ))}
                </div>
              )}

              {doc.summary && (
                <p className="research-feed-item-summary">{doc.summary}</p>
              )}

              <div className="research-feed-item-cta">
                <span className="research-feed-item-cta-text">
                  Ask about this research →
                </span>
              </div>
            </article>
          ))}
        </div>
      )}

      {selectedDocId && (
        <div className="research-feed-chat-overlay">
          <VaultDocChat
            documentId={selectedDocId}
            filename={selectedDocFilename}
            onClose={handleCloseChat}
          />
        </div>
      )}
      <AIDisclaimer variant="foot" />
    </div>
  );
}
