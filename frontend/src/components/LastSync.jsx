import React from 'react';
import { relativeTime, fullTime } from '../utils.js';

export default function LastSync({ lastSync }) {
  return (
    <div className="last-sync">
      <span className="last-sync-label">Last upload:</span>
      {lastSync ? (
        <span className="last-sync-time" title={`${fullTime(lastSync.uploaded_at)} — ${lastSync.rel_path}`}>
          {relativeTime(lastSync.uploaded_at)}
        </span>
      ) : (
        <span className="last-sync-time dim">No uploads yet</span>
      )}
    </div>
  );
}
