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

  useEffect(() => {
    fetch('/api/breakdown')
      .then(r => r.json())
      .then(setData)
      .catch(() => {});
  }, []);

  if (data.length === 0) return null;

  const chartData = data.map(d => ({
    name: LABELS[d.category] || d.category,
    value: d.total_size,
    rawSize: d.total_size,
    rawCount: d.count,
  }));

  const totalSize = data.reduce((a, d) => a + (d.total_size || 0), 0);
  const totalCount = data.reduce((a, d) => a + d.count, 0);

  const CustomTooltip = ({ active, payload }) => {
    if (!active || !payload?.[0]) return null;
    const d = payload[0].payload;
    const pct = totalSize > 0 ? ((d.rawSize / totalSize) * 100).toFixed(1) : 0;
    return (
      <div className="chart-tooltip">
        <div className="chart-tooltip-label">{d.name}</div>
        <div>{formatSize(d.rawSize)} ({pct}%)</div>
        <div>{d.rawCount.toLocaleString()} files</div>
      </div>
    );
  };

  const renderLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, rawSize, rawCount }) => {
    const RADIAN = Math.PI / 180;
    const radius = outerRadius + 24;
    const x = cx + radius * Math.cos(-midAngle * RADIAN);
    const y = cy + radius * Math.sin(-midAngle * RADIAN);
    // Skip labels for tiny slices
    if (rawSize / totalSize < 0.05) return null;
    return (
      <text x={x} y={y} textAnchor={x > cx ? 'start' : 'end'} dominantBaseline="central" style={{ fontSize: 11, fill: 'var(--text-dim)' }}>
        {formatSize(rawSize)} / {rawCount}
      </text>
    );
  };

  return (
    <div className="panel">
      <div className="panel-header">
        <h2>Storage Breakdown</h2>
        <span className="breakdown-total">{formatSize(totalSize)} — {totalCount.toLocaleString()} files</span>
      </div>
      <ResponsiveContainer width="100%" height={300}>
        <PieChart>
          <Pie
            data={chartData}
            cx="50%"
            cy="50%"
            innerRadius={55}
            outerRadius={95}
            dataKey="value"
            stroke="none"
            label={renderLabel}
            labelLine={false}
          >
            {chartData.map((_, i) => (
              <Cell key={i} fill={COLORS[i % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip content={<CustomTooltip />} />
          <Legend
            formatter={(value, entry) => {
              const d = entry.payload;
              return (
                <span style={{ color: 'var(--text)', fontSize: 12 }}>
                  {value} <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>({formatSize(d.rawSize)}, {d.rawCount})</span>
                </span>
              );
            }}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
