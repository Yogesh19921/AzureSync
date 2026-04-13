import React from 'react';
import { formatSize } from '../utils.js';

export default function Stats({ stats }) {
  if (!stats) return <div className="stats loading">Loading stats...</div>;

  const cards = [
    { label: 'Total Files', value: stats.total, cls: 'total', icon: '/' },
    { label: 'Uploaded', value: stats.uploaded, cls: 'uploaded', icon: '/' },
    { label: 'Pending', value: stats.pending, cls: 'pending', icon: '/' },
    { label: 'Uploading', value: stats.uploading, cls: 'uploading', icon: '/' },
    { label: 'Failed', value: stats.failed, cls: 'failed', icon: '/' },
    { label: 'Total Synced', value: formatSize(stats.totalSize), cls: 'size', icon: '/' },
  ];

  return (
    <div className="stats">
      {cards.map(c => (
        <div key={c.cls} className={`stat-card stat-${c.cls}`}>
          <div className="stat-value">{c.value}</div>
          <div className="stat-label">{c.label}</div>
        </div>
      ))}
    </div>
  );
}
