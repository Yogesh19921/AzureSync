import { join, relative } from 'path';
import { readdir, stat } from 'fs/promises';
import { config } from './config.js';
import { getByPath, upsertFile, markUploadedBulk, logActivity } from './db.js';
import { getContainerClient } from './uploader.js';
import { bus } from './events.js';
import { log } from './logger.js';

function shouldSkip(relPath) {
  const { skipPatterns } = config.sync;
  const name = relPath.split('/').pop();

  for (const pattern of skipPatterns) {
    if (name === pattern) return true;
    if (pattern.endsWith('*') && name.startsWith(pattern.slice(0, -1))) return true;
    if (pattern.endsWith('/**') && relPath.startsWith(pattern.slice(0, -3))) return true;
    if (pattern.startsWith('*.') && name.endsWith(pattern.slice(1))) return true;
  }
  return false;
}

async function walkDir(dirPath) {
  const files = [];

  async function walk(current) {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(current, entry.name);
      const relPath = relative(config.sync.basePath, fullPath);

      if (shouldSkip(relPath)) continue;

      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        const st = await stat(fullPath);
        files.push({ relPath, size: st.size, mtimeMs: Math.floor(st.mtimeMs) });
      }
    }
  }

  await walk(dirPath);
  return files;
}

async function listAzureBlobs(prefix) {
  const blobs = new Map();
  const container = getContainerClient();

  log.info('Listing Azure blobs', { prefix });

  for await (const blob of container.listBlobsFlat({ prefix })) {
    blobs.set(blob.name, {
      name: blob.name,
      size: blob.properties.contentLength,
    });
  }

  return blobs;
}

export async function reconcile() {
  const start = Date.now();
  bus.emit('reconcile:start');
  logActivity('system', 'Reconciliation started');
  log.info('Starting reconciliation');

  // Step 1: List all Azure blobs for our target prefixes
  const azureBlobs = new Map();
  for (const dir of config.sync.watchDirs) {
    const blobs = await listAzureBlobs(`${dir}/`);
    for (const [name, info] of blobs) {
      azureBlobs.set(name, info);
    }
  }

  log.info('Azure blobs fetched', { count: azureBlobs.size });

  // Step 2: Walk local dirs
  let totalLocal = 0;
  let queued = 0;
  let skipped = 0;
  let alreadyInAzure = 0;

  // Batch for bulk DB insert of already-uploaded files
  const bulkUploaded = [];

  for (const dir of config.sync.watchDirs) {
    const dirPath = join(config.sync.basePath, dir);
    let localFiles;
    try {
      localFiles = await walkDir(dirPath);
    } catch (err) {
      log.warn('Failed to walk dir', { dir, error: err.message });
      continue;
    }

    totalLocal += localFiles.length;

    for (const file of localFiles) {
      const azureBlob = azureBlobs.get(file.relPath);

      // Already in Azure w/ same size → mark as uploaded in DB, skip upload
      if (azureBlob && azureBlob.size === file.size) {
        const existing = getByPath(file.relPath);
        if (!existing || existing.status !== 'uploaded') {
          bulkUploaded.push({
            relPath: file.relPath,
            size: file.size,
            mtimeMs: file.mtimeMs,
            blobName: file.relPath,
          });
        }
        alreadyInAzure++;
        skipped++;
        continue;
      }

      // Not in Azure or size mismatch → queue for upload
      const existing = getByPath(file.relPath);
      if (!existing || existing.status !== 'uploaded' || existing.size !== file.size) {
        upsertFile(file.relPath, file.size, file.mtimeMs, file.relPath);
        queued++;
      } else {
        skipped++;
      }
    }
  }

  // Bulk insert already-uploaded records
  if (bulkUploaded.length > 0) {
    markUploadedBulk(bulkUploaded);
    log.info('Marked existing Azure blobs in DB', { count: bulkUploaded.length });
  }

  const duration = Date.now() - start;
  const msg = `Reconciliation done: ${totalLocal} local files, ${alreadyInAzure} already in Azure, ${queued} queued, ${skipped} skipped (${duration}ms)`;
  logActivity('system', msg);
  bus.emit('reconcile:done', { queued, skipped, alreadyInAzure, totalLocal, duration });
  bus.emit('stats:update');
  log.info(msg);

  return { queued, skipped, alreadyInAzure, totalLocal, duration };
}
