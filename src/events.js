import { EventEmitter } from 'events';

// Central event bus for decoupling watcher → uploader → server
export const bus = new EventEmitter();
bus.setMaxListeners(50);

// Event types:
// 'file:queued'    - new file queued for upload { relPath, size }
// 'file:uploading' - upload started { relPath }
// 'file:uploaded'  - upload complete { relPath, size, duration }
// 'file:failed'    - upload failed { relPath, error }
// 'reconcile:start' - reconciliation started
// 'reconcile:done'  - reconciliation complete { queued, skipped, duration }
// 'stats:update'    - stats changed (trigger dashboard refresh)
