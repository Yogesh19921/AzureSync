import React, { useEffect, useState } from 'react';
import { formatSize } from '../utils.js';

export default function CostEstimate() {
  const [cost, setCost] = useState(null);

  useEffect(() => {
    fetch('/api/cost').then(r => r.json()).then(setCost).catch(() => {});
    const interval = setInterval(() => {
      fetch('/api/cost').then(r => r.json()).then(setCost).catch(() => {});
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  if (!cost) return null;

  return (
    <div className="panel cost-panel">
      <h2>Azure Cost Estimate (Cold Tier)</h2>
      <div className="cost-grid">
        <div className="cost-item">
          <div className="cost-value">{formatSize(cost.totalBytes)}</div>
          <div className="cost-label">Total Stored</div>
        </div>
        <div className="cost-item">
          <div className="cost-value cost-accent">${cost.monthlyCost.toFixed(4)}</div>
          <div className="cost-label">Monthly</div>
        </div>
        <div className="cost-item">
          <div className="cost-value cost-accent">${cost.yearlyCost.toFixed(2)}</div>
          <div className="cost-label">Yearly</div>
        </div>
        <div className="cost-item">
          <div className="cost-value cost-dim">${cost.costPerGBPerMonth}/GB/mo</div>
          <div className="cost-label">Rate</div>
        </div>
      </div>
    </div>
  );
}
