import React from 'react';
import { relativeTime, fullTime } from '../utils.js';

export default function ActivityLog({ activity }) {
  return (
    <div className="panel">
      <div className="panel-header">
        <h2>Activity Log</h2>
        <a href="/api/export/activity" className="export-btn" download>Export CSV</a>
      </div>
      <div className="activity-list">
        {activity.length === 0 && <div className="empty">No activity yet</div>}
        {activity.map((a) => (
          <div key={a.id} className={`activity-item activity-${a.type}`}>
            <span className={`activity-badge badge-${a.type}`}>{a.type}</span>
            <span className="activity-msg">{a.message}</span>
            <span className="activity-time" title={fullTime(a.created_at)}>
              {relativeTime(a.created_at)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
