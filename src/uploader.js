import { BlobServiceClient } from '@azure/storage-blob';
import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import { join } from 'path';
import { config } from './config.js';
import { getPending, markUploading, markUploaded, markFailed, logActivity } from './db.js';
import { bus } from './events.js';
import { log } from './logger.js';

let containerClient;
let running = false;
let activeUploads = 0;

// Speed tracking — rolling window
const speedWindow = [];
const SPEED_WINDOW_SIZE = 20; // last N uploads

function recordSpeed(size, duration) {
  speedWindow.push({ size, duration, ts: Date.now() });
  if (speedWindow.length > SPEED_WINDOW_SIZE) speedWindow.shift();
}

export function getUploadSpeed() {
  // Calculate from recent uploads in last 60s
  const cutoff = Date.now() - 60000;
  const recent = speedWindow.filter(s => s.ts > cutoff);
  if (recent.length === 0) return { bytesPerSec: 0, avgDuration: 0, recentCount: 0 };
  const totalBytes = recent.reduce((a, s) => a + s.size, 0);
  const totalDuration = recent.reduce((a, s) => a + s.duration, 0);
  return {
    bytesPerSec: totalDuration > 0 ? Math.round((totalBytes / totalDuration) * 1000) : 0,
    avgDuration: Math.round(totalDuration / recent.length),
    recentCount: recent.length,
  };
}

export function initAzure() {
  const blobService = BlobServiceClient.fromConnectionString(config.azure.connectionString);
  containerClient = blobService.getContainerClient(config.azure.containerName);
  log.info('Azure Blob client initialized', { container: config.azure.containerName });
  return containerClient;
}

export function getContainerClient() {
  return containerClient;
}

async function uploadFile(file) {
  const fullPath = join(config.sync.basePath, file.rel_path);
  const blobClient = containerClient.getBlockBlobClient(file.blob_name);

  markUploading(file.rel_path);
  bus.emit('file:uploading', { relPath: file.rel_path });

  const start = Date.now();

  try {
    // Verify file still exists + get current size
    const st = await stat(fullPath);
    const stream = createReadStream(fullPath);

    await blobClient.uploadStream(
      stream,
      4 * 1024 * 1024, // 4MB buffer
      4,               // 4 concurrent transfers per file
      {
        blobHTTPHeaders: { blobContentType: getMimeType(file.rel_path) },
        tier: config.azure.accessTier,
      }
    );

    const duration = Date.now() - start;
    recordSpeed(st.size, duration);
    markUploaded(file.rel_path);
    logActivity('upload', `Uploaded ${file.rel_path} (${formatSize(st.size)}) in ${duration}ms`, file.rel_path);
    bus.emit('file:uploaded', { relPath: file.rel_path, size: st.size, duration, speed: getUploadSpeed() });
    bus.emit('stats:update');
    log.info('Uploaded', { relPath: file.rel_path, size: st.size, duration });
  } catch (err) {
    const duration = Date.now() - start;
    markFailed(file.rel_path, err.message);
    logActivity('error', `Failed to upload ${file.rel_path}: ${err.message}`, file.rel_path);
    bus.emit('file:failed', { relPath: file.rel_path, error: err.message });
    bus.emit('stats:update');
    log.error('Upload failed', { relPath: file.rel_path, error: err.message, duration });
  }
}

async function processQueue() {
  if (!running) return;

  while (running) {
    const pending = getPending(config.sync.concurrency - activeUploads);
    if (pending.length === 0) break;

    const uploads = pending.map(async (file) => {
      activeUploads++;
      try {
        await uploadFile(file);
      } finally {
        activeUploads--;
      }
    });

    await Promise.all(uploads);
  }
}

export function startUploader() {
  running = true;
  log.info('Upload workers started', { concurrency: config.sync.concurrency });

  // Process queue on new file events
  bus.on('file:queued', () => {
    if (activeUploads < config.sync.concurrency) {
      processQueue();
    }
  });

  // Initial drain of any pending files
  processQueue();
}

export function stopUploader() {
  running = false;
}

export function triggerQueue() {
  if (running && activeUploads < config.sync.concurrency) {
    processQueue();
  }
}

export function getUploaderStatus() {
  return { running, activeUploads, speed: getUploadSpeed() };
}

function getMimeType(filePath) {
  const ext = filePath.split('.').pop().toLowerCase();
  const types = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
    webp: 'image/webp', heic: 'image/heic', heif: 'image/heif',
    mp4: 'video/mp4', mov: 'video/quicktime', avi: 'video/x-msvideo', mkv: 'video/x-matroska',
    webm: 'video/webm', '3gp': 'video/3gpp',
    gz: 'application/gzip', sql: 'application/sql',
    json: 'application/json',
  };
  return types[ext] || 'application/octet-stream';
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)}GB`;
}
