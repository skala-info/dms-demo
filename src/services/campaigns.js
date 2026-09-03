// services/campaigns.js — campaign use cases and the single definition of "progress".
import { db } from '../db/store.js';
import { campaigns as campaignRepo, funds as fundRepo, allocations as allocRepo, donors as donorRepo } from '../repositories/index.js';
import { computeProgress } from '../domain/campaign.js';
import { parseMoney } from '../core/money.js';
import { uuid } from '../core/ids.js';
import { validation, notFound, conflict } from '../core/errors.js';
import { writeAudit } from '../core/audit.js';
import { publish } from '../core/events.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function createFund(orgId, payload, actor = 'system') {
  const errors = [];
  if (!payload.code) errors.push({ field: 'code', code: 'REQUIRED', message: 'A fund code is required.' });
  if (!payload.name) errors.push({ field: 'name', code: 'REQUIRED', message: 'A fund name is required.' });
  if (errors.length) throw validation(errors);

  return db.tx(() => {
    if (fundRepo.byCode(orgId, payload.code)) {
      throw conflict('DUPLICATE_RESOURCE', `A fund with code ${payload.code} already exists.`);
    }
    const now = new Date().toISOString();
    const fund = fundRepo.insert({
      id: uuid(),
      organization_id: orgId,
      code: payload.code,
      name: payload.name,
      restriction: payload.restriction || 'UNRESTRICTED',
      is_active: true,
      created_at: now,
      updated_at: now,
    });
    writeAudit(db, { organizationId: orgId, actor, entityType: 'fund', entityId: fund.id, operation: 'CREATE', before: null, after: fund });
    return fund;
  });
}

export function createCampaign(orgId, payload, actor = 'system') {
  const errors = [];
  if (!payload.code) errors.push({ field: 'code', code: 'REQUIRED', message: 'A campaign code is required.' });
  if (!payload.name) errors.push({ field: 'name', code: 'REQUIRED', message: 'A campaign name is required.' });
  const currency = payload.currency || 'USD';
  for (const f of ['start_date', 'end_date']) {
    if (payload[f] && !DATE_RE.test(payload[f])) {
      errors.push({ field: f, code: 'INVALID_DATE', message: 'Dates use YYYY-MM-DD.' });
    }
  }
  if (payload.start_date && payload.end_date && payload.end_date < payload.start_date) {
    errors.push({ field: 'end_date', code: 'END_BEFORE_START', message: 'end_date must not precede start_date.' });
  }
  if (errors.length) throw validation(errors);

  const goalMinor = payload.goal === undefined || payload.goal === null
    ? 0
    : parseMoney(payload.goal, currency, 'goal');
  if (goalMinor < 0) throw validation([{ field: 'goal', code: 'GOAL_NEGATIVE', message: 'A goal cannot be negative.' }]);

  return db.tx(() => {
    if (campaignRepo.byCode(orgId, payload.code)) {
      throw conflict('DUPLICATE_RESOURCE', `A campaign with code ${payload.code} already exists.`);
    }
    const now = new Date().toISOString();
    const campaign = campaignRepo.insert({
      id: uuid(),
      organization_id: orgId,
      code: payload.code,
      name: payload.name,
      description: payload.description || null,
      currency,
      goal_minor: goalMinor,
      start_date: payload.start_date || null,
      end_date: payload.end_date || null,
      status: 'ACTIVE',
      closed_at: null,
      milestones_reached: [],       // durable high-water marks; never cleared by a reversal
      goal_reached_at: null,
      last_digest_at: null,
      last_digest_raised_minor: 0,
      created_at: now,
      updated_at: now,
    });
    writeAudit(db, { organizationId: orgId, actor, entityType: 'campaign', entityId: campaign.id, operation: 'CREATE', before: null, after: campaign });
    return campaign;
  });
}

/** The one and only definition of campaign progress. */
export function getProgress(orgId, campaignId, opts = {}) {
  const campaign = campaignRepo.get(orgId, campaignId);
  if (!campaign) throw notFound('Campaign');
  return computeProgress(campaign, allocRepo.countingForCampaign(orgId, campaignId), opts);
}

/** Distinct donors who have a counting allocation on this campaign, with their totals. */
export function campaignDonors(orgId, campaignId) {
  const allocs = allocRepo.countingForCampaign(orgId, campaignId);
  const byDonor = new Map();
  for (const a of allocs) {
    const entry = byDonor.get(a.donor_id) || { donor_id: a.donor_id, total_minor: 0, donation_ids: new Set() };
    entry.total_minor += a.amount_minor;
    entry.donation_ids.add(a.donation_id);
    byDonor.set(a.donor_id, entry);
  }
  return [...byDonor.values()].map((e) => ({
    donor: donorRepo.get(orgId, e.donor_id),
    total_minor: e.total_minor,
    donation_count: e.donation_ids.size,
  })).filter((e) => e.donor);
}

/** Close a campaign. Emits campaign.closed, which fans out a final update to its donors. */
export function closeCampaign(orgId, campaignId, { actor = 'system', reason = null } = {}) {
  return db.tx(() => {
    const campaign = campaignRepo.get(orgId, campaignId);
    if (!campaign) throw notFound('Campaign');
    if (campaign.status === 'CLOSED') {
      throw conflict('INVALID_STATE_TRANSITION', 'This campaign is already closed.');
    }
    const before = structuredClone(campaign);
    const progress = getProgress(orgId, campaignId);
    campaignRepo.update(orgId, campaignId, {
      status: 'CLOSED',
      closed_at: new Date().toISOString(),
      close_reason: reason,
    });
    const after = campaignRepo.get(orgId, campaignId);
    writeAudit(db, { organizationId: orgId, actor, entityType: 'campaign', entityId: campaignId, operation: 'CLOSE', before, after });
    publish(db, {
      organizationId: orgId,
      type: 'campaign.closed',
      actor,
      data: { campaign_id: campaignId, progress },
    });
    return after;
  });
}

/** Ask for a progress update to go out to every donor on this campaign. */
export function requestUpdate(orgId, campaignId, { actor = 'system', trigger = 'MANUAL' } = {}) {
  return db.tx(() => {
    const campaign = campaignRepo.get(orgId, campaignId);
    if (!campaign) throw notFound('Campaign');
    const progress = getProgress(orgId, campaignId);
    const event = publish(db, {
      organizationId: orgId,
      type: 'campaign.update_requested',
      actor,
      data: {
        campaign_id: campaignId,
        trigger,
        progress,
        since_last_minor: Math.max(0, progress.raised_minor - (campaign.last_digest_raised_minor || 0)),
        // A digest is a point-in-time snapshot: the dedupe key makes re-running the job
        // on the same day a no-op rather than a second mail to every donor.
        dedupe_scope: `digest:${campaignId}:${new Date().toISOString().slice(0, 10)}`,
      },
    });
    campaignRepo.update(orgId, campaignId, {
      last_digest_at: new Date().toISOString(),
      last_digest_raised_minor: progress.raised_minor,
    });
    return { event_id: event.id, progress };
  });
}
