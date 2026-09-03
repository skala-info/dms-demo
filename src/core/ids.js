// core/ids.js — UUIDv4 ids, sortable request ids, opaque cursors.
import { randomUUID, randomBytes, createHmac } from 'node:crypto';

export const uuid = () => randomUUID();

/** Lexicographically sortable request/event id (ULID-ish, good enough for a demo). */
export function ulid(date = new Date()) {
  const t = date.getTime().toString(16).padStart(12, '0').toUpperCase();
  return `01${t}${randomBytes(8).toString('hex').toUpperCase()}`;
}

export const encodeCursor = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
export function decodeCursor(cursor) {
  try { return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')); }
  catch { return null; }
}

export const hashBody = (body) =>
  createHmac('sha256', 'idempotency').update(typeof body === 'string' ? body : JSON.stringify(body ?? '')).digest('hex');
