import chokidar from 'chokidar';
import { relative, join } from 'path';
import { stat } from 'fs/promises';
import { config } from './config.js';
import { upsertFile, getByPath, logActivity } from './db.js';
import { bus } from './events.js';
import { log } from './logger.js';

const debounceTimers = new Map();

function shouldSkip(relPath) {
  const { skipPatterns } = config.sync;
  const name = relPath.split('/').pop();

  for (const pattern of skipPatterns) {
    // Direct name match
    if (name === pattern) return true;
    // Glob-like prefix match: .fuse_hidden*
    if (pattern.endsWith('*') && name.startsWith(pattern.slice(0, -1))) return true;
    // Directory prefix match: thumbs/**, immich/**
    if (pattern.endsWith('/**') && relPath.startsWith(pattern.slice(0, -3))) return true;
    // Extension match: *.tmp
    if (pattern.startsWith('*.') && name.endsWith(pattern.slice(1))) return true;
  }
  return false;
}

function getRelPath(filePath) {
  return relative(config.sync.basePath, filePath);
}

async function handleFile(filePath) {
  const relPath = getRelPath(filePath);

  if (shouldSkip(relPath)) {
    log.debug('Skipped', { relPath });
    return;
  }

  try {
    const st = await stat(filePath);
    if (!st.isFile()) return;

    // Check if already uploaded w/ same size+mtime
    const existing = getByPath(relPath);
    if (existing && existing.status === 'uploaded' && existing.size === st.size && existing.mtime_ms === Math.floor(st.mtimeMs)) {
      log.debug('Already uploaded, skip', { relPath });
      return;
    }

    const blobName = relPath; // Mirror local path structure
    upsertFile(relPath, st.size, Math.floor(st.mtimeMs), blobName);
    bus.emit('file:queued', { relPath, size: st.size });
    log.info('Queued for upload', { relPath, size: st.size });
  } catch (err) {
    log.error('Failed to process file', { relPath, error: err.message });
  }
}

function debouncedHandle(filePath) {
  const existing = debounceTimers.get(filePath);
  if (existing) clearTimeout(existing);

  debounceTimers.set(filePath, setTimeout(() => {
    debounceTimers.delete(filePath);
    handleFile(filePath);
  }, config.sync.debounceMs));
}

export function startWatcher() {
  const watchPaths = config.sync.watchDirs.map(d => join(config.sync.basePath, d));

  log.info('Starting file watcher', { paths: watchPaths });

  const watcher = chokidar.watch(watchPaths, {
    persistent: true,
    ignoreInitial: true, // Don't fire for existing files — reconciler handles those
    awaitWriteFinish: {
      stabilityThreshold: config.sync.debounceMs,
      pollInterval: 500,
    },
    usePolling: false, // Use native inotify
  });

  watcher.on('add', (filePath) => {
    log.debug('File added', { filePath });
    debouncedHandle(filePath);
  });

  watcher.on('change', (filePath) => {
    log.debug('File changed', { filePath });
    debouncedHandle(filePath);
  });

  watcher.on('error', (err) => {
    log.error('Watcher error', { error: err.message });
  });

  watcher.on('ready', () => {
    log.info('Watcher ready — monitoring for new files');
    logActivity('system', 'File watcher started');
  });

  return watcher;
}
