import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const configPath = process.env.CONFIG_PATH || resolve(__dirname, '..', 'config.json');

const raw = JSON.parse(readFileSync(configPath, 'utf-8'));

// Allow env override for connection string (Docker secret friendly)
if (process.env.AZURE_CONNECTION_STRING) {
  raw.azure.connectionString = process.env.AZURE_CONNECTION_STRING;
}

export const config = Object.freeze(raw);
