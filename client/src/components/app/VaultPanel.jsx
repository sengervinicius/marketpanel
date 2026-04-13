/**
 * VaultPanel.jsx — Private Knowledge Vault management UI.
 *
 * Upload PDFs, view documents, delete, search vault contents.
 * Mounted inside the SettingsDrawer as a tab.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { API_BASE } from '../../utils/api';
import { useAuth } from '../../context/AuthContext';
import './VaultPanel.css';

export default function VaultPanel() {
  const { token } = useAuth();
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const fileInputRef = useRef(null);

  const headers = token ? { Authorization: `Bearer ${token}` } : {};

  // Fetch documents
  const fetchDocuments = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE}/api/vault/documents`, {
        headers,
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to load documents');
      const data = await res.json();
      setDocuments(data.documents || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { fetchDocuments(); }, [fetchDocuments]);

  // Upload handler
  const handleUpload = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.pdf')) {
      setError('Only PDF files are supported');
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      setError('File size must be under 10MB');
      return;
    }

    setUploading(true);
    setUploadProgress(`Uploading ${file.name}...`);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch(`${API_BASE}/api/vault/upload`, {
        method: 'POST',
        headers,
        credentials: 'include',
        body: formData,
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Upload failed');
      }

      const data = await res.json();
      setUploadProgress(`Processed: ${data.chunks || 0} chunks indexed`);

      // Refresh document list
      await fetchDocuments();

      setTimeout(() => setUploadProgress(''), 3000);
    } catch (e) {
      setError(e.message);
      setUploadProgress('');
    } finally {
      setUploading(false);
      // Reset file input so same file can be re-selected
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, [token, fetchDocuments]);

  // Delete handler
  const handleDelete = useCallback(async (docId, filename) => {
    if (!confirm(`Delete "${filename}" from your vault?`)) return;

    try {
      const res = await fetch(`${API_BASE}/api/vault/documents/${docId}`, {
        method: 'DELETE',
        headers,
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Delete failed');
      setDocuments(prev => prev.filter(d => d.id !== docId));
    } catch (e) {
      setError(e.message);
    }
  }, [token]);

  // Search handler
  const handleSearch = useCallback(async (e) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;

    setSearching(true);
    setSearchResults(null);

    try {
      const res = await fetch(`${API_BASE}/api/vault/search`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ query: searchQuery.trim() }),
      });
      if (!res.ok) throw new Error('Search failed');
      const data = await res.json();
      setSearchResults(data.results || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setSearching(false);
    }
  }, [searchQuery, token]);

  // Format date
  const fmtDate = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  return (
    <div className="vault-panel">
      <div className="vault-header">
        <span className="vault-title">Knowledge Vault</span>
        <span className="vault-subtitle">Upload research to power AI answers</span>
      </div>

      {/* Upload area */}
      <div className="vault-upload-area" onClick={() => !uploading && fileInputRef.current?.click()}>
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf"
          onChange={handleUpload}
          style={{ display: 'none' }}
        />
        {uploading ? (
          <div className="vault-upload-progress">
            <span className="vault-upload-spinner" />
            <span>{uploadProgress}</span>
          </div>
        ) : (
          <>
            <svg className="vault-upload-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            <span className="vault-upload-label">Upload PDF</span>
            <span className="vault-upload-hint">Max 10MB per file</span>
          </>
        )}
      </div>

      {uploadProgress && !uploading && (
        <div className="vault-success">{uploadProgress}</div>
      )}

      {error && (
        <div className="vault-error">
          {error}
          <button className="vault-error-dismiss" onClick={() => setError(null)}>&times;</button>
        </div>
      )}

      {/* Search */}
      <form className="vault-search" onSubmit={handleSearch}>
        <input
          className="vault-search-input"
          type="text"
          placeholder="Search your vault..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
        />
        <button className="vault-search-btn" type="submit" disabled={searching || !searchQuery.trim()}>
          {searching ? '...' : 'Search'}
        </button>
      </form>

      {/* Search results */}
      {searchResults && (
        <div className="vault-search-results">
          <div className="vault-section-label">
            {searchResults.length === 0 ? 'No matches found' : `${searchResults.length} passages found`}
          </div>
          {searchResults.map((r, i) => (
            <div key={i} className="vault-search-result">
              <div className="vault-result-source">
                {r.filename || r.doc_metadata?.bank || 'Unknown'}
                {r.similarity != null && (
                  <span className="vault-result-score">{(r.similarity * 100).toFixed(0)}% match</span>
                )}
              </div>
              <div className="vault-result-content">{r.content?.slice(0, 200)}...</div>
            </div>
          ))}
          <button className="vault-search-clear" onClick={() => setSearchResults(null)}>Clear results</button>
        </div>
      )}

      {/* Document list */}
      <div className="vault-section-label">
        {loading ? 'Loading...' : `${documents.length} document${documents.length !== 1 ? 's' : ''}`}
      </div>

      {!loading && documents.length === 0 && (
        <div className="vault-empty">
          No documents yet. Upload your first PDF to get started.
        </div>
      )}

      <div className="vault-doc-list">
        {documents.map(doc => (
          <div key={doc.id} className="vault-doc">
            <div className="vault-doc-info">
              <span className="vault-doc-name" title={doc.filename}>{doc.filename}</span>
              <span className="vault-doc-meta">
                {doc.chunk_count ? `${doc.chunk_count} chunks` : ''}
                {doc.metadata?.tickers && (
                  <span className="vault-doc-tickers">
                    {Array.isArray(doc.metadata.tickers) ? doc.metadata.tickers.join(', ') : doc.metadata.tickers}
                  </span>
                )}
                {doc.created_at && <span> &middot; {fmtDate(doc.created_at)}</span>}
              </span>
            </div>
            <button
              className="vault-doc-delete"
              onClick={() => handleDelete(doc.id, doc.filename)}
              title="Delete document"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
