// repositories/ — every read and write goes through here.
//
// Rule X-I1: every row carries `organization_id` and no query may cross tenants. That is
// enforced in this file and nowhere else, so it cannot be forgotten in a service.
import { db } from '../db/store.js';
import { countsTowardsSummary } from '../domain/summary.js';

const scoped = (name, orgId, pred = () => true) =>
  db.filter(name, (r) => r.organization_id === orgId && pred(r));

const scopedGet = (name, orgId, id) => {
  const row = db.get(name, id);
  return row && row.organization_id === orgId ? row : null;
};

export const orgs = {
  get: (id) => db.get('organization', id),
  byApiKey: (key) => db.find('organization', (o) => o.api_key === key),
  /** Allocate the next receipt number. In Postgres this is SELECT ... FOR UPDATE. */
  nextReceiptSequence(orgId) {
    const org = db.get('organization', orgId);
    const seq = org.receipt_next_number;
    org.receipt_next_number = seq + 1;
    return seq;
  },
  nextDonorNumber(orgId) {
    const org = db.get('organization', orgId);
    const n = org.donor_next_number;
    org.donor_next_number = n + 1;
    return n;
  },
};

export const funds = {
  insert: (row) => db.insert('fund', row),
  get: (orgId, id) => scopedGet('fund', orgId, id),
  byCode: (orgId, code) => db.find('fund', (f) => f.organization_id === orgId && f.code === code),
  list: (orgId) => scoped('fund', orgId),
};

export const campaigns = {
  insert: (row) => db.insert('campaign', row),
  get: (orgId, id) => scopedGet('campaign', orgId, id),
  byCode: (orgId, code) => db.find('campaign', (c) => c.organization_id === orgId && c.code === code),
  list: (orgId, pred) => scoped('campaign', orgId, pred),
  update: (orgId, id, patch) => (scopedGet('campaign', orgId, id) ? db.update('campaign', id, patch) : null),
};

export const donors = {
  insert: (row) => db.insert('donor', row),
  get: (orgId, id) => scopedGet('donor', orgId, id),
  byEmail: (orgId, email) =>
    db.find('donor', (d) => d.organization_id === orgId && d.email && d.email.toLowerCase() === String(email).toLowerCase()),
  list: (orgId, pred) => scoped('donor', orgId, pred),
  update: (orgId, id, patch) => (scopedGet('donor', orgId, id) ? db.update('donor', id, patch) : null),
};

export const donations = {
  insert: (row) => db.insert('donation', row),
  get: (orgId, id) => scopedGet('donation', orgId, id),
  list: (orgId, pred) => scoped('donation', orgId, pred),
  forDonor: (orgId, donorId) => scoped('donation', orgId, (d) => d.donor_id === donorId),
  update: (orgId, id, patch) => (scopedGet('donation', orgId, id) ? db.update('donation', id, patch) : null),
};

export const allocations = {
  insertMany: (rows) => rows.map((r) => db.insert('allocation', r)),
  forDonation: (orgId, donationId) => scoped('allocation', orgId, (a) => a.donation_id === donationId),
  /** Allocations that count towards campaign progress: POSTED and not excluded. */
  countingForCampaign(orgId, campaignId) {
    const eligible = new Set(
      scoped('donation', orgId, (d) => countsTowardsSummary(d)).map((d) => d.id),
    );
    return scoped('allocation', orgId, (a) => a.campaign_id === campaignId && eligible.has(a.donation_id));
  },
};

export const summaries = {
  get: (orgId, donorId) => db.find('giving_summary', (s) => s.organization_id === orgId && s.donor_id === donorId),
  upsert(orgId, summary) {
    const existing = summaries.get(orgId, summary.donor_id);
    if (existing) return Object.assign(existing, summary, { updated_at: new Date().toISOString() });
    return db.insert('giving_summary', { id: `${orgId}:${summary.donor_id}`, organization_id: orgId, ...summary, updated_at: new Date().toISOString() });
  },
};

export const receipts = {
  insert: (row) => db.insert('receipt', row),
  get: (orgId, id) => scopedGet('receipt', orgId, id),
  activeForDonation: (orgId, donationId) =>
    db.find('receipt', (r) => r.organization_id === orgId && r.donation_id === donationId && r.status === 'ISSUED'),
  list: (orgId, pred) => scoped('receipt', orgId, pred),
  update: (orgId, id, patch) => (scopedGet('receipt', orgId, id) ? db.update('receipt', id, patch) : null),
};

export const communications = {
  insert: (row) => db.insert('communication', row),
  get: (orgId, id) => scopedGet('communication', orgId, id),
  list: (orgId, pred) => scoped('communication', orgId, pred),
  update: (orgId, id, patch) => (scopedGet('communication', orgId, id) ? db.update('communication', id, patch) : null),
  /** Has this exact stewardship message already gone to this donor? Dedupe key, not a filter. */
  byDedupeKey: (orgId, dedupeKey) =>
    db.find('communication', (c) => c.organization_id === orgId && c.dedupe_key === dedupeKey),
  dueForSend: (now = new Date()) =>
    db.filter('communication', (c) => c.status === 'QUEUED' && (!c.next_attempt_at || c.next_attempt_at <= now.toISOString())),
};

export const outbox = {
  unpublished: () => db.filter('outbox_event', (e) => e.published_at === null),
  markPublished: (id) => db.update('outbox_event', id, { published_at: new Date().toISOString() }),
  list: (orgId) => scoped('outbox_event', orgId),
};

export const audit = {
  insert: (row) => db.insert('audit_entry', row),
  list: (orgId, pred) => scoped('audit_entry', orgId, pred),
};

export const jobRuns = {
  insert: (row) => db.insert('job_run', row),
  list: (orgId) => scoped('job_run', orgId),
};
