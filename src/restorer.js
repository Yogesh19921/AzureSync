import { join, dirname } from 'path';
import { existsSync, createWriteStream } from 'fs';
import { mkdir } from 'fs/promises';
import { execSync } from 'child_process';
import { config } from './config.js';
import { getContainerClient } from './uploader.js';
import { bus } from './events.js';
import { log } from './logger.js';

let scanResult = null;
let scanning = false;
let restoring = false;
let restoreProgress = { total: 0, done: 0, failed: 0, active: 0, currentFile: null };

export function getScanResult() { return scanResult; }
export function isScanning() { return scanning; }
export function isRestoring() { return restoring; }
export function getRestoreProgress() { return { ...restoreProgress }; }

// Get set of active asset paths from Immich DB (container path → relative blob path)
function getImmichActivePaths() {
  try {
    const raw = execSync(
      `docker exec immich_postgres psql -U postgres -d immich -t -A -c 'SELECT "originalPath" FROM asset WHERE status = $$active$$;'`,
      { timeout: 30000, encoding: 'utf-8' }
    );
    const paths = new Set();
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      // Convert /usr/src/app/upload/upload/... → upload/...
      const rel = trimmed.replace('/usr/src/app/upload/', '');
      paths.add(rel);
    }
    log.info('Loaded Immich active asset paths', { count: paths.size });
    return paths;
  } catch (err) {
    log.warn('Could not query Immich DB — falling back to full scan', { error: err.message });
    return null;
  }
}

export async function scanMissing(options = {}) {
  if (scanning) throw new Error('Scan already in progress');
  scanning = true;
  bus.emit('restore:scan-start');

  const prefixes = options.prefixes || ['upload'];
  const immichOnly = options.immichOnly !== false; // default true

  try {
    const container = getContainerClient();
    const missing = [];
    let totalAzure = 0;
    let totalLocal = 0;
    let totalMissingSize = 0;
    let skippedNotInImmich = 0;

    // Try to get Immich DB paths for cross-referencing
    const immichPaths = immichOnly ? getImmichActivePaths() : null;

    for (const dir of prefixes) {
      log.info('Scanning Azure prefix for missing files', { prefix: dir });

      for await (const blob of container.listBlobsFlat({ prefix: `${dir}/` })) {
        if (blob.name.startsWith('immich/')) continue;

        // Skip junk files
        const name = blob.name.split('/').pop();
        if (name.startsWith('.fuse_hidden') || name.startsWith('.azDownload-') || name === '.DS_Store' || name === '.immich' || name.endsWith('.tmp')) {
          continue;
        }

        totalAzure++;

        // If Immich cross-ref available, skip files not in Immich DB
        if (immichPaths && !immichPaths.has(blob.name)) {
          skippedNotInImmich++;
          continue;
        }

        const localPath = join(config.sync.basePath, blob.name);
        if (existsSync(localPath)) {
          totalLocal++;
        } else {
          missing.push({
            blobName: blob.name,
            size: blob.properties.contentLength,
            lastModified: blob.properties.lastModified,
            contentType: blob.properties.contentSettings?.contentType || 'unknown',
          });
          totalMissingSize += blob.properties.contentLength;
        }
      }
    }

    scanResult = {
      scannedAt: new Date().toISOString(),
      prefixes,
      immichCrossRef: !!immichPaths,
      totalAzure,
      totalLocal,
      skippedNotInImmich,
      missingCount: missing.length,
      missingSize: totalMissingSize,
      files: missing,
    };

    log.info('Scan complete', {
      prefixes, totalAzure, totalLocal, missing: missing.length,
      missingSize: totalMissingSize, skippedNotInImmich,
      immichCrossRef: !!immichPaths,
    });
    bus.emit('restore:scan-done', { missingCount: missing.length, missingSize: totalMissingSize });
    return scanResult;
  } finally {
    scanning = false;
  }
}

async function downloadBlob(blobName) {
  const container = getContainerClient();
  const blobClient = container.getBlockBlobClient(blobName);
  const localPath = join(config.sync.basePath, blobName);

  await mkdir(dirname(localPath), { recursive: true });

  const downloadResponse = await blobClient.download(0);
  return new Promise((resolve, reject) => {
    const ws = createWriteStream(localPath);
    downloadResponse.readableStreamBody.pipe(ws);
    ws.on('finish', resolve);
    ws.on('error', reject);
  });
}

export async function restoreAll() {
  if (restoring) throw new Error('Restore already in progress');
  if (!scanResult || scanResult.files.length === 0) throw new Error('No scan results. Run scan first.');

  restoring = true;
  const files = [...scanResult.files];
  restoreProgress = { total: files.length, done: 0, failed: 0, active: 0, currentFile: null };
  bus.emit('restore:start', { total: files.length });

  const concurrency = config.sync.concurrency || 3;
  let index = 0;

  async function worker() {
    while (index < files.length) {
      const i = index++;
      const file = files[i];
      restoreProgress.active++;
      restoreProgress.currentFile = file.blobName;
      bus.emit('restore:progress', getRestoreProgress());

      try {
        await downloadBlob(file.blobName);
        restoreProgress.done++;
        log.info('Restored', { blob: file.blobName });
      } catch (err) {
        restoreProgress.failed++;
        log.error('Restore failed', { blob: file.blobName, error: err.message });
      }

      restoreProgress.active--;
      bus.emit('restore:progress', getRestoreProgress());
    }
  }

  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);

  restoring = false;
  bus.emit('restore:done', getRestoreProgress());
  log.info('Restore complete', restoreProgress);

  scanResult = null;
  return getRestoreProgress();
}

export async function restoreOne(blobName) {
  try {
    await downloadBlob(blobName);
    if (scanResult) {
      scanResult.files = scanResult.files.filter(f => f.blobName !== blobName);
      scanResult.missingCount = scanResult.files.length;
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}
