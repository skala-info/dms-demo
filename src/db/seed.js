// db/seed.js — the provisioning service.
//
// A new organization is created here, in one transaction, with its numbering counters and
// defaults. Provisioning is application code, never a data migration.
import { db } from './store.js';
import { uuid } from '../core/ids.js';
import { config } from '../core/config.js';

export const DEFAULT_RECEIPT_STATEMENT =
  'No goods or services were provided in exchange for this contribution except as noted above.';

export function provisionOrganization(payload = {}) {
  return db.tx(() => {
    const now = new Date().toISOString();
    return db.insert('organization', {
      id: payload.id || uuid(),
      name: payload.name || 'Riverbank Community Trust',
      legal_name: payload.legal_name || payload.name || 'Riverbank Community Trust',
      tax_id: payload.tax_id || '81-0000000',
      address: payload.address || '14 Mill Lane, Riverbank, CA 95367',
      email: payload.email || 'hello@riverbank.example.org',
      email_from: payload.email_from || config.emailFrom,
      portal_base_url: payload.portal_base_url || 'https://give.riverbank.example.org',
      default_currency: payload.default_currency || 'USD',
      api_key: payload.api_key || 'demo-key',

      // Receipt numbering: {prefix}{year}{sequence:0Nd}
      receipt_prefix: payload.receipt_prefix ?? 'R',
      receipt_number_width: payload.receipt_number_width ?? 6,
      receipt_number_includes_year: payload.receipt_number_includes_year ?? true,
      receipt_next_number: 1,
      receipt_statement: payload.receipt_statement || DEFAULT_RECEIPT_STATEMENT,

      donor_next_number: 1,
      created_at: now,
      updated_at: now,
    });
  });
}

/** Wipe and provision a single organization. Used by `npm run demo` and the tests. */
export function resetAndProvision(payload = {}, { persist = false } = {}) {
  db.reset({ persist });
  return provisionOrganization(payload);
}
