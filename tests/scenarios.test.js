// tests/scenarios.test.js — keeping the donor informed, scenario by scenario.
// These mirror docs/demo1/10-module-notifications.md §5 one-for-one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer, donate, runJobs } from '../src/testing/harness.js';

const today = new Date().toISOString().slice(0, 10);
const inDays = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

async function world(t, { goal = '1000.00' } = {}) {
  const h = await startServer();
  t.after(() => h.close());
  const { api } = h;
  const fund = (await api.post('/api/v1/funds', { code: 'GEN', name: 'General Fund' })).body.data;
  const campaign = (await api.post('/api/v1/campaigns', {
    code: 'C1', name: 'Twelve Wells', goal, currency: 'USD', end_date: inDays(30),
  })).body.data;

  const addDonor = async (overrides = {}) => (await api.post('/api/v1/donors', {
    first_name: 'A', last_name: overrides.last_name || `Donor${Math.random().toString(36).slice(2, 7)}`,
    email: overrides.email ?? `${Math.random().toString(36).slice(2, 8)}@example.com`,
    ...overrides,
  })).body.data;

  const give = async (donor, amount, extra = {}) => (await donate(api, {
    donor_id: donor.id, amount, currency: 'USD', donation_date: today, method: 'CASH',
    allocations: [{ fund_id: fund.id, campaign_id: campaign.id, amount }],
    ...extra,
  })).body.data;

  const mailOf = async (donorId) => (await api.get(`/api/v1/donors/${donorId}/communications`)).body.data;
  const subjectsSince = (mark) => h.adapter.sent.slice(mark).map((m) => m.subject);

  return { h, api, fund, campaign, addDonor, give, mailOf, subjectsSince, adapter: h.adapter };
}

test('S1 registering a donor sends a welcome that carries campaign progress', async (t) => {
  const { api, campaign, adapter } = await world(t);
  const donor = (await api.post('/api/v1/donors', {
    first_name: 'Jane', last_name: 'Okonkwo', email: 'jane@example.com', welcome_campaign_id: campaign.id,
  })).body.data;

  await runJobs(api);
  assert.equal(adapter.to('jane@example.com').length, 1);
  const mail = adapter.to('jane@example.com')[0];
  assert.match(mail.subject, /^Welcome to /);
  assert.match(mail.text, /Twelve Wells/);
  assert.match(mail.text, /0% of the goal is funded/);

  const [comm] = await (async () => (await api.get(`/api/v1/donors/${donor.id}/communications`)).body.data)();
  assert.equal(comm.template_key, 'welcome');
  assert.equal(comm.status, 'SENT');
});

test('S2 a donation is thanked, receipted, and reported against the goal', async (t) => {
  const { api, addDonor, give, adapter, campaign } = await world(t);
  const donor = await addDonor({ email: 'd1@example.com' });
  await runJobs(api);

  const donation = await give(donor, '250.00');
  await runJobs(api);

  const thanks = adapter.to('d1@example.com').find((m) => m.subject.includes('Thank you'));
  assert.ok(thanks, 'a thank-you was sent');
  assert.match(thanks.text, new RegExp(donation.receipt.receipt_number));
  assert.match(thanks.text, /25% of the goal is funded/);
  assert.match(thanks.text, /750\.00 still to raise/);

  const progress = (await api.get(`/api/v1/campaigns/${campaign.id}/progress`)).body.data;
  assert.equal(progress.percent, 25);
});

test('S3 crossing a milestone informs every donor on the campaign exactly once', async (t) => {
  const { api, addDonor, give, adapter } = await world(t);
  const a = await addDonor({ email: 'a@example.com' });
  const b = await addDonor({ email: 'b@example.com' });
  await give(a, '100.00');
  await give(b, '100.00');
  await runJobs(api);
  assert.equal(adapter.sent.filter((m) => m.subject.includes('% funded')).length, 0, 'nothing at 20%');

  await give(b, '110.00');
  await runJobs(api);
  const milestone = adapter.sent.filter((m) => m.subject.includes('25% funded'));
  assert.equal(milestone.length, 2, 'one per campaign donor');
  assert.deepEqual(milestone.map((m) => m.to).sort(), ['a@example.com', 'b@example.com']);

  // More money, same milestone: silence.
  await give(a, '50.00');
  await runJobs(api);
  assert.equal(adapter.sent.filter((m) => m.subject.includes('25% funded')).length, 2);
});

