// services/notifications.js — keeping the donor informed.
//
// Everything a donor receives is produced here, from a domain event, through one
// suppression check and one template render, into a `communication` row. Nothing else
// in the system is allowed to call the email port directly. That gives a single place
// to answer "why did/didn't this donor get that mail?".
import { db } from '../db/store.js';
import {
  orgs, donors as donorRepo, campaigns as campaignRepo, donations as donationRepo,
  allocations as allocRepo, receipts as receiptRepo, communications as commRepo, funds as fundRepo,
} from '../repositories/index.js';
import { suppressionReason } from '../domain/donor.js';
import { computeProgress } from '../domain/campaign.js';
import { displayMoney } from '../core/money.js';
import { formatDateLong, plural } from '../core/dates.js';
import { uuid } from '../core/ids.js';
import { log } from '../core/logging.js';
import { renderTemplate, templateKind } from '../templates/index.js';
import { campaignDonors } from './campaigns.js';

// ---------------------------------------------------------------- context builders

const orgContext = (org) => ({
  name: org.name,
  email: org.email,
  tax_id: org.tax_id,
  address: org.address,
});

function campaignContext(campaign, progress, extra = {}) {
  const c = campaign.currency;
  return {
    id: campaign.id,
    code: campaign.code,
    name: campaign.name,
    currency: c,
    goal: displayMoney(progress.goal_minor, c),
    raised: displayMoney(progress.raised_minor, c),
    remaining: displayMoney(progress.remaining_minor, c),
    percent: progress.percent,
    bar_width: Math.min(100, progress.percent),
    donor_count: progress.donor_count,
    donation_count: progress.donation_count,
    average: displayMoney(progress.average_donation_minor, c),
    days_remaining: progress.days_remaining,
    donor_label: plural(progress.donor_count, 'donor'),
    donation_label: plural(progress.donation_count, 'donation'),
    days_label: progress.days_remaining === null ? null : plural(progress.days_remaining, 'day'),
    end_date: formatDateLong(campaign.end_date),
    goal_reached: progress.goal_reached,
    ...extra,
  };
}

function donorContext(donor, extra = {}) {
  return {
    id: donor.id,
    display_name: donor.display_name,
    first_name: donor.first_name || donor.organization_name || null,
    salutation_informal: donor.salutation?.informal || null,
    email: donor.email,
    ...extra,
  };
}

function donorCampaignFacts(orgId, donorId, campaignId, currency) {
  const allocs = allocRepo.countingForCampaign(orgId, campaignId).filter((a) => a.donor_id === donorId);
  const total = allocs.reduce((s, a) => s + a.amount_minor, 0);
  const donationCount = new Set(allocs.map((a) => a.donation_id)).size;
  return {
    campaign_total: displayMoney(total, currency),
    campaign_total_currency: currency,
    campaign_donation_count: donationCount,
    campaign_donation_label: plural(donationCount, 'donation'),
    multiple_gifts: donationCount > 1,
  };
}

const preferencesUrl = (org, donor) => `${org.portal_base_url}/preferences/${donor.id}`;

// ---------------------------------------------------------------- queueing

/**
 * Render and queue one message. Always writes a `communication` row — including when the
 * message is suppressed, so "we deliberately did not mail this donor, and here is why"
 * is visible on the timeline rather than being an absence of evidence.
 */
export function queueMessage(orgId, { donor, templateKey, context, dedupeKey = null, relatedType = null, relatedId = null, trigger = null }) {
  if (dedupeKey && commRepo.byDedupeKey(orgId, dedupeKey)) {
    return { skipped: true, reason: 'ALREADY_SENT', communication: commRepo.byDedupeKey(orgId, dedupeKey) };
  }

  const kind = templateKind(templateKey);
  const reason = suppressionReason(donor, kind);
  const now = new Date().toISOString();

  const base = {
    id: uuid(),
    organization_id: orgId,
    donor_id: donor.id,
    channel: 'EMAIL',
    template_key: templateKey,
    kind,
    to_address: donor.email || null,
    dedupe_key: dedupeKey,
    related_type: relatedType,
    related_id: relatedId,
    trigger,
    attempts: 0,
    last_error: null,
    next_attempt_at: null,
    provider_message_id: null,
    sent_at: null,
    created_at: now,
    updated_at: now,
  };

  if (reason) {
    const comm = commRepo.insert({ ...base, status: 'SUPPRESSED', suppression_reason: reason, subject: null, html: null, text: null, warnings: [] });
    log.info('communication.suppressed', { template: templateKey, reason, donor_id: donor.id });
    return { skipped: true, reason, communication: comm };
  }

  const rendered = renderTemplate(templateKey, context);
  const comm = commRepo.insert({
    ...base,
    status: 'QUEUED',
    suppression_reason: null,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    warnings: rendered.warnings,
  });
  return { skipped: false, communication: comm };
}

