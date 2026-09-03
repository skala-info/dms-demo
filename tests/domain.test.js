// tests/domain.test.js — the pure rules. No HTTP, no store, no clock dependence.
import test from 'node:test';
import assert from 'node:assert/strict';

import { parseMoney, formatMoney, displayMoney, splitByPercent, percentOf } from '../src/core/money.js';
import { buildDisplayName, buildSortName, buildSalutation, normalisePhone, suppressionReason } from '../src/domain/donor.js';
import { buildAllocations } from '../src/domain/allocation.js';
import { computeProgress, newlyCrossedMilestones } from '../src/domain/campaign.js';
import { computeSummary } from '../src/domain/summary.js';
import { formatReceiptNumber } from '../src/domain/receipt.js';
import { render, htmlToText } from '../src/templates/render.js';
import { formatDateLong, plural } from '../src/core/dates.js';

test('money never round-trips through a float', () => {
  assert.equal(parseMoney('1000.00', 'USD'), 100000);
  assert.equal(parseMoney('0.01', 'USD'), 1);
  assert.equal(parseMoney(250, 'USD'), 25000);
  assert.equal(formatMoney(100000, 'USD'), '1000.00');
  assert.equal(displayMoney(123456789, 'USD'), '1,234,567.89');
  assert.equal(parseMoney('1000', 'JPY'), 1000, 'zero-decimal currency');
});

test('money rejects junk and excess precision', () => {
  const isValidationError = (e) => e.code === 'VALIDATION_ERROR';
  assert.throws(() => parseMoney('1,000.00', 'USD'), isValidationError);
  assert.throws(() => parseMoney('10.005', 'USD'), isValidationError);
  assert.throws(() => parseMoney('abc', 'USD'), isValidationError);
  assert.throws(() => parseMoney('1.00', 'XYZ'), isValidationError);
});

test('percentage splits distribute the rounding remainder to the largest share', () => {
  assert.deepEqual(splitByPercent(10000, [50, 50]), [5000, 5000]);
  const thirds = splitByPercent(10000, [33.34, 33.33, 33.33]);
  assert.equal(thirds.reduce((a, b) => a + b, 0), 10000);
  assert.equal(thirds[0], 3334);
});

test('percentOf never divides by zero and never goes negative', () => {
  assert.equal(percentOf(500, 0), 0);
  assert.equal(percentOf(2500, 10000), 25);
  assert.equal(percentOf(-100, 10000), 0);
});

test('display and sort names are derived, not entered', () => {
  assert.equal(buildDisplayName({ type: 'INDIVIDUAL', first_name: 'Jane', middle_name: 'A', last_name: 'Okonkwo' }), 'Okonkwo, Jane A');
  assert.equal(buildDisplayName({ type: 'ORGANIZATION', organization_name: 'Acme Foundation' }), 'Acme Foundation');
  assert.equal(buildSortName('Ökonkwo, Jané'), 'okonkwo jane');
  assert.deepEqual(buildSalutation({ type: 'INDIVIDUAL', prefix: 'Ms', first_name: 'Jane', last_name: 'Okonkwo' }), { formal: 'Ms Okonkwo', informal: 'Jane' });
  assert.equal(normalisePhone('(415) 555-0142'), '+14155550142');
});

test('suppression is one rule set, applied by message kind', () => {
  const base = { email: 'a@b.com', status: 'ACTIVE', no_email: false, no_solicitation: false, progress_updates_opt_in: true };
  assert.equal(suppressionReason(base, 'TRANSACTIONAL'), null);
  assert.equal(suppressionReason(base, 'STEWARDSHIP'), null);
  assert.equal(suppressionReason({ ...base, email: null }, 'TRANSACTIONAL'), 'NO_EMAIL_ADDRESS');
  assert.equal(suppressionReason({ ...base, no_email: true }, 'TRANSACTIONAL'), 'NO_EMAIL_PREFERENCE');
  assert.equal(suppressionReason({ ...base, progress_updates_opt_in: false }, 'STEWARDSHIP'), 'PROGRESS_UPDATES_OPTED_OUT');
  assert.equal(suppressionReason({ ...base, progress_updates_opt_in: false }, 'TRANSACTIONAL'), null,
    'opting out of progress updates must never suppress a receipt');
  assert.equal(suppressionReason({ ...base, no_solicitation: true }, 'STEWARDSHIP'), null,
    'no_solicitation suppresses asks, not stewardship');
  assert.equal(suppressionReason({ ...base, no_solicitation: true }, 'SOLICITATION'), 'NO_SOLICITATION');
  assert.equal(suppressionReason({ ...base, email_bounced: true }, 'TRANSACTIONAL'), 'EMAIL_HARD_BOUNCED');
});