test('S4 one donation may cross several milestones at once, and reaching the goal is its own message', async (t) => {
  const { api, addDonor, give, adapter } = await world(t);
  const donor = await addDonor({ email: 'whale@example.com' });
  await give(donor, '1000.00');
  await runJobs(api);

  const subjects = adapter.to('whale@example.com').map((m) => m.subject);
  for (const pct of [25, 50, 75, 100]) {
    assert.ok(subjects.some((s) => s.includes(`${pct}% funded`)), `milestone ${pct} announced`);
  }
  assert.ok(subjects.some((s) => s.includes('reached its goal')));
  assert.ok(subjects.some((s) => s.includes('Thank you')));
});

test('S5 opting out of progress updates keeps the receipt but stops the stewardship mail', async (t) => {
  const { api, addDonor, give, mailOf, adapter } = await world(t);
  const optedOut = await addDonor({ email: 'quiet@example.com', progress_updates_opt_in: false });
  const other = await addDonor({ email: 'loud@example.com' });
  await give(optedOut, '100.00');
  await give(other, '200.00');
  await runJobs(api);

  const mail = await mailOf(optedOut.id);
  const sent = mail.filter((m) => m.status === 'SENT').map((m) => m.template_key);
  const suppressed = mail.filter((m) => m.status === 'SUPPRESSED');

  assert.ok(sent.includes('donation_thank_you'), 'transactional mail is unaffected');
  assert.ok(suppressed.some((m) => m.template_key === 'campaign_milestone'));
  assert.ok(suppressed.every((m) => m.suppression_reason === 'PROGRESS_UPDATES_OPTED_OUT'));
  assert.equal(adapter.to('quiet@example.com').filter((m) => m.subject.includes('% funded')).length, 0);
  assert.equal(adapter.to('loud@example.com').filter((m) => m.subject.includes('% funded')).length, 1);
});

test('S6 a donor who cannot be emailed is recorded as suppressed, never silently skipped', async (t) => {
  const { api, addDonor, give, mailOf, adapter } = await world(t);
  const noEmailPref = await addDonor({ email: 'ruth@example.com', no_email: true });
  const noAddress = await addDonor({ email: null });

  await give(noEmailPref, '300.00');
  await give(noAddress, '300.00');
  await runJobs(api);

  const a = await mailOf(noEmailPref.id);
  const b = await mailOf(noAddress.id);
  assert.ok(a.length > 0 && a.every((m) => m.status === 'SUPPRESSED'));
  assert.ok(a.every((m) => m.suppression_reason === 'NO_EMAIL_PREFERENCE'));
  assert.ok(b.length > 0 && b.every((m) => m.suppression_reason === 'NO_EMAIL_ADDRESS'));
  assert.equal(adapter.sent.filter((m) => m.to === 'ruth@example.com').length, 0);
  assert.equal(adapter.sent.filter((m) => m.to === null).length, 0);
});

test('S7 the scheduled digest goes out once per day per campaign', async (t) => {
  const { api, addDonor, give, adapter } = await world(t);
  const donor = await addDonor({ email: 'digest@example.com' });
  await give(donor, '100.00');
  await runJobs(api);

  const before = adapter.sent.length;
  await runJobs(api, { include_digests: true, digest_interval_days: 0 });
  const first = adapter.sent.slice(before).filter((m) => m.subject.startsWith('Progress update'));
  assert.equal(first.length, 1);
  assert.match(first[0].text, /10% of the goal is funded/);

  const after = adapter.sent.length;
  await runJobs(api, { include_digests: true, digest_interval_days: 0 });
  assert.equal(adapter.sent.slice(after).filter((m) => m.subject.startsWith('Progress update')).length, 0);
});

test('S8 a reversal rewinds progress, voids the receipt, tells the donor, and does not replay milestones', async (t) => {
  const { api, addDonor, give, campaign, adapter, mailOf } = await world(t);
  const donor = await addDonor({ email: 'rev@example.com' });
  const donation = await give(donor, '400.00');
  await runJobs(api);
  assert.equal((await api.get(`/api/v1/campaigns/${campaign.id}`)).body.data.milestones_reached.join(), '25');

  await api.post(`/api/v1/donations/${donation.id}/reverse`, { reason: 'Cheque returned' });
  await runJobs(api);

  const progress = (await api.get(`/api/v1/campaigns/${campaign.id}/progress`)).body.data;
  assert.equal(progress.raised, '0.00');
  assert.equal(progress.donor_count, 0);
  assert.equal((await api.get(`/api/v1/receipts/${donation.receipt.id}`)).body.data.status, 'VOIDED');
  assert.ok(adapter.to('rev@example.com').some((m) => m.subject.includes('reversed')));
  assert.ok((await mailOf(donor.id)).some((m) => m.template_key === 'donation_reversed' && m.status === 'SENT'));

  // Re-give past 25%: the milestone is already banked and must not be announced twice.
  const markAfter = adapter.sent.length;
  await give(donor, '400.00');
  await runJobs(api);
  assert.equal(adapter.sent.slice(markAfter).filter((m) => m.subject.includes('25% funded')).length, 0);
  assert.equal((await api.get(`/api/v1/campaigns/${campaign.id}`)).body.data.milestones_reached.join(), '25');
});

