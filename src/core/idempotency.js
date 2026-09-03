// core/idempotency.js — replay protection for POSTs that create money or send mail.
import { hashBody } from './ids.js';
import { conflict } from './errors.js';

/**
 * Returns { replay: true, response } when this exact request was already handled,
 * or { replay: false, reserve } when the caller should proceed and then record the result.
 * Same key + different body is a 409, never a silent second charge.
 */
export function checkIdempotency(db, { organizationId, key, endpoint, body }) {
  if (!key) return { replay: false, reserve: null };
  const fingerprint = hashBody(body);
  const existing = db.find(
    'idempotency_key',
    (r) => r.organization_id === organizationId && r.key === key && r.endpoint === endpoint,
  );
  if (existing) {
    if (existing.fingerprint !== fingerprint) {
      throw conflict('IDEMPOTENCY_KEY_REUSE', 'This Idempotency-Key was already used with a different request body.');
    }
    return { replay: true, response: existing.response };
  }
  return {
    replay: false,
    reserve: (response) => db.insert('idempotency_key', {
      id: `${organizationId}:${endpoint}:${key}`,
      organization_id: organizationId,
      key,
      endpoint,
      fingerprint,
      response,
      created_at: new Date().toISOString(),
    }),
  };
}