// ---------------------------------------------------------------- event handlers

function fanOutToCampaignDonors(orgId, campaignId, templateKey, { dedupePrefix, extraCampaign = {}, extraContext = {}, trigger, progressOverride = null }) {
  const org = orgs.get(orgId);
  const campaign = campaignRepo.get(orgId, campaignId);
  if (!campaign) return [];
  const progress = progressOverride || computeProgress(campaign, allocRepo.countingForCampaign(orgId, campaignId));

  return campaignDonors(orgId, campaignId).map(({ donor }) => queueMessage(orgId, {
    donor,
    templateKey,
    dedupeKey: `${dedupePrefix}:${donor.id}`,
    relatedType: 'campaign',
    relatedId: campaignId,
    trigger,
    context: {
      org: orgContext(org),
      donor: donorContext(donor, donorCampaignFacts(orgId, donor.id, campaignId, campaign.currency)),
      campaign: campaignContext(campaign, progress, extraCampaign),
      links: { preferences_url: preferencesUrl(org, donor) },
      ...extraContext,
    },
  }));
}

const handlers = {
  'donor.registered'(orgId, event) {
    const org = orgs.get(orgId);
    const donor = donorRepo.get(orgId, event.data.donor_id);
    if (!donor) return [];
    const campaign = event.data.campaign_id ? campaignRepo.get(orgId, event.data.campaign_id) : null;
    const progress = campaign ? computeProgress(campaign, allocRepo.countingForCampaign(orgId, campaign.id)) : null;

    return [queueMessage(orgId, {
      donor,
      templateKey: 'welcome',
      dedupeKey: `welcome:${donor.id}`,
      relatedType: 'donor',
      relatedId: donor.id,
      trigger: 'donor.registered',
      context: {
        org: orgContext(org),
        donor: donorContext(donor),
        campaign: campaign ? campaignContext(campaign, progress) : null,
        links: { preferences_url: preferencesUrl(org, donor) },
      },
    })];
  },

  'donation.posted'(orgId, event) {
    const org = orgs.get(orgId);
    const donation = donationRepo.get(orgId, event.data.donation_id);
    const donor = donorRepo.get(orgId, event.data.donor_id);
    if (!donation || !donor) return [];

    const allocations = allocRepo.forDonation(orgId, donation.id);
    const fundName = (id) => fundRepo.get(orgId, id)?.name || 'Unrestricted';
    // A donation may span several campaigns; the thank-you shows the largest allocation's
    // campaign, and the milestone/digest mails cover the rest.
    const primary = [...allocations]
      .filter((a) => a.campaign_id)
      .sort((a, b) => b.amount_minor - a.amount_minor)[0];
    const campaign = primary ? campaignRepo.get(orgId, primary.campaign_id) : null;
    const progress = campaign ? computeProgress(campaign, allocRepo.countingForCampaign(orgId, campaign.id)) : null;
    const receipt = donation.receipt_id ? receiptRepo.get(orgId, donation.receipt_id) : null;

    return [queueMessage(orgId, {
      donor,
      templateKey: 'donation_thank_you',
      dedupeKey: `thanks:${donation.id}`,
      relatedType: 'donation',
      relatedId: donation.id,
      trigger: 'donation.posted',
      context: {
        org: orgContext(org),
        donor: donorContext(donor, campaign ? donorCampaignFacts(orgId, donor.id, campaign.id, campaign.currency) : {}),
        donation: {
          currency: donation.currency,
          amount: displayMoney(donation.amount_minor, donation.currency),
          date: formatDateLong(donation.donation_date),
          method: donation.method,
          reference: donation.reference,
          fair_market_value: displayMoney(donation.fair_market_value_minor, donation.currency),
          deductible_amount: displayMoney(donation.deductible_minor, donation.currency),
          has_fmv: donation.fair_market_value_minor > 0,
        },
        allocations: allocations.map((a) => ({ fund: fundName(a.fund_id), amount: displayMoney(a.amount_minor, donation.currency) })),
        receipt: receipt ? { number: receipt.receipt_number, issue_date: formatDateLong(receipt.issue_date), statement: receipt.statement } : null,
        campaign: campaign ? campaignContext(campaign, progress) : null,
        links: { preferences_url: preferencesUrl(org, donor) },
      },
    })];
  },

  'campaign.milestone_reached'(orgId, event) {
    const { campaign_id: campaignId, percent } = event.data;
    return fanOutToCampaignDonors(orgId, campaignId, 'campaign_milestone', {
      dedupePrefix: `milestone:${campaignId}:${percent}`,
      trigger: 'campaign.milestone_reached',
      progressOverride: event.data.progress,
      extraContext: { milestone: { percent } },
    });
  },

  'campaign.goal_reached'(orgId, event) {
    const { campaign_id: campaignId } = event.data;
    const campaign = campaignRepo.get(orgId, campaignId);
    return fanOutToCampaignDonors(orgId, campaignId, 'campaign_goal_reached', {
      dedupePrefix: `goal:${campaignId}`,
      trigger: 'campaign.goal_reached',
      progressOverride: event.data.progress,
      extraCampaign: { still_open: campaign?.status === 'ACTIVE' },
    });
  },

  'campaign.update_requested'(orgId, event) {
    const { campaign_id: campaignId, dedupe_scope: scope, since_last_minor: sinceLast } = event.data;
    const campaign = campaignRepo.get(orgId, campaignId);
    return fanOutToCampaignDonors(orgId, campaignId, 'campaign_progress_digest', {
      dedupePrefix: scope,
      trigger: event.data.trigger || 'MANUAL',
      extraCampaign: { since_last: sinceLast > 0 ? displayMoney(sinceLast, campaign.currency) : null },
    });
  },

  'campaign.closed'(orgId, event) {
    const { campaign_id: campaignId } = event.data;
    const campaign = campaignRepo.get(orgId, campaignId);
    return fanOutToCampaignDonors(orgId, campaignId, 'campaign_closed', {
      dedupePrefix: `closed:${campaignId}`,
      trigger: 'campaign.closed',
      progressOverride: event.data.progress,
      extraCampaign: { closed_on: formatDateLong((campaign?.closed_at || '').slice(0, 10)) },
    });
  },

  'donation.reversed'(orgId, event) {
    const org = orgs.get(orgId);
    const donation = donationRepo.get(orgId, event.data.donation_id);
    const donor = donorRepo.get(orgId, event.data.donor_id);
    if (!donation || !donor) return [];
    const receipt = event.data.voided_receipt_id ? receiptRepo.get(orgId, event.data.voided_receipt_id) : null;

    return [queueMessage(orgId, {
      donor,
      templateKey: 'donation_reversed',
      dedupeKey: `reversed:${donation.id}`,
      relatedType: 'donation',
      relatedId: donation.id,
      trigger: 'donation.reversed',
      context: {
        org: orgContext(org),
        donor: donorContext(donor),
        donation: {
          currency: donation.currency,
          amount: displayMoney(donation.amount_minor, donation.currency),
          date: formatDateLong(donation.donation_date),
        },
        reversal: { reason: event.data.reason },
        receipt: receipt ? { number: receipt.receipt_number } : null,
        links: { preferences_url: preferencesUrl(org, donor) },
      },
    })];
  },
};

/** Dispatch one outbox event. Consumers must tolerate being called more than once. */
export function handleEvent(event) {
  const handler = handlers[event.type];
  if (!handler) return [];
  return handler(event.organization_id, event) || [];
}

export function listCommunications(orgId, { donorId, status, templateKey } = {}) {
  return commRepo
    .list(orgId, (c) => (donorId ? c.donor_id === donorId : true)
      && (status ? c.status === status : true)
      && (templateKey ? c.template_key === templateKey : true))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}
