import { config } from './config.js';
import { initDb, initStatements, logActivity } from './db.js';
import { initAzure, startUploader } from './uploader.js';
import { reconcile } from './reconciler.js';
import { startWatcher } from './watcher.js';
import { startServer } from './server.js';
import { initDiscord } from './discord.js';
import { log } from './logger.js';

async function main() {
  log.info('AzureSync starting');

  // Validate config
  if (!config.azure.connectionString) {
    log.error('AZURE_CONNECTION_STRING env var or azure.connectionString in config.json required');
    process.exit(1);
  }

  // Init
  initDb();
  initStatements();
  initAzure();
  initDiscord();
  logActivity('system', 'AzureSync daemon started');

  // Start HTTP + WebSocket server
  startServer();

  // Reconcile local ↔ Azure
  log.info('Running startup reconciliation...');
  const result = await reconcile();
  log.info('Reconciliation complete', result);

  // Start upload workers (drain pending queue)
  startUploader();

  // Start file watcher (inotify)
  startWatcher();

  log.info('AzureSync running — watching for new files');
}

// Graceful shutdown
process.on('SIGTERM', () => {
  log.info('SIGTERM received — shutting down');
  logActivity('system', 'AzureSync daemon stopped');
  process.exit(0);
});

process.on('SIGINT', () => {
  log.info('SIGINT received — shutting down');
  logActivity('system', 'AzureSync daemon stopped');
  process.exit(0);
});

main().catch((err) => {
  log.error('Fatal error', { error: err.message, stack: err.stack });
  process.exit(1);
});
