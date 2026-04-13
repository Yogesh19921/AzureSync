import React, { useState, useEffect, useCallback } from 'react';
import { useWebSocket } from './useWebSocket.js';
import { useToast } from './useToast.js';
import FailureBanner from './components/FailureBanner.jsx';
import ProgressBar from './components/ProgressBar.jsx';
import LastSync from './components/LastSync.jsx';
import Stats from './components/Stats.jsx';
import Digest from './components/Digest.jsx';
import CostEstimate from './components/CostEstimate.jsx';
import StorageBreakdown from './components/StorageBreakdown.jsx';
import FileTypeBreakdown from './components/FileTypeBreakdown.jsx';
import UploadTimeline from './components/UploadTimeline.jsx';
import LargestFiles from './components/LargestFiles.jsx';
import LiveEvents from './components/LiveEvents.jsx';
import ActivityLog from './components/ActivityLog.jsx';
import FileList from './components/FileList.jsx';
import SystemHealth from './components/SystemHealth.jsx';
import ConfigEditor from './components/ConfigEditor.jsx';
import ThemeToggle from './components/ThemeToggle.jsx';
import Toasts from './components/Toasts.jsx';
import { formatSize } from './utils.js';
import './styles.css';

export default function App() {
  const [stats, setStats] = useState(null);
  const [activity, setActivity] = useState([]);
  const [files, setFiles] = useState({ files: [], total: 0 });
  const [events, setEvents] = useState([]);
  const [page, setPage] = useState(0);
  const [filter, setFilter] = useState(null);
  const [search, setSearch] = useState('');
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'dark');
  const [paused, setPaused] = useState(false);
  const { toasts, addToast, removeToast } = useToast();

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  const fetchActivity = () => fetch('/api/activity?limit=100').then(r => r.json()).then(setActivity).catch(() => {});
  const fetchFiles = (p = 0, f = filter, s = search) => {
    const params = new URLSearchParams({ limit: '50', offset: String(p * 50) });
    if (f) params.set('status', f);
    if (s) params.set('search', s);
    fetch(`/api/files?${params}`).then(r => r.json()).then(setFiles).catch(() => {});
  };

  useEffect(() => { fetchActivity(); fetchFiles(0); }, []);

  const onMessage = useCallback((msg) => {
    if (msg.type === 'stats') {
      setStats(msg.data);
      setPaused(!msg.data.uploader?.running);
    } else {
      setEvents(prev => [{ ...msg, ts: Date.now() }, ...prev].slice(0, 200));
      if (msg.type === 'file:uploaded') {
        addToast(`Uploaded: ${msg.data?.relPath?.split('/').pop()} (${formatSize(msg.data?.size)})`, 'success', 3000);
        fetchActivity(); fetchFiles(page, filter, search);
      } else if (msg.type === 'file:failed') {
        addToast(`Failed: ${msg.data?.relPath?.split('/').pop()}`, 'error', 5000);
        fetchActivity(); fetchFiles(page, filter, search);
      } else if (msg.type === 'reconcile:done') {
        addToast(`Reconciliation done: ${msg.data?.queued} queued`, 'info', 4000);
        fetchActivity(); fetchFiles(page, filter, search);
      }
    }
  }, [page, filter, search]);

  const wsConnected = useWebSocket(onMessage);

  const handlePauseResume = async () => {
    const endpoint = paused ? '/api/resume' : '/api/pause';
    await fetch(endpoint, { method: 'POST' });
    setPaused(!paused);
    addToast(paused ? 'Uploads resumed' : 'Uploads paused', 'info');
  };

  return (
    <div className="app">
      <Toasts toasts={toasts} onRemove={removeToast} />

      <header className="header">
        <h1>AzureSync</h1>
        <div className="header-right">
          <LastSync lastSync={stats?.lastSync} />
          <button className={`pause-btn ${paused ? 'paused' : ''}`} onClick={handlePauseResume}>
            {paused ? '\u25B6 Resume' : '\u275A\u275A Pause'}
          </button>
          <div className={`ws-status ${wsConnected ? 'connected' : 'disconnected'}`}>
            {wsConnected ? 'Live' : 'Disconnected'}
          </div>
          <ThemeToggle theme={theme} onToggle={() => setTheme(t => t === 'dark' ? 'light' : 'dark')} />
        </div>
      </header>

      <FailureBanner trend={stats?.failureTrend} />
      <ProgressBar stats={stats} />
      <Stats stats={stats} />

      <div className="grid-3">
        <Digest />
        <CostEstimate />
      </div>

      <div className="grid-2">
        <StorageBreakdown />
        <FileTypeBreakdown />
      </div>

      <div className="grid-2">
        <UploadTimeline />
        <LargestFiles />
      </div>

      <div className="grid-2">
        <LiveEvents events={events} />
        <ActivityLog activity={activity} />
      </div>

      <FileList
        files={files} page={page}
        onPageChange={(p) => { setPage(p); fetchFiles(p, filter, search); }}
        onSearch={(s) => { setSearch(s); setPage(0); fetchFiles(0, filter, s); }}
        onFilter={(f) => { setFilter(f); setPage(0); fetchFiles(0, f, search); }}
        onRetry={async () => { const r = await fetch('/api/retry', { method: 'POST' }).then(r => r.json()); addToast(`Retrying ${r.retried} failed files`, 'info'); fetchFiles(page, filter, search); }}
        onRetryOne={async (p) => { await fetch(`/api/retry/${encodeURIComponent(p)}`, { method: 'POST' }); addToast(`Retrying: ${p.split('/').pop()}`, 'info'); fetchFiles(page, filter, search); }}
        currentFilter={filter} currentSearch={search}
      />

      <SystemHealth onReconcile={() => {}} onToast={addToast} />
      <ConfigEditor onToast={addToast} />
    </div>
  );
}
