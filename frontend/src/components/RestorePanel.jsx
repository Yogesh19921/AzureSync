import React, { useState, useEffect, useCallback } from 'react';
import { formatSize } from '../utils.js';

export default function RestorePanel({ onToast, wsEvents }) {
  const [status, setStatus] = useState(null);
  const [files, setFiles] = useState({ files: [], total: 0 });
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState(false);

  const fetchStatus = () => fetch('/api/restore/status').then(r => r.json()).then(setStatus).catch(() => {});
  const fetchFiles = (p = 0) => fetch(`/api/restore/files?limit=50&offset=${p * 50}`).then(r => r.json()).then(setFiles).catch(() => {});

  // Listen for WS restore events
  useEffect(() => {
    if (!wsEvents) return;
    const last = wsEvents[0];
    if (!last) return;
    if (last.type === 'restore:scan-done' || last.type === 'restore:done') {
      fetchStatus();
      fetchFiles(page);
    }
    if (last.type === 'restore:progress') {
      setStatus(prev => prev ? { ...prev, progress: last.data, restoring: true } : prev);
    }
  }, [wsEvents]);

  const handleScan = async () => {
    onToast('Scanning Azure for missing files...', 'info', 10000);
    await fetch('/api/restore/scan', { method: 'POST' });
    // Results come via WS
    const poll = setInterval(() => {
      fetchStatus().then(() => {
        fetchFiles(0);
      });
    }, 3000);
    // Stop polling after 5 min
    setTimeout(() => clearInterval(poll), 300000);
  };

  const handleRestoreAll = async () => {
    if (!status?.scan?.missingCount) return;

    // This is a significant operation — confirm
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
    if (data.success) {
      onToast(`Restored: ${blobName.split('/').pop()}`, 'success');
      fetchStatus();
      fetchFiles(page);
    } else {
      onToast(`Failed: ${data.error}`, 'error');
    }
  };

  const totalPages = Math.ceil(files.total / 50);
  const progress = status?.progress;
  const isRestoring = status?.restoring;
  const isScanning = status?.scanning;
  const scan = status?.scan;

  return (
    <div className="panel restore-panel">
      <div className="panel-header">
        <h2>Restore from Azure</h2>
        <div className="restore-actions">
          <button className="scan-btn" onClick={handleScan} disabled={isScanning || isRestoring}>
            {isScanning ? 'Scanning...' : 'Scan for Missing Files'}
          </button>
          {scan && scan.missingCount > 0 && !isRestoring && (
            <button className="restore-all-btn" onClick={handleRestoreAll}>
              Download All ({scan.missingCount} files, {formatSize(scan.missingSize)})
            </button>
          )}
        </div>
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
            <span className="restore-stat-label">Azure blobs</span>
          </div>
          <div className="restore-stat">
            <span className="restore-stat-value">{scan.totalLocal.toLocaleString()}</span>
            <span className="restore-stat-label">On disk</span>
          </div>
          <div className="restore-stat">
            <span className={`restore-stat-value ${scan.missingCount > 0 ? 'restore-warn' : 'restore-ok'}`}>
              {scan.missingCount.toLocaleString()}
            </span>
            <span className="restore-stat-label">Missing ({formatSize(scan.missingSize)})</span>
          </div>
        </div>
      )}

      {/* Missing files list (collapsible) */}
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
                    <tr>
                      <th>Path</th>
                      <th>Size</th>
                      <th>Type</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {files.files.map((f, i) => (
                      <tr key={i}>
                        <td className="file-path" title={f.blobName}>{f.blobName}</td>
                        <td>{formatSize(f.size)}</td>
                        <td>{f.contentType}</td>
                        <td>
                          <button className="retry-btn" onClick={() => handleRestoreOne(f.blobName)} disabled={isRestoring}>
                            Download
                          </button>
                        </td>
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
        <div className="empty">Click "Scan for Missing Files" to compare Azure blobs against local disk</div>
      )}

      {scan && scan.missingCount === 0 && (
        <div className="restore-ok-msg">All Azure files exist locally. Nothing to restore.</div>
      )}
    </div>
  );
}
