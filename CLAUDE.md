# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Run

```bash
# Local development
npm install                            # Installs backend + frontend deps (postinstall)
npm start                              # Backend daemon on :3420 (serves built frontend)
npm run dev                            # Backend with --watch auto-restart
cd frontend && npm run dev             # Frontend dev server on :3421 (proxies /api + /ws to :3420)
npm run build:frontend                 # Build frontend into frontend/dist/

# Docker (production)
docker compose up -d --build           # Build + run container on :3420
docker compose logs -f                 # Stream logs

# Debug
LOG_LEVEL=debug npm start              # Verbose logging
```

Frontend dev server (Vite :3421) proxies `/api` and `/ws` to backend :3420 — run both for local development.

## Architecture

**Daemon** that watches immich media directories via inotify and uploads new files to Azure Blob Storage (cold tier). Three decoupled pipelines communicate through a central EventEmitter bus (`src/events.js`):

```
Watcher (chokidar/inotify)
    ↓ file:queued
Upload Queue (N concurrent workers)
    ↓ file:uploaded / file:failed
Express Server → WebSocket → React Dashboard
```

**Startup sequence** (`src/index.js`): init SQLite → init Azure client → start HTTP server → reconcile local↔Azure → start upload workers → start file watcher.

### Backend (`src/`)

- **watcher.js** — chokidar watches configured dirs, debounces writes, applies skip patterns, emits `file:queued`
- **uploader.js** — concurrency-limited queue, streams files to Azure with cold tier, tracks upload speed (rolling 60s window), emits progress events
- **reconciler.js** — lists Azure blobs by prefix, walks local dirs, queues missing files, bulk-marks already-synced files in DB. Runs at startup + triggerable via API
- **db.js** — SQLite with WAL mode. Two tables: `files` (sync state per file) and `activity_log`. All queries use prepared statements
- **server.js** — Express REST API + WebSocket. Broadcasts bus events to connected dashboard clients. Endpoints include stats, file list (with search/filter), retry, health, reconcile trigger, CSV export
- **events.js** — shared EventEmitter bus. Event types: `file:{queued,uploading,uploaded,failed}`, `reconcile:{start,done}`, `stats:update`

### Frontend (`frontend/src/`)

React 19 + Vite. Single-page dashboard with WebSocket for real-time updates.

- **useWebSocket.js** — auto-reconnecting WebSocket hook, parses JSON events
- **useToast.js** — notification system for upload/fail/reconcile events
- **recharts** — used for StorageBreakdown (pie chart) and UploadTimeline (area chart)
- Theme toggle (dark/light) persisted to localStorage

### Config

- **config.json** — sync settings (basePath, watchDirs, skipPatterns, debounceMs, concurrency), Azure settings (containerName, accessTier), server port, DB path
- **AZURE_CONNECTION_STRING** env var overrides `config.json` azure.connectionString (Docker secret friendly)

### Key Design Decisions

- **Change detection**: `(path, mtime, size)` tuple — no hashing (too slow for media files)
- **Blob naming**: mirrors local relative path (e.g., `library/<uuid>/2024/Aug/photo.jpg`)
- **Skip patterns**: `.DS_Store`, `.fuse_hidden*`, `.azDownload-*`, `thumbs/**`, `immich/**` (blobfuse artifacts from prior sync)
- **No resume**: failed uploads restart from beginning (simpler, files are media not multi-GB)
- **inotify over polling**: zero CPU when idle. `ignoreInitial: true` — reconciler handles existing files at startup
