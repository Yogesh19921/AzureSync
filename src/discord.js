import { config } from './config.js';
import { bus } from './events.js';
import { log } from './logger.js';

let webhookUrl = '';

export function initDiscord() {
  webhookUrl = process.env.DISCORD_WEBHOOK_URL || config.discord?.webhookUrl || '';
  if (!webhookUrl) {
    log.info('Discord notifications disabled (no webhook URL)');
    return;
  }

  log.info('Discord failure notifications enabled');

  bus.on('file:failed', async ({ relPath, error }) => {
    if (!config.discord?.notifyOnFailure) return;
    await send({
      embeds: [{
        title: 'AzureSync Upload Failed',
        color: 0xef4444,
        fields: [
          { name: 'File', value: `\`${relPath}\``, inline: false },
          { name: 'Error', value: error || 'Unknown error', inline: false },
        ],
        timestamp: new Date().toISOString(),
        footer: { text: 'AzureSync' },
      }],
    });
  });
}

async function send(payload) {
  const url = webhookUrl || config.discord?.webhookUrl;
  if (!url) return;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      log.warn('Discord webhook failed', { status: res.status });
    }
  } catch (err) {
    log.warn('Discord webhook error', { error: err.message });
  }
}

export function updateWebhookUrl(url) {
  webhookUrl = url;
}

export function getWebhookUrl() {
  return webhookUrl;
}
