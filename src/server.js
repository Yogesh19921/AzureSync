import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { stat } from 'fs/promises';
import { config } from './config.js';
import {
  getStats, getActivity, getFileListFiltered, getTotalCountFiltered,
  getRecentUploads, getStorageBreakdown, getUploadTimeline, getDbSize,
  retryFailed, retryOne, logActivity, getFailedFiles,
  getFileTypeBreakdown, getLargestFiles, getDigest, getLastSync, getFailureTrend,
} from './db.js';
import { getUploaderStatus, triggerQueue, pauseUploader, resumeUploader } from './uploader.js';
import { updateWebhookUrl } from './discord.js';
import { reconcile } from './reconciler.js';
import { scanMissing, restoreAll, restoreOne, getScanResult, isScanning, isRestoring, getRestoreProgress } from './restorer.js';
import { bus } from './events.js';
import { log } from './logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const configPath = process.env.CONFIG_PATH || resolve(__dirname, '..', 'config.json');

function buildStats() {
  const rows = getStats();
  const s = { pending: 0, uploading: 0, uploaded: 0, failed: 0, totalSize: 0, pendingSize: 0 };
  for (const row of rows) {
    s[row.status] = row.count;
    if (row.status === 'uploaded') s.totalSize = row.total_size || 0;
    if (row.status === 'pending' || row.status === 'failed') s.pendingSize += row.total_size || 0;
  }
  s.total = s.pending + s.uploading + s.uploaded + s.failed;
  s.uploader = getUploaderStatus();
  s.lastSync = getLastSync();
  s.failureTrend = getFailureTrend();
  return s;
}

let reconciling = false;

