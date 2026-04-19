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
import { apiFetch, apiJSON, API_BASE } from '../../utils/api';
import { useAuth } from '../../context/AuthContext';
import VaultDocChat from './VaultDocChat';
import AIDisclaimer from '../common/AIDisclaimer';
import './VaultPanel.css';

/**
 * Phase 3: Sanitize backend error messages — never show raw config errors to users.
 * Maps developer-facing errors to friendly user messages.
 */
function sanitizeVaultError(msg) {
  if (!msg) return 'Upload failed. Please try again.';
  const lower = msg.toLowerCase();
  if (lower.includes('postgres') || lower.includes('econnrefused') || lower.includes('connection terminated')
      || lower.includes('database') || lower.includes('set ') || lower.includes('not configured')) {
    return 'Knowledge Vault is initializing. Please try again in a moment.';
  }
  if (lower.includes('timeout') || lower.includes('not connected')) {
    return 'Connection timed out. Please try again.';
  }
  if (lower.includes('no extractable text') || lower.includes('unable to read')) {
    return 'Could not extract text from this file. Try a different format or file.';
  }
  if (lower.includes('unsupported file type')) {
    return msg; // This one is already user-friendly
  }
  if (lower.includes('vault limit') || lower.includes('plan allows')) {
    return msg; // Quota messages are already user-friendly
  }
  if (lower.includes('too large') || lower.includes('exceeds')) {
    return 'File is too large. Maximum file size is 10MB.';
  }
  // Catch-all: don't expose raw error strings
  return 'An error occurred processing the file. Please try a different file or try again.';
}

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
  // W3.5: admin-status diagnostic — populated from /api/auth/me/admin-status
  // so a founder who is locked out (wrong user ID in ADMIN_USER_IDS) sees a
  // precise hint in the Central Vault tab instead of silent absence.
  const [adminDiag, setAdminDiag] = useState(null); // { userId, email, isAdmin, reason, envConfigured }
  const [centralLoading, setCentralLoading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [selectedDocType, setSelectedDocType] = useState('auto');
  const [quota, setQuota] = useState(null);
  const [vaultHealth, setVaultHealth] = useState(null); // { ok, database, embeddings }
  const [chatDocId, setChatDocId] = useState(null);
  const [chatDocFilename, setChatDocFilename] = useState(null);
  const fileInputRef = useRef(null);
  const dropRef = useRef(null);

  // Vault health check — runs on mount and periodically if unhealthy
  useEffect(() => {
    let timer;
    const check = async () => {
      try {
        const res = await apiFetch('/api/vault/health');
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

  // Check admin status via the diagnostic endpoint instead of piggy-backing on
  // /api/vault/admin/documents (which silently 403s without a reason). The
  // diagnostic never 403s — it always returns { isAdmin, reason, userId, email }
  // so the founder can self-diagnose if they're locked out.
  useEffect(() => {
    async function checkAdmin() {
      try {
        const res = await apiFetch('/api/auth/me/admin-status');
        if (!res.ok) {
          // /me/admin-status should always 200 when requireAuth passes. If it
          // doesn't, surface the raw state so production issues aren't invisible.
          console.warn('[Vault] admin-status fetch non-OK:', res.status);
          setAdminDiag({ isAdmin: false, reason: `http_${res.status}` });
          return;
        }
        const diag = await res.json();
        setAdminDiag(diag);
        if (diag.isAdmin) {
          setIsAdmin(true);
          // Fetch central docs now that we know we have access
          try {
            const docsRes = await apiFetch('/api/vault/admin/documents');
            if (docsRes.ok) {
              const data = await docsRes.json();
              setCentralDocs(data.documents || []);
            }
          } catch (e) {
            console.warn('[Vault] central docs initial fetch failed:', e?.message || e);
          }
        } else {
          // Log the precise reason so the founder sees "not_in_allowlist" with
          // their own user ID + email in devtools and can update Render env.
          console.warn('[Vault] admin check → not admin:', diag);
        }
      } catch (e) {
        console.error('[Vault] admin-status fetch threw:', e?.message || e);
        setAdminDiag({ isAdmin: false, reason: 'network_error' });
      }
    }
    if (token) checkAdmin();
  }, [token]);

  // Fetch quota
  useEffect(() => {
    if (!token) return;
    apiFetch('/api/vault/quota')
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setQuota(data); })
      .catch(() => {});
  }, [token, documents.length]);

  // Fetch private documents
  const fetchDocuments = useCallback(async () => {
    try {
      setLoading(true);
      const data = await apiJSON('/api/vault/documents');
      setDocuments(data.documents || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [token]);

  // Fetch central vault documents (admin) — Phase 6: loading state + error handling.
  // W3.5: do NOT clobber the existing list on error. A failed refetch after a
  // successful upload used to blank the UI, making a real upload look like
  // "nothing happened". Instead surface a non-blocking error and keep the list.
  const fetchCentralDocs = useCallback(async () => {
    if (!isAdmin) return;
    setCentralLoading(true);
    try {
      const data = await apiJSON('/api/vault/admin/documents');
      setCentralDocs(data.documents || []);
    } catch (e) {
      console.error('[Vault] Central docs refetch failed (keeping previous list):', e.message);
      setError(`Could not refresh Central Vault list: ${e.message}. Your upload may still have succeeded — reload to verify.`);
    } finally {
      setCentralLoading(false);
    }
  }, [token, isAdmin]);

  useEffect(() => { fetchDocuments(); }, [fetchDocuments]);

  // Upload handler (core logic — used by both click and drag-and-drop)
  const handleUploadFile = useCallback(async (file) => {
    if (!file) return;
    const ext = file.name.toLowerCase().split('.').pop();
    const ACCEPTED = new Set(['pdf', 'docx', 'csv', 'tsv', 'txt', 'md', 'markdown', 'png', 'jpg', 'jpeg', 'tiff', 'tif']);
    if (!ACCEPTED.has(ext)) { setError(`Unsupported file type (.${ext}). Accepted: PDF, DOCX, CSV, TXT, MD, PNG, JPG, TIFF`); return; }
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
      // Phase 6: Pass user-selected document type (if not auto)
      if (selectedDocType && selectedDocType !== 'auto') {
        formData.append('docType', selectedDocType);
      }
      const uploadHeaders = token ? { Authorization: `Bearer ${token}` } : {};

      if (import.meta.env?.DEV) {
        // eslint-disable-next-line no-console
        console.log('[Vault] Uploading to:', uploadUrl, 'auth:', !!token, 'file:', file.name, file.size);
      }

      let res;
      try {
        res = await fetch(uploadUrl, { method: 'POST', headers: uploadHeaders, credentials: 'include', body: formData });
      } catch (networkErr) {
        // Network-level failure: CORS blocked, DNS failed, server unreachable, etc.
        console.error('[Vault] Network error:', networkErr);
        throw new Error(`Network error: ${networkErr.message}. Check if server is reachable at ${uploadUrl}`);
      }

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        const rawMsg = errData.message || errData.error || `HTTP ${res.status}`;
        console.error('[Vault Upload]', res.status, rawMsg, errData);
        throw new Error(`Upload failed (${res.status}): ${rawMsg}`);
      }
      const data = await res.json();
      const chunks = data.chunks || 0;
      const tickers = data.metadata?.tickers;
      const bank = data.metadata?.bank;

      // Build rich assimilation summary
      const insight = {
        filename: file.name,
        documentId: data.documentId,
        chunks,
        tickers: tickers || [],
        bank: bank || null,
        summary: `${chunks} passages extracted and indexed into your knowledge base.${bank ? ` Source identified: ${bank}.` : ''}${tickers?.length ? ` Key tickers detected: ${tickers.join(', ')}.` : ''} Particle AI will now use this document to enrich your answers.`,
      };
      setUploadInsight(insight);

      if (tab === 'central') await fetchCentralDocs(); else await fetchDocuments();
    } catch (e) {
      console.error('[Vault Upload Error]', e);
      // Show raw error for debugging — remove sanitization temporarily
      setError(e.message || 'Unknown upload error');
    } finally {
      setUploading(false);
      setUploadFileName('');
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, [token, tab, fetchDocuments, fetchCentralDocs]);

  // Drag-and-drop
  const handleDragOver = useCallback((e) => { e.preventDefault(); e.stopPropagation(); setDragOver(true); }, []);
  const handleDragLeave = useCallback((e) => { e.preventDefault(); e.stopPropagation(); setDragOver(false); }, []);
  const handleDrop = useCallback((e) => {
    e.preventDefault(); e.stopPropagation(); setDragOver(false);
    const files = e.dataTransfer?.files;
    if (files?.length > 0) handleUploadFile(files[0]);
  }, [handleUploadFile]);

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
      const deleteRes = await apiFetch(deleteUrl.replace(API_BASE, ''), { method: 'DELETE' });
      if (!deleteRes.ok) throw new Error('Delete failed');
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
      const data = await apiJSON('/api/vault/search', {
        method: 'POST',
        body: JSON.stringify({ query: searchQuery.trim() }),
      });
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

        {/* Phase 3: Particle-themed processing animation — particles converge into document */}
        {uploading && (
          <div className="vault-processing">
            <div className="vault-particle-field">
              {Array.from({ length: 12 }).map((_, i) => (
                <div key={i} className="vault-particle" style={{
                  '--delay': `${i * 0.15}s`,
                  '--angle': `${i * 30}deg`,
                  '--distance': `${35 + (i % 3) * 12}px`,
                }} />
              ))}
              <div className="vault-doc-target">
                <svg width="24" height="28" viewBox="0 0 24 28" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M4 1h12l6 6v20H4V1z" />
                  <path d="M16 1v6h6" />
                  <line x1="8" y1="12" x2="18" y2="12" opacity="0.4" />
                  <line x1="8" y1="16" x2="16" y2="16" opacity="0.4" />
                  <line x1="8" y1="20" x2="14" y2="20" opacity="0.4" />
                </svg>
              </div>
            </div>
            <div className="vault-processing-label">Extracting intelligence</div>
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
            <div className="vault-assimilated-meta">
              {uploadInsight.bank && <span className="vault-assimilated-tag">{uploadInsight.bank}</span>}
              {uploadInsight.tickers.map(t => (
                <span key={t} className="vault-assimilated-tag">{t}</span>
              ))}
              <span className="vault-assimilated-tag">{uploadInsight.chunks} passages</span>
            </div>
            {/* Phase 3: "Ready to chat" button — opens VaultDocChat pre-focused */}
            {uploadInsight.documentId && (
              <button
                className="vault-chat-ready-btn"
                onClick={() => { setChatDocId(uploadInsight.documentId); setUploadInsight(null); }}
              >
                Ready to chat about this document
              </button>
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
                ? 'Knowledge Vault is being configured. Document storage will be available shortly.'
                : vaultHealth.reconnecting
                  ? 'Knowledge Vault is reconnecting… Upload will be available in a moment.'
                  : 'Knowledge Vault is initializing. This usually takes a few seconds.'}
            </div>
          </div>
        )}

        {/* Upload area (when not uploading) */}
        {!uploading && (
          <>
            <input ref={fileInputRef} type="file" accept=".pdf,.docx,.csv,.tsv,.txt,.md,.png,.jpg,.jpeg,.tiff,.tif" onChange={handleUpload} style={{ display: 'none' }} />
            <div className={`vault-upload-area${vaultHealth && !vaultHealth.ok ? ' vault-upload-area--degraded' : ''}`}
                 onClick={() => fileInputRef.current?.click()}>
              <div className="vault-upload-icon-ring">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
                  <path d="M3 17v2a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-2" />
                </svg>
              </div>
              <span className="vault-upload-label">
                {tab === 'central' ? 'Upload to Central Vault' : 'Drop or click to upload'}
              </span>
              <span className="vault-upload-hint">
                {tab === 'central' ? 'Powers all users\' Particle AI answers' : 'PDF, DOCX, CSV, TXT, images \u00B7 up to 10MB'}
              </span>
              <span className="vault-upload-hint" style={{ fontSize: '8px', opacity: 0.3 }}>v2</span>
            </div>
            {/* Phase 6: Document type selector */}
            <div className="vault-doctype-row" style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '2px 8px' }}>
              <span style={{ color: 'var(--text-faint)', fontSize: '8px', letterSpacing: '0.05em' }}>Type:</span>
              <select
                className="vault-doctype-select"
                value={selectedDocType}
                onChange={(e) => { e.stopPropagation(); setSelectedDocType(e.target.value); }}
                onClick={(e) => e.stopPropagation()}
                style={{
                  background: 'var(--bg-app)', border: '1px solid var(--border-subtle)',
                  color: 'var(--text-muted)', fontSize: '8px', padding: '1px 4px',
                  fontFamily: 'var(--font-ui)', outline: 'none', cursor: 'pointer',
                }}
              >
                <option value="auto">Auto-detect</option>
                <option value="earnings_transcript">Earnings Transcript</option>
                <option value="research_report">Research Report</option>
                <option value="macro_commentary">Macro Commentary</option>
                <option value="filing">Filing (10-K/10-Q)</option>
                <option value="financial_table">Financial Table</option>
                <option value="default">Generic Document</option>
              </select>
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

        {/* W3.5: Admin self-diag banner.
            Shows only for the founder (ADMIN_EMAILS convention) when they
            expected central access but didn't get it — so they can see
            their own user ID and fix Render env vars. */}
        {adminDiag && !adminDiag.isAdmin && adminDiag.reason === 'not_in_allowlist' && (
          <div className="vault-toast vault-toast--error" style={{ fontSize: '11px', lineHeight: 1.4 }}>
            <span>
              <strong>Central Vault locked.</strong> You are user #{adminDiag.userId}
              {adminDiag.email ? ` (${adminDiag.email})` : ''}. To enable
              Central Vault uploads, set <code>ADMIN_EMAILS</code> on the server
              to include your email, or add your user ID to
              <code> ADMIN_USER_IDS</code>. (Current config:
              ADMIN_USER_IDS={adminDiag.envConfigured?.adminUserIds ? 'set' : 'unset'},
              ADMIN_EMAILS={adminDiag.envConfigured?.adminEmails ? 'set' : 'unset'})
            </span>
            <button className="vault-toast-dismiss" onClick={() => setAdminDiag({ ...adminDiag, reason: 'dismissed' })}>&times;</button>
          </div>
        )}

        {/* ── Documents Section ── */}
        <div className="vault-section-bar">
          <span className="vault-section-label">Documents</span>
          <div className="vault-section-line" />
          <span className="vault-section-count">{activeDocs.length}</span>
        </div>

        <div className="vault-docs-list">
          {(tab === 'central' ? centralLoading : loading) && (
            <div className="vault-empty-state">
              <span className="vault-empty-text">Loading documents...</span>
            </div>
          )}

          {!(tab === 'central' ? centralLoading : loading) && activeDocs.length === 0 && (
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

        <AIDisclaimer variant="foot" />
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
