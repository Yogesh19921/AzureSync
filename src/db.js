import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { dirname } from 'path';
import { config } from './config.js';
import { log } from './logger.js';

let db;

export function initDb() {
  mkdirSync(dirname(config.db.path), { recursive: true });
  db = new Database(config.db.path);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rel_path TEXT UNIQUE NOT NULL,
      size INTEGER NOT NULL,
      mtime_ms INTEGER NOT NULL,
      blob_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      uploaded_at TEXT,
      error TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_files_status ON files(status);
    CREATE INDEX IF NOT EXISTS idx_files_rel_path ON files(rel_path);

    CREATE TABLE IF NOT EXISTS activity_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      message TEXT NOT NULL,
      rel_path TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_log(created_at);
  `);

  log.info('SQLite initialized', { path: config.db.path });
  return db;
}

export function getDb() {
  return db;
}

// --- File operations ---

const stmts = {};

function prepare() {
  stmts.upsertFile = db.prepare(`
    INSERT INTO files (rel_path, size, mtime_ms, blob_name, status)
    VALUES (@relPath, @size, @mtimeMs, @blobName, 'pending')
    ON CONFLICT(rel_path) DO UPDATE SET
      size = @size, mtime_ms = @mtimeMs, status = 'pending', error = NULL
  `);

  stmts.markUploading = db.prepare(`
    UPDATE files SET status = 'uploading' WHERE rel_path = @relPath
  `);

  stmts.markUploaded = db.prepare(`
    UPDATE files SET status = 'uploaded', uploaded_at = datetime('now'), error = NULL
    WHERE rel_path = @relPath
  `);

  stmts.markFailed = db.prepare(`
    UPDATE files SET status = 'failed', error = @error WHERE rel_path = @relPath
  `);

  stmts.getByPath = db.prepare(`SELECT * FROM files WHERE rel_path = @relPath`);

  stmts.getPending = db.prepare(`
    SELECT * FROM files WHERE status IN ('pending', 'failed') ORDER BY created_at LIMIT @limit
  `);

  stmts.getStats = db.prepare(`
    SELECT status, COUNT(*) as count, SUM(size) as total_size FROM files GROUP BY status
  `);

  stmts.getRecent = db.prepare(`
    SELECT * FROM files ORDER BY uploaded_at DESC LIMIT @limit
  `);

  stmts.getAllUploaded = db.prepare(`SELECT rel_path, size FROM files WHERE status = 'uploaded'`);

  stmts.logActivity = db.prepare(`
    INSERT INTO activity_log (type, message, rel_path) VALUES (@type, @message, @relPath)
  `);

  stmts.getActivity = db.prepare(`
    SELECT * FROM activity_log ORDER BY created_at DESC LIMIT @limit
  `);

  stmts.getFileList = db.prepare(`
    SELECT * FROM files ORDER BY created_at DESC LIMIT @limit OFFSET @offset
  `);

  stmts.getTotalCount = db.prepare(`SELECT COUNT(*) as count FROM files`);

  stmts.getTotalCountFiltered = db.prepare(`
    SELECT COUNT(*) as count FROM files
    WHERE (@status IS NULL OR status = @status)
    AND (@search IS NULL OR rel_path LIKE '%' || @search || '%')
  `);

  stmts.getFileListFiltered = db.prepare(`
    SELECT * FROM files
    WHERE (@status IS NULL OR status = @status)
    AND (@search IS NULL OR rel_path LIKE '%' || @search || '%')
    ORDER BY created_at DESC LIMIT @limit OFFSET @offset
  `);

  stmts.retryFailed = db.prepare(`
    UPDATE files SET status = 'pending', error = NULL WHERE status = 'failed'
  `);

  stmts.retryOne = db.prepare(`
    UPDATE files SET status = 'pending', error = NULL WHERE rel_path = @relPath AND status = 'failed'
  `);

  stmts.getStorageBreakdown = db.prepare(`
    SELECT
      CASE
        WHEN rel_path LIKE 'library/%' THEN 'library'
        WHEN rel_path LIKE 'upload/%' THEN 'upload'
        WHEN rel_path LIKE 'encoded-video/%' THEN 'encoded-video'
        WHEN rel_path LIKE 'backups/%' THEN 'backups'
        ELSE 'other'
      END as category,
      COUNT(*) as count,
      SUM(size) as total_size
    FROM files
    GROUP BY category
  `);

  stmts.getUploadTimeline = db.prepare(`
    SELECT
      strftime('%Y-%m-%d %H:00:00', uploaded_at) as hour,
      COUNT(*) as count,
      SUM(size) as total_size
    FROM files
    WHERE status = 'uploaded' AND uploaded_at IS NOT NULL
    AND uploaded_at >= datetime('now', @since)
    GROUP BY hour
    ORDER BY hour
  `);

  stmts.getDbSize = db.prepare(`SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size()`);

  stmts.getFailedFiles = db.prepare(`SELECT * FROM files WHERE status = 'failed' ORDER BY created_at DESC`);

  stmts.getFileTypeBreakdown = db.prepare(`
    SELECT
      CASE
        WHEN lower(rel_path) GLOB '*.[jJ][pP][gG]' OR lower(rel_path) GLOB '*.[jJ][pP][eE][gG]'
          OR lower(rel_path) GLOB '*.[pP][nN][gG]' OR lower(rel_path) GLOB '*.[gG][iI][fF]'
          OR lower(rel_path) GLOB '*.[wW][eE][bB][pP]' OR lower(rel_path) GLOB '*.[hH][eE][iI][cCfF]'
          THEN 'images'
        WHEN lower(rel_path) GLOB '*.[mM][pP]4' OR lower(rel_path) GLOB '*.[mM][oO][vV]'
          OR lower(rel_path) GLOB '*.[aA][vV][iI]' OR lower(rel_path) GLOB '*.[mM][kK][vV]'
          OR lower(rel_path) GLOB '*.[wW][eE][bB][mM]' OR lower(rel_path) GLOB '*.[3][gG][pP]'
          THEN 'videos'
        WHEN lower(rel_path) GLOB '*.[sS][qQ][lL].[gG][zZ]' OR lower(rel_path) GLOB '*.[sS][qQ][lL]'
          THEN 'database'
        ELSE 'other'
      END as file_type,
      COUNT(*) as count,
      SUM(size) as total_size
    FROM files
    GROUP BY file_type
  `);

  stmts.getLargestFiles = db.prepare(`
    SELECT * FROM files ORDER BY size DESC LIMIT @limit
  `);

  stmts.getDigest = db.prepare(`
    SELECT
      COUNT(*) FILTER (WHERE uploaded_at >= datetime('now', @since)) as uploaded_count,
      COALESCE(SUM(size) FILTER (WHERE uploaded_at >= datetime('now', @since)), 0) as uploaded_size,
      COUNT(*) FILTER (WHERE status = 'failed' AND created_at >= datetime('now', @since)) as failed_count
    FROM files
  `);

  stmts.getLastSync = db.prepare(`
    SELECT uploaded_at, rel_path FROM files WHERE status = 'uploaded' AND uploaded_at IS NOT NULL
    ORDER BY uploaded_at DESC LIMIT 1
  `);

  stmts.getFailureTrend = db.prepare(`
    SELECT
      COUNT(*) FILTER (WHERE status = 'failed' AND created_at >= datetime('now', '-1 hours')) as last_hour,
      COUNT(*) FILTER (WHERE status = 'failed' AND created_at >= datetime('now', '-24 hours')) as last_day,
      COUNT(*) FILTER (WHERE status = 'failed') as total
    FROM files
  `);

  stmts.markUploadedBulk = db.prepare(`
    INSERT INTO files (rel_path, size, mtime_ms, blob_name, status, uploaded_at)
    VALUES (@relPath, @size, @mtimeMs, @blobName, 'uploaded', datetime('now'))
    ON CONFLICT(rel_path) DO UPDATE SET
      size = @size, status = 'uploaded', uploaded_at = datetime('now')
  `);
}

export function upsertFile(relPath, size, mtimeMs, blobName) {
  return stmts.upsertFile.run({ relPath, size, mtimeMs, blobName });
}

export function markUploading(relPath) {
  return stmts.markUploading.run({ relPath });
}

export function markUploaded(relPath) {
  return stmts.markUploaded.run({ relPath });
}

export function markFailed(relPath, error) {
  return stmts.markFailed.run({ relPath, error: String(error) });
}

export function getByPath(relPath) {
  return stmts.getByPath.get({ relPath });
}

export function getPending(limit = 100) {
  return stmts.getPending.all({ limit });
}

export function getStats() {
  return stmts.getStats.all();
}

export function getRecentUploads(limit = 50) {
  return stmts.getRecent.all({ limit });
}

export function getAllUploaded() {
  return stmts.getAllUploaded.all();
}

export function logActivity(type, message, relPath = null) {
  stmts.logActivity.run({ type, message, relPath });
}

export function getActivity(limit = 100) {
  return stmts.getActivity.all({ limit });
}

export function getFileList(limit = 50, offset = 0) {
  return stmts.getFileList.all({ limit, offset });
}

export function getTotalCount() {
  return stmts.getTotalCount.get().count;
}

export function getFileListFiltered(limit = 50, offset = 0, status = null, search = null) {
  return stmts.getFileListFiltered.all({ limit, offset, status, search: search || null });
}

export function getTotalCountFiltered(status = null, search = null) {
  return stmts.getTotalCountFiltered.get({ status, search: search || null }).count;
}

export function retryFailed() {
  return stmts.retryFailed.run();
}

export function retryOne(relPath) {
  return stmts.retryOne.run({ relPath });
}

export function getStorageBreakdown() {
  return stmts.getStorageBreakdown.all();
}

export function getUploadTimeline(since = '-7 days') {
  return stmts.getUploadTimeline.all({ since });
}

export function getDbSize() {
  return stmts.getDbSize.get()?.size || 0;
}

export function getFailedFiles() {
  return stmts.getFailedFiles.all();
}

export function getFileTypeBreakdown() {
  return stmts.getFileTypeBreakdown.all();
}

export function getLargestFiles(limit = 10) {
  return stmts.getLargestFiles.all({ limit });
}

export function getDigest(since = '-1 days') {
  return stmts.getDigest.get({ since });
}

export function getLastSync() {
  return stmts.getLastSync.get() || null;
}

export function getFailureTrend() {
  return stmts.getFailureTrend.get();
}

export function markUploadedBulk(files) {
  const tx = db.transaction((items) => {
    for (const f of items) {
      stmts.markUploadedBulk.run(f);
    }
  });
  tx(files);
}

export function initStatements() {
  prepare();
}
