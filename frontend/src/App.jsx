import React, { useState, useEffect, useCallback } from 'react';
import { useWebSocket } from './useWebSocket.js';
import { useToast } from './useToast.js';
import Stats from './components/Stats.jsx';
import ProgressBar from './components/ProgressBar.jsx';
import ActivityLog from './components/ActivityLog.jsx';
import FileList from './components/FileList.jsx';
import LiveEvents from './components/LiveEvents.jsx';
import StorageBreakdown from './components/StorageBreakdown.jsx';
import UploadTimeline from './components/UploadTimeline.jsx';
import SystemHealth from './components/SystemHealth.jsx';
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
  const { toasts, addToast, removeToast } = useToast();

  // Apply theme
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

  useEffect(() => {
    fetchActivity();
    fetchFiles(0);
  }, []);

  const onMessage = useCallback((msg) => {
    if (msg.type === 'stats') {
      setStats(msg.data);
    } else {
      setEvents(prev => [{ ...msg, ts: Date.now() }, ...prev].slice(0, 200));

      if (msg.type === 'file:uploaded') {
        addToast(`Uploaded: ${msg.data?.relPath?.split('/').pop()} (${formatSize(msg.data?.size)})`, 'success', 3000);
        fetchActivity();
        fetchFiles(page, filter, search);
      } else if (msg.type === 'file:failed') {
        addToast(`Failed: ${msg.data?.relPath?.split('/').pop()}`, 'error', 5000);
        fetchActivity();
        fetchFiles(page, filter, search);
      } else if (msg.type === 'reconcile:done') {
        addToast(`Reconciliation done: ${msg.data?.queued} queued`, 'info', 4000);
        fetchActivity();
        fetchFiles(page, filter, search);
      }
    }
  }, [page, filter, search]);

  const wsConnected = useWebSocket(onMessage);

  const handlePageChange = (newPage) => {
    setPage(newPage);
    fetchFiles(newPage, filter, search);
  };

  const handleFilter = (f) => {
    setFilter(f);
    setPage(0);
    fetchFiles(0, f, search);
  };

  const handleSearch = (s) => {
    setSearch(s);
    setPage(0);
    fetchFiles(0, filter, s);
  };

  const handleRetryAll = async () => {
    const res = await fetch('/api/retry', { method: 'POST' });
    const data = await res.json();
    addToast(`Retrying ${data.retried} failed files`, 'info');
    fetchFiles(page, filter, search);
  };

  const handleRetryOne = async (relPath) => {
    await fetch(`/api/retry/${encodeURIComponent(relPath)}`, { method: 'POST' });
    addToast(`Retrying: ${relPath.split('/').pop()}`, 'info');
    fetchFiles(page, filter, search);
  };

  return (
    <div className="app">
      <Toasts toasts={toasts} onRemove={removeToast} />

      <header className="header">
        <h1>AzureSync</h1>
        <div className="header-right">
          <div className={`ws-status ${wsConnected ? 'connected' : 'disconnected'}`}>
            {wsConnected ? 'Live' : 'Disconnected'}
          </div>
          <ThemeToggle theme={theme} onToggle={() => setTheme(t => t === 'dark' ? 'light' : 'dark')} />
        </div>
      </header>

      <ProgressBar stats={stats} />
      <Stats stats={stats} />

      <div className="grid-2">
        <StorageBreakdown />
        <UploadTimeline />
      </div>

      <div className="grid-2">
        <LiveEvents events={events} />
        <ActivityLog activity={activity} />
      </div>

      <FileList
        files={files}
        page={page}
        onPageChange={handlePageChange}
        onSearch={handleSearch}
        onFilter={handleFilter}
        onRetry={handleRetryAll}
        onRetryOne={handleRetryOne}
        currentFilter={filter}
        currentSearch={search}
      />

      <SystemHealth onReconcile={() => addToast('Reconciliation started', 'info')} />
    </div>
  );
}