export function startServer() {
  const app = express();
  const server = createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  app.use(express.json());

  const frontendDist = resolve(__dirname, '..', 'frontend', 'dist');
  if (existsSync(frontendDist)) {
    app.use(express.static(frontendDist));
  }

  // --- REST API ---

  app.get('/api/stats', (_req, res) => res.json(buildStats()));

  app.get('/api/activity', (req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    res.json(getActivity(limit));
  });

  app.get('/api/files', (req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const offset = parseInt(req.query.offset) || 0;
    const status = req.query.status || null;
    const search = req.query.search || null;
    res.json({ files: getFileListFiltered(limit, offset, status, search), total: getTotalCountFiltered(status, search), limit, offset });
  });

  app.get('/api/recent', (req, res) => {
    res.json(getRecentUploads(Math.min(parseInt(req.query.limit) || 50, 200)));
  });

  app.get('/api/breakdown', (_req, res) => res.json(getStorageBreakdown()));

  app.get('/api/breakdown/types', (_req, res) => res.json(getFileTypeBreakdown()));

  app.get('/api/largest', (req, res) => {
    res.json(getLargestFiles(Math.min(parseInt(req.query.limit) || 10, 50)));
  });

  app.get('/api/digest', (req, res) => {
    const since = req.query.since || '-1 days';
    const allowed = ['-1 days', '-7 days', '-30 days'];
    res.json(getDigest(allowed.includes(since) ? since : '-1 days'));
  });

  app.get('/api/timeline', (req, res) => {
    const since = req.query.since || '-7 days';
    const allowed = ['-1 days', '-7 days', '-30 days', '-24 hours'];
    res.json(getUploadTimeline(allowed.includes(since) ? since : '-7 days'));
  });

  app.get('/api/health', async (_req, res) => {
    let disk;
    try { await stat(config.sync.basePath); disk = { path: config.sync.basePath, accessible: true }; }
    catch { disk = { path: config.sync.basePath, accessible: false }; }

    res.json({
      status: 'running',
      uptime: Math.floor(process.uptime()),
      memoryMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
      dbSizeMB: (getDbSize() / 1024 / 1024).toFixed(2),
      disk,
      uploader: getUploaderStatus(),
      config: {
        basePath: config.sync.basePath,
        container: config.azure.containerName,
        accessTier: config.azure.accessTier,
        concurrency: config.sync.concurrency,
        watchDirs: config.sync.watchDirs,
      },
    });
  });

  app.get('/api/cost', (_req, res) => {
    const rows = getStats();
    let totalBytes = 0;
    for (const row of rows) {
      if (row.status === 'uploaded') totalBytes = row.total_size || 0;
    }
    const gb = totalBytes / (1024 * 1024 * 1024);
    const rate = config.azure.costPerGBPerMonth || 0.0036;
    res.json({
      totalBytes,
      totalGB: parseFloat(gb.toFixed(2)),
      costPerGBPerMonth: rate,
      monthlyCost: parseFloat((gb * rate).toFixed(4)),
      yearlyCost: parseFloat((gb * rate * 12).toFixed(2)),
    });
  });

  // Pause / Resume
  app.post('/api/pause', (_req, res) => { pauseUploader(); logActivity('system', 'Uploads paused'); res.json({ paused: true }); });
  app.post('/api/resume', (_req, res) => { resumeUploader(); logActivity('system', 'Uploads resumed'); res.json({ paused: false }); });

  // Retry
  app.post('/api/retry', (_req, res) => {
    const result = retryFailed();
    logActivity('system', `Retried ${result.changes} failed files`);
    bus.emit('stats:update');
    triggerQueue();
    res.json({ retried: result.changes });
  });

  app.post('/api/retry/:id', (req, res) => {
    const relPath = decodeURIComponent(req.params.id);
    const result = retryOne(relPath);
    if (result.changes > 0) { logActivity('system', `Retried file: ${relPath}`, relPath); bus.emit('stats:update'); triggerQueue(); }
    res.json({ retried: result.changes });
  });

  // Reconciliation
  app.post('/api/reconcile', async (_req, res) => {
    if (reconciling) return res.status(409).json({ error: 'Reconciliation already in progress' });
    reconciling = true;
    res.json({ started: true });
    try { await reconcile(); triggerQueue(); } catch (err) { log.error('Manual reconciliation failed', { error: err.message }); }
    finally { reconciling = false; }
  });

  // Config read/write
  app.get('/api/config', (_req, res) => {
    try {
      const raw = JSON.parse(readFileSync(configPath, 'utf-8'));
      if (raw.azure?.connectionString) raw.azure.connectionString = '***configured***';
      res.json(raw);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.put('/api/config', (req, res) => {
    try {
      const current = JSON.parse(readFileSync(configPath, 'utf-8'));
      const u = req.body;

      if (u.sync?.concurrency != null) { const v = parseInt(u.sync.concurrency); if (v >= 1 && v <= 10) { current.sync.concurrency = v; config.sync.concurrency = v; } }
      if (u.sync?.debounceMs != null) { const v = parseInt(u.sync.debounceMs); if (v >= 500 && v <= 30000) { current.sync.debounceMs = v; config.sync.debounceMs = v; } }
      if (u.sync?.skipPatterns != null && Array.isArray(u.sync.skipPatterns)) { current.sync.skipPatterns = u.sync.skipPatterns; config.sync.skipPatterns = u.sync.skipPatterns; }
      if (u.discord?.webhookUrl != null) { current.discord = current.discord || {}; current.discord.webhookUrl = u.discord.webhookUrl; config.discord = config.discord || {}; config.discord.webhookUrl = u.discord.webhookUrl; updateWebhookUrl(u.discord.webhookUrl); }
      if (u.discord?.notifyOnFailure != null) { current.discord = current.discord || {}; current.discord.notifyOnFailure = Boolean(u.discord.notifyOnFailure); config.discord = config.discord || {}; config.discord.notifyOnFailure = Boolean(u.discord.notifyOnFailure); }
      if (u.azure?.costPerGBPerMonth != null) { const v = parseFloat(u.azure.costPerGBPerMonth); if (v >= 0 && v <= 1) { current.azure.costPerGBPerMonth = v; config.azure.costPerGBPerMonth = v; } }

      writeFileSync(configPath, JSON.stringify(current, null, 2) + '\n');
      logActivity('system', 'Configuration updated from dashboard');
      res.json({ saved: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Export CSV
  app.get('/api/export/activity', (req, res) => {
    const rows = getActivity(Math.min(parseInt(req.query.limit) || 1000, 10000));
    const csv = ['timestamp,type,message,file'].concat(rows.map(r => `"${r.created_at}","${r.type}","${r.message.replace(/"/g, '""')}","${(r.rel_path || '').replace(/"/g, '""')}"`)).join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=azure-sync-activity.csv');
    res.send(csv);
  });

  app.get('/api/export/files', (req, res) => {
    const status = req.query.status || null;
    const rows = getFileListFiltered(10000, 0, status, null);
    const csv = ['path,size,status,uploaded_at,error'].concat(rows.map(r => `"${r.rel_path}",${r.size},"${r.status}","${r.uploaded_at || ''}","${(r.error || '').replace(/"/g, '""')}"`)).join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=azure-sync-files${status ? '-' + status : ''}.csv`);
    res.send(csv);
  });

  app.get('/api/failed', (_req, res) => res.json(getFailedFiles()));

  // --- Restore (Azure → local) ---

  app.post('/api/restore/scan', async (_req, res) => {
    if (isScanning()) return res.status(409).json({ error: 'Scan already in progress' });
    res.json({ started: true });
    try { await scanMissing(); } catch (err) { log.error('Scan failed', { error: err.message }); }
  });

  app.get('/api/restore/status', (_req, res) => {
    const scan = getScanResult();
    res.json({
      scanning: isScanning(),
      restoring: isRestoring(),
      progress: getRestoreProgress(),
      scan: scan ? { scannedAt: scan.scannedAt, totalAzure: scan.totalAzure, totalLocal: scan.totalLocal, missingCount: scan.missingCount, missingSize: scan.missingSize } : null,
    });
  });

  app.get('/api/restore/files', (req, res) => {
    const scan = getScanResult();
    if (!scan) return res.json({ files: [], total: 0 });
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const offset = parseInt(req.query.offset) || 0;
    res.json({ files: scan.files.slice(offset, offset + limit), total: scan.missingCount });
  });

  app.post('/api/restore/all', async (_req, res) => {
    if (isRestoring()) return res.status(409).json({ error: 'Restore already in progress' });
    if (!getScanResult()) return res.status(400).json({ error: 'Run scan first' });
    logActivity('system', `Restore started: ${getScanResult().missingCount} files`);
    res.json({ started: true });
    try {
      const result = await restoreAll();
      logActivity('system', `Restore complete: ${result.done} downloaded, ${result.failed} failed`);
    } catch (err) { log.error('Restore failed', { error: err.message }); }
  });

  app.post('/api/restore/file', async (req, res) => {
    const { blobName } = req.body;
    if (!blobName) return res.status(400).json({ error: 'blobName required' });
    const result = await restoreOne(blobName);
    res.json(result);
  });

  // SPA fallback — LAST
  app.get('*', (_req, res) => {
    if (existsSync(resolve(frontendDist, 'index.html'))) res.sendFile(resolve(frontendDist, 'index.html'));
    else res.status(200).send('AzureSync running. Frontend not built yet — run: npm run build:frontend');
  });

  // --- WebSocket ---
  const clients = new Set();

  wss.on('connection', (ws) => {
    clients.add(ws);
    ws.send(JSON.stringify({ type: 'stats', data: buildStats() }));
    ws.on('close', () => clients.delete(ws));
  });

  function broadcast(type, data) {
    const msg = JSON.stringify({ type, data });
    for (const ws of clients) { if (ws.readyState === 1) ws.send(msg); }
  }

  bus.on('file:queued', (data) => broadcast('file:queued', data));
  bus.on('file:uploading', (data) => broadcast('file:uploading', data));
  bus.on('file:uploaded', (data) => broadcast('file:uploaded', data));
  bus.on('file:failed', (data) => broadcast('file:failed', data));
  bus.on('reconcile:start', () => broadcast('reconcile:start', {}));
  bus.on('reconcile:done', (data) => broadcast('reconcile:done', data));
  bus.on('restore:scan-start', () => broadcast('restore:scan-start', {}));
  bus.on('restore:scan-done', (data) => broadcast('restore:scan-done', data));
  bus.on('restore:start', (data) => broadcast('restore:start', data));
  bus.on('restore:progress', (data) => broadcast('restore:progress', data));
  bus.on('restore:done', (data) => broadcast('restore:done', data));
  bus.on('stats:update', () => broadcast('stats', buildStats()));

  server.listen(config.server.port, () => {
    log.info(`Dashboard: http://localhost:${config.server.port}`);
    log.info(`WebSocket: ws://localhost:${config.server.port}/ws`);
  });

  return server;
}
