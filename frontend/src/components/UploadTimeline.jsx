import React, { useEffect, useState } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { formatSize } from '../utils.js';

export default function UploadTimeline() {
  const [data, setData] = useState([]);
  const [range, setRange] = useState('-7 days');

  const fetchData = () => {
    fetch(`/api/timeline?since=${encodeURIComponent(range)}`)
      .then(r => r.json())
      .then(setData)
      .catch(() => {});
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [range]);

  const chartData = data.map(d => ({
    ...d,
    label: new Date(d.hour + 'Z').toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    }),
  }));

  const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.[0]) return null;
    const d = payload[0].payload;
    return (
      <div className="chart-tooltip">
        <div className="chart-tooltip-label">{d.label}</div>
        <div>{d.count} files ({formatSize(d.total_size)})</div>
      </div>
    );
  };

  return (
    <div className="panel">
      <div className="panel-header">
        <h2>Upload Timeline</h2>
        <div className="toggle-group">
          {[
            { label: '24h', value: '-24 hours' },
            { label: '7d', value: '-7 days' },
            { label: '30d', value: '-30 days' },
          ].map(r => (
            <button key={r.value} className={range === r.value ? 'active' : ''} onClick={() => setRange(r.value)}>
              {r.label}
            </button>
          ))}
        </div>
      </div>
      {chartData.length === 0 ? (
        <div className="empty">No upload data for this period</div>
      ) : (
        <ResponsiveContainer width="100%" height={280}>
          <AreaChart data={chartData}>
            <defs>
              <linearGradient id="colorCount" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis
              dataKey="label"
              tick={{ fill: 'var(--text-dim)', fontSize: 10 }}
              interval="preserveStartEnd"
            />
            <YAxis tick={{ fill: 'var(--text-dim)', fontSize: 10 }} />
            <Tooltip content={<CustomTooltip />} />
            <Area
              type="monotone"
              dataKey="count"
              stroke="#3b82f6"
              fill="url(#colorCount)"
              strokeWidth={2}
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
