import { join, dirname } from 'path';
import { existsSync, createWriteStream } from 'fs';
import { mkdir } from 'fs/promises';
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

export async function scanMissing() {
  if (scanning) throw new Error('Scan already in progress');
  scanning = true;
  bus.emit('restore:scan-start');

  try {
    const container = getContainerClient();
    const missing = [];
    let totalAzure = 0;
    let totalLocal = 0;
    let totalMissingSize = 0;

    for (const dir of config.sync.watchDirs) {
      log.info('Scanning Azure prefix for missing files', { prefix: dir });

      for await (const blob of container.listBlobsFlat({ prefix: `${dir}/` })) {
        totalAzure++;
        const localPath = join(config.sync.basePath, blob.name);

        // Skip junk
        const name = blob.name.split('/').pop();
        if (name.startsWith('.fuse_hidden') || name.startsWith('.azDownload-') || name === '.DS_Store' || name === '.immich' || name.endsWith('.tmp')) {
          continue;
        }

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
      totalAzure,
      totalLocal,
      missingCount: missing.length,
      missingSize: totalMissingSize,
      files: missing,
    };

    log.info('Scan complete', { totalAzure, totalLocal, missing: missing.length, missingSize: totalMissingSize });
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

  // Create directory structure
  await mkdir(dirname(localPath), { recursive: true });

  // Download to file
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

  // Clear scan results — files now exist locally
  scanResult = null;
  return getRestoreProgress();
}

export async function restoreOne(blobName) {
  try {
    await downloadBlob(blobName);
    // Remove from scan results
    if (scanResult) {
      scanResult.files = scanResult.files.filter(f => f.blobName !== blobName);
      scanResult.missingCount = scanResult.files.length;
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}
