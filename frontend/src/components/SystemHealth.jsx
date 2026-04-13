import React, { useEffect, useState } from 'react';
import { formatDuration, formatSpeed } from '../utils.js';

export default function SystemHealth({ onReconcile, onToast }) {
  const [health, setHealth] = useState(null);
  const [reconciling, setReconciling] = useState(false);

  const fetchHealth = () => fetch('/api/health').then(r => r.json()).then(setHealth).catch(() => {});

  useEffect(() => {
    fetchHealth();
    const interval = setInterval(fetchHealth, 10000);
    return () => clearInterval(interval);
  }, []);

  const handleReconcile = async () => {
    setReconciling(true);
    try {
      const res = await fetch('/api/reconcile', { method: 'POST' });
      const data = await res.json();
      if (data.error) { onToast(data.error, 'error'); setReconciling(false); return; }
      onToast('Reconciliation started', 'info');
      if (onReconcile) onReconcile();
    } catch { onToast('Failed to start reconciliation', 'error'); }
    setTimeout(() => setReconciling(false), 30000);
  };

  if (!health) return null;

  return (
    <div className="panel health-panel">
      <div className="panel-header">
        <h2>System Health</h2>
        <button className={`reconcile-btn ${reconciling ? 'disabled' : ''}`} onClick={handleReconcile} disabled={reconciling}>
          {reconciling ? 'Reconciling...' : 'Force Reconcile'}
        </button>
      </div>
      <div className="health-grid">
        <div className="health-item"><span className="health-label">Status</span><span className="health-value status-running">{health.status}</span></div>
        <div className="health-item"><span className="health-label">Uptime</span><span className="health-value">{formatDuration(health.uptime)}</span></div>
        <div className="health-item"><span className="health-label">Memory</span><span className="health-value">{health.memoryMB} MB</span></div>
        <div className="health-item"><span className="health-label">DB Size</span><span className="health-value">{health.dbSizeMB} MB</span></div>
        <div className="health-item"><span className="health-label">Azure</span><span className={`health-value ${health.azure?.connected ? 'status-running' : 'status-error'}`} title={health.azure?.error || ''}>{health.azure?.connected ? 'Connected' : 'Disconnected'}</span></div>
        <div className="health-item"><span className="health-label">Disk</span><span className={`health-value ${health.disk?.accessible ? 'status-running' : 'status-error'}`}>{health.disk?.accessible ? 'Accessible' : 'Unavailable'}</span></div>
        <div className="health-item"><span className="health-label">Workers</span><span className="health-value">{health.uploader?.activeUploads} / {health.config?.concurrency} active</span></div>
        <div className="health-item"><span className="health-label">Speed</span><span className="health-value">{formatSpeed(health.uploader?.speed?.bytesPerSec)}</span></div>
        <div className="health-item"><span className="health-label">Container</span><span className="health-value">{health.config?.container}</span></div>
      </div>
    </div>
  );
}
