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

// Pastors Discipleship Network's appeals. `endsIn` is days from today; a negative value
// is a date already past, which is how the completed run gets a sensible end date.
const CAMPAIGNS = [
  { code: 'ATW26', name: 'Africa to the World', goal: '20000.00', endsIn: 150, fund: 'GEN' },
  { code: 'ALS26', name: 'Africa Leadership Summit', goal: '25000.00', endsIn: 75, fund: 'TRAIN' },
  { code: 'ROOT26', name: 'Rooted in the Word', goal: '8000.00', endsIn: 200, fund: 'TRAIN' },
  { code: 'IPM26', name: 'Interim Pastoral Ministry', goal: '9000.00', endsIn: 120, fund: 'TRAIN' },
  { code: 'YELT26', name: 'Youth & Emerging Leaders Training', goal: '7500.00', endsIn: 95, fund: 'TRAIN' },
  { code: 'RAU26', name: 'Run Across Uganda', goal: '6000.00', endsIn: -10, fund: 'GEN' },
];

// Which appeal each gift lands on, weighted so the flagship appeals carry the most.
const ALLOCATION_ORDER = [
  'ATW26', 'ALS26', 'ATW26', 'ROOT26', 'ALS26', 'IPM26',
  'ATW26', 'YELT26', 'ALS26', 'RAU26', 'ROOT26', 'ATW26',
];

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

/**
 * @param apiKey  the organisation's key
 * @param origin  '' in the browser (same page); an http://host:port for `npm run seed`,
 *                so the console and the local server are seeded from one definition.
 */
export async function seedDemo(apiKey, origin = '') {
  const call = async (method, path, body, extra = {}) => {
    const response = await fetch(`${origin}/api/v1${path}`, {
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

  const funds = {
    GEN: await post('/funds', { code: 'GEN', name: 'General Fund' }),
    TRAIN: await post('/funds', { code: 'TRAIN', name: 'Training & Discipleship Fund' }),
  };

  const campaigns = {};
  for (const entry of CAMPAIGNS) {
    campaigns[entry.code] = await post('/campaigns', {
      code: entry.code, name: entry.name, goal: entry.goal,
      currency: 'USD', end_date: dayOffset(-entry.endsIn),
    });
  }
  const fundFor = (code) => funds[CAMPAIGNS.find((c) => c.code === code).fund];

  const donors = [];
  for (const [first, last, preferences] of PEOPLE) {
    donors.push(await post('/donors', {
      first_name: first,
      last_name: last,
      email: `${first}.${last}@example.com`.toLowerCase(),
      welcome_campaign_id: campaigns.ATW26.id,
      ...preferences,
    }));
  }

  const recorded = [];
  for (const [daysAgo, who, major, method] of GIFTS) {
    const code = ALLOCATION_ORDER[(recorded.length + who) % ALLOCATION_ORDER.length];
    const campaign = campaigns[code];
    const fund = fundFor(code);
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
  await post(`/campaigns/${campaigns.RAU26.id}/close`, { reason: 'The run is finished — thank you for every mile.' });
  await post(`/campaigns/${campaigns.ALS26.id}/send-update`, {});
  await post('/jobs/run', { include_digests: true, digest_interval_days: 7 });

  return { donors: donors.length, donations: recorded.length };
}
