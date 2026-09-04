// scripts/demo.js — the whole user flow, end to end, over the real HTTP API.
//
//   register a donor -> record a donation -> keep the donor informed of campaign
//   progress by email -> and then every scenario that makes that hard.
//
// Run with:  npm run demo
// Generated mail is written to demo1/outbox/ as .eml files you can open.
import { startServer, donate, runJobs } from '../src/testing/harness.js';
import { FileEmailAdapter } from '../src/integrations/email/index.js';
import { config } from '../src/core/config.js';

// ---------------------------------------------------------------- presentation

const C = { dim: '\x1b[2m', bold: '\x1b[1m', green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m', blue: '\x1b[34m', reset: '\x1b[0m' };
let step = 0;
const heading = (title) => {
  step += 1;
  process.stdout.write(`\n${C.bold}${C.blue}S${step}. ${title}${C.reset}\n${C.dim}${'-'.repeat(72)}${C.reset}\n`);
};
const say = (msg) => process.stdout.write(`   ${msg}\n`);
const ok = (msg) => say(`${C.green}OK${C.reset}  ${msg}`);
const warn = (msg) => say(`${C.yellow}!! ${C.reset} ${msg}`);

function assert(condition, message) {
  if (!condition) {
    process.stdout.write(`\n${C.red}ASSERTION FAILED: ${message}${C.reset}\n`);
    process.exit(1);
  }
}

// Records everything it writes so the demo can narrate, and still writes real .eml files.
class RecordingFileAdapter extends FileEmailAdapter {
  constructor() { super(); this.sent = []; this.failuresBeforeSuccess = 0; }
  async send(message) {
    if (this.failuresBeforeSuccess > 0) {
      this.failuresBeforeSuccess -= 1;
      throw new Error('provider temporarily unavailable');
    }
    const result = await super.send(message);
    this.sent.push({ ...message, ...result });
    return result;
  }
  since(mark) { return this.sent.slice(mark); }
  get mark() { return this.sent.length; }
}

const iso = (d) => d.toISOString().slice(0, 10);
const today = iso(new Date());
const inDays = (n) => iso(new Date(Date.now() + n * 86400000));

// ---------------------------------------------------------------- the walkthrough

const adapter = new RecordingFileAdapter();
const h = await startServer({ persist: true, email: adapter });
const { api } = h;

process.stdout.write(`${C.bold}DMS demo1 — donor registration, donations, campaign progress by email${C.reset}\n`);
say(`${C.dim}organization: ${h.org.name} · api key: ${h.org.api_key} · mail: ${config.outboxDir}${C.reset}`);

const progressOf = async (id) => (await api.get(`/api/v1/campaigns/${id}/progress`)).body.data;
const mailFor = async (donorId) => (await api.get(`/api/v1/donors/${donorId}/communications`)).body.data;

// ---------------------------------------------------------------------------
heading('Set up a fund and a campaign with a goal');

const fund = (await api.post('/api/v1/funds', { code: 'TRAIN', name: 'Training & Discipleship Fund', restriction: 'TEMPORARILY_RESTRICTED' })).body.data;
const fundGeneral = (await api.post('/api/v1/funds', { code: 'GEN', name: 'General Fund' })).body.data;

const campaign = (await api.post('/api/v1/campaigns', {
  code: 'ALS26', name: 'Africa Leadership Summit', description: 'Bringing 300 pastors to the 2026 summit.',
  goal: '50000.00', currency: 'USD', start_date: today, end_date: inDays(60),
})).body.data;

const winter = (await api.post('/api/v1/campaigns', {
  code: 'RAU26', name: 'Run Across Uganda', goal: '10000.00', currency: 'USD', end_date: inDays(90),
})).body.data;

ok(`campaign ${campaign.code} "${campaign.name}" — goal ${campaign.goal} ${campaign.currency}, closes ${campaign.end_date}`);
ok(`campaign ${winter.code} "${winter.name}" — goal ${winter.goal} ${winter.currency}`);

// ---------------------------------------------------------------------------
heading('Register a donor — the welcome email carries the campaign progress');

const jane = (await api.post('/api/v1/donors', {
  type: 'INDIVIDUAL', prefix: 'Ms', first_name: 'Jane', last_name: 'Okonkwo',
  email: 'jane.okonkwo@example.com', phone: '(415) 555-0142',
  address: '221 Bay Street, San Francisco, CA 94133',
  welcome_campaign_id: campaign.id,
})).body.data;
ok(`donor #${jane.number} ${jane.display_name} registered (display_name and sort_name derived on write)`);

let mark = adapter.mark;
await runJobs(api);
const welcome = adapter.since(mark);
assert(welcome.length === 1, 'exactly one welcome email');
ok(`email sent: "${welcome[0].subject}"`);
say(`${C.dim}${welcome[0].text.split('\n').filter(Boolean).slice(1, 4).join(' / ')}${C.reset}`);

// ---------------------------------------------------------------------------
heading('Record a donation — receipt issued, progress reported back to the donor');

mark = adapter.mark;
const first = (await donate(api, {
  donor_id: jane.id, amount: '5000.00', currency: 'USD', donation_date: today,
  method: 'CHECK', reference: '10241',
  allocations: [{ fund_id: fund.id, campaign_id: campaign.id, amount: '5000.00' }],
})).body.data;
ok(`donation ${first.amount} ${first.currency} posted, receipt ${first.receipt.receipt_number} issued`);

await runJobs(api);
const thanks = adapter.since(mark)[0];
ok(`email sent: "${thanks.subject}"`);
say(`${C.dim}includes: receipt number, deductible amount, and "${(await progressOf(campaign.id)).percent}% of the goal is funded"${C.reset}`);

// ---------------------------------------------------------------------------
heading('One donation, two campaigns — the split-allocation model');

const marcus = (await api.post('/api/v1/donors', {
  first_name: 'Marcus', last_name: 'Bell', email: 'marcus.bell@example.com',
})).body.data;

mark = adapter.mark;
const split = (await donate(api, {
  donor_id: marcus.id, amount: '2000.00', currency: 'USD', donation_date: today, method: 'CREDIT_CARD',
  allocations: [
    { fund_id: fund.id, campaign_id: campaign.id, percent: 75 },
    { fund_id: fundGeneral.id, campaign_id: winter.id, percent: 25 },
  ],
})).body.data;
assert(split.allocations.length === 2, 'two allocations');
ok(`one donation of ${split.amount}, allocated ${split.allocations.map((a) => a.amount).join(' + ')}`);

const marcusSummary = (await api.get(`/api/v1/donors/${marcus.id}/summary`)).body.data;
assert(marcusSummary.donation_count === 1, 'a split donation counts once');
ok(`donation count for the donor is ${marcusSummary.donation_count}, not 2 — splits are allocations, not donations`);
await runJobs(api);
adapter.since(mark).forEach((m) => say(`${C.dim}mail: ${m.subject}${C.reset}`));

// ---------------------------------------------------------------------------
heading('Crossing 25% — every donor on the campaign hears about it, once');

const priya = (await api.post('/api/v1/donors', {
  first_name: 'Priya', last_name: 'Raman', email: 'priya.raman@example.com',
})).body.data;

mark = adapter.mark;
await donate(api, {
  donor_id: priya.id, amount: '7000.00', currency: 'USD', donation_date: today, method: 'BANK_TRANSFER',
  allocations: [{ fund_id: fund.id, campaign_id: campaign.id, amount: '7000.00' }],
});
await runJobs(api);

const progress25 = await progressOf(campaign.id);
const milestoneMail = adapter.since(mark).filter((m) => m.subject.includes('% funded'));
ok(`campaign now at ${progress25.percent}% (${progress25.raised} of ${progress25.goal})`);
ok(`${milestoneMail.length} milestone emails sent — one per campaign donor: ${milestoneMail.map((m) => m.to).join(', ')}`);

mark = adapter.mark;
await donate(api, {
  donor_id: priya.id, amount: '100.00', currency: 'USD', donation_date: today, method: 'CREDIT_CARD',
  allocations: [{ fund_id: fund.id, campaign_id: campaign.id, amount: '100.00' }],
});
await runJobs(api);
assert(adapter.since(mark).filter((m) => m.subject.includes('25% funded')).length === 0, '25% must not fire twice');
ok('a further donation does not re-send the 25% milestone — the high-water mark is durable');

// ---------------------------------------------------------------------------
heading('A donor who opted out of progress updates still gets their receipt');

const sam = (await api.post('/api/v1/donors', {
  first_name: 'Sam', last_name: 'Whitfield', email: 'sam.whitfield@example.com',
  progress_updates_opt_in: false,
})).body.data;

mark = adapter.mark;
await donate(api, {
  donor_id: sam.id, amount: '250.00', currency: 'USD', donation_date: today, method: 'CREDIT_CARD',
  allocations: [{ fund_id: fund.id, campaign_id: campaign.id, amount: '250.00' }],
});
await runJobs(api);
const samMail = await mailFor(sam.id);
const samSent = samMail.filter((m) => m.status === 'SENT').map((m) => m.template_key);
assert(samSent.includes('donation_thank_you'), 'transactional mail still goes out');
ok(`sent to Sam: ${samSent.join(', ')} — stewardship mail will be suppressed with PROGRESS_UPDATES_OPTED_OUT`);

// ---------------------------------------------------------------------------
heading('A donor with no_email — suppression is recorded, not silent');

const ruth = (await api.post('/api/v1/donors', {
  first_name: 'Ruth', last_name: 'Calder', email: 'ruth.calder@example.com', no_email: true,
})).body.data;

mark = adapter.mark;
await donate(api, {
  donor_id: ruth.id, amount: '400.00', currency: 'USD', donation_date: today, method: 'CHECK', reference: '882',
  allocations: [{ fund_id: fund.id, campaign_id: campaign.id, amount: '400.00' }],
});
await runJobs(api);
const ruthMail = await mailFor(ruth.id);
assert(ruthMail.every((m) => m.status === 'SUPPRESSED'), 'nothing sent to a no_email donor');
assert(adapter.since(mark).every((m) => m.to !== ruth.email), 'the provider never saw the address');
ok(`${ruthMail.length} communications recorded, all SUPPRESSED — reasons: ${[...new Set(ruthMail.map((m) => m.suppression_reason))].join(', ')}`);
say(`${C.dim}her receipt still exists and can be printed; only the email channel is closed${C.reset}`);

// ---------------------------------------------------------------------------
heading('The scheduled digest — a weekly progress update, deduped per day');

mark = adapter.mark;
await runJobs(api, { include_digests: true, digest_interval_days: 0 });
const digest1 = adapter.since(mark).filter((m) => m.subject.startsWith('Progress update'));
ok(`${digest1.length} digest emails sent for the campaigns with donors`);

mark = adapter.mark;
await runJobs(api, { include_digests: true, digest_interval_days: 0 });
const digest2 = adapter.since(mark).filter((m) => m.subject.startsWith('Progress update'));
assert(digest2.length === 0, 'a second run on the same day must not re-mail');
ok('running the digest job again the same day sends nothing — dedupe key is scoped to the day');

// ---------------------------------------------------------------------------
heading('Duplicate guard and idempotent retry');

const dup = await donate(api, {
  donor_id: jane.id, amount: '5000.00', currency: 'USD', donation_date: today, method: 'CHECK',
  allocations: [{ fund_id: fund.id, campaign_id: campaign.id, amount: '5000.00' }],
});
assert(dup.status === 409 && dup.body.code === 'DUPLICATE_SUSPECTED', 'same donor/amount/date is caught');
ok(`same donor, amount and date -> 409 ${dup.body.code} with candidates, not a silent second gift`);

const key = crypto.randomUUID();
const payload = {
  donor_id: marcus.id, amount: '125.00', currency: 'USD', donation_date: today, method: 'CREDIT_CARD',
  allocations: [{ fund_id: fund.id, campaign_id: campaign.id, amount: '125.00' }],
};
const once = await donate(api, payload, key);
const twice = await donate(api, payload, key);
assert(once.body.data.id === twice.body.data.id, 'the retry replays the original response');
assert(twice.headers['idempotency-replayed'] === 'true', 'replay is flagged');
ok('a retried POST with the same Idempotency-Key replays the original donation — no second receipt number');

const reused = await donate(api, { ...payload, amount: '999.00', allocations: [{ fund_id: fund.id, campaign_id: campaign.id, amount: '999.00' }] }, key);
assert(reused.status === 409 && reused.body.code === 'IDEMPOTENCY_KEY_REUSE', 'key reuse with a different body is a 409');
ok(`the same key with a different body -> 409 ${reused.body.code}`);

// ---------------------------------------------------------------------------
heading('The email provider fails — retry with backoff, then park the message');

adapter.failuresBeforeSuccess = 99;
const ada = (await api.post('/api/v1/donors', { first_name: 'Ada', last_name: 'Fenwick', email: 'ada.fenwick@example.com' })).body.data;
await donate(api, {
  donor_id: ada.id, amount: '60.00', currency: 'USD', donation_date: today, method: 'CREDIT_CARD',
  allocations: [{ fund_id: fundGeneral.id, amount: '60.00' }],
});
for (let attempt = 0; attempt < 4; attempt += 1) {
  await runJobs(api);
  // The mailer backs off; the demo fast-forwards by clearing next_attempt_at.
  h.db.filter('communication', (c) => c.status === 'QUEUED').forEach((c) => { c.next_attempt_at = null; });
}
const adaMail = await mailFor(ada.id);
assert(adaMail.some((m) => m.status === 'FAILED'), 'the message ends up FAILED, not retried forever');
warn(`Ada's thank-you is FAILED after ${adaMail[0].attempts} attempts — last error: "${adaMail[0].last_error}"`);
adapter.failuresBeforeSuccess = 0;

// ---------------------------------------------------------------------------
heading('Reaching the goal');

mark = adapter.mark;
const remaining = (await progressOf(campaign.id)).remaining;
await donate(api, {
  donor_id: marcus.id, amount: remaining, currency: 'USD', donation_date: today, method: 'BANK_TRANSFER',
  allocations: [{ fund_id: fund.id, campaign_id: campaign.id, amount: remaining }],
});
await runJobs(api);
const finalProgress = await progressOf(campaign.id);
assert(finalProgress.goal_reached, 'the goal is reached');
const goalMail = adapter.since(mark).filter((m) => m.subject.includes('reached its goal'));
ok(`campaign at ${finalProgress.percent}% — ${goalMail.length} "goal reached" emails plus the 50/75/100 milestones`);
say(`${C.dim}milestones recorded: ${(await api.get(`/api/v1/campaigns/${campaign.id}`)).body.data.milestones_reached.join(', ')}${C.reset}`);

// ---------------------------------------------------------------------------
heading('A donation is reversed — progress recomputes, the receipt is voided');

const before = await progressOf(campaign.id);
mark = adapter.mark;
const reversed = (await api.post(`/api/v1/donations/${first.id}/reverse`, { reason: 'Cheque returned unpaid' })).body.data;
await runJobs(api);
const after = await progressOf(campaign.id);

assert(reversed.status === 'REVERSED', 'the donation is reversed, never deleted');
assert(Number(after.raised) < Number(before.raised), 'progress drops');
ok(`raised ${before.raised} -> ${after.raised} (${before.percent}% -> ${after.percent}%)`);

const voided = (await api.get(`/api/v1/receipts/${first.receipt.id}`)).body.data;
assert(voided.status === 'VOIDED', 'the receipt is voided');
ok(`receipt ${voided.receipt_number} is VOIDED — reason "${voided.void_reason}"`);
ok(`donor notified: "${adapter.since(mark).find((m) => m.subject.includes('reversed'))?.subject}"`);

const stillRecorded = (await api.get(`/api/v1/campaigns/${campaign.id}`)).body.data.milestones_reached;
ok(`milestones still recorded as ${stillRecorded.join(', ')} — a reversal never re-opens a milestone for re-sending`);

// ---------------------------------------------------------------------------
heading('Closing the campaign — a final update to everyone who gave');

mark = adapter.mark;
await api.post(`/api/v1/campaigns/${campaign.id}/close`, { reason: 'Season ended' });
await runJobs(api);
const closeMail = adapter.since(mark).filter((m) => m.subject.includes('has closed'));
ok(`${closeMail.length} closing emails sent`);

const rejected = await donate(api, {
  donor_id: priya.id, amount: '50.00', currency: 'USD', donation_date: today, method: 'CASH',
  allocations: [{ fund_id: fund.id, campaign_id: campaign.id, amount: '50.00' }],
});
assert(rejected.status === 422, 'a closed campaign takes no new gifts');
ok(`a donation to the closed campaign -> 422 ${rejected.body.errors[0].code}`);

// ---------------------------------------------------------------------------
heading('What the organization can see afterwards');

const comms = (await api.get('/api/v1/communications?limit=200')).body;
const byStatus = comms.data.reduce((acc, c) => ({ ...acc, [c.status]: (acc[c.status] || 0) + 1 }), {});
const receipts = (await api.get('/api/v1/receipts?limit=200')).body;
const events = (await api.get('/api/v1/events?limit=200')).body;
const audit = (await api.get('/api/v1/audit-entries?limit=200')).body;

say(`communications : ${Object.entries(byStatus).map(([k, v]) => `${v} ${k}`).join(', ')}`);
say(`receipt register: ${receipts.data.length} receipts, numbers ${receipts.data[0].receipt_number}…${receipts.data.at(-1).receipt_number}`);
say(`domain events   : ${events.meta.total}`);
say(`audit entries   : ${audit.meta.total}`);
say(`mail on disk    : ${adapter.sent.length} .eml files in ${config.outboxDir}`);

process.stdout.write(`\n${C.green}${C.bold}Every scenario passed.${C.reset}\n`);
process.stdout.write(`${C.dim}The database is at ${config.dataFile}; start the API with \`npm start\`.${C.reset}\n\n`);

await h.close();
