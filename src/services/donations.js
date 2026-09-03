// services/donations.js — recording a donation, and the campaign-progress bookkeeping
// that hangs off it. This is the module the product lives or dies on: every rule below
// is enforced here in the service/domain layer, never in the API schema or a UI.
import { db } from '../db/store.js';
import {
  donors as donorRepo, campaigns as campaignRepo, funds as fundRepo,
  donations as donationRepo, allocations as allocRepo, summaries, receipts as receiptRepo,
} from '../repositories/index.js';
import { buildAllocations } from '../domain/allocation.js';
import { newlyCrossedMilestones } from '../domain/campaign.js';
import { computeSummary } from '../domain/summary.js';
import { parseMoney } from '../core/money.js';
import { config } from '../core/config.js';
import { uuid } from '../core/ids.js';
import { validation, notFound, conflict, businessRule } from '../core/errors.js';
import { writeAudit } from '../core/audit.js';
import { publish } from '../core/events.js';
import { getProgress } from './campaigns.js';
import { issueForDonation, voidReceipt } from './receipts.js';

export const METHODS = ['CASH', 'CHECK', 'CREDIT_CARD', 'BANK_TRANSFER', 'IN_KIND', 'OTHER'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const today = () => new Date().toISOString().slice(0, 10);

function validateHeader(payload) {
  const errors = [];
  if (!payload.donor_id) errors.push({ field: 'donor_id', code: 'REQUIRED', message: 'A donor is required.' });
  if (payload.amount === undefined || payload.amount === null) {
    errors.push({ field: 'amount', code: 'REQUIRED', message: 'An amount is required.' });
  }
  const date = payload.donation_date || today();
  if (!DATE_RE.test(date)) errors.push({ field: 'donation_date', code: 'INVALID_DATE', message: 'Dates use YYYY-MM-DD.' });
  if (date > today()) errors.push({ field: 'donation_date', code: 'DATE_IN_FUTURE', message: 'A donation cannot be dated in the future.' });
  const method = payload.method || 'OTHER';
  if (!METHODS.includes(method)) {
    errors.push({ field: 'method', code: 'INVALID_ENUM', message: `method must be one of ${METHODS.join(', ')}.` });
  }
  if (errors.length) throw validation(errors);
  return { date, method };
}

/**
 * Record a donation. Posts immediately (demo1 has no batch/draft stage), issues a
 * receipt, refreshes the donor's giving summary, recomputes campaign progress and emits
 * the events that drive every donor email.
 */
export function recordDonation(orgId, payload, { actor = 'system', allowDuplicate = false } = {}) {
  const { date, method } = validateHeader(payload);
  const currency = payload.currency || 'USD';
  const amountMinor = parseMoney(payload.amount, currency, 'amount');
  if (amountMinor <= 0) {
    throw validation([{ field: 'amount', code: 'AMOUNT_NOT_POSITIVE', message: 'A donation amount must be greater than zero.' }]);
  }
  const fmvMinor = payload.fair_market_value ? parseMoney(payload.fair_market_value, currency, 'fair_market_value') : 0;
  const deductibleMinor = amountMinor - fmvMinor;
  if (deductibleMinor < 0) {
    throw businessRule('DEDUCTIBLE_NEGATIVE', 'The value of goods received cannot exceed the donation amount.');
  }

  return db.tx(() => {
    const donor = donorRepo.get(orgId, payload.donor_id);
    if (!donor) throw notFound('Donor');
    if (donor.status === 'DELETED') throw conflict('INVALID_STATE_TRANSITION', 'This donor record has been deleted.');

    // Same donor, same amount, same date → almost always a double entry.
    if (!allowDuplicate) {
      const candidates = donationRepo.list(orgId, (d) =>
        d.donor_id === donor.id && d.amount_minor === amountMinor
        && d.donation_date === date && d.status === 'POSTED');
      if (candidates.length) {
        throw conflict('DUPLICATE_SUSPECTED', 'A donation with the same donor, amount and date already exists.', {
          duplicate_candidates: candidates.map((d) => ({ id: d.id, donation_date: d.donation_date })),
        });
      }
    }

    const allocations = buildAllocations(payload.allocations, amountMinor, currency);
    const errors = [];
    allocations.forEach((a, i) => {
      if (!fundRepo.get(orgId, a.fund_id)) {
        errors.push({ field: `allocations[${i}].fund_id`, code: 'FUND_NOT_FOUND', message: 'Unknown fund.' });
      }
      if (a.campaign_id) {
        const c = campaignRepo.get(orgId, a.campaign_id);
        if (!c) errors.push({ field: `allocations[${i}].campaign_id`, code: 'CAMPAIGN_NOT_FOUND', message: 'Unknown campaign.' });
        else if (c.status === 'CLOSED') {
          errors.push({ field: `allocations[${i}].campaign_id`, code: 'CAMPAIGN_CLOSED', message: `Campaign ${c.code} is closed and cannot take new gifts.` });
        }
      }
    });
    if (errors.length) throw validation(errors);

    const campaignIds = [...new Set(allocations.map((a) => a.campaign_id).filter(Boolean))];
    // Snapshot progress BEFORE the money lands so we can detect what this gift crossed.
    const before = new Map(campaignIds.map((id) => [id, getProgress(orgId, id)]));

    const now = new Date().toISOString();
    const donation = donationRepo.insert({
      id: uuid(),
      organization_id: orgId,
      donor_id: donor.id,
      transaction_type: 'DONATION',
      status: 'POSTED',
      amount_minor: amountMinor,
      currency,
      fair_market_value_minor: fmvMinor,
      deductible_minor: deductibleMinor,
      donation_date: date,
      method,
      reference: payload.reference || null,
      memo: payload.memo || null,
      is_anonymous: payload.is_anonymous ?? false,
      exclude_from_summaries: payload.exclude_from_summaries ?? false,
      campaign_ids: campaignIds,
      receipt_id: null,
      source: payload.source || 'API',
      reversal_reason: null,
      reversed_at: null,
      posted_at: now,
      created_at: now,
      updated_at: now,
    });

    allocRepo.insertMany(allocations.map((a) => ({
      id: uuid(),
      organization_id: orgId,
      donation_id: donation.id,
      donor_id: donor.id,
      fund_id: a.fund_id,
      campaign_id: a.campaign_id,
      amount_minor: a.amount_minor,
      created_at: now,
    })));

    summaries.upsert(orgId, computeSummary(donor.id, donationRepo.forDonor(orgId, donor.id)));

    // A zero-deductible gift (goods fully offset the payment) gets no receipt.
    let receipt = null;
    const wantsReceipt = payload.issue_receipt ?? true;
    if (wantsReceipt && deductibleMinor > 0) {
      receipt = issueForDonation(orgId, donation, { actor });
    }

    writeAudit(db, { organizationId: orgId, actor, entityType: 'donation', entityId: donation.id, operation: 'POST', before: null, after: donation });

    const progressAfter = {};
    const milestoneEvents = [];
    for (const campaignId of campaignIds) {
      const prev = before.get(campaignId);
      const now_ = getProgress(orgId, campaignId);
      progressAfter[campaignId] = now_;

      const campaign = campaignRepo.get(orgId, campaignId);
      const crossed = newlyCrossedMilestones(prev.percent, now_.percent, config.milestones, campaign.milestones_reached);
      if (crossed.length) {
        campaignRepo.update(orgId, campaignId, { milestones_reached: [...campaign.milestones_reached, ...crossed].sort((a, b) => a - b) });
      }
      for (const percent of crossed) {
        milestoneEvents.push({ campaign_id: campaignId, percent, progress: now_, triggered_by_donation_id: donation.id });
      }
      if (now_.goal_reached && !campaign.goal_reached_at) {
        campaignRepo.update(orgId, campaignId, { goal_reached_at: now });
        publish(db, { organizationId: orgId, type: 'campaign.goal_reached', actor, data: { campaign_id: campaignId, progress: now_, triggered_by_donation_id: donation.id } });
      }
    }

    publish(db, {
      organizationId: orgId,
      type: 'donation.posted',
      actor,
      data: {
        donation_id: donation.id,
        donor_id: donor.id,
        amount_minor: amountMinor,
        currency,
        receipt_id: receipt ? receipt.id : null,
        campaign_progress: progressAfter,
      },
    });

    // Milestone events are published after donation.posted so the donor who tipped the
    // campaign over receives their thank-you first, then the milestone note.
    for (const data of milestoneEvents) {
      publish(db, { organizationId: orgId, type: 'campaign.milestone_reached', actor, data });
    }

    return { donation, receipt, allocations: allocRepo.forDonation(orgId, donation.id), progress: progressAfter };
  });
}

/**
 * Reverse a posted donation. The row is never edited or deleted: a posted donation is
 * immutable in amount, date and donor. Reversal removes it from campaign progress and
 * from the donor's summary, and voids any receipt.
 */
export function reverseDonation(orgId, donationId, { reason = 'Correction', actor = 'system' } = {}) {
  return db.tx(() => {
    const donation = donationRepo.get(orgId, donationId);
    if (!donation) throw notFound('Donation');
    if (donation.status !== 'POSTED') {
      throw conflict('INVALID_STATE_TRANSITION', `A donation with status ${donation.status} cannot be reversed.`);
    }

    const before = structuredClone(donation);
    const receipt = receiptRepo.activeForDonation(orgId, donationId);
    if (receipt) voidReceipt(orgId, receipt.id, { reason: `Donation reversed: ${reason}`, actor });

    donationRepo.update(orgId, donationId, { status: 'REVERSED', reversal_reason: reason, reversed_at: new Date().toISOString() });
    const after = donationRepo.get(orgId, donationId);

    summaries.upsert(orgId, computeSummary(donation.donor_id, donationRepo.forDonor(orgId, donation.donor_id)));
    writeAudit(db, { organizationId: orgId, actor, entityType: 'donation', entityId: donationId, operation: 'REVERSE', before, after });

    const progress = {};
    for (const campaignId of donation.campaign_ids || []) progress[campaignId] = getProgress(orgId, campaignId);

    publish(db, {
      organizationId: orgId,
      type: 'donation.reversed',
      actor,
      data: {
        donation_id: donationId,
        donor_id: donation.donor_id,
        reason,
        voided_receipt_id: receipt ? receipt.id : null,
        campaign_progress: progress,
      },
    });
    return { donation: after, progress };
  });
}

export function getDonation(orgId, id) {
  const donation = donationRepo.get(orgId, id);
  if (!donation) throw notFound('Donation');
  return { donation, allocations: allocRepo.forDonation(orgId, id) };
}

export function listDonations(orgId, { donorId, campaignId, status } = {}) {
  let rows = donationRepo.list(orgId, (d) => (donorId ? d.donor_id === donorId : true));
  if (status) rows = rows.filter((d) => d.status === status);
  if (campaignId) rows = rows.filter((d) => (d.campaign_ids || []).includes(campaignId));
  return rows.sort((a, b) => (b.donation_date + b.created_at).localeCompare(a.donation_date + a.created_at));
}
