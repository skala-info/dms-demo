// tests/api.test.js — the HTTP contract: auth, envelopes, problem+json, pagination,
// idempotency, optimistic concurrency.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer, donate } from '../src/testing/harness.js';

const today = new Date().toISOString().slice(0, 10);

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

test('health needs no credential; everything else does', async (t) => {
  const h = await startServer();
  t.after(() => h.close());
  assert.equal((await h.api.get('/health', { auth: false })).status, 200);

  const noAuth = await h.api.get('/api/v1/donors', { auth: false });
  assert.equal(noAuth.status, 401);
  assert.equal(noAuth.body.code, 'UNAUTHENTICATED');
  assert.equal(noAuth.headers['content-type'], 'application/problem+json; charset=utf-8');

  const wrongKey = await h.api.get('/api/v1/donors', { auth: false, headers: { Authorization: 'Bearer nope' } });
  assert.equal(wrongKey.status, 401);
  await h.close();
});

test('a created donor comes back in an envelope with a request id and an ETag', async (t) => {
  const { h, api } = await fixture(t);
  const res = await api.post('/api/v1/donors', { first_name: 'Marcus', last_name: 'Bell', email: 'marcus@example.com' });
  assert.equal(res.status, 201);
  assert.equal(res.body.data.type, 'donor');
  assert.equal(res.body.data.display_name, 'Bell, Marcus');
  assert.ok(res.body.meta.request_id);
  assert.equal(res.headers.etag, '"1"');
  assert.ok(res.headers.location.startsWith('/api/v1/donors/'));
  await h.close();
});

test('validation returns every error at once, not just the first', async (t) => {
  const { h, api } = await fixture(t);
  const res = await api.post('/api/v1/donors', { type: 'INDIVIDUAL', email: 'not-an-email', no_email: 'yes' });
  assert.equal(res.status, 422);
  assert.equal(res.body.code, 'VALIDATION_ERROR');
  const fields = res.body.errors.map((e) => e.field).sort();
  assert.deepEqual(fields, ['email', 'last_name', 'no_email']);
  await h.close();
});

test('a duplicate email is a 409 with candidates, and can be overridden', async (t) => {
  const { h, api } = await fixture(t);
  const dup = await api.post('/api/v1/donors', { first_name: 'Jane', last_name: 'Okonkwo', email: 'jane@example.com' });
  assert.equal(dup.status, 409);
  assert.equal(dup.body.code, 'DUPLICATE_SUSPECTED');
  assert.equal(dup.body.duplicate_candidates.length, 1);

  const forced = await api.post('/api/v1/donors?allow_duplicate=true', { first_name: 'Jane', last_name: 'Okonkwo', email: 'jane@example.com' });
  assert.equal(forced.status, 201);
  await h.close();
});

test('donations require an Idempotency-Key and replay on retry', async (t) => {
  const { h, api, fund, campaign, donor } = await fixture(t);
  const payload = {
    donor_id: donor.id, amount: '100.00', currency: 'USD', donation_date: today, method: 'CASH',
    allocations: [{ fund_id: fund.id, campaign_id: campaign.id, amount: '100.00' }],
  };

  const missing = await api.post('/api/v1/donations', payload);
  assert.equal(missing.status, 400);
  assert.equal(missing.body.code, 'IDEMPOTENCY_KEY_REQUIRED');

  const key = crypto.randomUUID();
  const first = await donate(api, payload, key);
  assert.equal(first.status, 201);
  assert.equal(first.body.data.receipt.receipt_number, 'R' + new Date().getUTCFullYear() + '000001');

  const retry = await donate(api, payload, key);
  assert.equal(retry.headers['idempotency-replayed'], 'true');
  assert.equal(retry.body.data.id, first.body.data.id);

  const receipts = await api.get('/api/v1/receipts');
  assert.equal(receipts.body.meta.total, 1, 'a replay must not issue a second receipt');
  await h.close();
});

