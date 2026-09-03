// api/presenters.js — the only place internal rows become API resources.
//
// Money leaves the system as a decimal *string* with a sibling `currency`, never a float
// and never minor units.
import { formatMoney } from '../core/money.js';

export const donorOut = (d) => ({
  id: d.id,
  type: 'donor',
  donor_type: d.type,
  number: d.number,
  display_name: d.display_name,
  sort_name: d.sort_name,
  prefix: d.prefix,
  first_name: d.first_name,
  middle_name: d.middle_name,
  last_name: d.last_name,
  nickname: d.nickname,
  organization_name: d.organization_name,
  salutation: d.salutation,
  email: d.email,
  email_bounced: d.email_bounced,
  phone: d.phone,
  address: d.address,
  preferences: {
    no_email: d.no_email,
    no_solicitation: d.no_solicitation,
    progress_updates_opt_in: d.progress_updates_opt_in,
  },
  status: d.status,
  source: d.source,
  version: d.version,
  created_at: d.created_at,
  updated_at: d.updated_at,
});

export const summaryOut = (s, currency = 'USD') => ({
  type: 'giving_summary',
  donor_id: s.donor_id,
  currency,
  donation_count: s.donation_count,
  total_amount: formatMoney(s.total_minor, currency),
  average_amount: formatMoney(s.average_minor, currency),
  ytd_amount: formatMoney(s.ytd_minor, currency),
  first_donation: s.first_donation_date && { date: s.first_donation_date, amount: formatMoney(s.first_donation_minor, currency) },
  last_donation: s.last_donation_date && { date: s.last_donation_date, amount: formatMoney(s.last_donation_minor, currency) },
  largest_donation: s.largest_donation_date && { date: s.largest_donation_date, amount: formatMoney(s.largest_donation_minor, currency) },
  campaigns_supported: s.campaigns_supported,
});

export const fundOut = (f) => ({
  id: f.id, type: 'fund', code: f.code, name: f.name,
  restriction: f.restriction, is_active: f.is_active, created_at: f.created_at,
});

export const campaignOut = (c) => ({
  id: c.id,
  type: 'campaign',
  code: c.code,
  name: c.name,
  description: c.description,
  currency: c.currency,
  goal: formatMoney(c.goal_minor, c.currency),
  start_date: c.start_date,
  end_date: c.end_date,
  status: c.status,
  closed_at: c.closed_at,
  milestones_reached: c.milestones_reached,
  goal_reached_at: c.goal_reached_at,
  last_update_sent_at: c.last_digest_at,
  created_at: c.created_at,
});

export const progressOut = (p) => ({
  type: 'campaign_progress',
  campaign_id: p.campaign_id,
  currency: p.currency,
  goal: formatMoney(p.goal_minor, p.currency),
  raised: formatMoney(p.raised_minor, p.currency),
  remaining: formatMoney(p.remaining_minor, p.currency),
  percent: p.percent,
  goal_reached: p.goal_reached,
  donor_count: p.donor_count,
  donation_count: p.donation_count,
  average_donation: formatMoney(p.average_donation_minor, p.currency),
  days_remaining: p.days_remaining,
  status: p.status,
});

export const allocationOut = (a, currency) => ({
  id: a.id, type: 'allocation', fund_id: a.fund_id, campaign_id: a.campaign_id,
  amount: formatMoney(a.amount_minor, currency), currency,
});

export const donationOut = (d, allocations = []) => ({
  id: d.id,
  type: 'donation',
  donor_id: d.donor_id,
  status: d.status,
  currency: d.currency,
  amount: formatMoney(d.amount_minor, d.currency),
  fair_market_value: formatMoney(d.fair_market_value_minor, d.currency),
  deductible_amount: formatMoney(d.deductible_minor, d.currency),
  donation_date: d.donation_date,
  method: d.method,
  reference: d.reference,
  memo: d.memo,
  is_anonymous: d.is_anonymous,
  exclude_from_summaries: d.exclude_from_summaries,
  campaign_ids: d.campaign_ids,
  receipt_id: d.receipt_id,
  source: d.source,
  reversal_reason: d.reversal_reason,
  reversed_at: d.reversed_at,
  posted_at: d.posted_at,
  allocations: allocations.map((a) => allocationOut(a, d.currency)),
});

export const receiptOut = (r) => ({
  id: r.id,
  type: 'receipt',
  receipt_number: r.receipt_number,
  donation_id: r.donation_id,
  donor_id: r.donor_id,
  issue_date: r.issue_date,
  tax_year: r.tax_year,
  currency: r.currency,
  amount: formatMoney(r.amount_minor, r.currency),
  deductible_amount: formatMoney(r.deductible_minor, r.currency),
  status: r.status,
  void_reason: r.void_reason,
  voided_at: r.voided_at,
  statement: r.statement,
  snapshot: r.snapshot,
});

export const communicationOut = (c, { body = false } = {}) => ({
  id: c.id,
  type: 'communication',
  donor_id: c.donor_id,
  channel: c.channel,
  template_key: c.template_key,
  kind: c.kind,
  to: c.to_address,
  subject: c.subject,
  status: c.status,
  suppression_reason: c.suppression_reason,
  attempts: c.attempts,
  last_error: c.last_error,
  next_attempt_at: c.next_attempt_at,
  trigger: c.trigger,
  related: c.related_type ? { type: c.related_type, id: c.related_id } : null,
  warnings: c.warnings,
  sent_at: c.sent_at,
  created_at: c.created_at,
  ...(body ? { html: c.html, text: c.text } : {}),
});

export const auditOut = (a) => ({
  id: a.id, type: 'audit_entry', actor: a.actor, entity_type: a.entity_type,
  entity_id: a.entity_id, operation: a.operation, changes: a.changes, occurred_at: a.occurred_at,
});

export const eventOut = (e) => ({
  id: e.id, type: 'event', event_type: e.type, occurred_at: e.occurred_at,
  actor: e.actor, published_at: e.published_at, data: e.data,
});

const headlineOut = (h, currency) => ({
  raised: formatMoney(h.raised_minor, currency),
  gift_count: h.gift_count,
  donor_count: h.donor_count,
  average_gift: formatMoney(h.average_minor, currency),
  largest_gift: formatMoney(h.largest_minor, currency),
});

export const statsOut = (s) => ({
  type: 'stats',
  currency: s.currency,
  range: s.range,
  lifetime: headlineOut(s.lifetime, s.currency),
  period: { ...headlineOut(s.period, s.currency), new_donors: s.period.new_donors },
  by_month: s.by_month.map((m) => ({
    month: m.month,
    count: m.count,
    amount: formatMoney(m.amount_minor, s.currency),
    cumulative: formatMoney(m.cumulative_minor, s.currency),
  })),
  size_distribution: s.size_distribution.map((b) => ({
    key: b.key, label: b.label, count: b.count, amount: formatMoney(b.amount_minor, s.currency),
  })),
  by_method: s.by_method.map((m) => ({
    method: m.method, count: m.count, amount: formatMoney(m.amount_minor, s.currency),
  })),
  email: s.email,
  top_donors: s.top_donors.map((d) => ({
    donor_id: d.donor_id, display_name: d.display_name, count: d.count,
    amount: formatMoney(d.amount_minor, s.currency),
  })),
  campaigns: s.campaigns.map(({ campaign, progress }) => ({
    ...campaignOut(campaign),
    progress: progressOut(progress),
  })),
});
