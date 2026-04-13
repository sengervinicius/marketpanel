/**
 * VaultPanel.jsx — Knowledge Vault management UI.
 *
 * Redesigned to match Particle/Terminal premium aesthetic:
 *   - Sticky header with Vault gold accent
 *   - Grid layout with document list + search sections
 *   - Compact upload zone (not a giant dropbox)
 *   - Terminal-style document rows
 *
 * Two tabs:
 *   1. My Vault — user's private documents
 *   2. Central Vault — admin-only global research (visible to admins)
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { API_BASE } from '../../utils/api';
import { useAuth } from '../../context/AuthContext';
import './VaultPanel.css';

export default function VaultPanel({ fullScreen = false }) {
  const { token, user } = useAuth();
  const [tab, setTab] = useState('private'); // 'private' | 'central'
  const [documents, setDocuments] = useState([]);
  const [centralDocs, setCentralDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');
  const [uploadInsight, setUploadInsight] = useState(null);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [quota, setQuota] = useState(null);
  const fileInputRef = useRef(null);
  const dropRef = useRef(null);

  const headers = token ? { Authorization: `Bearer ${token}` } : {};

  // Check admin status
  useEffect(() => {
    async function checkAdmin() {
      try {
        const res = await fetch(`${API_BASE}/api/vault/admin/documents`, {
          headers,
          credentials: 'include',
        });
        if (res.ok) {
          setIsAdmin(true);
          const data = await res.json();
          setCentralDocs(data.documents || []);
        }
      } catch {
        // Not admin
      }
    }
    if (token) checkAdmin();
  }, [token]);

  // Fetch quota
  useEffect(() => {
    if (!token) return;
    fetch(`${API_BASE}/api/vault/quota`, { headers, credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setQuota(data); })
      .catch(() => {});
  }, [token, documents.length]);

  // Drag-and-drop
  const handleDragOver = useCallback((e) => { e.preventDefault(); e.stopPropagation(); setDragOver(true); }, []);
  const handleDragLeave = useCallback((e) => { e.preventDefault(); e.stopPropagation(); setDragOver(false); }, []);
  const handleDrop = useCallback((e) => {
    e.preventDefault(); e.stopPropagation(); setDragOver(false);
    const files = e.dataTransfer?.files;
    if (files?.length > 0) handleUploadFile(files[0]);
  }, [token, tab]);

  // Upload handler
  const handleUploadFile = useCallback(async (file) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.pdf')) { setError('Only PDF files are supported'); return; }
    if (file.size > 10 * 1024 * 1024) { setError('File size must be under 10MB'); return; }

    setUploading(true);
    setUploadProgress(`Processing ${file.name}...`);
    setError(null);
    setUploadInsight(null);

    const uploadUrl = tab === 'central'
      ? `${API_BASE}/api/vault/admin/upload`
      : `${API_BASE}/api/vault/upload`;

    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch(uploadUrl, { method: 'POST', headers, credentials: 'include', body: formData });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.message || errData.error || 'Upload failed');
      }
      const data = await res.json();
      const chunks = data.chunks || 0;
      const tickers = data.metadata?.tickers;
      const bank = data.metadata?.bank;

      let insight = `${file.name} indexed — ${chunks} passages.`;
      if (bank) insight += ` Source: ${bank}.`;
      if (tickers?.length) insight += ` Tickers: ${tickers.join(', ')}.`;
      setUploadInsight(insight);
      setUploadProgress('');

      if (tab === 'central') await fetchCentralDocs(); else await fetchDocuments();
      setTimeout(() => setUploadInsight(null), 8000);
    } catch (e) {
      setError(e.message);
      setUploadProgress('');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, [token, tab]);

  // Fetch private documents
  const fetchDocuments = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE}/api/vault/documents`, { headers, credentials: 'include' });
      if (!res.ok) throw new Error('Failed to load documents');
      const data = await res.json();
      setDocuments(data.documents || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [token]);

  // Fetch central vault documents (admin)
  const fetchCentralDocs = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const res = await fetch(`${API_BASE}/api/vault/admin/documents`, { headers, credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setCentralDocs(data.documents || []);
      }
    } catch {
      // Silent
    }
  }, [token, isAdmin]);

  useEffect(() => { fetchDocuments(); }, [fetchDocuments]);

  // Upload handler (click-based)
  const handleUpload = useCallback((e) => {
    const file = e.target.files?.[0];
    if (file) handleUploadFile(file);
  }, [handleUploadFile]);

  // Delete handler
  const handleDelete = useCallback(async (docId, filename) => {
    if (!confirm(`Delete "${filename}" from ${tab === 'central' ? 'the central' : 'your'} vault?`)) return;

    const deleteUrl = tab === 'central'
      ? `${API_BASE}/api/vault/admin/documents/${docId}`
      : `${API_BASE}/api/vault/documents/${docId}`;

    try {
      const res = await fetch(deleteUrl, { method: 'DELETE', headers, credentials: 'include' });
      if (!res.ok) throw new Error('Delete failed');
      if (tab === 'central') {
        setCentralDocs(prev => prev.filter(d => d.id !== docId));
      } else {
        setDocuments(prev => prev.filter(d => d.id !== docId));
      }
    } catch (e) {
      setError(e.message);
    }
  }, [token, tab]);

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
      setSearchResults(data.passages || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setSearching(false);
    }
  }, [searchQuery, token]);

  const fmtDate = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const activeDocs = tab === 'central' ? centralDocs : documents;
  const totalChunks = activeDocs.reduce((s, d) => s + (d.chunk_count || 0), 0);

  return (
    <div
      className={`vault-panel${fullScreen ? ' vault-panel--fullscreen' : ''}${dragOver ? ' vault-panel--dragover' : ''}`}
      ref={dropRef}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drag-over overlay */}
      {dragOver && (
        <div className="vault-drop-overlay">
          <div className="vault-drop-content">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" />
            </svg>
            <span>DROP PDF TO VAULT</span>
          </div>
        </div>
      )}

      {/* ── Sticky Header ── */}
      <div className="vault-top-bar">
        <div className="vault-top-accent" />
        <span className="vault-top-title">Vault</span>
        <span className="vault-top-badge">KNOWLEDGE</span>
        <div className="vault-top-spacer" />
        <div className="vault-top-stats">
          <div className="vault-stat">
            <span className="vault-stat-value">{activeDocs.length}</span>
            <span className="vault-stat-label">DOCS</span>
          </div>
          <div className="vault-stat">
            <span className="vault-stat-value">{totalChunks}</span>
            <span className="vault-stat-label">PASSAGES</span>
          </div>
          {quota && !quota.documents?.unlimited && (
            <div className="vault-stat">
              <span className="vault-stat-value">{quota.documents.used}/{quota.documents.limit}</span>
              <span className="vault-stat-label">{quota.tierLabel?.toUpperCase() || 'QUOTA'}</span>
            </div>
          )}
        </div>
      </div>

      {/* Quota bar (subtle) */}
      {quota && !quota.documents?.unlimited && (
        <div className="vault-quota-strip">
          <div className="vault-quota-bar">
            <div className="vault-quota-fill" style={{ width: `${Math.min(100, (quota.documents.used / quota.documents.limit) * 100)}%` }} />
          </div>
          <span className="vault-quota-label">{quota.documents.used}/{quota.documents.limit} docs</span>
        </div>
      )}

      {/* Admin tabs */}
      {isAdmin && (
        <div className="vault-tab-strip">
          <button
            className={`vault-tab-btn${tab === 'private' ? ' vault-tab-btn--active' : ''}`}
            onClick={() => setTab('private')}
          >
            My Vault
          </button>
          <button
            className={`vault-tab-btn${tab === 'central' ? ' vault-tab-btn--active' : ''}`}
            onClick={() => { setTab('central'); fetchCentralDocs(); }}
          >
            Central Vault
          </button>
        </div>
      )}

      {/* Status toasts */}
      {uploadInsight && (
        <div className="vault-toast vault-toast--success">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
          </svg>
          <span>{uploadInsight}</span>
        </div>
      )}

      {error && (
        <div className="vault-toast vault-toast--error">
          <span>{error}</span>
          <button className="vault-toast-dismiss" onClick={() => setError(null)}>&times;</button>
        </div>
      )}

      {/* ── Main Content Grid ── */}
      <div className="vault-body">
        {/* Left: Documents list */}
        <div className="vault-section">
          <div className="vault-section-head">
            <svg className="vault-section-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
            </svg>
            <span className="vault-section-title">Documents</span>
            <span className="vault-section-count">{activeDocs.length}</span>
          </div>

          {/* Upload zone (compact) */}
          <input ref={fileInputRef} type="file" accept=".pdf" onChange={handleUpload} style={{ display: 'none' }} />

          {uploading ? (
            <div className="vault-upload-progress-inline">
              <span className="vault-upload-spinner" />
              <span>{uploadProgress}</span>
            </div>
          ) : (
            <div className="vault-upload-zone" onClick={() => fileInputRef.current?.click()}>
              <div className="vault-upload-zone-icon">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
                </svg>
              </div>
              <div className="vault-upload-zone-text">
                <span className="vault-upload-zone-label">
                  {tab === 'central' ? 'Upload to Central Vault' : 'Upload PDF'}
                </span>
                <span className="vault-upload-zone-hint">
                  {tab === 'central' ? 'Powers all users\' AI answers' : 'Drop or click \u00B7 PDF up to 10MB'}
                </span>
              </div>
            </div>
          )}

          {/* Document list */}
          <div className="vault-section-body">
            {loading && <div className="vault-empty-state"><span className="vault-empty-text">Loading...</span></div>}

            {!loading && activeDocs.length === 0 && (
              <div className="vault-empty-state">
                <svg className="vault-empty-icon" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
                  <path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" />
                </svg>
                <span className="vault-empty-text">
                  {tab === 'central'
                    ? 'No central research yet. Upload professional reports.'
                    : 'No documents yet. Upload your first PDF to power your AI.'}
                </span>
              </div>
            )}

            {activeDocs.map(doc => (
              <div key={doc.id} className="vault-doc-row">
                <div className="vault-doc-icon">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
                  </svg>
                </div>
                <div className="vault-doc-info">
                  <span className="vault-doc-name" title={doc.filename}>
                    {doc.is_global && <span className="vault-badge-global">C</span>}
                    {doc.filename}
                  </span>
                  <span className="vault-doc-meta">
                    {doc.chunk_count ? <span className="vault-doc-chunks">{doc.chunk_count} chunks</span> : null}
                    {doc.metadata?.tickers && (
                      <span className="vault-doc-tickers">
                        {Array.isArray(doc.metadata.tickers) ? doc.metadata.tickers.join(', ') : doc.metadata.tickers}
                      </span>
                    )}
                    {doc.created_at && <span>{fmtDate(doc.created_at)}</span>}
                  </span>
                </div>
                <button className="vault-doc-delete" onClick={() => handleDelete(doc.id, doc.filename)} title="Delete">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Right: Search & Results */}
        <div className="vault-section">
          <div className="vault-section-head">
            <svg className="vault-section-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <span className="vault-section-title">Semantic Search</span>
            {searchResults && <span className="vault-section-count">{searchResults.length} results</span>}
          </div>

          {/* Search bar */}
          <form className="vault-search-bar" onSubmit={handleSearch}>
            <input
              className="vault-search-input"
              type="text"
              placeholder="Search your vault with natural language..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
            <button className="vault-search-btn" type="submit" disabled={searching || !searchQuery.trim()}>
              {searching ? '...' : 'Search'}
            </button>
          </form>

          <div className="vault-section-body">
            {/* Default state: helpful tips */}
            {!searchResults && !searching && (
              <div className="vault-empty-state">
                <svg className="vault-empty-icon" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
                  <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <span className="vault-empty-text">
                  Search across all your uploaded research. Particle AI also uses these documents to enrich answers.
                </span>
              </div>
            )}

            {/* Results */}
            {searchResults && searchResults.length === 0 && (
              <div className="vault-empty-state">
                <span className="vault-empty-text">No matching passages found. Try different keywords.</span>
              </div>
            )}

            {searchResults && searchResults.map((r, i) => (
              <div key={i} className="vault-result-row">
                <div className="vault-result-head">
                  {r.is_global && <span className="vault-badge-global">C</span>}
                  <span className="vault-result-source">{r.filename || r.doc_metadata?.bank || 'Unknown'}</span>
                  {r.similarity != null && (
                    <span className="vault-result-score">{(r.similarity * 100).toFixed(0)}%</span>
                  )}
                </div>
                <div className="vault-result-content">{r.content?.slice(0, 250)}...</div>
              </div>
            ))}

            {searchResults && searchResults.length > 0 && (
              <button className="vault-search-clear" onClick={() => setSearchResults(null)}>Clear Results</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
