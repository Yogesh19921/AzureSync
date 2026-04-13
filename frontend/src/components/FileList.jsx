import React, { useState } from 'react';
import { formatSize, relativeTime, fullTime } from '../utils.js';

const STATUS_COLORS = {
  uploaded: '#22c55e',
  pending: '#eab308',
  uploading: '#3b82f6',
  failed: '#ef4444',
};

export default function FileList({ files, page, onPageChange, onSearch, onFilter, onRetry, onRetryOne, currentFilter, currentSearch }) {
  const [expandedId, setExpandedId] = useState(null);
  const [searchInput, setSearchInput] = useState(currentSearch || '');
  const totalPages = Math.ceil(files.total / 50);

  const handleSearch = (e) => {
    e.preventDefault();
    onSearch(searchInput);
  };

  return (
    <div className="panel file-panel">
      <div className="panel-header">
        <h2>Files ({files.total})</h2>
        <div className="file-controls">
          <a href={`/api/export/files${currentFilter ? '?status=' + currentFilter : ''}`} className="export-btn" download>
            Export CSV
          </a>
          <button className="retry-all-btn" onClick={onRetry}>Retry Failed</button>
        </div>
      </div>

      <div className="file-toolbar">
        <form onSubmit={handleSearch} className="search-form">
          <input
            type="text"
            placeholder="Search files..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="search-input"
          />
          <button type="submit" className="search-btn">Search</button>
          {currentSearch && (
            <button type="button" className="clear-btn" onClick={() => { setSearchInput(''); onSearch(''); }}>Clear</button>
          )}
        </form>

        <div className="filter-group">
          {['all', 'uploaded', 'pending', 'uploading', 'failed'].map(s => (
            <button
              key={s}
              className={`filter-btn ${(currentFilter || 'all') === s ? 'active' : ''}`}
              onClick={() => onFilter(s === 'all' ? null : s)}
            >
              {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div className="file-table-wrap">
        <table className="file-table">
          <thead>
            <tr>
              <th>Path</th>
              <th>Size</th>
              <th>Status</th>
              <th>Uploaded</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {files.files.map((f) => (
              <React.Fragment key={f.id}>
                <tr
                  className={expandedId === f.id ? 'expanded' : ''}
                  onClick={() => setExpandedId(expandedId === f.id ? null : f.id)}
                >
                  <td className="file-path" title={f.rel_path}>{f.rel_path}</td>
                  <td>{formatSize(f.size)}</td>
                  <td>
                    <span className="status-dot" style={{ background: STATUS_COLORS[f.status] || '#888' }} />
                    {f.status}
                  </td>
                  <td title={fullTime(f.uploaded_at)}>{relativeTime(f.uploaded_at)}</td>
                  <td>
                    {f.status === 'failed' && (
                      <button
                        className="retry-btn"
                        onClick={(e) => { e.stopPropagation(); onRetryOne(f.rel_path); }}
                      >
                        Retry
                      </button>
                    )}
                  </td>
                </tr>
                {expandedId === f.id && f.error && (
                  <tr className="error-row">
                    <td colSpan={5}>
                      <div className="error-detail">
                        <strong>Error:</strong> {f.error}
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>

      <div className="pagination">
        <button disabled={page === 0} onClick={() => onPageChange(page - 1)}>Prev</button>
        <span>Page {page + 1} of {totalPages || 1}</span>
        <button disabled={page >= totalPages - 1} onClick={() => onPageChange(page + 1)}>Next</button>
      </div>
    </div>
  );
}
