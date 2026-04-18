/**
 * ImportWizard.jsx — W6.4 CSV portfolio import UI.
 *
 * Two-step modal:
 *   1. User picks a CSV file → POST /api/portfolio/import/preview
 *      We show the first 10 rows + a header→field mapping that's prefilled
 *      from the server's heuristic. User can tweak the mapping.
 *   2. User clicks "Import" → POST /api/portfolio/import/commit
 *      Server returns { added, rejected, warnings }. We show the result.
 *
 * The component is intentionally self-contained (no shared UI kit) so it can
 * be dropped in wherever a CSV import is useful — PortfolioPanel, onboarding,
 * settings. It relies only on the exported fetch/auth helpers in utils/api.
 */

import { useState, useRef } from 'react';
import { API_BASE, getAuthToken } from '../../utils/api';

const FIELDS = [
  { key: 'symbol',         label: 'Symbol / Ticker', required: true },
  { key: 'quantity',       label: 'Quantity' },
  { key: 'entryPrice',     label: 'Entry Price' },
  { key: 'investedAmount', label: 'Invested Amount' },
  { key: 'currency',       label: 'Currency' },
  { key: 'note',           label: 'Note' },
];

async function multipartPost(path, formData) {
  const token = getAuthToken();
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    credentials: 'include',
    body: formData,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.message || `HTTP ${res.status}`);
    err.status = res.status;
    err.data   = data;
    throw err;
  }
  return data;
}

