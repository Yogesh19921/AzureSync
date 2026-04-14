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

**Daemon** that watches immich media directories (`/media/usbdrive/immich`) via inotify and uploads new files to Azure Blob Storage (cold tier). Also provides a React dashboard for monitoring, configuration, and restoring files from Azure.

### Data flow

```
┌──────────────────────────────────────────────────────────────┐
│                        AzureSync                             │
│                                                              │
│  Watcher (chokidar/inotify)     Restorer (Azure → local)    │
│      ↓ file:queued                   ↓ marks DB "uploaded"   │
│  Upload Queue (N workers)            ↓ skips re-upload       │
│      ↓ file:uploaded/failed                                  │
│      ↓ verify (HEAD req)                                     │
│  ──────── events.js (EventEmitter bus) ──────────            │
│      ↓                                                       │
│  Express Server → WebSocket → React Dashboard                │
│      ↓                                                       │
│  Discord webhook (failures only)                             │
└──────────────────────────────────────────────────────────────┘
```

### Startup sequence (`src/index.js`)

1. Init SQLite (WAL mode) + prepare all statements
2. Init Azure Blob client (connection string)
3. Init Discord webhook listener (if configured)
4. Start Express HTTP + WebSocket server
5. Run reconciliation: list Azure blobs → walk local dirs → queue missing files
6. Start upload workers (drain pending queue)
7. Start chokidar file watcher (inotify, zero CPU when idle)

## Backend files (`src/`)

### `index.js` — Entry point
Orchestrates startup sequence above. Handles SIGTERM/SIGINT graceful shutdown. Validates Azure connection string exists before starting.

### `config.js` — Configuration loader
Reads `config.json` from disk. Allows `AZURE_CONNECTION_STRING` env var override. Config object is mutable (not frozen) — the config editor in the dashboard writes changes at runtime via `server.js`.

### `db.js` — SQLite database layer
WAL mode, synchronous=NORMAL for performance. All queries are prepared statements cached in a `stmts` object via `initStatements()`.

**Tables:**
- `files` — tracks every synced file: `(rel_path, size, mtime_ms, blob_name, status, uploaded_at, error)`. Status: `pending` → `uploading` → `uploaded` or `failed`
- `activity_log` — `(type, message, rel_path, created_at)`. Types: `upload`, `error`, `system`

**Key queries:**
- `getStats()` — counts + total size grouped by status
- `getFileListFiltered()` — paginated file list with status/search filters
- `getStorageBreakdown()` — groups by directory prefix (library/upload/encoded-video/backups)
- `getFileTypeBreakdown()` — groups by file type (images/videos/database/other) using GLOB patterns
- `getUploadTimeline()` — hourly upload counts for charts
- `getDigest()` — uploaded count, size, failures for a given time range
- `getLastSync()` — most recent uploaded file timestamp
- `getFailureTrend()` — failure counts for last hour, last day, total
- `getLargestFiles()` — top N files by size
- `markUploadedBulk()` — transactional batch insert, used by reconciler and restorer

### `watcher.js` — File watcher
Uses chokidar with native inotify (no polling). Watches dirs from `config.sync.watchDirs` under `config.sync.basePath`.

- `ignoreInitial: true` — existing files handled by reconciler, not watcher
- `awaitWriteFinish` + custom debounce timer — waits for file writes to stabilize before queueing
- `shouldSkip()` — matches against `config.sync.skipPatterns` (glob-like: `*.tmp`, `.fuse_hidden*`, `thumbs/**`)
- Before queueing, checks DB: if `status='uploaded'` with matching `(size, mtime)` → skips. This prevents re-upload of files downloaded by restorer.
- Emits `file:queued` on the event bus

### `uploader.js` — Azure upload workers
Concurrency-limited queue controlled by `config.sync.concurrency`.

- `uploadFile()` — streams file to Azure via `uploadStream()` with 4MB buffer, 4 parallel transfers per file. Sets `tier` from config (Cold). After upload, does `getProperties()` HEAD request to verify blob exists with matching size.
- Speed tracking — rolling window of last 20 uploads within 60s. Exposes `getUploadSpeed()` → `{ bytesPerSec, avgDuration, recentCount }`
- `pauseUploader()` / `resumeUploader()` — sets `running` flag. Queue processing stops/resumes.
- `triggerQueue()` — called by retry and reconcile endpoints to kick the queue
- Emits `file:uploading`, `file:uploaded`, `file:failed` events

### `reconciler.js` — Startup reconciliation
Runs at startup and on-demand via `POST /api/reconcile`.

1. Lists all Azure blobs for each `watchDir` prefix (skips `immich/` prefix — known blobfuse artifacts)
2. Walks local directories, applies skip patterns
3. For each local file: if blob exists in Azure with same size → bulk-mark as "uploaded" in DB (no re-upload)
4. If blob missing or size mismatch → upsert as "pending" in DB
5. Emits `reconcile:start`, `reconcile:done` events

