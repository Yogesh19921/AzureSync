import React, { useEffect, useState } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';
import { formatSize } from '../utils.js';

const COLORS = ['#3b82f6', '#22c55e', '#a855f7', '#eab308', '#6b7280'];
const LABELS = {
  library: 'Library',
  upload: 'Uploads',
  'encoded-video': 'Videos',
  backups: 'Backups',
  other: 'Other',
};

export default function StorageBreakdown() {
  const [data, setData] = useState([]);
  const [mode, setMode] = useState('size'); // 'size' or 'count'

  useEffect(() => {
    fetch('/api/breakdown')
      .then(r => r.json())
      .then(setData)
      .catch(() => {});
  }, []);

  if (data.length === 0) return null;

  const chartData = data.map(d => ({
    name: LABELS[d.category] || d.category,
    value: mode === 'size' ? d.total_size : d.count,
    rawSize: d.total_size,
    rawCount: d.count,
  }));

  const CustomTooltip = ({ active, payload }) => {
    if (!active || !payload?.[0]) return null;
    const d = payload[0].payload;
    return (
      <div className="chart-tooltip">
        <div className="chart-tooltip-label">{d.name}</div>
        <div>{formatSize(d.rawSize)} ({d.rawCount} files)</div>
      </div>
    );
  };

  return (
    <div className="panel">
      <div className="panel-header">
        <h2>Storage Breakdown</h2>
        <div className="toggle-group">
          <button className={mode === 'size' ? 'active' : ''} onClick={() => setMode('size')}>Size</button>
          <button className={mode === 'count' ? 'active' : ''} onClick={() => setMode('count')}>Count</button>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={280}>
        <PieChart>
          <Pie
            data={chartData}
            cx="50%"
            cy="50%"
            innerRadius={60}
            outerRadius={100}
            dataKey="value"
            stroke="none"
          >
            {chartData.map((_, i) => (
              <Cell key={i} fill={COLORS[i % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip content={<CustomTooltip />} />
          <Legend
            formatter={(value) => <span style={{ color: 'var(--text)', fontSize: 12 }}>{value}</span>}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
