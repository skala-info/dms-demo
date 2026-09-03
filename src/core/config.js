// core/config.js — 12-factor configuration. No config files are read at runtime.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');

function int(name, fallback) {
  const raw = process.env[name];
  return raw === undefined || raw === '' ? fallback : Number.parseInt(raw, 10);
}

export const config = {
  root,
  env: process.env.ENVIRONMENT || 'development',
  port: int('PORT', 3000),
  dataFile: process.env.DATA_FILE || path.join(root, 'data', 'db.json'),
  outboxDir: process.env.MAIL_OUTBOX_DIR || path.join(root, 'outbox'),

  // Email port selection: console | file | memory | failing
  emailProvider: process.env.EMAIL_PROVIDER || 'file',
  emailFrom: process.env.EMAIL_FROM || 'no-reply@dms.example.org',

  // Progress-notification policy (FR-NOT-*)
  milestones: (process.env.PROGRESS_MILESTONES || '25,50,75,100')
    .split(',').map((s) => Number.parseInt(s.trim(), 10)).filter(Number.isFinite),

  // Delivery
  maxSendAttempts: int('MAX_SEND_ATTEMPTS', 3),
  retryBackoffSeconds: [60, 300, 1800],

  // Idempotency-key retention (seconds)
  idempotencyTtl: int('IDEMPOTENCY_TTL', 24 * 3600),

  // Pagination
  defaultLimit: int('DEFAULT_LIMIT', 50),
  maxLimit: int('MAX_LIMIT', 200),

  logLevel: process.env.LOG_LEVEL || 'info',
};
