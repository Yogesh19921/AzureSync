import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, statSync } from 'fs';
import { stat } from 'fs/promises';
import { config } from './config.js';
import {
  getStats, getActivity, getFileListFiltered, getTotalCountFiltered,
  getRecentUploads, getStorageBreakdown, getUploadTimeline, getDbSize,
  retryFailed, retryOne, logActivity, getFailedFiles,
} from './db.js';
import { getUploaderStatus, triggerQueue } from './uploader.js';
import { reconcile } from './reconciler.js';
import { bus } from './events.js';
import { log } from './logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function buildStats() {
  const rows = getStats();
  const stats = { pending: 0, uploading: 0, uploaded: 0, failed: 0, totalSize: 0, pendingSize: 0 };
  for (const row of rows) {
    stats[row.status] = row.count;
    if (row.status === 'uploaded') stats.totalSize = row.total_size || 0;
    if (row.status === 'pending' || row.status === 'failed') stats.pendingSize += row.total_size || 0;
  }
  stats.total = stats.pending + stats.uploading + stats.uploaded + stats.failed;
  stats.uploader = getUploaderStatus();
  return stats;
}

let reconciling = false;

export function startServer() {
  const app = express();
  const server = createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  app.use(express.json());

  // Serve frontend
  const frontendDist = resolve(__dirname, '..', 'frontend', 'dist');
  if (existsSync(frontendDist)) {
    app.use(express.static(frontendDist));
  }

  // --- REST API ---

  app.get('/api/stats', (_req, res) => {
    res.json(buildStats());
  });

  app.get('/api/activity', (req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    res.json(getActivity(limit));
  });

  app.get('/api/files', (req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const offset = parseInt(req.query.offset) || 0;
    const status = req.query.status || null;
    const search = req.query.search || null;
    const files = getFileListFiltered(limit, offset, status, search);
    const total = getTotalCountFiltered(status, search);
    res.json({ files, total, limit, offset });
  });

  app.get('/api/recent', (req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    res.json(getRecentUploads(limit));
  });

  // Storage breakdown by directory
  app.get('/api/breakdown', (_req, res) => {
    res.json(getStorageBreakdown());
  });

  // Upload timeline
  app.get('/api/timeline', (req, res) => {
    const since = req.query.since || '-7 days';
    // Validate since format
    const allowed = ['-1 days', '-7 days', '-30 days', '-24 hours'];
    const safeSince = allowed.includes(since) ? since : '-7 days';
    res.json(getUploadTimeline(safeSince));
  });

  // System health
  app.get('/api/health', async (_req, res) => {
    let diskUsage = null;
    try {
      const st = await stat(config.sync.basePath);
      diskUsage = { path: config.sync.basePath, accessible: true };
    } catch {
      diskUsage = { path: config.sync.basePath, accessible: false };
    }

    const dbSize = getDbSize();
    const uploader = getUploaderStatus();

    res.json({
      status: 'running',
      uptime: Math.floor(process.uptime()),
      memoryMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
      dbSizeMB: (dbSize / 1024 / 1024).toFixed(2),
      disk: diskUsage,
      uploader,
      config: {
        basePath: config.sync.basePath,
        container: config.azure.containerName,
        accessTier: config.azure.accessTier,
        concurrency: config.sync.concurrency,
        watchDirs: config.sync.watchDirs,
      },
    });
  });

  // Retry all failed
  app.post('/api/retry', (_req, res) => {
    const result = retryFailed();
    logActivity('system', `Retried ${result.changes} failed files`);
    bus.emit('stats:update');
    triggerQueue();
    res.json({ retried: result.changes });
  });

  // Retry single file
  app.post('/api/retry/:id', (req, res) => {
    const relPath = decodeURIComponent(req.params.id);
    const result = retryOne(relPath);
    if (result.changes > 0) {
      logActivity('system', `Retried file: ${relPath}`, relPath);
      bus.emit('stats:update');
      triggerQueue();
    }
    res.json({ retried: result.changes });
  });

  // Trigger reconciliation
  app.post('/api/reconcile', async (_req, res) => {
    if (reconciling) {
      return res.status(409).json({ error: 'Reconciliation already in progress' });
    }
    reconciling = true;
    res.json({ started: true });

    try {
      const result = await reconcile();
      triggerQueue();
      reconciling = false;
    } catch (err) {
      log.error('Manual reconciliation failed', { error: err.message });
      reconciling = false;
    }
  });

  // Export activity as CSV
  app.get('/api/export/activity', (req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 1000, 10000);
    const rows = getActivity(limit);
    const csv = ['timestamp,type,message,file'].concat(
      rows.map(r => `"${r.created_at}","${r.type}","${r.message.replace(/"/g, '""')}","${(r.rel_path || '').replace(/"/g, '""')}"`)
    ).join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=azure-sync-activity.csv');
    res.send(csv);
  });

  // Export files as CSV
  app.get('/api/export/files', (req, res) => {
    const status = req.query.status || null;
    const rows = getFileListFiltered(10000, 0, status, null);
    const csv = ['path,size,status,uploaded_at,error'].concat(
      rows.map(r => `"${r.rel_path}",${r.size},"${r.status}","${r.uploaded_at || ''}","${(r.error || '').replace(/"/g, '""')}"`)
    ).join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=azure-sync-files${status ? '-' + status : ''}.csv`);
    res.send(csv);
  });

  // Get failed files
  app.get('/api/failed', (_req, res) => {
    res.json(getFailedFiles());
  });

  // SPA fallback — must be LAST
  app.get('*', (_req, res) => {
    if (existsSync(resolve(frontendDist, 'index.html'))) {
      res.sendFile(resolve(frontendDist, 'index.html'));
    } else {
      res.status(200).send('AzureSync running. Frontend not built yet — run: npm run build:frontend');
    }
  });

  // --- WebSocket ---

  const clients = new Set();

  wss.on('connection', (ws) => {
    clients.add(ws);
    log.debug('WebSocket client connected', { total: clients.size });
    ws.send(JSON.stringify({ type: 'stats', data: buildStats() }));

    ws.on('close', () => {
      clients.delete(ws);
    });
  });

  function broadcast(type, data) {
    const msg = JSON.stringify({ type, data });
    for (const ws of clients) {
      if (ws.readyState === 1) ws.send(msg);
    }
  }

  // Forward events to WebSocket clients
  bus.on('file:queued', (data) => broadcast('file:queued', data));
  bus.on('file:uploading', (data) => broadcast('file:uploading', data));
  bus.on('file:uploaded', (data) => broadcast('file:uploaded', data));
  bus.on('file:failed', (data) => broadcast('file:failed', data));
  bus.on('reconcile:start', () => broadcast('reconcile:start', {}));
  bus.on('reconcile:done', (data) => broadcast('reconcile:done', data));
  bus.on('stats:update', () => broadcast('stats', buildStats()));

  server.listen(config.server.port, () => {
    log.info(`Dashboard: http://localhost:${config.server.port}`);
    log.info(`WebSocket: ws://localhost:${config.server.port}/ws`);
  });

  return server;
}