export default function ImportWizard({ onClose, onImported }) {
  const fileInputRef = useRef(null);
  const [step, setStep]         = useState('pick');   // 'pick' | 'preview' | 'result'
  const [file, setFile]         = useState(null);
  const [preview, setPreview]   = useState(null);      // { headers, rows, detectedMapping, totalRows }
  const [mapping, setMapping]   = useState({});
  const [mode, setMode]         = useState('merge');   // 'merge' | 'replace'
  const [portfolioName, setPortfolioName] = useState('Imported');
  const [result, setResult]     = useState(null);      // { added, rejected, warnings }
  const [error, setError]       = useState(null);
  const [busy, setBusy]         = useState(false);

  async function handlePreview(e) {
    e?.preventDefault();
    setError(null);
    const f = fileInputRef.current?.files?.[0] || file;
    if (!f) { setError('Pick a CSV file first'); return; }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', f);
      const data = await multipartPost('/api/portfolio/import/preview', fd);
      setFile(f);
      setPreview(data);
      setMapping(data.detectedMapping || {});
      setStep('preview');
    } catch (e) {
      setError(e.message || 'Preview failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleCommit() {
    setError(null);
    if (!mapping.symbol) { setError('You must map a Symbol column.'); return; }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('mapping', JSON.stringify(mapping));
      fd.append('mode', mode);
      fd.append('portfolioName', portfolioName);
      const data = await multipartPost('/api/portfolio/import/commit', fd);
      setResult(data);
      setStep('result');
      if (typeof onImported === 'function') onImported(data);
    } catch (e) {
      setError(e?.data?.message || e.message || 'Import failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="iw-backdrop" role="dialog" aria-modal="true" aria-label="Import portfolio"
         style={backdropStyle} onClick={onClose}>
      <div className="iw-dialog" style={dialogStyle} onClick={e => e.stopPropagation()}>
        <header style={headerStyle}>
          <h2 style={{ margin: 0, fontSize: 16 }}>Import portfolio from CSV</h2>
          <button type="button" onClick={onClose} style={closeBtnStyle} aria-label="Close">×</button>
        </header>

        {error && <div style={errorStyle} role="alert">{error}</div>}

        {step === 'pick' && (
          <form onSubmit={handlePreview} style={{ padding: 16 }}>
            <p style={{ marginTop: 0, fontSize: 13, color: '#888' }}>
              Upload a CSV exported from your broker. We&apos;ll detect the columns and
              show you a preview before anything is written to your portfolio.
            </p>
            <input ref={fileInputRef} type="file" accept=".csv,.tsv,.txt,text/csv"
                   onChange={e => setFile(e.target.files?.[0] || null)} />
            <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" onClick={onClose} style={btnSecondaryStyle}>Cancel</button>
              <button type="submit" disabled={busy || !file} style={btnPrimaryStyle}>
                {busy ? 'Parsing…' : 'Preview'}
              </button>
            </div>
          </form>
        )}

        {step === 'preview' && preview && (
          <div style={{ padding: 16 }}>
            <div style={{ fontSize: 13, color: '#888', marginBottom: 8 }}>
              Detected {preview.totalRows} row(s), delimiter <code>{preview.delimiter || ','}</code>.
              Adjust the mapping if needed.
            </div>

            <table style={mappingTableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Our field</th>
                  <th style={thStyle}>Your column</th>
                </tr>
              </thead>
              <tbody>
                {FIELDS.map(f => (
                  <tr key={f.key}>
                    <td style={tdStyle}>{f.label}{f.required && <span style={{ color: '#e14' }}> *</span>}</td>
                    <td style={tdStyle}>
                      <select value={mapping[f.key] || ''}
                              onChange={e => setMapping(m => ({ ...m, [f.key]: e.target.value || undefined }))}
                              style={{ width: '100%' }}>
                        <option value="">— none —</option>
                        {preview.headers.map(h => <option key={h} value={h}>{h}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <details style={{ marginTop: 12, fontSize: 12 }}>
              <summary>Show first {preview.rows.length} row(s)</summary>
              <pre style={{ background: '#0b0b0b', color: '#ddd', padding: 8, overflow: 'auto', fontSize: 11 }}>
                {JSON.stringify(preview.rows, null, 2)}
              </pre>
            </details>

            <div style={{ marginTop: 16, display: 'grid', gap: 8, gridTemplateColumns: '1fr 1fr' }}>
              <label style={{ fontSize: 13 }}>
                Portfolio name
                <input value={portfolioName} onChange={e => setPortfolioName(e.target.value)}
                       maxLength={64} style={{ width: '100%', marginTop: 4 }} />
              </label>
              <label style={{ fontSize: 13 }}>
                Mode
                <select value={mode} onChange={e => setMode(e.target.value)}
                        style={{ width: '100%', marginTop: 4 }}>
                  <option value="merge">Merge into existing (safer)</option>
                  <option value="replace">Replace everything (destructive)</option>
                </select>
              </label>
            </div>

            <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'space-between' }}>
              <button type="button" onClick={() => setStep('pick')} style={btnSecondaryStyle}>Back</button>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" onClick={onClose} style={btnSecondaryStyle}>Cancel</button>
                <button type="button" onClick={handleCommit} disabled={busy || !mapping.symbol}
                        style={btnPrimaryStyle}>
                  {busy ? 'Importing…' : `Import ${preview.totalRows} row(s)`}
                </button>
              </div>
            </div>
          </div>
        )}

        {step === 'result' && result && (
          <div style={{ padding: 16 }}>
            <p style={{ fontSize: 14 }}>
              Imported <strong>{result.added}</strong> position(s).
              {result.rejected?.length > 0 && ` Skipped ${result.rejected.length} row(s).`}
            </p>
            {result.warnings?.length > 0 && (
              <ul style={{ fontSize: 12, color: '#b88' }}>
                {result.warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            )}
            {result.rejected?.length > 0 && (
              <details style={{ fontSize: 12 }}>
                <summary>Rejected rows ({result.rejected.length})</summary>
                <pre style={{ background: '#0b0b0b', color: '#ddd', padding: 8, overflow: 'auto', fontSize: 11 }}>
                  {JSON.stringify(result.rejected.slice(0, 20), null, 2)}
                </pre>
              </details>
            )}
            <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
              <button type="button" onClick={onClose} style={btnPrimaryStyle}>Done</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Inline styles so the component drops in without a CSS dependency.
const backdropStyle = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
};
const dialogStyle = {
  background: '#111', color: '#eee', borderRadius: 8, width: 'min(640px, 92vw)',
  maxHeight: '90vh', overflow: 'auto', boxShadow: '0 8px 40px rgba(0,0,0,0.5)',
};
const headerStyle = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  padding: '12px 16px', borderBottom: '1px solid #2a2a2a',
};
const closeBtnStyle = {
  background: 'none', border: 'none', color: '#aaa', fontSize: 22, cursor: 'pointer',
};
const errorStyle = {
  background: '#5a1a1a', color: '#fdd', padding: '8px 16px', fontSize: 13, borderBottom: '1px solid #742',
};
const btnPrimaryStyle = {
  background: '#2563eb', color: '#fff', border: 'none', padding: '6px 14px',
  borderRadius: 4, cursor: 'pointer', fontSize: 13,
};
const btnSecondaryStyle = {
  background: 'transparent', color: '#ccc', border: '1px solid #444',
  padding: '6px 14px', borderRadius: 4, cursor: 'pointer', fontSize: 13,
};
const mappingTableStyle = { width: '100%', borderCollapse: 'collapse', fontSize: 13 };
const thStyle = { textAlign: 'left', padding: '6px 4px', borderBottom: '1px solid #333', color: '#aaa' };
const tdStyle = { padding: '6px 4px', borderBottom: '1px solid #222' };