### `restorer.js` — Azure → local restore
On-demand feature for downloading files from Azure that are missing locally.

- `scanMissing(options)` — lists Azure blobs for selected prefixes, compares with local disk. Options:
  - `prefixes` — which dirs to scan (default: `['upload']`)
  - `immichOnly` — cross-reference with Immich postgres DB (default: `true`). Queries `docker exec immich_postgres psql` for active asset paths. Falls back to full scan if DB unreachable.
- `downloadBlob()` — downloads blob, creates dir structure, writes to disk, then marks as "uploaded" in SQLite (prevents watcher re-upload loop)
- `restoreAll()` — concurrent download of all missing files. Progress tracked in memory (`restoreProgress`), broadcast via WebSocket.
- `restoreOne()` — download single file
- Scan results cached in memory (`scanResult`). Cleared after restore completes.

**Note:** Restore progress survives browser refresh (server-side state) but NOT server restart. Re-scan after restart; already-downloaded files will be skipped.

### `server.js` — Express + WebSocket server
Serves REST API, built frontend static files, and WebSocket for real-time events.

**REST endpoints:**
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/stats` | File counts by status, upload speed, last sync, failure trend |
| GET | `/api/files?status=X&search=Y&limit=N&offset=N` | Paginated file list with filter/search |
| GET | `/api/activity?limit=N` | Activity log entries |
| GET | `/api/recent?limit=N` | Recently uploaded files |
| GET | `/api/breakdown` | Storage breakdown by directory |
| GET | `/api/breakdown/types` | File type breakdown (images/videos/db/other) |
| GET | `/api/largest?limit=N` | Top N largest files |
| GET | `/api/digest?since=-1+days` | Upload/failure summary for period |
| GET | `/api/timeline?since=-7+days` | Hourly upload counts for chart |
| GET | `/api/health` | System health: uptime, memory, DB size, disk, Azure connectivity, workers |
| GET | `/api/cost` | Azure cost estimate (monthly/yearly based on synced size) |
| GET | `/api/failed` | All failed files |
| POST | `/api/retry` | Retry all failed uploads |
| POST | `/api/retry/:path` | Retry single file |
| POST | `/api/pause` | Pause upload workers |
| POST | `/api/resume` | Resume upload workers |
| POST | `/api/reconcile` | Trigger full reconciliation |
| GET | `/api/config` | Read config (connection string masked) |
| PUT | `/api/config` | Update config (concurrency, debounce, skip patterns, Discord, cost rate) |
| POST | `/api/restore/scan` | Scan Azure for missing files (body: `{prefixes, immichOnly}`) |
| GET | `/api/restore/status` | Restore scan results + download progress |
| GET | `/api/restore/files?limit=N&offset=N` | Paginated missing files list |
| POST | `/api/restore/all` | Download all missing files from Azure |
| POST | `/api/restore/file` | Download single file (body: `{blobName}`) |
| GET | `/api/export/activity` | CSV export of activity log |
| GET | `/api/export/files?status=X` | CSV export of file list |

**WebSocket events** (broadcast to all connected clients):
`file:queued`, `file:uploading`, `file:uploaded`, `file:failed`, `reconcile:start`, `reconcile:done`, `restore:scan-start`, `restore:scan-done`, `restore:start`, `restore:progress`, `restore:done`, `stats` (full stats refresh)

**Config editor** — `PUT /api/config` validates ranges, writes to `config.json`, mutates in-memory config object. Safe fields only: concurrency (1-10), debounceMs (500-30000), skipPatterns, Discord webhook, cost rate.

### `discord.js` — Discord failure notifications
Sends embed to Discord webhook on every `file:failed` event. Fields: file path + error message. Controlled by `config.discord.notifyOnFailure`. Webhook URL updatable at runtime via config editor.

### `events.js` — Central event bus
Shared `EventEmitter` instance. Decouples watcher → uploader → server → Discord. Max 50 listeners.

### `logger.js` — Structured logger
JSON-formatted log lines with timestamp. Levels: error/warn/info/debug. Set via `LOG_LEVEL` env var.

## Frontend files (`frontend/src/`)

React 19 + Vite. Single-page dashboard. Code-split: recharts in separate chunk (~117KB gzip).

### `App.jsx` — Main app shell
Wires all components. Manages state for stats, activity, files, events, pagination, filter, search, theme, pause. WebSocket `onMessage` handler dispatches to state + triggers toast notifications.

### `useWebSocket.js` — WebSocket hook
Auto-reconnects every 3s on disconnect. Uses `onMessageRef` to avoid stale closures. Returns `connected` boolean for status indicator.

### `useToast.js` — Toast notification system
Queue of `{id, message, type}`. Auto-dismiss after configurable duration. Types: success/error/info.

### `utils.js` — Shared utilities
`formatSize()`, `formatSpeed()`, `relativeTime()`, `fullTime()`, `formatDuration()`, `estimateTimeRemaining()`

### Components (`frontend/src/components/`)

| Component | Description |
|-----------|-------------|
| `ProgressBar` | Overall sync progress bar with speed, ETA, active uploads |
| `Stats` | 6 stat cards: total, uploaded, pending, uploading, failed, total synced size |
| `LastSync` | "Last upload: 2m ago" in header |
| `FailureBanner` | Red warning banner when failures spike in last hour |
| `Digest` | Today/week/month toggle: files uploaded, data synced, failures |
| `CostEstimate` | Azure cold storage monthly + yearly cost estimate |
| `StorageBreakdown` | Donut chart by directory (library/upload/video/backups) with size + count in legend |
| `FileTypeBreakdown` | Donut chart by type (images/videos/DB/other) |
| `UploadTimeline` | Area chart of uploads over time (24h/7d/30d toggle) |
| `LargestFiles` | Top 10 files by size with bar visualization |
| `LiveEvents` | Real-time WebSocket event stream |
| `ActivityLog` | Historical activity log with CSV export |
| `FileList` | Paginated file table: search, status filter, expandable error details, retry per file |
| `RestorePanel` | Azure → local restore: prefix checkboxes, Immich DB cross-ref toggle, scan button, progress bar, paginated missing files, download all/individual |
| `SystemHealth` | Uptime, memory, DB size, Azure connectivity, disk status, workers, speed, force reconcile button |
| `ConfigEditor` | Live-edit: concurrency, debounce, skip patterns, Discord webhook URL, notify toggle, cost rate |
| `ThemeToggle` | Dark/light theme switch (localStorage persisted) |
| `Toasts` | Toast notification overlay |

## Config (`config.json`)

```jsonc
{
  "azure": {
    "connectionString": "",        // or use AZURE_CONNECTION_STRING env var
    "containerName": "immich",
    "accessTier": "Cold",
    "costPerGBPerMonth": 0.0036
  },
  "sync": {
    "basePath": "/media/usbdrive/immich",
    "watchDirs": ["library", "upload", "encoded-video", "backups"],
    "skipPatterns": [".DS_Store", ".fuse_hidden*", ".azDownload-*", ".immich", "*.tmp", "thumbs/**", "profile/**", "immich/**"],
    "debounceMs": 2000,
    "concurrency": 3               // parallel upload/download workers
  },
  "discord": {
    "webhookUrl": "",
    "notifyOnFailure": true
  },
  "server": { "port": 3420 },
  "db": { "path": "./data/sync.db" }
}
```

## Docker

**Dockerfile** — multi-stage: builds React frontend in stage 1, installs Node deps (with python/g++ for better-sqlite3 native addon + docker-cli for Immich DB queries) in stage 2, copies built frontend.

**docker-compose.yml volumes:**
- `./config.json:/app/config.json` — writable (config editor needs write access)
- `./data:/app/data` — SQLite DB persistence
- `/media/usbdrive/immich:/media/usbdrive/immich` — writable (restorer needs write access)
- `/var/run/docker.sock:/var/run/docker.sock` — for `docker exec immich_postgres` queries

**Environment:**
- `AZURE_CONNECTION_STRING` — required, overrides config.json
- `LOG_LEVEL` — optional (default: info)
- `DISCORD_WEBHOOK_URL` — optional, overrides config.json
- `CONFIG_PATH` — optional, path to config.json

## Key Design Decisions

- **Change detection**: `(path, mtime, size)` tuple — no hashing (too slow for media files)
- **Blob naming**: mirrors local relative path (e.g., `library/<uuid>/2024/Aug/photo.jpg`)
- **Skip patterns**: `.DS_Store`, `.fuse_hidden*`, `.azDownload-*`, `thumbs/**`, `immich/**` (blobfuse artifacts from prior sync tool)
- **`immich/` prefix in Azure**: ~253 GB of duplicate blobfuse artifacts. Explicitly skipped in reconciler + restorer. All real data exists in top-level prefixes. Confirmed zero unique real files.
- **Upload verification**: HEAD request after each upload confirms blob exists with matching size before marking "uploaded"
- **Restore loop prevention**: downloaded files immediately marked "uploaded" in DB → watcher sees matching record → skips re-upload
- **inotify over polling**: zero CPU when idle. `ignoreInitial: true` — reconciler handles existing files
- **No resume**: failed uploads restart from beginning (simpler for media files)
- **Config mutation**: `PUT /api/config` writes to disk + mutates in-memory object. Safe fields validated with ranges. Connection string never exposed via API.
- **Immich DB cross-reference**: restorer can query `immich_postgres` to only download files Immich actively references, reducing ~13K to ~9.8K files needed
