import React, { useEffect, useState } from 'react';
import { formatSize } from '../utils.js';

export default function Digest() {
  const [digest, setDigest] = useState(null);
  const [range, setRange] = useState('-1 days');

  const labels = { '-1 days': 'Today', '-7 days': 'This Week', '-30 days': 'This Month' };

  useEffect(() => {
    fetch(`/api/digest?since=${encodeURIComponent(range)}`)
      .then(r => r.json())
      .then(setDigest)
      .catch(() => {});
  }, [range]);

  if (!digest) return null;

  return (
    <div className="panel digest-panel">
      <div className="panel-header">
        <h2>Digest</h2>
        <div className="toggle-group">
          {Object.entries(labels).map(([v, l]) => (
            <button key={v} className={range === v ? 'active' : ''} onClick={() => setRange(v)}>{l}</button>
          ))}
        </div>
      </div>
      <div className="digest-grid">
        <div className="digest-item">
          <div className="digest-value digest-green">{digest.uploaded_count}</div>
          <div className="digest-label">Files Uploaded</div>
        </div>
        <div className="digest-item">
          <div className="digest-value digest-purple">{formatSize(digest.uploaded_size)}</div>
          <div className="digest-label">Data Synced</div>
        </div>
        <div className="digest-item">
          <div className={`digest-value ${digest.failed_count > 0 ? 'digest-red' : 'digest-green'}`}>{digest.failed_count}</div>
          <div className="digest-label">Failures</div>
        </div>
      </div>
    </div>
  );
}
