// tests/stats.test.js — the numbers behind the charts.
//
// A chart looks convincing whatever it is drawn from, so the arithmetic is tested here
// rather than trusted to the page that draws it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer, donate, runJobs } from '../src/testing/harness.js';
import * as stats from '../src/domain/stats.js';

const today = new Date().toISOString().slice(0, 10);

// ---------------------------------------------------------------- domain

test('monthSpan covers every month inclusive, across a year boundary', () => {
  assert.deepEqual(stats.monthSpan('2025-11', '2026-02'), ['2025-11', '2025-12', '2026-01', '2026-02']);
  assert.deepEqual(stats.monthSpan('2026-03', '2026-03'), ['2026-03']);
  assert.deepEqual(stats.monthSpan('2026-05', '2026-04'), []);
});

test('givingByMonth plots empty months as zero and carries a running total', () => {
  const span = stats.monthSpan('2026-01', '2026-03');
  const rows = stats.givingByMonth([
    { donation_date: '2026-01-10', amount_minor: 10000 },
    { donation_date: '2026-03-02', amount_minor: 5000 },
    { donation_date: '2026-03-20', amount_minor: 2500 },
  ], span);

  assert.deepEqual(rows.map((r) => r.month), ['2026-01', '2026-02', '2026-03']);
  assert.deepEqual(rows.map((r) => r.amount_minor), [10000, 0, 7500]);
  assert.deepEqual(rows.map((r) => r.count), [1, 0, 2]);
  // The cumulative line never dips just because a month was quiet.
  assert.deepEqual(rows.map((r) => r.cumulative_minor), [10000, 10000, 17500]);
});

test('a gift outside the span is not silently folded into the edge months', () => {
  const rows = stats.givingByMonth(
    [{ donation_date: '2025-12-31', amount_minor: 99900 }],
    stats.monthSpan('2026-01', '2026-02'),
  );
  assert.deepEqual(rows.map((r) => r.amount_minor), [0, 0]);
});

test('only POSTED, non-excluded gifts count — the same rule the progress bars use', () => {
  const rows = stats.counted([
    { status: 'POSTED', exclude_from_summaries: false, amount_minor: 100 },
    { status: 'REVERSED', exclude_from_summaries: false, amount_minor: 100 },
    { status: 'POSTED', exclude_from_summaries: true, amount_minor: 100 },
  ]);
  assert.equal(rows.length, 1);
});

test('size bands are scaled by the currency exponent', () => {
  const usd = stats.sizeDistribution([{ amount_minor: 25000 }], 100); // 250.00
  assert.equal(usd.find((b) => b.label === '100–499').count, 1);

  // The same 250 in a zero-exponent currency is 250 minor units, not 2.50.
  const jpy = stats.sizeDistribution([{ amount_minor: 250 }], 1);
  assert.equal(jpy.find((b) => b.label === '100–499').count, 1);
});

test('size distribution puts every gift in exactly one band', () => {
  const donations = [49, 50, 99, 100, 499, 500, 999, 1000, 4999, 5000, 100000]
    .map((major) => ({ amount_minor: major * 100 }));
  const bands = stats.sizeDistribution(donations, 100);
  assert.equal(bands.reduce((sum, b) => sum + b.count, 0), donations.length);
  assert.deepEqual(bands.map((b) => b.count), [1, 2, 2, 2, 2, 2]);
});

test('byMethod ranks by money, not by name', () => {
  const rows = stats.byMethod([
    { method: 'CASH', amount_minor: 100 },
    { method: 'CHECK', amount_minor: 900 },
    { method: 'CASH', amount_minor: 100 },
  ]);
  assert.deepEqual(rows.map((r) => r.method), ['CHECK', 'CASH']);
  assert.deepEqual(rows.map((r) => r.count), [1, 2]);
});

test('email outcomes count suppression as an outcome, with its reasons', () => {
  const result = stats.emailOutcomes([
    { status: 'SENT' }, { status: 'SENT' },
    { status: 'SUPPRESSED', suppression_reason: 'NO_EMAIL_PREFERENCE' },
    { status: 'SUPPRESSED', suppression_reason: 'NO_EMAIL_PREFERENCE' },
    { status: 'SUPPRESSED', suppression_reason: 'PROGRESS_UPDATES_OPTED_OUT' },
    { status: 'FAILED' },
  ]);
  assert.equal(result.total, 6);
  const byStatus = Object.fromEntries(result.outcomes.map((o) => [o.status, o.count]));
  assert.deepEqual(byStatus, { SENT: 2, QUEUED: 0, FAILED: 1, SUPPRESSED: 3 });
  assert.deepEqual(result.suppression_reasons[0], { reason: 'NO_EMAIL_PREFERENCE', count: 2 });
});

test('headline counts donors once however many times they give', () => {
  const h = stats.headline([
    { donor_id: 'a', amount_minor: 100 },
    { donor_id: 'a', amount_minor: 200 },
    { donor_id: 'b', amount_minor: 301 },
  ]);
  assert.equal(h.gift_count, 3);
  assert.equal(h.donor_count, 2);
  assert.equal(h.raised_minor, 601);
  assert.equal(h.average_minor, 200); // 601/3 rounded, still an integer of minor units
  assert.equal(h.largest_minor, 301);
});

// ---------------------------------------------------------------- API

