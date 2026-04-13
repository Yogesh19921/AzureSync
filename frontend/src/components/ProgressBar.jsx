import React from 'react';
import { formatSize, formatSpeed, estimateTimeRemaining } from '../utils.js';

export default function ProgressBar({ stats }) {
  if (!stats || stats.total === 0) return null;

  const percent = stats.total > 0 ? Math.round((stats.uploaded / stats.total) * 100) : 0;
  const speed = stats.uploader?.speed;
  const eta = estimateTimeRemaining(stats.pendingSize, speed?.bytesPerSec);

  return (
    <div className="progress-section">
      <div className="progress-header">
        <span className="progress-label">
          Sync Progress: {stats.uploaded} / {stats.total} files ({percent}%)
        </span>
        <span className="progress-meta">
          {speed?.bytesPerSec > 0 && (
            <>
              <span className="speed-badge">{formatSpeed(speed.bytesPerSec)}</span>
              {eta && <span className="eta-badge">ETA: {eta}</span>}
            </>
          )}
          {stats.uploader?.activeUploads > 0 && (
            <span className="active-badge">{stats.uploader.activeUploads} active</span>
          )}
        </span>
      </div>
      <div className="progress-bar">
        <div
          className="progress-fill"
          style={{ width: `${percent}%` }}
        />
        {stats.uploading > 0 && (
          <div
            className="progress-fill uploading"
            style={{ width: `${(stats.uploading / stats.total) * 100}%` }}
          />
        )}
      </div>
      <div className="progress-footer">
        <span>{formatSize(stats.totalSize)} synced</span>
        {stats.pendingSize > 0 && <span>{formatSize(stats.pendingSize)} remaining</span>}
      </div>
    </div>
  );
}
