import React, { useState, useEffect } from 'react';
import { formatSize } from '../utils.js';

const ALL_PREFIXES = [
  { id: 'upload', label: 'Uploads (originals)', recommended: true },
  { id: 'library', label: 'Library (organized copies)', recommended: false },
  { id: 'encoded-video', label: 'Encoded Videos (regenerable)', recommended: false },
  { id: 'backups', label: 'DB Backups', recommended: false },
];

export default function RestorePanel({ onToast, wsEvents }) {
  const [status, setStatus] = useState(null);
  const [files, setFiles] = useState({ files: [], total: 0 });
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [selectedPrefixes, setSelectedPrefixes] = useState(['upload']);
  const [immichOnly, setImmichOnly] = useState(true);

  const fetchStatus = () => fetch('/api/restore/status').then(r => r.json()).then(setStatus).catch(() => {});
  const fetchFiles = (p = 0) => fetch(`/api/restore/files?limit=50&offset=${p * 50}`).then(r => r.json()).then(setFiles).catch(() => {});

  useEffect(() => {
    if (!wsEvents || !wsEvents[0]) return;
    const last = wsEvents[0];
    if (last.type === 'restore:scan-done' || last.type === 'restore:done') {
      fetchStatus();
      fetchFiles(page);
    }
    if (last.type === 'restore:progress') {
      setStatus(prev => prev ? { ...prev, progress: last.data, restoring: true } : prev);
    }
  }, [wsEvents]);

  const togglePrefix = (id) => {
    setSelectedPrefixes(prev =>
      prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]
    );
  };

  const handleScan = async () => {
    if (selectedPrefixes.length === 0) { onToast('Select at least one prefix', 'error'); return; }
    onToast('Scanning Azure for missing files...', 'info', 10000);
    await fetch('/api/restore/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefixes: selectedPrefixes, immichOnly }),
    });
    const poll = setInterval(() => { fetchStatus(); fetchFiles(0); }, 3000);
    setTimeout(() => clearInterval(poll), 300000);
  };

  const handleRestoreAll = async () => {
    if (!status?.scan?.missingCount) return;
    const count = status.scan.missingCount;
    const size = formatSize(status.scan.missingSize);
    if (!window.confirm(`Download ${count} files (${size}) from Azure to local disk?\n\nThis will restore missing files to your immich directory.`)) return;
    onToast(`Restoring ${count} files from Azure...`, 'info', 10000);
    await fetch('/api/restore/all', { method: 'POST' });
  };

  const handleRestoreOne = async (blobName) => {
    const res = await fetch('/api/restore/file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ blobName }),
    });
    const data = await res.json();
    if (data.success) { onToast(`Restored: ${blobName.split('/').pop()}`, 'success'); fetchStatus(); fetchFiles(page); }
    else { onToast(`Failed: ${data.error}`, 'error'); }
  };

  const totalPages = Math.ceil(files.total / 50);
  const isRestoring = status?.restoring;
  const isScanning = status?.scanning;
  const scan = status?.scan;
  const progress = status?.progress;

  return (
    <div className="panel restore-panel">
      <div className="panel-header">
        <h2>Restore from Azure</h2>
        {scan && scan.missingCount > 0 && !isRestoring && (
          <button className="restore-all-btn" onClick={handleRestoreAll}>
            Download All ({scan.missingCount} files, {formatSize(scan.missingSize)})
          </button>
        )}
      </div>

      {/* Scan options */}
      <div className="restore-options">
        <div className="restore-prefixes">
          <span className="restore-options-label">Scan prefixes:</span>
          {ALL_PREFIXES.map(p => (
            <label key={p.id} className="restore-prefix-check">
              <input
                type="checkbox"
                checked={selectedPrefixes.includes(p.id)}
                onChange={() => togglePrefix(p.id)}
                disabled={isScanning || isRestoring}
              />
              <span>{p.label}</span>
              {p.recommended && <span className="restore-tag">recommended</span>}
            </label>
          ))}
        </div>
        <label className="restore-prefix-check">
          <input
            type="checkbox"
            checked={immichOnly}
            onChange={e => setImmichOnly(e.target.checked)}
            disabled={isScanning || isRestoring}
          />
          <span>Only files referenced by Immich DB</span>
          <span className="restore-tag">saves bandwidth</span>
        </label>
        <button className="scan-btn" onClick={handleScan} disabled={isScanning || isRestoring || selectedPrefixes.length === 0}>
          {isScanning ? 'Scanning...' : 'Scan for Missing Files'}
        </button>
      </div>

      {/* Restore progress */}
      {isRestoring && progress && (
        <div className="restore-progress">
          <div className="restore-progress-bar">
            <div className="restore-progress-fill" style={{ width: `${progress.total > 0 ? ((progress.done / progress.total) * 100) : 0}%` }} />
          </div>
          <div className="restore-progress-info">
            <span>{progress.done} / {progress.total} downloaded</span>
            {progress.failed > 0 && <span className="restore-failed">{progress.failed} failed</span>}
            {progress.currentFile && <span className="restore-current">{progress.currentFile.split('/').pop()}</span>}
          </div>
        </div>
      )}

      {/* Scan results summary */}
      {scan && !isScanning && (
        <div className="restore-summary">
          <div className="restore-stat">
            <span className="restore-stat-value">{scan.totalAzure.toLocaleString()}</span>
            <span className="restore-stat-label">Azure blobs scanned</span>
          </div>
          <div className="restore-stat">
            <span className="restore-stat-value">{scan.totalLocal.toLocaleString()}</span>
            <span className="restore-stat-label">Already on disk</span>
          </div>
          <div className="restore-stat">
            <span className={`restore-stat-value ${scan.missingCount > 0 ? 'restore-warn' : 'restore-ok'}`}>
              {scan.missingCount.toLocaleString()}
            </span>
            <span className="restore-stat-label">Missing ({formatSize(scan.missingSize)})</span>
          </div>
          {scan.skippedNotInImmich > 0 && (
            <div className="restore-stat">
              <span className="restore-stat-value restore-dim">{scan.skippedNotInImmich.toLocaleString()}</span>
              <span className="restore-stat-label">Skipped (not in Immich)</span>
            </div>
          )}
          {scan.immichCrossRef && (
            <div className="restore-badge">Immich DB cross-referenced</div>
          )}
        </div>
      )}

      {/* Missing files list */}
      {scan && scan.missingCount > 0 && (
        <>
          <button className="expand-btn" onClick={() => { setExpanded(!expanded); if (!expanded) fetchFiles(0); }}>
            {expanded ? 'Hide file list' : `Show ${scan.missingCount} missing files`}
          </button>

          {expanded && (
            <>
              <div className="file-table-wrap">
                <table className="file-table">
                  <thead>
                    <tr><th>Path</th><th>Size</th><th>Type</th><th>Action</th></tr>
                  </thead>
                  <tbody>
                    {files.files.map((f, i) => (
                      <tr key={i}>
                        <td className="file-path" title={f.blobName}>{f.blobName}</td>
                        <td>{formatSize(f.size)}</td>
                        <td>{f.contentType}</td>
                        <td><button className="retry-btn" onClick={() => handleRestoreOne(f.blobName)} disabled={isRestoring}>Download</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="pagination">
                <button disabled={page === 0} onClick={() => { setPage(page - 1); fetchFiles(page - 1); }}>Prev</button>
                <span>Page {page + 1} of {totalPages || 1}</span>
                <button disabled={page >= totalPages - 1} onClick={() => { setPage(page + 1); fetchFiles(page + 1); }}>Next</button>
              </div>
            </>
          )}
        </>
      )}

      {!scan && !isScanning && (
        <div className="empty">Select prefixes and click "Scan for Missing Files" to compare Azure vs local disk</div>
      )}

      {scan && scan.missingCount === 0 && (
        <div className="restore-ok-msg">All files exist locally. Nothing to restore.</div>
      )}
    </div>
  );
}
