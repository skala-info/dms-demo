// domain/stats.js — the aggregations behind the stats page. Pure: rows in, numbers out.
//
// These live here, not in the browser, for the same reason every other rule does: the
// definition of "raised" is `countsTowardsSummary` and there is exactly one of it. A
// chart that counted a REVERSED gift would be a second, wrong definition — and nobody
// would notice, because a chart looks right whatever it is drawn from.
//
// Money stays in integer minor units throughout. Nothing here divides into a float.
import { countsTowardsSummary } from './summary.js';

/** 'YYYY-MM-DD' -> 'YYYY-MM'. Dates are already calendar dates, never timestamps. */
export const monthOf = (date) => String(date).slice(0, 7);

/** Every month from `from` to `to` inclusive, so a month with no gifts still plots as zero. */
export function monthSpan(from, to) {
  const months = [];
  if (!from || !to || to < from) return months;
  let [year, month] = from.split('-').map(Number);
  const [endYear, endMonth] = to.split('-').map(Number);
  while (year < endYear || (year === endYear && month <= endMonth)) {
    months.push(`${year}-${String(month).padStart(2, '0')}`);
    month += 1;
    if (month > 12) { month = 1; year += 1; }
  }
  return months;
}

/** Gifts that count towards any statistic: POSTED, not excluded. One definition, imported. */
export const counted = (donations) => donations.filter(countsTowardsSummary);

/**
 * Money and gift count per calendar month, plus the running total.
 * `span` fixes the x-axis so the chart shows the requested period, not just the months
 * that happen to contain a gift.
 */
export function givingByMonth(donations, span) {
  const buckets = new Map(span.map((m) => [m, { month: m, amount_minor: 0, count: 0 }]));
  for (const donation of donations) {
    const bucket = buckets.get(monthOf(donation.donation_date));
    if (!bucket) continue;
    bucket.amount_minor += donation.amount_minor;
    bucket.count += 1;
  }
  let running = 0;
  return span.map((m) => {
    const bucket = buckets.get(m);
    running += bucket.amount_minor;
    return { ...bucket, cumulative_minor: running };
  });
}

/**
 * Gift-size bands. Ordered, so the chart may colour them as an ordinal ramp; thresholds
 * are major units scaled by the currency's exponent, so JPY does not land every gift in
 * the top band.
 */
export const SIZE_BAND_EDGES = [50, 100, 500, 1000, 5000];

export function sizeBands(unit) {
  const edges = SIZE_BAND_EDGES.map((e) => e * unit);
  return [
    { key: 'b1', label: `Under ${SIZE_BAND_EDGES[0]}`, min: 0, max: edges[0] - 1 },
    { key: 'b2', label: `${SIZE_BAND_EDGES[0]}–${SIZE_BAND_EDGES[1] - 1}`, min: edges[0], max: edges[1] - 1 },
    { key: 'b3', label: `${SIZE_BAND_EDGES[1]}–${SIZE_BAND_EDGES[2] - 1}`, min: edges[1], max: edges[2] - 1 },
    { key: 'b4', label: `${SIZE_BAND_EDGES[2]}–${SIZE_BAND_EDGES[3] - 1}`, min: edges[2], max: edges[3] - 1 },
    { key: 'b5', label: `${SIZE_BAND_EDGES[3]}–${SIZE_BAND_EDGES[4] - 1}`, min: edges[3], max: edges[4] - 1 },
    { key: 'b6', label: `${SIZE_BAND_EDGES[4]} and over`, min: edges[4], max: Infinity },
  ];
}

export function sizeDistribution(donations, unit) {
  const bands = sizeBands(unit).map((b) => ({ ...b, count: 0, amount_minor: 0 }));
  for (const donation of donations) {
    const band = bands.find((b) => donation.amount_minor >= b.min && donation.amount_minor <= b.max);
    if (!band) continue;
    band.count += 1;
    band.amount_minor += donation.amount_minor;
  }
  return bands.map(({ min, max, ...rest }) => rest);
}

/** How the money arrives. Ordered by amount, because the reader's question is "which is biggest". */
export function byMethod(donations) {
  const totals = new Map();
  for (const donation of donations) {
    const method = donation.method || 'OTHER';
    const row = totals.get(method) || { method, count: 0, amount_minor: 0 };
    row.count += 1;
    row.amount_minor += donation.amount_minor;
    totals.set(method, row);
  }
  return [...totals.values()].sort((a, b) => b.amount_minor - a.amount_minor || a.method.localeCompare(b.method));
}

/**
 * What happened to the mail. SUPPRESSED is an outcome, not an absence: the whole point of
 * recording it is that this chart can show it.
 */
export const EMAIL_OUTCOMES = ['SENT', 'QUEUED', 'FAILED', 'SUPPRESSED'];

export function emailOutcomes(communications) {
  const counts = new Map(EMAIL_OUTCOMES.map((s) => [s, 0]));
  const reasons = new Map();
  for (const comm of communications) {
    counts.set(comm.status, (counts.get(comm.status) || 0) + 1);
    if (comm.suppression_reason) {
      reasons.set(comm.suppression_reason, (reasons.get(comm.suppression_reason) || 0) + 1);
    }
  }
  return {
    total: communications.length,
    outcomes: [...counts.entries()].map(([status, count]) => ({ status, count })),
    suppression_reasons: [...reasons.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason)),
  };
}

/** Who gave the most in this period. */
export function topDonors(donations, limit = 5) {
  const totals = new Map();
  for (const donation of donations) {
    const row = totals.get(donation.donor_id) || { donor_id: donation.donor_id, count: 0, amount_minor: 0 };
    row.count += 1;
    row.amount_minor += donation.amount_minor;
    totals.set(donation.donor_id, row);
  }
  return [...totals.values()]
    .sort((a, b) => b.amount_minor - a.amount_minor || a.donor_id.localeCompare(b.donor_id))
    .slice(0, limit);
}

/** The headline numbers: one pass, integer arithmetic, no floats. */
export function headline(donations) {
  const total = donations.reduce((sum, d) => sum + d.amount_minor, 0);
  const largest = donations.reduce((best, d) => Math.max(best, d.amount_minor), 0);
  return {
    raised_minor: total,
    gift_count: donations.length,
    donor_count: new Set(donations.map((d) => d.donor_id)).size,
    average_minor: donations.length ? Math.round(total / donations.length) : 0,
    largest_minor: largest,
  };
}
