import React, { useEffect, useState } from 'react';

export default function ConfigEditor({ onToast }) {
  const [cfg, setCfg] = useState(null);
  const [saving, setSaving] = useState(false);
  const [concurrency, setConcurrency] = useState(3);
  const [debounce, setDebounce] = useState(2000);
  const [skipPatterns, setSkipPatterns] = useState('');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [notifyFailure, setNotifyFailure] = useState(true);
  const [costRate, setCostRate] = useState(0.0036);

  useEffect(() => {
    fetch('/api/config').then(r => r.json()).then(c => {
      setCfg(c);
      setConcurrency(c.sync?.concurrency || 3);
      setDebounce(c.sync?.debounceMs || 2000);
      setSkipPatterns((c.sync?.skipPatterns || []).join('\n'));
      setWebhookUrl(c.discord?.webhookUrl || '');
      setNotifyFailure(c.discord?.notifyOnFailure !== false);
      setCostRate(c.azure?.costPerGBPerMonth || 0.0036);
    }).catch(() => {});
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sync: {
            concurrency: parseInt(concurrency),
            debounceMs: parseInt(debounce),
            skipPatterns: skipPatterns.split('\n').map(s => s.trim()).filter(Boolean),
          },
          discord: {
            webhookUrl,
            notifyOnFailure: notifyFailure,
          },
          azure: {
            costPerGBPerMonth: parseFloat(costRate),
          },
        }),
      });
      if (res.ok) {
        onToast('Configuration saved', 'success');
      } else {
        onToast('Failed to save config', 'error');
      }
    } catch {
      onToast('Failed to save config', 'error');
    }
    setSaving(false);
  };

  if (!cfg) return null;

  return (
    <div className="panel config-panel">
      <div className="panel-header">
        <h2>Configuration</h2>
        <button className="save-btn" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>

      <div className="config-grid">
        <div className="config-section">
          <h3>Sync Settings</h3>
          <label className="config-field">
            <span>Concurrency (1-10)</span>
            <input type="number" min="1" max="10" value={concurrency} onChange={e => setConcurrency(e.target.value)} />
          </label>
          <label className="config-field">
            <span>Debounce (ms)</span>
            <input type="number" min="500" max="30000" step="500" value={debounce} onChange={e => setDebounce(e.target.value)} />
          </label>
          <label className="config-field">
            <span>Skip Patterns (one per line)</span>
            <textarea rows="5" value={skipPatterns} onChange={e => setSkipPatterns(e.target.value)} />
          </label>
        </div>

        <div className="config-section">
          <h3>Discord Notifications</h3>
          <label className="config-field">
            <span>Webhook URL</span>
            <input type="text" placeholder="https://discord.com/api/webhooks/..." value={webhookUrl} onChange={e => setWebhookUrl(e.target.value)} />
          </label>
          <label className="config-field config-checkbox">
            <input type="checkbox" checked={notifyFailure} onChange={e => setNotifyFailure(e.target.checked)} />
            <span>Notify on upload failures</span>
          </label>

          <h3>Cost Tracking</h3>
          <label className="config-field">
            <span>Cost per GB/month ($)</span>
            <input type="number" min="0" max="1" step="0.0001" value={costRate} onChange={e => setCostRate(e.target.value)} />
          </label>
        </div>
      </div>
    </div>
  );
}
