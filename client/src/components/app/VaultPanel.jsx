/**
 * VaultPanel.jsx — Knowledge Vault · Full-screen futuristic design
 *
 * Matches Particle aesthetic with:
 *   - Playfair Display hero header
 *   - "Nuclear reactor" processing animation for PDF uploads
 *   - Assimilation summary after each upload
 *   - Immersive dark design with vault gold accents
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { API_BASE } from '../../utils/api';
import { useAuth } from '../../context/AuthContext';
import VaultDocChat from './VaultDocChat';
import './VaultPanel.css';

export default function VaultPanel({ fullScreen = false }) {
  const { token, user } = useAuth();
  const [tab, setTab] = useState('private');
  const [documents, setDocuments] = useState([]);
  const [centralDocs, setCentralDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadFileName, setUploadFileName] = useState('');
  const [uploadInsight, setUploadInsight] = useState(null);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [quota, setQuota] = useState(null);
  const [vaultHealth, setVaultHealth] = useState(null); // { ok, database, embeddings }
  const [chatDocId, setChatDocId] = useState(null);
  const [chatDocFilename, setChatDocFilename] = useState(null);
  const fileInputRef = useRef(null);
  const dropRef = useRef(null);

  const headers = token ? { Authorization: `Bearer ${token}` } : {};

  // Vault health check — runs on mount and periodically if unhealthy
  useEffect(() => {
    let timer;
    const check = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/vault/health`, { credentials: 'include' });
        const data = await res.json();
        setVaultHealth(data);
        // If unhealthy, recheck every 15 seconds
        if (!data.ok) {
          timer = setTimeout(check, 15_000);
        }
      } catch {
        setVaultHealth({ ok: false, database: 'unreachable' });
        timer = setTimeout(check, 15_000);
      }
    };
    check();
    return () => clearTimeout(timer);
  }, []);

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
    setUploadFileName(file.name);
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

      // Build rich assimilation summary
      const insight = {
        filename: file.name,
        chunks,
        tickers: tickers || [],
        bank: bank || null,
        summary: `${chunks} passages extracted and indexed into your knowledge base.${bank ? ` Source identified: ${bank}.` : ''}${tickers?.length ? ` Key tickers detected: ${tickers.join(', ')}.` : ''} Particle AI will now use this document to enrich your answers.`,
      };
      setUploadInsight(insight);

      if (tab === 'central') await fetchCentralDocs(); else await fetchDocuments();
    } catch (e) {
      setError(e.message);
    } finally {
      setUploading(false);
      setUploadFileName('');
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
      {/* Drag-over overlay with reactor animation */}
      {dragOver && (
        <div className="vault-drop-overlay">
          <div className="vault-drop-content">
            <div className="vault-drop-rings">
              <div className="vault-drop-ring" />
              <div className="vault-drop-ring" />
              <div className="vault-drop-ring" />
              <div className="vault-drop-core" />
            </div>
            <span className="vault-drop-text">Drop to Assimilate</span>
          </div>
        </div>
      )}

      {/* ── Hero Header ── */}
      <div className="vault-hero">
        <h1 className="vault-hero-title">The <span>Vault</span></h1>
        <div className="vault-hero-sub">Knowledge Intelligence</div>
        <div className="vault-hero-stats">
          <div className="vault-hero-stat">
            <span className="vault-hero-stat-value">{activeDocs.length}</span>
            <span className="vault-hero-stat-label">Documents</span>
          </div>
          <div className="vault-hero-divider" />
          <div className="vault-hero-stat">
            <span className="vault-hero-stat-value">{totalChunks}</span>
            <span className="vault-hero-stat-label">Passages</span>
          </div>
          {quota && !quota.documents?.unlimited && (
            <>
              <div className="vault-hero-divider" />
              <div className="vault-hero-stat">
                <span className="vault-hero-stat-value">{quota.documents.used}/{quota.documents.limit}</span>
                <span className="vault-hero-stat-label">{quota.tierLabel?.toUpperCase() || 'Quota'}</span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Scrollable content */}
      <div className="vault-content">

        {/* Nuclear processing animation */}
        {uploading && (
          <div className="vault-processing">
            <div className="vault-scan-lines">
              <div className="vault-scan-line" />
              <div className="vault-scan-line" />
              <div className="vault-scan-line" />
            </div>
            <div className="vault-reactor">
              <div className="vault-reactor-core" />
              <div className="vault-reactor-ring" />
              <div className="vault-reactor-ring" />
              <div className="vault-reactor-ring" />
            </div>
            <div className="vault-processing-label">Assimilating</div>
            <div className="vault-processing-file">{uploadFileName}</div>
          </div>
        )}

        {/* Assimilation summary (after upload) */}
        {uploadInsight && !uploading && (
          <div className="vault-assimilated">
            <div className="vault-assimilated-header">
              <div className="vault-assimilated-icon">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
              <span className="vault-assimilated-title">Assimilation Complete</span>
              <button className="vault-assimilated-dismiss" onClick={() => setUploadInsight(null)}>&times;</button>
            </div>
            <div className="vault-assimilated-body">{uploadInsight.summary}</div>
            {(uploadInsight.tickers.length > 0 || uploadInsight.bank) && (
              <div className="vault-assimilated-meta">
                {uploadInsight.bank && <span className="vault-assimilated-tag">{uploadInsight.bank}</span>}
                {uploadInsight.tickers.map(t => (
                  <span key={t} className="vault-assimilated-tag">{t}</span>
                ))}
                <span className="vault-assimilated-tag">{uploadInsight.chunks} passages</span>
              </div>
            )}
          </div>
        )}

        {/* Database status banner — shows when vault DB is down */}
        {vaultHealth && !vaultHealth.ok && (
          <div className="vault-db-banner">
            <div className="vault-db-banner-icon">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>
            <div className="vault-db-banner-text">
              {vaultHealth.database === 'not_configured'
                ? 'Vault database is not configured. Set POSTGRES_URL on the server to enable document storage.'
                : vaultHealth.reconnecting
                  ? 'Vault database is reconnecting… Upload will be available shortly.'
                  : 'Vault database is currently offline. The server is attempting to reconnect automatically.'}
            </div>
          </div>
        )}

        {/* Upload area (when not uploading) */}
        {!uploading && (
          <>
            <input ref={fileInputRef} type="file" accept=".pdf" onChange={handleUpload} style={{ display: 'none' }} />
            <div className={`vault-upload-area${vaultHealth && !vaultHealth.ok ? ' vault-upload-area--disabled' : ''}`}
                 onClick={() => vaultHealth?.ok !== false && fileInputRef.current?.click()}>
              <div className="vault-upload-icon-ring">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
                  <path d="M3 17v2a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-2" />
                </svg>
              </div>
              <span className="vault-upload-label">
                {tab === 'central' ? 'Upload to Central Vault' : 'Drop or click to upload PDF'}
              </span>
              <span className="vault-upload-hint">
                {tab === 'central' ? 'Powers all users\' Particle AI answers' : 'PDF up to 10MB \u00B7 Indexed for AI retrieval'}
              </span>
            </div>
          </>
        )}

        {/* Quota bar */}
        {quota && !quota.documents?.unlimited && (
          <div className="vault-quota-strip">
            <div className="vault-quota-bar">
              <div className="vault-quota-fill" style={{ width: `${Math.min(100, (quota.documents.used / quota.documents.limit) * 100)}%` }} />
            </div>
            <span className="vault-quota-label">{quota.documents.used}/{quota.documents.limit}</span>
          </div>
        )}

        {/* Error / success toasts */}
        {error && (
          <div className="vault-toast vault-toast--error">
            <span>{error}</span>
            <button className="vault-toast-dismiss" onClick={() => setError(null)}>&times;</button>
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

        {/* ── Documents Section ── */}
        <div className="vault-section-bar">
          <span className="vault-section-label">Documents</span>
          <div className="vault-section-line" />
          <span className="vault-section-count">{activeDocs.length}</span>
        </div>

        <div className="vault-docs-list">
          {loading && (
            <div className="vault-empty-state">
              <span className="vault-empty-text">Loading documents...</span>
            </div>
          )}

          {!loading && activeDocs.length === 0 && (
            <div className="vault-empty-state">
              <svg className="vault-empty-icon" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
                <path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" />
              </svg>
              <span className="vault-empty-text">
                {tab === 'central'
                  ? 'No central research yet. Upload professional reports to power all users.'
                  : 'Your vault is empty. Upload your first PDF and Particle AI will use it to enrich your answers.'}
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
              <button
                className="vault-doc-ask"
                onClick={() => { setChatDocId(doc.id); setChatDocFilename(doc.filename); }}
                title="Ask a question about this document"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
              </button>
              <button className="vault-doc-delete" onClick={() => handleDelete(doc.id, doc.filename)} title="Delete">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                </svg>
              </button>
            </div>
          ))}
        </div>

        {/* ── Semantic Search Section ── */}
        <div className="vault-section-bar">
          <span className="vault-section-label">Semantic Search</span>
          <div className="vault-section-line" />
          {searchResults && <span className="vault-section-count">{searchResults.length} results</span>}
        </div>

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

        <div className="vault-results-list">
          {!searchResults && !searching && (
            <div className="vault-empty-state">
              <svg className="vault-empty-icon" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
                <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <span className="vault-empty-text">
                Search across all your uploaded research. Particle AI also uses these documents automatically.
              </span>
            </div>
          )}

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

      {/* Document Q&A Chat */}
      {chatDocId && (
        <VaultDocChat
          documentId={chatDocId}
          filename={chatDocFilename}
          onClose={() => { setChatDocId(null); setChatDocFilename(null); }}
        />
      )}
    </div>
  );
}
