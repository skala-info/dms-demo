// services/stats.js — the read model behind the stats page.
//
// Reporting is otherwise out of scope for demo1 (see the scope table in the README); this
// is the one deliberately small exception, so that the console's charts and the API agree
// on every number instead of the browser inventing its own arithmetic.
import { donations as donationRepo, donors as donorRepo, communications as commRepo, campaigns as campaignRepo, orgs } from '../repositories/index.js';
import { exponent } from '../core/money.js';
import { validation } from '../core/errors.js';
import * as stats from '../domain/stats.js';
import { getProgress } from './campaigns.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const today = () => new Date().toISOString().slice(0, 10);

/** An axis longer than this stops being readable; the range filter is the way to see less. */
const MAX_MONTHS = 36;

function validateRange(from, to) {
  const errors = [];
  for (const [field, value] of [['from', from], ['to', to]]) {
    if (value && !DATE_RE.test(value)) {
      errors.push({ field, code: 'INVALID_DATE', message: 'Dates use YYYY-MM-DD.' });
    }
  }
  if (from && to && to < from) {
    errors.push({ field: 'to', code: 'END_BEFORE_START', message: 'to must not precede from.' });
  }
  if (errors.length) throw validation(errors);
}

export function buildStats(orgId, { from = null, to = null } = {}) {
  validateRange(from, to);

  const org = orgs.get(orgId);
  const currency = org.default_currency;
  const unit = 10 ** exponent(currency);

  // "Raised" is `countsTowardsSummary` and nothing else — the same rule the campaign
  // progress bars and the donor summaries use.
  const lifetime = stats.counted(donationRepo.list(orgId));
  const inRange = lifetime.filter((d) => (!from || d.donation_date >= from) && (!to || d.donation_date <= to));

  const earliest = lifetime.reduce((min, d) => (min === null || d.donation_date < min ? d.donation_date : min), null);
  const spanStart = from || earliest || today();
  let span = stats.monthSpan(stats.monthOf(spanStart), stats.monthOf(to || today()));
  const truncated = span.length > MAX_MONTHS;
  if (truncated) span = span.slice(-MAX_MONTHS);

  const donorNames = new Map(donorRepo.list(orgId).map((d) => [d.id, d.display_name]));
  const newDonors = donorRepo.list(orgId).filter((d) => {
    const created = String(d.created_at).slice(0, 10);
    return (!from || created >= from) && (!to || created <= to);
  }).length;

  const communications = commRepo.list(orgId).filter((c) => {
    const created = String(c.created_at).slice(0, 10);
    return (!from || created >= from) && (!to || created <= to);
  });

  return {
    currency,
    range: { from, to, months: span.length, truncated },
    lifetime: stats.headline(lifetime),
    period: { ...stats.headline(inRange), new_donors: newDonors },
    by_month: stats.givingByMonth(inRange, span),
    size_distribution: stats.sizeDistribution(inRange, unit),
    by_method: stats.byMethod(inRange),
    email: stats.emailOutcomes(communications),
    top_donors: stats.topDonors(inRange).map((row) => ({ ...row, display_name: donorNames.get(row.donor_id) || null })),
    campaigns: campaignRepo
      .list(orgId)
      .sort((a, b) => a.code.localeCompare(b.code))
      .map((c) => ({ campaign: c, progress: getProgress(orgId, c.id) })),
  };
}