async function fixture(t) {
  const h = await startServer();
  t.after(() => h.close());
  const fund = (await h.api.post('/api/v1/funds', { code: 'GEN', name: 'General Fund' })).body.data;
  const campaign = (await h.api.post('/api/v1/campaigns', {
    code: 'C1', name: 'Test Campaign', goal: '1000.00', currency: 'USD',
  })).body.data;
  const donor = (await h.api.post('/api/v1/donors', {
    first_name: 'Jane', last_name: 'Okonkwo', email: 'jane@example.com',
  })).body.data;
  return { h, api: h.api, fund, campaign, donor };
}

test('GET /api/v1/stats needs a credential', async (t) => {
  const h = await startServer();
  t.after(() => h.close());
  assert.equal((await h.api.get('/api/v1/stats', { auth: false })).status, 401);
});

test('the stats endpoint reports money as decimal strings and agrees with the donations', async (t) => {
  const { api, fund, campaign, donor } = await fixture(t);
  await donate(api, {
    donor_id: donor.id, amount: '250.00', currency: 'USD', donation_date: today, method: 'CHECK',
    allocations: [{ fund_id: fund.id, campaign_id: campaign.id, amount: '250.00' }],
  });
  await donate(api, {
    donor_id: donor.id, amount: '50.00', currency: 'USD', donation_date: today, method: 'CASH',
    allocations: [{ fund_id: fund.id, campaign_id: campaign.id, amount: '50.00' }],
  });

  const stats = (await api.get('/api/v1/stats')).body.data;
  assert.equal(stats.type, 'stats');
  assert.equal(stats.currency, 'USD');
  assert.equal(stats.lifetime.raised, '300.00');
  assert.equal(stats.lifetime.gift_count, 2);
  assert.equal(stats.lifetime.donor_count, 1);
  assert.equal(stats.lifetime.average_gift, '150.00');
  assert.equal(stats.period.raised, '300.00');

  // The current month carries both gifts, and the campaign block is the same progress
  // number the campaign endpoint serves.
  const thisMonth = stats.by_month.find((m) => m.month === today.slice(0, 7));
  assert.equal(thisMonth.amount, '300.00');
  assert.equal(thisMonth.count, 2);
  assert.equal(stats.campaigns[0].progress.raised, '300.00');

  assert.deepEqual(stats.by_method.map((m) => m.method), ['CHECK', 'CASH']);
  assert.equal(stats.top_donors[0].display_name, 'Okonkwo, Jane');
  assert.equal(stats.top_donors[0].amount, '300.00');
});

test('a reversed gift leaves the charts as well as the ledger', async (t) => {
  const { api, fund, campaign, donor } = await fixture(t);
  const donation = (await donate(api, {
    donor_id: donor.id, amount: '100.00', currency: 'USD', donation_date: today, method: 'CHECK',
    allocations: [{ fund_id: fund.id, campaign_id: campaign.id, amount: '100.00' }],
  })).body.data;

  assert.equal((await api.get('/api/v1/stats')).body.data.lifetime.raised, '100.00');
  await api.post(`/api/v1/donations/${donation.id}/reverse`, { reason: 'Cheque returned' });

  const after = (await api.get('/api/v1/stats')).body.data;
  assert.equal(after.lifetime.raised, '0.00');
  assert.equal(after.lifetime.gift_count, 0);
  assert.equal(after.by_month.at(-1).amount, '0.00');
});

test('the range narrows the period figures but not the lifetime ones', async (t) => {
  const { api, fund, campaign, donor } = await fixture(t);
  await donate(api, {
    donor_id: donor.id, amount: '40.00', currency: 'USD', donation_date: '2026-01-15', method: 'CASH',
    allocations: [{ fund_id: fund.id, campaign_id: campaign.id, amount: '40.00' }],
  });
  await donate(api, {
    donor_id: donor.id, amount: '60.00', currency: 'USD', donation_date: today, method: 'CASH',
    allocations: [{ fund_id: fund.id, campaign_id: campaign.id, amount: '60.00' }],
  });

  const scoped = (await api.get(`/api/v1/stats?from=${today}`)).body.data;
  assert.equal(scoped.period.raised, '60.00');
  assert.equal(scoped.lifetime.raised, '100.00');
  assert.equal(scoped.range.from, today);
  assert.equal(scoped.by_month.length, 1);
});

test('a malformed range is a validation error, not an empty chart', async (t) => {
  const { api } = await fixture(t);
  const bad = await api.get('/api/v1/stats?from=15-01-2026');
  assert.equal(bad.status, 422);
  assert.equal(bad.body.code, 'VALIDATION_ERROR');
  assert.equal(bad.body.errors[0].field, 'from');

  const backwards = await api.get('/api/v1/stats?from=2026-06-01&to=2026-01-01');
  assert.equal(backwards.status, 422);
});

test('email outcomes in the stats match the communications log', async (t) => {
  const { api, fund, campaign, donor } = await fixture(t);
  await donate(api, {
    donor_id: donor.id, amount: '100.00', currency: 'USD', donation_date: today, method: 'CHECK',
    allocations: [{ fund_id: fund.id, campaign_id: campaign.id, amount: '100.00' }],
  });
  await runJobs(api);

  const stats = (await api.get('/api/v1/stats')).body.data;
  const log = (await api.get('/api/v1/communications?limit=200')).body.data;
  assert.equal(stats.email.total, log.length);
  const sent = stats.email.outcomes.find((o) => o.status === 'SENT').count;
  assert.equal(sent, log.filter((c) => c.status === 'SENT').length);
});
