// core/logging.js — structured JSON logs. Never log PII values; log field *names*.
import { config } from './config.js';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 };
const threshold = () => LEVELS[process.env.LOG_LEVEL || config.logLevel] ?? LEVELS.info;

function emit(level, msg, fields = {}) {
  if (LEVELS[level] < threshold()) return;
  process.stdout.write(JSON.stringify({ ts: new Date().toISOString(), level, msg, ...fields }) + '\n');
}

export const log = {
  debug: (m, f) => emit('debug', m, f),
  info: (m, f) => emit('info', m, f),
  warn: (m, f) => emit('warn', m, f),
  error: (m, f) => emit('error', m, f),
};
