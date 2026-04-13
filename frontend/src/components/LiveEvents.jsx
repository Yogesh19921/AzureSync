import React from 'react';

export default function LiveEvents({ events }) {
  return (
    <div className="panel">
      <h2>Live Events</h2>
      <div className="events-list">
        {events.length === 0 && <div className="empty">Waiting for events...</div>}
        {events.map((e, i) => (
          <div key={i} className={`event event-${e.type.replace(/:/g, '-')}`}>
            <span className="event-type">{e.type}</span>
            <span className="event-data">
              {e.data?.relPath || e.data?.error || (e.data?.queued != null ? `${e.data.queued} queued, ${e.data.skipped} skipped` : '')}
            </span>
            <span className="event-time">{new Date(e.ts).toLocaleTimeString()}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
