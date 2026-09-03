// services/receipts.js — issuing and voiding tax receipts.
//
// Receipting is the one area where a bug is a legal problem rather than a support
// ticket, so the rules here are deliberately rigid: sequential numbering allocated
// inside the issuing transaction, an immutable printed snapshot, and correction only by
// void-and-reissue.
import { db } from '../db/store.js';
import { orgs, receipts as receiptRepo, donations as donationRepo, allocations as allocRepo, funds as fundRepo, donors as donorRepo } from '../repositories/index.js';
import { formatReceiptNumber, buildSnapshot } from '../domain/receipt.js';
import { uuid } from '../core/ids.js';
import { notFound, conflict } from '../core/errors.js';
import { writeAudit } from '../core/audit.js';
import { publish } from '../core/events.js';

/** Must be called inside an open transaction (donations.recordDonation does). */
export function issueForDonation(orgId, donation, { actor = 'system' } = {}) {
  if (receiptRepo.activeForDonation(orgId, donation.id)) {
    throw conflict('DONATION_ALREADY_RECEIPTED', 'This donation already has an active receipt.');
  }
  const org = orgs.get(orgId);
  const donor = donorRepo.get(orgId, donation.donor_id);
  const allocations = allocRepo.forDonation(orgId, donation.id);
  const year = Number(donation.donation_date.slice(0, 4));
  const sequence = orgs.nextReceiptSequence(orgId);
  const now = new Date().toISOString();

  const receipt = receiptRepo.insert({
    id: uuid(),
    organization_id: orgId,
    receipt_number: formatReceiptNumber(org, sequence, year),
    sequence,
    donation_id: donation.id,
    donor_id: donation.donor_id,
    issue_date: now.slice(0, 10),
    tax_year: year,
    currency: donation.currency,
    amount_minor: donation.amount_minor,
    deductible_minor: donation.deductible_minor,
    status: 'ISSUED',
    void_reason: null,
    voided_at: null,
    replaces_receipt_id: null,
    statement: org.receipt_statement,
    snapshot: buildSnapshot({ org, donor, donation, allocations, funds: fundRepo.list(orgId) }),
    created_at: now,
    updated_at: now,
  });

  donationRepo.update(orgId, donation.id, { receipt_id: receipt.id });
  writeAudit(db, { organizationId: orgId, actor, entityType: 'receipt', entityId: receipt.id, operation: 'ISSUE', before: null, after: receipt });
  publish(db, { organizationId: orgId, type: 'receipt.issued', actor, data: { receipt_id: receipt.id, donation_id: donation.id, donor_id: donation.donor_id, receipt_number: receipt.receipt_number } });
  return receipt;
}

/** Voiding releases the donation to be receipted again and is recorded in the register. */
export function voidReceipt(orgId, receiptId, { reason = 'Correction', actor = 'system' } = {}) {
  return db.tx(() => {
    const receipt = receiptRepo.get(orgId, receiptId);
    if (!receipt) throw notFound('Receipt');
    if (receipt.status !== 'ISSUED') throw conflict('RECEIPT_ALREADY_VOIDED', 'This receipt has already been voided.');

    const before = structuredClone(receipt);
    receiptRepo.update(orgId, receiptId, { status: 'VOIDED', void_reason: reason, voided_at: new Date().toISOString() });
    const donation = donationRepo.get(orgId, receipt.donation_id);
    if (donation && donation.receipt_id === receiptId) donationRepo.update(orgId, donation.id, { receipt_id: null });

    const after = receiptRepo.get(orgId, receiptId);
    writeAudit(db, { organizationId: orgId, actor, entityType: 'receipt', entityId: receiptId, operation: 'VOID', before, after });
    publish(db, { organizationId: orgId, type: 'receipt.voided', actor, data: { receipt_id: receiptId, donation_id: receipt.donation_id, reason } });
    return after;
  });
}

/** The auditor's document: number, date, donor, amount, status, void reason. */
export function register(orgId, { taxYear } = {}) {
  return receiptRepo
    .list(orgId, (r) => (taxYear ? r.tax_year === Number(taxYear) : true))
    .sort((a, b) => a.sequence - b.sequence);
}

export function getReceipt(orgId, id) {
  const receipt = receiptRepo.get(orgId, id);
  if (!receipt) throw notFound('Receipt');
  return receipt;
}
