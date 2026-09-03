// seed.js — the demo dataset, built through the API rather than injected into the store.
//
// Every row here is created by the same endpoints a client would call, so the seeded world
// obeys every rule: allocations sum exactly, receipts are numbered in sequence, the
// reversal voids its receipt, and the emails are the ones the outbox actually produced.
const dayOffset = (days) => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
};

const PEOPLE = [
  ['Jane', 'Okonkwo', {}],
  ['Marcus', 'Bell', {}],
  ['Priya', 'Raman', {}],
  ['Sam', 'Whitfield', { no_email: true }],
  ['Ada', 'Fenwick', { progress_updates_opt_in: false }],
  ['Ruth', 'Calder', {}],
  ['Tomas', 'Lindqvist', {}],
  ['Nadia', 'Haddad', {}],
];

// [days ago, donor index, amount, method] — spread across a year and every size band.
const GIFTS = [
  [355, 0, 40, 'CHECK'], [350, 1, 250, 'CREDIT_CARD'], [345, 2, 25, 'CASH'],
  [320, 3, 1200, 'BANK_TRANSFER'], [318, 0, 75, 'CREDIT_CARD'], [300, 4, 500, 'CHECK'],
  [290, 5, 60, 'CASH'], [285, 1, 5000, 'BANK_TRANSFER'], [270, 6, 120, 'CREDIT_CARD'],
  [255, 2, 45, 'CASH'], [240, 7, 800, 'CHECK'], [232, 3, 150, 'CREDIT_CARD'],
  [225, 0, 2500, 'BANK_TRANSFER'], [210, 4, 35, 'CASH'], [195, 5, 95, 'CREDIT_CARD'],
  [180, 6, 640, 'CHECK'], [172, 1, 110, 'CREDIT_CARD'], [160, 2, 7500, 'BANK_TRANSFER'],
  [150, 7, 55, 'CASH'], [140, 3, 300, 'CHECK'], [128, 0, 480, 'CREDIT_CARD'],
  [115, 4, 1500, 'BANK_TRANSFER'], [100, 5, 70, 'CASH'], [95, 6, 220, 'CREDIT_CARD'],
  [82, 1, 3200, 'CHECK'], [70, 2, 90, 'CREDIT_CARD'], [60, 7, 130, 'CASH'],
  [48, 3, 950, 'CHECK'], [40, 0, 260, 'CREDIT_CARD'], [30, 4, 6400, 'BANK_TRANSFER'],
  [22, 5, 45, 'CASH'], [15, 6, 175, 'CREDIT_CARD'], [9, 1, 520, 'CHECK'],
  [5, 2, 85, 'CREDIT_CARD'], [2, 7, 1100, 'BANK_TRANSFER'],
];

export async function seedDemo(apiKey) {
  const call = async (method, path, body, extra = {}) => {
    const response = await fetch(`/api/v1${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}`, ...extra },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(`${method} ${path} → ${response.status} ${payload.detail || ''}`);
    return payload.data;
  };
  const post = (path, body, extra) => call('POST', path, body, extra);
  const amount = (major) => `${major}.00`;

  const water = await post('/funds', { code: 'WATER', name: 'Clean Water Fund' });
  const general = await post('/funds', { code: 'GEN', name: 'General Fund' });

  const wells = await post('/campaigns', { code: 'WELL26', name: 'Twelve Wells by Spring', goal: '50000.00', currency: 'USD', end_date: dayOffset(-60) });
  const warmth = await post('/campaigns', { code: 'WARM26', name: 'Winter Warmth Appeal', goal: '10000.00', currency: 'USD', end_date: dayOffset(-90) });
  const school = await post('/campaigns', { code: 'SCHL26', name: 'Riverbank School Books', goal: '8000.00', currency: 'USD', end_date: dayOffset(-120) });

  const donors = [];
  for (const [first, last, preferences] of PEOPLE) {
    donors.push(await post('/donors', {
      first_name: first,
      last_name: last,
      email: `${first}.${last}@example.com`.toLowerCase(),
      welcome_campaign_id: wells.id,
      ...preferences,
    }));
  }

  const campaigns = [wells, wells, warmth, wells, school, wells, warmth, school];
  const recorded = [];
  for (const [daysAgo, who, major, method] of GIFTS) {
    const campaign = campaigns[(recorded.length + who) % campaigns.length];
    const fund = campaign.id === wells.id ? water : general;
    recorded.push(await post('/donations', {
      donor_id: donors[who].id,
      amount: amount(major),
      currency: 'USD',
      donation_date: dayOffset(daysAgo),
      method,
      allocations: [{ fund_id: fund.id, campaign_id: campaign.id, amount: amount(major) }],
    }, { 'Idempotency-Key': crypto.randomUUID() }));
  }

  // One correction and one closure, so REVERSED and CLOSED are visible in the demo.
  await post(`/donations/${recorded[6].id}/reverse`, { reason: 'Cheque returned unpaid' });
  await post(`/campaigns/${school.id}/close`, { reason: 'The books are bought.' });
  await post(`/campaigns/${warmth.id}/send-update`, {});
  await post('/jobs/run', { include_digests: true, digest_interval_days: 7 });

  return { donors: donors.length, donations: recorded.length };
}
