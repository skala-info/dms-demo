// workers/index.js — the job runner.
//
// In production these are separate scheduled workers (outbox every 2s, mailer
// continuously, digests daily). demo1 exposes them as one callable so a script, a test,
// or POST /api/v1/jobs/run can advance the world deterministically instead of sleeping.
import { db } from '../db/store.js';
import { jobRuns } from '../repositories/index.js';
import { uuid } from '../core/ids.js';
import { publishOutbox } from './outbox.js';
import { sendQueuedEmails } from './mailer.js';
import { runCampaignDigests } from './digest.js';

export { publishOutbox, sendQueuedEmails, runCampaignDigests };

/** Drain the outbox, then send whatever that queued. Returns the counts from both. */
export async function runJobs(orgId, { now = new Date(), includeDigests = false, digestIntervalDays = 7 } = {}) {
  const startedAt = new Date().toISOString();
  const digests = includeDigests ? runCampaignDigests(orgId, { intervalDays: digestIntervalDays, now }) : null;
  const outbox = publishOutbox();
  const mail = await sendQueuedEmails({ now });

  const run = {
    id: uuid(),
    organization_id: orgId,
    job: 'run_jobs',
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    counts: { digests, outbox, mail },
  };
  db.tx(() => jobRuns.insert(run));
  return run;
}
