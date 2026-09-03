// domain/campaign.js — progress-to-goal and milestone crossing. Pure.
import { percentOf } from '../core/money.js';

/**
 * Progress for one campaign.
 * Counted: allocations of POSTED donations that are not `exclude_from_summaries`.
 * Not counted: DRAFT, REVERSED, and excluded donations. There is no other definition of
 * "raised" anywhere in the system.
 */
export function computeProgress(campaign, allocations, { asOf = new Date() } = {}) {
  const raisedMinor = allocations.reduce((sum, a) => sum + a.amount_minor, 0);
  const donorIds = new Set(allocations.map((a) => a.donor_id));
  const donationIds = new Set(allocations.map((a) => a.donation_id));
  const goalMinor = campaign.goal_minor || 0;
  const percent = percentOf(raisedMinor, goalMinor);
  const remainingMinor = Math.max(0, goalMinor - raisedMinor);

  let daysRemaining = null;
  if (campaign.end_date) {
    const end = Date.parse(`${campaign.end_date}T23:59:59Z`);
    daysRemaining = Math.max(0, Math.ceil((end - asOf.getTime()) / 86400000));
  }

  return {
    campaign_id: campaign.id,
    goal_minor: goalMinor,
    raised_minor: raisedMinor,
    remaining_minor: remainingMinor,
    percent,
    donor_count: donorIds.size,
    donation_count: donationIds.size,
    average_donation_minor: donationIds.size ? Math.round(raisedMinor / donationIds.size) : 0,
    days_remaining: daysRemaining,
    goal_reached: goalMinor > 0 && raisedMinor >= goalMinor,
    currency: campaign.currency,
    status: campaign.status,
  };
}

/**
 * Which milestones does this movement cross, upward, for the first time?
 *
 * `alreadyReached` is the campaign's durable high-water list. A reversal that drops the
 * percentage back below a threshold does NOT clear it: donors are never told the same
 * milestone twice. (See docs/demo1/10-module-notifications.md, scenario S7.)
 */
export function newlyCrossedMilestones(previousPercent, currentPercent, thresholds, alreadyReached = []) {
  if (currentPercent <= previousPercent) return [];
  return thresholds
    .filter((t) => currentPercent >= t && previousPercent < t && !alreadyReached.includes(t))
    .sort((a, b) => a - b);
}
