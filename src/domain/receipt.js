// domain/receipt.js — receipt numbering and the printed snapshot.
//
// Numbering is the one place where a bug is a legal problem rather than a support
// ticket: sequential per organization, allocated inside the issuing transaction,
// never reused.
import { formatMoney } from '../core/money.js';

/** format: {prefix}{year}{sequence:0Nd} -> "R2026000142" */
export function formatReceiptNumber(org, sequence, year) {
  const width = org.receipt_number_width || 6;
  const prefix = org.receipt_prefix ?? 'R';
  const y = org.receipt_number_includes_year === false ? '' : String(year);
  return `${prefix}${y}${String(sequence).padStart(width, '0')}`;
}

/**
 * A receipt stores a snapshot of everything printed. Later edits to the donor never
 * alter an issued receipt.
 */
export function buildSnapshot({ org, donor, donation, allocations, funds }) {
  const fundName = (id) => funds.find((f) => f.id === id)?.name || 'Unrestricted';
  return {
    organization: {
      name: org.name,
      tax_id: org.tax_id,
      address: org.address,
      email: org.email,
    },
    donor: {
      display_name: donor.display_name,
      email: donor.email,
      address: donor.address || null,
    },
    donation: {
      id: donation.id,
      date: donation.donation_date,
      currency: donation.currency,
      amount: formatMoney(donation.amount_minor, donation.currency),
      fair_market_value: formatMoney(donation.fair_market_value_minor || 0, donation.currency),
      deductible_amount: formatMoney(donation.deductible_minor, donation.currency),
      method: donation.method,
      reference: donation.reference || null,
    },
    allocations: allocations.map((a) => ({
      fund: fundName(a.fund_id),
      amount: formatMoney(a.amount_minor, donation.currency),
    })),
  };
}
