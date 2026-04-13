const LOG_LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const currentLevel = LOG_LEVELS[process.env.LOG_LEVEL || 'info'];

function fmt(level, msg, meta) {
  const ts = new Date().toISOString();
  const base = `[${ts}] [${level.toUpperCase()}] ${msg}`;
  return meta ? `${base} ${JSON.stringify(meta)}` : base;
}

export const log = {
  error: (msg, meta) => currentLevel >= 0 && console.error(fmt('error', msg, meta)),
  warn:  (msg, meta) => currentLevel >= 1 && console.warn(fmt('warn', msg, meta)),
  info:  (msg, meta) => currentLevel >= 2 && console.log(fmt('info', msg, meta)),
  debug: (msg, meta) => currentLevel >= 3 && console.log(fmt('debug', msg, meta)),
};