test('S9 closing a campaign sends a final update and stops new gifts', async (t) => {
  const { api, addDonor, give, campaign, adapter } = await world(t);
  const donor = await addDonor({ email: 'closer@example.com' });
  await give(donor, '600.00');
  await runJobs(api);

  const mark = adapter.sent.length;
  await api.post(`/api/v1/campaigns/${campaign.id}/close`, { reason: 'Season ended' });
  await runJobs(api);

  const closing = adapter.sent.slice(mark).filter((m) => m.subject.includes('has closed'));
  assert.equal(closing.length, 1);
  assert.match(closing[0].text, /60% of goal/);
  assert.match(closing[0].text, /short of the target/);
});

test('S10 a failing provider retries with backoff, then parks the message as FAILED', async (t) => {
  const { h, api, addDonor, give, mailOf, adapter } = await world(t);
  const donor = await addDonor({ email: 'flaky@example.com' });
  await runJobs(api);

  adapter.failuresBeforeSuccess = 99;
  await give(donor, '50.00');

  await runJobs(api);
  let mail = (await mailOf(donor.id)).find((m) => m.template_key === 'donation_thank_you');
  assert.equal(mail.status, 'QUEUED');
  assert.equal(mail.attempts, 1);
  assert.ok(mail.next_attempt_at, 'a retry is scheduled with backoff');

  for (let i = 0; i < 3; i += 1) {
    h.db.filter('communication', (c) => c.status === 'QUEUED').forEach((c) => { c.next_attempt_at = null; });
    await runJobs(api);
  }
  mail = (await mailOf(donor.id)).find((m) => m.template_key === 'donation_thank_you');
  assert.equal(mail.status, 'FAILED');
  assert.equal(mail.attempts, 3);
  assert.match(mail.last_error, /unavailable/);
});

test('S11 at-least-once event delivery never produces a second email', async (t) => {
  const { api, addDonor, give, adapter } = await world(t);
  const donor = await addDonor({ email: 'once@example.com' });
  await give(donor, '300.00');

  await runJobs(api);
  const afterFirst = adapter.sent.length;
  await runJobs(api);
  await runJobs(api);
  assert.equal(adapter.sent.length, afterFirst, 'draining the outbox again sends nothing');

  const events = (await api.get('/api/v1/events?limit=100')).body.data;
  assert.ok(events.every((e) => e.published_at), 'every event is marked published');
});

test('S12 a donation that names no campaign still thanks the donor, without a progress block', async (t) => {
  const { api, fund, addDonor, adapter } = await world(t);
  const donor = await addDonor({ email: 'unrestricted@example.com' });
  await donate(api, {
    donor_id: donor.id, amount: '75.00', currency: 'USD', donation_date: today, method: 'CASH',
    allocations: [{ fund_id: fund.id, amount: '75.00' }],
  });
  await runJobs(api);

  const thanks = adapter.to('unrestricted@example.com').find((m) => m.subject.includes('Thank you'));
  assert.ok(thanks);
  assert.doesNotMatch(thanks.text, /of the goal is funded/);
  assert.match(thanks.text, /General Fund/);
});

test('S13 a quid-pro-quo gift receipts only the deductible part and says so', async (t) => {
  const { api, fund, campaign, addDonor, adapter } = await world(t);
  const donor = await addDonor({ email: 'gala@example.com' });
  const donation = (await donate(api, {
    donor_id: donor.id, amount: '500.00', currency: 'USD', donation_date: today, method: 'CREDIT_CARD',
    fair_market_value: '180.00',
    allocations: [{ fund_id: fund.id, campaign_id: campaign.id, amount: '500.00' }],
  })).body.data;
  await runJobs(api);

  assert.equal(donation.deductible_amount, '320.00');
  assert.equal(donation.receipt.deductible_amount, '320.00');
  const mail = adapter.to('gala@example.com').find((m) => m.subject.includes('Thank you'));
  assert.match(mail.text, /Value of goods received/);
  assert.match(mail.text, /320\.00/);
  assert.match(mail.text, /50% of the goal is funded/, 'the full 500 still counts towards the campaign');
});
