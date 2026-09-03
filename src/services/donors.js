// services/donors.js — donor registration and preferences.
import { db } from '../db/store.js';
import { donors as donorRepo, orgs, summaries, campaigns as campaignRepo } from '../repositories/index.js';
import { buildDisplayName, buildSortName, buildSalutation, normalisePhone, EMAIL_RE, DONOR_TYPES } from '../domain/donor.js';
import { computeSummary } from '../domain/summary.js';
import { uuid } from '../core/ids.js';
import { validation, notFound, conflict } from '../core/errors.js';
import { writeAudit } from '../core/audit.js';
import { publish } from '../core/events.js';

const BOOL_PREFS = ['no_email', 'no_solicitation', 'progress_updates_opt_in'];

function validateRegistration(payload) {
  const errors = [];
  const type = payload.type || 'INDIVIDUAL';
  if (!DONOR_TYPES.includes(type)) {
    errors.push({ field: 'type', code: 'INVALID_ENUM', message: `type must be one of ${DONOR_TYPES.join(', ')}.` });
  }
  if (type === 'INDIVIDUAL' && !payload.last_name) {
    errors.push({ field: 'last_name', code: 'REQUIRED', message: 'An individual needs a last name.' });
  }
  if (type === 'ORGANIZATION' && !payload.organization_name) {
    errors.push({ field: 'organization_name', code: 'REQUIRED', message: 'An organization needs an organization name.' });
  }
  // Email is not strictly required to hold a record, but without one the donor can never
  // be kept informed — so the API says so out loud instead of silently never mailing them.
  if (payload.email && !EMAIL_RE.test(payload.email)) {
    errors.push({ field: 'email', code: 'INVALID_EMAIL', message: 'That does not look like an email address.' });
  }
  for (const key of BOOL_PREFS) {
    if (payload[key] !== undefined && typeof payload[key] !== 'boolean') {
      errors.push({ field: key, code: 'INVALID_TYPE', message: `${key} must be a boolean.` });
    }
  }
  // Validate the whole payload before touching the database, and return ALL errors.
  if (errors.length) throw validation(errors);
  return type;
}

/**
 * Register a donor.
 * Returns { donor, duplicate_candidates } — a same-email match is a 409 unless the
 * caller passes allow_duplicate, because silent duplicate creation is the #1 way these
 * databases rot.
 */
export function registerDonor(orgId, payload, { actor = 'system', allowDuplicate = false, welcomeCampaignId = null } = {}) {
  const type = validateRegistration(payload);

  return db.tx(() => {
    if (payload.email) {
      const existing = donorRepo.byEmail(orgId, payload.email);
      if (existing && !allowDuplicate) {
        throw conflict('DUPLICATE_SUSPECTED', 'A donor with this email address already exists.', {
          duplicate_candidates: [{ id: existing.id, display_name: existing.display_name, email: existing.email }],
        });
      }
    }

    const now = new Date().toISOString();
    const base = {
      type,
      prefix: payload.prefix || null,
      first_name: payload.first_name || null,
      middle_name: payload.middle_name || null,
      last_name: payload.last_name || null,
      nickname: payload.nickname || null,
      organization_name: payload.organization_name || null,
    };
    const display_name = buildDisplayName(base);

    const donor = donorRepo.insert({
      id: uuid(),
      organization_id: orgId,
      number: orgs.nextDonorNumber(orgId),
      ...base,
      display_name,
      sort_name: buildSortName(display_name),
      salutation: buildSalutation(base),
      email: payload.email ? String(payload.email).trim() : null,
      email_bounced: false,
      phone: normalisePhone(payload.phone),
      phone_entered: payload.phone || null,
      address: payload.address || null,
      // Contact preferences. Progress updates default to opt-in; that default is a
      // tenant policy decision recorded in docs/demo1/10-module-notifications.md §3.
      no_email: payload.no_email ?? false,
      no_solicitation: payload.no_solicitation ?? false,
      progress_updates_opt_in: payload.progress_updates_opt_in ?? true,
      preferred_language: payload.preferred_language || 'en',
      status: 'ACTIVE',
      source: payload.source || 'API',
      created_at: now,
      updated_at: now,
      version: 1,
    });

    summaries.upsert(orgId, computeSummary(donor.id, []));
    writeAudit(db, { organizationId: orgId, actor, entityType: 'donor', entityId: donor.id, operation: 'CREATE', before: null, after: donor });

    // The welcome mail can carry the progress of a campaign so the donor sees the cause
    // they are being invited into, not just a "thanks for signing up".
    const campaign = welcomeCampaignId ? campaignRepo.get(orgId, welcomeCampaignId) : null;
    publish(db, {
      organizationId: orgId,
      type: 'donor.registered',
      actor,
      data: { donor_id: donor.id, campaign_id: campaign ? campaign.id : null },
    });

    return donor;
  });
}

export function getDonor(orgId, id) {
  const donor = donorRepo.get(orgId, id);
  if (!donor) throw notFound('Donor');
  return donor;
}

const MUTABLE = ['prefix', 'first_name', 'middle_name', 'last_name', 'nickname', 'organization_name',
  'email', 'phone', 'address', 'no_email', 'no_solicitation', 'progress_updates_opt_in',
  'preferred_language', 'status', 'email_bounced'];

/** PATCH with merge-patch semantics: an explicit null clears, an absent key is untouched. */
export function updateDonor(orgId, id, patch, { actor = 'system', expectedVersion = null } = {}) {
  return db.tx(() => {
    const donor = donorRepo.get(orgId, id);
    if (!donor) throw notFound('Donor');
    if (expectedVersion !== null && Number(expectedVersion) !== donor.version) {
      throw conflict('VERSION_MISMATCH', `The donor has changed since you read it (current version ${donor.version}).`, { current_version: donor.version });
    }

    const unknown = Object.keys(patch).filter((k) => !MUTABLE.includes(k));
    if (unknown.length) {
      throw validation(unknown.map((k) => ({ field: k, code: 'UNKNOWN_FIELD', message: `${k} cannot be set here.` })));
    }
    if (patch.email && !EMAIL_RE.test(patch.email)) {
      throw validation([{ field: 'email', code: 'INVALID_EMAIL', message: 'That does not look like an email address.' }]);
    }

    const before = structuredClone(donor);
    const next = { ...patch };
    if (next.phone !== undefined) {
      next.phone_entered = next.phone;
      next.phone = normalisePhone(next.phone);
    }
    Object.assign(donor, next);

    donor.display_name = buildDisplayName(donor);
    donor.sort_name = buildSortName(donor.display_name);
    donor.version += 1;
    donor.updated_at = new Date().toISOString();

    writeAudit(db, { organizationId: orgId, actor, entityType: 'donor', entityId: id, operation: 'UPDATE', before, after: donor });
    publish(db, { organizationId: orgId, type: 'donor.updated', actor, data: { donor_id: id, fields: Object.keys(patch) } });
    return donor;
  });
}

export function getSummary(orgId, donorId) {
  getDonor(orgId, donorId);
  return summaries.get(orgId, donorId) || computeSummary(donorId, []);
}

export function listDonors(orgId, { q } = {}) {
  const needle = q ? String(q).toLowerCase() : null;
  return donorRepo.list(orgId, (d) => {
    if (d.status === 'DELETED') return false;
    if (!needle) return true;
    return d.sort_name.includes(needle)
      || (d.email || '').toLowerCase().includes(needle)
      || String(d.number) === needle;
  }).sort((a, b) => a.sort_name.localeCompare(b.sort_name));
}
