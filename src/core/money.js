// core/money.js — money is NEVER a float.
// Internally every amount is an integer of minor units (cents) plus an ISO-4217 code.
// Over the wire it is a decimal *string* with a sibling `currency` field.
import { validation } from './errors.js';

export const CURRENCIES = { USD: 2, EUR: 2, GBP: 2, CAD: 2, AUD: 2, INR: 2, JPY: 0, KES: 2 };

export function exponent(currency) {
  const e = CURRENCIES[currency];
  if (e === undefined) throw validation([{ field: 'currency', code: 'UNSUPPORTED_CURRENCY', message: `Unsupported currency ${currency}.` }]);
  return e;
}

/** "1000.00" | 1000 -> 100000 minor units. Rejects floats-with-precision-loss and junk. */
export function parseMoney(value, currency, field = 'amount') {
  const e = exponent(currency);
  const raw = typeof value === 'number' ? value.toString() : String(value ?? '').trim();
  const m = /^(-)?(\d+)(?:\.(\d+))?$/.exec(raw);
  if (!m) {
    throw validation([{ field, code: 'INVALID_MONEY', message: `"${raw}" is not a decimal amount.` }]);
  }
  const [, sign, whole, frac = ''] = m;
  if (frac.length > e) {
    throw validation([{ field, code: 'MONEY_PRECISION', message: `${currency} allows at most ${e} decimal places.` }]);
  }
  const padded = (frac + '0'.repeat(e)).slice(0, e);
  const minor = BigInt(whole) * BigInt(10 ** e) + BigInt(padded || '0');
  const n = Number(minor) * (sign ? -1 : 1);
  if (!Number.isSafeInteger(n)) {
    throw validation([{ field, code: 'MONEY_OVERFLOW', message: 'Amount out of range.' }]);
  }
  return n;
}

/** 100000 -> "1000.00" */
export function formatMoney(minor, currency) {
  const e = exponent(currency);
  const neg = minor < 0;
  const s = Math.abs(Math.round(minor)).toString().padStart(e + 1, '0');
  const whole = s.slice(0, s.length - e);
  const frac = e ? '.' + s.slice(s.length - e) : '';
  return `${neg ? '-' : ''}${whole}${frac}`;
}

/** Serialise for an API response: { amount, currency }. */
export const moneyOut = (minor, currency) => ({ amount: formatMoney(minor, currency), currency });

/**
 * Split a total across weights, largest-remainder method.
 * The rounding remainder lands on the largest weight (docs §08 FR-GFT-003).
 */
export function splitByPercent(totalMinor, percents) {
  const sum = percents.reduce((a, b) => a + b, 0);
  if (Math.abs(sum - 100) > 1e-9) {
    throw validation([{ field: 'allocations', code: 'PERCENT_SUM_MISMATCH', message: `Percentages total ${sum}, expected 100.` }]);
  }
  const parts = percents.map((p) => Math.floor((totalMinor * p) / 100));
  let remainder = totalMinor - parts.reduce((a, b) => a + b, 0);
  const order = percents.map((p, i) => [p, i]).sort((a, b) => b[0] - a[0]);
  let k = 0;
  while (remainder > 0) { parts[order[k % order.length][1]] += 1; remainder -= 1; k += 1; }
  return parts;
}

/** Percentage of goal, rounded to 1 decimal, clamped at >= 0. Never divides by zero. */
export function percentOf(raisedMinor, goalMinor) {
  if (!goalMinor || goalMinor <= 0) return 0;
  return Math.max(0, Math.round((raisedMinor / goalMinor) * 1000) / 10);
}

/** Display form with thousands separators: 5000000 -> "50,000.00". API responses use formatMoney. */
export function displayMoney(minor, currency) {
  const plain = formatMoney(minor, currency);
  const [whole, frac] = plain.split('.');
  const grouped = whole.replace('-', '').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${whole.startsWith('-') ? '-' : ''}${grouped}${frac ? '.' + frac : ''}`;
}
