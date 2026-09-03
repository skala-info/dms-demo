// domain/summary.js — the donor's giving summary. Derived, never user-writable.
//
// SUM-I1: a full rebuild must be byte-identical to the incremental result. The demo
// therefore has exactly one implementation — `computeSummary` — and the incremental path
// calls it. That makes the invariant true by construction instead of by hope.

/** Donations that count towards a donor's totals. */
export const countsTowardsSummary = (d) =>
  d.status === 'POSTED' && !d.exclude_from_summaries && d.transaction_type !== 'PLEDGE';

export function computeSummary(donorId, donations) {
  const mine = donations
    .filter((d) => d.donor_id === donorId && countsTowardsSummary(d))
    .sort((a, b) => (a.donation_date < b.donation_date ? -1 : a.donation_date > b.donation_date ? 1 : 0));

  if (mine.length === 0) {
    return {
      donor_id: donorId,
      first_donation_date: null, first_donation_minor: 0,
      last_donation_date: null, last_donation_minor: 0,
      largest_donation_date: null, largest_donation_minor: 0,
      donation_count: 0, total_minor: 0, average_minor: 0,
      ytd_minor: 0, campaigns_supported: [],
    };
  }

  const total = mine.reduce((s, d) => s + d.amount_minor, 0);
  const largest = mine.reduce((best, d) => (d.amount_minor > best.amount_minor ? d : best), mine[0]);
  const first = mine[0];
  const last = mine[mine.length - 1];
  const year = new Date().getUTCFullYear();
  const ytd = mine.filter((d) => d.donation_date.startsWith(String(year))).reduce((s, d) => s + d.amount_minor, 0);
  const campaigns = [...new Set(mine.flatMap((d) => (d.campaign_ids || [])))].sort();

  return {
    donor_id: donorId,
    first_donation_date: first.donation_date,
    first_donation_minor: first.amount_minor,
    last_donation_date: last.donation_date,
    last_donation_minor: last.amount_minor,
    largest_donation_date: largest.donation_date,
    largest_donation_minor: largest.amount_minor,
    donation_count: mine.length,
    total_minor: total,
    average_minor: Math.round(total / mine.length),
    ytd_minor: ytd,
    campaigns_supported: campaigns,
  };
}