test('allocations must sum exactly to the donation amount', () => {
  const ok = buildAllocations([{ fund_id: 'f1', amount: '600.00' }, { fund_id: 'f2', amount: '400.00' }], 100000, 'USD');
  assert.equal(ok.reduce((s, a) => s + a.amount_minor, 0), 100000);
  assert.throws(
    () => buildAllocations([{ fund_id: 'f1', amount: '600.00' }, { fund_id: 'f2', amount: '300.00' }], 100000, 'USD'),
    (e) => e.code === 'ALLOCATION_SUM_MISMATCH',
  );
  assert.throws(() => buildAllocations([], 100000, 'USD'), (e) => e.code === 'VALIDATION_ERROR');
  assert.throws(() => buildAllocations([{ amount: '1000.00' }], 100000, 'USD'), (e) => e.code === 'VALIDATION_ERROR');
  assert.throws(
    () => buildAllocations([{ fund_id: 'f1', amount: '600.00' }, { fund_id: 'f2', percent: 40 }], 100000, 'USD'),
    (e) => e.code === 'VALIDATION_ERROR',
  );
});

test('campaign progress counts allocations, not donations', () => {
  const campaign = { id: 'c1', goal_minor: 1000000, currency: 'USD', status: 'ACTIVE', end_date: null };
  const allocs = [
    { donation_id: 'd1', donor_id: 'p1', amount_minor: 150000 },
    { donation_id: 'd1', donor_id: 'p1', amount_minor: 50000 },
    { donation_id: 'd2', donor_id: 'p2', amount_minor: 100000 },
  ];
  const p = computeProgress(campaign, allocs);
  assert.equal(p.raised_minor, 300000);
  assert.equal(p.percent, 30);
  assert.equal(p.donation_count, 2, 'a split donation counts once');
  assert.equal(p.donor_count, 2);
  assert.equal(p.remaining_minor, 700000);
  assert.equal(p.goal_reached, false);
});

test('milestones fire once, upward, and survive a reversal', () => {
  const thresholds = [25, 50, 75, 100];
  assert.deepEqual(newlyCrossedMilestones(10, 30, thresholds, []), [25]);
  assert.deepEqual(newlyCrossedMilestones(10, 80, thresholds, []), [25, 50, 75]);
  assert.deepEqual(newlyCrossedMilestones(30, 40, thresholds, [25]), []);
  assert.deepEqual(newlyCrossedMilestones(80, 60, thresholds, [25, 50, 75]), [], 'falling never fires');
  assert.deepEqual(newlyCrossedMilestones(60, 80, thresholds, [25, 50, 75]), [],
    're-crossing a milestone already reached must not re-notify');
});

test('the giving summary excludes reversed and excluded donations', () => {
  const donations = [
    { donor_id: 'p1', status: 'POSTED', amount_minor: 10000, donation_date: '2026-01-05', exclude_from_summaries: false, campaign_ids: ['c1'] },
    { donor_id: 'p1', status: 'POSTED', amount_minor: 50000, donation_date: '2026-03-01', exclude_from_summaries: false, campaign_ids: ['c1'] },
    { donor_id: 'p1', status: 'REVERSED', amount_minor: 99900, donation_date: '2026-04-01', exclude_from_summaries: false, campaign_ids: [] },
    { donor_id: 'p1', status: 'POSTED', amount_minor: 70000, donation_date: '2026-05-01', exclude_from_summaries: true, campaign_ids: [] },
    { donor_id: 'p2', status: 'POSTED', amount_minor: 100, donation_date: '2026-05-01', exclude_from_summaries: false, campaign_ids: [] },
  ];
  const s = computeSummary('p1', donations);
  assert.equal(s.donation_count, 2);
  assert.equal(s.total_minor, 60000);
  assert.equal(s.first_donation_date, '2026-01-05');
  assert.equal(s.last_donation_date, '2026-03-01');
  assert.equal(s.largest_donation_minor, 50000);
  assert.equal(s.average_minor, 30000);
  assert.deepEqual(s.campaigns_supported, ['c1']);
  assert.equal(computeSummary('nobody', donations).donation_count, 0);
});

test('receipt numbers follow the configured format', () => {
  const org = { receipt_prefix: 'R', receipt_number_width: 6, receipt_number_includes_year: true };
  assert.equal(formatReceiptNumber(org, 142, 2026), 'R2026000142');
  assert.equal(formatReceiptNumber({ ...org, receipt_number_includes_year: false, receipt_number_width: 4 }, 7, 2026), 'R0007');
});

test('the template renderer escapes, loops, branches and reports missing fields', () => {
  const tpl = '{{ donor.name }}|{{#if items}}{{#each items}}[{{@index}}:{{ this.label }}]{{/each}}{{else}}none{{/if}}|{{ missing | default("n/a") }}';
  const a = render(tpl, { donor: { name: '<b>Jane</b>' }, items: [{ label: 'x' }, { label: 'y' }] });
  assert.equal(a.html, '&lt;b&gt;Jane&lt;/b&gt;|[0:x][1:y]|n/a');
  assert.ok(a.warnings.some((w) => w.code === 'MISSING_MERGE_FIELD' && w.field === 'missing'));

  const b = render(tpl, { donor: { name: 'Jane' }, items: [] });
  assert.equal(b.html, 'Jane|none|n/a');
  assert.equal(htmlToText('<p>Hello</p><p>World</p>'), 'Hello\nWorld');
});

test('dates and plurals are formatted in one place', () => {
  assert.equal(formatDateLong('2026-08-27'), 'August 27, 2026');
  assert.equal(formatDateLong(null), null);
  assert.equal(plural(1, 'donor'), '1 donor');
  assert.equal(plural(0, 'donation'), '0 donations');
});
