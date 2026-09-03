// domain/allocation.js — the split-allocation model.
//
// A $1,000 donation split 60/40 between two funds is ONE donation with TWO allocations.
// The donor's donation count goes up by 1, not 2; revenue-by-fund aggregates allocations.
import { parseMoney, splitByPercent, formatMoney } from '../core/money.js';
import { validation, businessRule } from '../core/errors.js';

/**
 * Normalise the request's allocation list into minor units and enforce the sum invariant.
 * Accepts either `amount` (decimal string) or `percent` per line, never a mix.
 * DON-I1: sum(allocations.amount) === donation.amount, exactly.
 */
export function buildAllocations(input, totalMinor, currency) {
  const lines = Array.isArray(input) ? input : [];
  if (lines.length === 0) {
    throw validation([{ field: 'allocations', code: 'ALLOCATION_REQUIRED', message: 'At least one allocation with a fund is required.' }]);
  }

  const usesPercent = lines.some((l) => l.percent !== undefined);
  const usesAmount = lines.some((l) => l.amount !== undefined);
  if (usesPercent && usesAmount) {
    throw validation([{ field: 'allocations', code: 'ALLOCATION_MIXED_MODE', message: 'Use either amount or percent on every allocation, not both.' }]);
  }

  let amounts;
  if (usesPercent) {
    amounts = splitByPercent(totalMinor, lines.map((l) => Number(l.percent)));
  } else {
    amounts = lines.map((l, i) => parseMoney(l.amount, currency, `allocations[${i}].amount`));
  }

  const errors = [];
  lines.forEach((l, i) => {
    if (!l.fund_id) errors.push({ field: `allocations[${i}].fund_id`, code: 'FUND_REQUIRED', message: 'Every allocation must name a fund.' });
    if (amounts[i] <= 0) errors.push({ field: `allocations[${i}].amount`, code: 'ALLOCATION_NOT_POSITIVE', message: 'Allocation amounts must be greater than zero.' });
  });
  if (errors.length) throw validation(errors);

  const sum = amounts.reduce((a, b) => a + b, 0);
  if (sum !== totalMinor) {
    throw businessRule(
      'ALLOCATION_SUM_MISMATCH',
      `Allocations total ${formatMoney(sum, currency)} but the donation amount is ${formatMoney(totalMinor, currency)}.`,
      { errors: [{ field: 'allocations', code: 'ALLOCATION_SUM_MISMATCH', message: 'Allocations must sum exactly to the donation amount.' }] },
    );
  }

  return lines.map((l, i) => ({
    fund_id: l.fund_id,
    campaign_id: l.campaign_id || null,
    amount_minor: amounts[i],
  }));
}
