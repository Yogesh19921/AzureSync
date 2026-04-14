import { config } from './config.js';
import { bus } from './events.js';
import { log } from './logger.js';

let webhookUrl = '';

// Rate limiting: max 1 message per 10 seconds, batch failures
let pendingFailures = [];
let flushTimer = null;
const FLUSH_INTERVAL = 10000;

export function initDiscord() {
  webhookUrl = process.env.DISCORD_WEBHOOK_URL || config.discord?.webhookUrl || '';
  if (!webhookUrl) {
    log.info('Discord notifications disabled (no webhook URL)');
    return;
  }

  log.info('Discord failure notifications enabled');

  bus.on('file:failed', ({ relPath, error, permanent }) => {
    if (!config.discord?.notifyOnFailure) return;
    pendingFailures.push({ relPath, error, permanent });

    // Flush on timer to batch multiple failures into one message
    if (!flushTimer) {
      flushTimer = setTimeout(flushFailures, FLUSH_INTERVAL);
    }
  });
}

async function flushFailures() {
  flushTimer = null;
  if (pendingFailures.length === 0) return;

  const batch = pendingFailures.splice(0);
  const permCount = batch.filter(f => f.permanent).length;
  const retryCount = batch.length - permCount;

  const fileList = batch.slice(0, 10).map(f => {
    const name = f.relPath.split('/').pop();
    const prefix = f.permanent ? '[PERM]' : '[RETRY]';
    return `${prefix} \`${name}\`: ${f.error || 'Unknown'}`;
  }).join('\n');

  const extra = batch.length > 10 ? `\n...and ${batch.length - 10} more` : '';

  await send({
    embeds: [{
      title: `AzureSync: ${batch.length} Upload Failure${batch.length > 1 ? 's' : ''}`,
      color: 0xef4444,
      description: `${fileList}${extra}`,
      fields: [
        ...(retryCount > 0 ? [{ name: 'Retryable', value: `${retryCount}`, inline: true }] : []),
        ...(permCount > 0 ? [{ name: 'Permanent (file missing)', value: `${permCount}`, inline: true }] : []),
      ],
      timestamp: new Date().toISOString(),
      footer: { text: 'AzureSync' },
    }],
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
    if (res.status === 429) {
      const retry = parseInt(res.headers.get('retry-after') || '30');
      log.warn('Discord rate limited, backing off', { retryAfter: retry });
      // Re-schedule flush
      if (!flushTimer) flushTimer = setTimeout(flushFailures, retry * 1000);
    } else if (!res.ok) {
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
