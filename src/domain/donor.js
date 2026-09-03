// domain/donor.js — pure donor rules: name building, contactability, suppression.
// No I/O, no store access. Everything here is unit-testable in isolation.

export const DONOR_TYPES = ['INDIVIDUAL', 'ORGANIZATION'];
export const DONOR_STATUSES = ['ACTIVE', 'INACTIVE', 'DECEASED', 'DELETED'];

/** `Last, First Middle` for people; the organization name for organizations. Derived + stored. */
export function buildDisplayName(donor) {
  if (donor.type === 'ORGANIZATION') return (donor.organization_name || '').trim();
  const first = [donor.first_name, donor.middle_name].filter(Boolean).join(' ').trim();
  const last = (donor.last_name || '').trim();
  if (last && first) return `${last}, ${first}`;
  return last || first;
}

/** Accent-folded, lowercase, punctuation-free form used for ordering and matching. */
export function buildSortName(displayName) {
  return (displayName || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Salutations are derived once at creation and never silently overwritten afterwards. */
export function buildSalutation(donor) {
  if (donor.type === 'ORGANIZATION') {
    return { formal: donor.organization_name || '', informal: donor.organization_name || '' };
  }
  const prefix = donor.prefix ? `${donor.prefix} ` : '';
  const last = donor.last_name || '';
  const first = donor.first_name || last;
  return {
    formal: `${prefix}${last}`.trim() || first,
    informal: donor.nickname || first,
  };
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** E.164-ish normalisation; the entered form is preserved separately for display. */
export function normalisePhone(raw, defaultCountry = '+1') {
  if (!raw) return null;
  const digits = String(raw).replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) return digits;
  if (digits.length === 10) return `${defaultCountry}${digits}`;
  return `+${digits}`;
}

/**
 * The suppression service. ONE implementation, used by every send path
 * (docs/demo1/10-module-notifications.md §3). Returns null when the message may go out,
 * or a stable reason code when it must not.
 *
 * Message kinds:
 *   TRANSACTIONAL — receipt / thank-you for a donation the donor just made
 *   STEWARDSHIP   — campaign progress updates, milestones, digests
 *   SOLICITATION  — an ask for money
 */
export function suppressionReason(donor, kind) {
  if (!donor) return 'NO_DONOR';
  if (!donor.email) return 'NO_EMAIL_ADDRESS';
  if (donor.email_bounced) return 'EMAIL_HARD_BOUNCED';
  if (donor.status === 'DELETED') return 'DONOR_DELETED';
  if (donor.status === 'DECEASED') return 'DONOR_DECEASED';
  // `no_email` is a channel-level opt-out and outranks everything: we have no way to reach them.
  if (donor.no_email) return 'NO_EMAIL_PREFERENCE';
  if (kind === 'STEWARDSHIP' && donor.progress_updates_opt_in === false) return 'PROGRESS_UPDATES_OPTED_OUT';
  // no_solicitation suppresses asks only — never receipts, never legally required mail.
  if (kind === 'SOLICITATION' && donor.no_solicitation) return 'NO_SOLICITATION';
  return null;
}

export const isContactable = (donor, kind) => suppressionReason(donor, kind) === null;
