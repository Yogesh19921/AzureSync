import React, { useEffect, useState } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';
import { formatSize } from '../utils.js';

const COLORS = { images: '#3b82f6', videos: '#a855f7', database: '#eab308', other: '#6b7280' };
const LABELS = { images: 'Images', videos: 'Videos', database: 'DB Backups', other: 'Other' };

export default function FileTypeBreakdown() {
  const [data, setData] = useState([]);

  useEffect(() => {
    fetch('/api/breakdown/types').then(r => r.json()).then(setData).catch(() => {});
  }, []);

  if (data.length === 0) return null;

  const chartData = data.map(d => ({
    name: LABELS[d.file_type] || d.file_type,
    value: d.total_size,
    rawSize: d.total_size,
    rawCount: d.count,
    type: d.file_type,
  }));

  const totalSize = data.reduce((a, d) => a + (d.total_size || 0), 0);

  const CustomTooltip = ({ active, payload }) => {
    if (!active || !payload?.[0]) return null;
    const d = payload[0].payload;
    return (
      <div className="chart-tooltip">
        <div className="chart-tooltip-label">{d.name}</div>
        <div>{formatSize(d.rawSize)} ({totalSize > 0 ? ((d.rawSize / totalSize) * 100).toFixed(1) : 0}%)</div>
        <div>{d.rawCount.toLocaleString()} files</div>
      </div>
    );
  };

  return (
    <div className="panel">
      <h2>File Types</h2>
      <ResponsiveContainer width="100%" height={280}>
        <PieChart>
          <Pie data={chartData} cx="50%" cy="50%" innerRadius={55} outerRadius={95} dataKey="value" stroke="none">
            {chartData.map((d, i) => <Cell key={i} fill={COLORS[d.type] || '#6b7280'} />)}
          </Pie>
          <Tooltip content={<CustomTooltip />} />
          <Legend formatter={(value, entry) => {
            const d = entry.payload;
            return <span style={{ color: 'var(--text)', fontSize: 12 }}>{value} <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>({formatSize(d.rawSize)}, {d.rawCount})</span></span>;
          }} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