test('optimistic concurrency: a stale If-Match is a 409', async (t) => {
  const { h, api, donor } = await fixture(t);
  const ok = await api.patch(`/api/v1/donors/${donor.id}`, { nickname: 'Janey' }, { headers: { 'If-Match': '"1"' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.data.version, 2);

  const stale = await api.patch(`/api/v1/donors/${donor.id}`, { nickname: 'J' }, { headers: { 'If-Match': '"1"' } });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code, 'VERSION_MISMATCH');
  assert.equal(stale.body.current_version, 2);
  await h.close();
});

test('unknown fields on PATCH are rejected rather than silently ignored', async (t) => {
  const { h, api, donor } = await fixture(t);
  const res = await api.patch(`/api/v1/donors/${donor.id}`, { total_amount: '999.00' });
  assert.equal(res.status, 422);
  assert.equal(res.body.errors[0].code, 'UNKNOWN_FIELD');
  await h.close();
});

test('cursor pagination walks the whole collection exactly once', async (t) => {
  const { h, api } = await fixture(t);
  for (let i = 0; i < 7; i += 1) {
    await api.post('/api/v1/donors', { first_name: 'D', last_name: `Donor${i}`, email: `d${i}@example.com` });
  }
  const seen = [];
  let path = '/api/v1/donors?limit=3';
  while (path) {
    const page = await api.get(path);
    assert.ok(page.body.data.length <= 3);
    seen.push(...page.body.data.map((d) => d.id));
    path = page.body.links.next;
  }
  assert.equal(seen.length, 8);
  assert.equal(new Set(seen).size, 8);

  const bad = await api.get('/api/v1/donors?cursor=not-a-cursor');
  assert.equal(bad.status, 400);
  assert.equal(bad.body.code, 'INVALID_CURSOR');
  await h.close();
});

test('cross-tenant and unknown ids are 404, never 403', async (t) => {
  const { h, api } = await fixture(t);
  const res = await api.get(`/api/v1/donors/${crypto.randomUUID()}`);
  assert.equal(res.status, 404);
  assert.equal(res.body.code, 'NOT_FOUND');
  await h.close();
});

test('money crosses the wire as a decimal string with a currency', async (t) => {
  const { h, api, fund, campaign, donor } = await fixture(t);
  const res = await donate(api, {
    donor_id: donor.id, amount: '1000.00', currency: 'USD', donation_date: today, method: 'CHECK',
    fair_market_value: '180.00',
    allocations: [{ fund_id: fund.id, campaign_id: campaign.id, percent: 60 }, { fund_id: fund.id, percent: 40 }],
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.data.amount, '1000.00');
  assert.equal(res.body.data.deductible_amount, '820.00');
  assert.deepEqual(res.body.data.allocations.map((a) => a.amount), ['600.00', '400.00']);
  assert.equal(res.body.data.receipt.deductible_amount, '820.00');

  const progress = await api.get(`/api/v1/campaigns/${campaign.id}/progress`);
  assert.equal(progress.body.data.raised, '600.00', 'only the allocation coded to the campaign counts');
  assert.equal(progress.body.data.percent, 60);
  await h.close();
});

test('allocations that do not sum to the amount are rejected', async (t) => {
  const { h, api, fund, donor } = await fixture(t);
  const res = await donate(api, {
    donor_id: donor.id, amount: '100.00', currency: 'USD', donation_date: today, method: 'CASH',
    allocations: [{ fund_id: fund.id, amount: '60.00' }],
  });
  assert.equal(res.status, 422);
  assert.equal(res.body.code, 'ALLOCATION_SUM_MISMATCH');
  await h.close();
});

test('a future-dated donation is rejected', async (t) => {
  const { h, api, fund, donor } = await fixture(t);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const res = await donate(api, {
    donor_id: donor.id, amount: '10.00', currency: 'USD', donation_date: tomorrow, method: 'CASH',
    allocations: [{ fund_id: fund.id, amount: '10.00' }],
  });
  assert.equal(res.status, 422);
  assert.equal(res.body.errors[0].code, 'DATE_IN_FUTURE');
  await h.close();
});

test('the giving summary is derived and updated by posting', async (t) => {
  const { h, api, fund, campaign, donor } = await fixture(t);
  const empty = await api.get(`/api/v1/donors/${donor.id}/summary`);
  assert.equal(empty.body.data.donation_count, 0);
  assert.equal(empty.body.data.total_amount, '0.00');

  for (const amount of ['100.00', '250.00']) {
    await donate(api, {
      donor_id: donor.id, amount, currency: 'USD', donation_date: today, method: 'CASH',
      allocations: [{ fund_id: fund.id, campaign_id: campaign.id, amount }],
    });
  }
  const summary = (await api.get(`/api/v1/donors/${donor.id}/summary`)).body.data;
  assert.equal(summary.donation_count, 2);
  assert.equal(summary.total_amount, '350.00');
  assert.equal(summary.largest_donation.amount, '250.00');
  assert.deepEqual(summary.campaigns_supported, [campaign.id]);
  await h.close();
});

test('reversal voids the receipt and rewinds the summary and the campaign', async (t) => {
  const { h, api, fund, campaign, donor } = await fixture(t);
  const donation = (await donate(api, {
    donor_id: donor.id, amount: '400.00', currency: 'USD', donation_date: today, method: 'CHECK',
    allocations: [{ fund_id: fund.id, campaign_id: campaign.id, amount: '400.00' }],
  })).body.data;

  const res = await api.post(`/api/v1/donations/${donation.id}/reverse`, { reason: 'Cheque returned' });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.status, 'REVERSED');

  const receipt = (await api.get(`/api/v1/receipts/${donation.receipt.id}`)).body.data;
  assert.equal(receipt.status, 'VOIDED');
  assert.match(receipt.void_reason, /Cheque returned/);

  assert.equal((await api.get(`/api/v1/campaigns/${campaign.id}/progress`)).body.data.raised, '0.00');
  assert.equal((await api.get(`/api/v1/donors/${donor.id}/summary`)).body.data.donation_count, 0);

  const again = await api.post(`/api/v1/donations/${donation.id}/reverse`, {});
  assert.equal(again.status, 409);
  assert.equal(again.body.code, 'INVALID_STATE_TRANSITION');
  await h.close();
});

test('a closed campaign takes no new donations', async (t) => {
  const { h, api, fund, campaign, donor } = await fixture(t);
  assert.equal((await api.post(`/api/v1/campaigns/${campaign.id}/close`, {})).status, 200);
  const res = await donate(api, {
    donor_id: donor.id, amount: '10.00', currency: 'USD', donation_date: today, method: 'CASH',
    allocations: [{ fund_id: fund.id, campaign_id: campaign.id, amount: '10.00' }],
  });
  assert.equal(res.status, 422);
  assert.equal(res.body.errors[0].code, 'CAMPAIGN_CLOSED');
  await h.close();
});

// Two entries can share a millisecond — a create and an update in one quick request, or a
// pair of writes in one transaction. When they do, the timestamp alone cannot order them,
// and this endpoint used to fall back to insertion order, which is oldest-first. Forced
// here rather than raced for, so it fails every time instead of one run in five.
test('audit entries sharing a timestamp still come back newest first', async (t) => {
  const h = await startServer();
  t.after(() => h.close());

  const sameInstant = '2026-06-01T12:00:00.000Z';
  for (const [id, operation] of [['a', 'CREATE'], ['b', 'UPDATE'], ['c', 'DELETE']]) {
    h.db.insert('audit_entry', {
      id,
      organization_id: h.org.id,
      actor: 'tester',
      entity_type: 'donor',
      entity_id: 'same-entity',
      operation,
      changes: {},
      context: null,
      occurred_at: sameInstant,
    });
  }

  const entries = (await h.api.get('/api/v1/audit-entries?entity_id=same-entity')).body.data;
  assert.deepEqual(entries.map((e) => e.operation), ['DELETE', 'UPDATE', 'CREATE']);
});

test('every mutation leaves an audit entry', async (t) => {
  const { h, api, donor } = await fixture(t);
  const entries = (await api.get(`/api/v1/audit-entries?entity_id=${donor.id}`)).body.data;
  assert.equal(entries.length, 1);
  assert.equal(entries[0].operation, 'CREATE');

  await api.patch(`/api/v1/donors/${donor.id}`, { nickname: 'Janey' });
  const after = (await api.get(`/api/v1/audit-entries?entity_id=${donor.id}`)).body.data;
  assert.equal(after.length, 2);
  assert.deepEqual(after[0].changes.nickname, { before: null, after: 'Janey' });
  await h.close();
});
