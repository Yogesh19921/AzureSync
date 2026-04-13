import React, { useEffect, useState } from 'react';
import { formatSize } from '../utils.js';

export default function LargestFiles() {
  const [files, setFiles] = useState([]);

  useEffect(() => {
    fetch('/api/largest?limit=10').then(r => r.json()).then(setFiles).catch(() => {});
  }, []);

  if (files.length === 0) return null;

  const maxSize = files[0]?.size || 1;

  return (
    <div className="panel">
      <h2>Largest Files</h2>
      <div className="largest-list">
        {files.map((f, i) => (
          <div key={f.id} className="largest-item">
            <div className="largest-rank">{i + 1}</div>
            <div className="largest-info">
              <div className="largest-path" title={f.rel_path}>{f.rel_path.split('/').pop()}</div>
              <div className="largest-bar-wrap">
                <div className="largest-bar" style={{ width: `${(f.size / maxSize) * 100}%` }} />
              </div>
            </div>
            <div className="largest-size">{formatSize(f.size)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
