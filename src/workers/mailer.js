// workers/mailer.js — drains queued communications through the email port.
//
// A failed send is retried with backoff and, after `maxSendAttempts`, parked as FAILED
// rather than retried forever. Nothing here decides *whether* a donor should be mailed;
// that was settled by the suppression check when the message was queued.
import { db } from '../db/store.js';
import { communications as commRepo, orgs } from '../repositories/index.js';
import { emailPort } from '../integrations/email/index.js';
import { config } from '../core/config.js';
import { log } from '../core/logging.js';

const backoffFor = (attempt) =>
  config.retryBackoffSeconds[Math.min(attempt - 1, config.retryBackoffSeconds.length - 1)];

export async function sendQueuedEmails({ now = new Date(), limit = 500 } = {}) {
  const due = commRepo.dueForSend(now).slice(0, limit);
  let sent = 0;
  let retried = 0;
  let failed = 0;

  for (const comm of due) {
    const org = orgs.get(comm.organization_id);
    const from = org?.email_from || config.emailFrom;
    try {
      const result = await emailPort.send({
        to: comm.to_address,
        from,
        subject: comm.subject,
        html: comm.html,
        text: comm.text,
        headers: { 'X-DMS-Communication-Id': comm.id, 'X-DMS-Template': comm.template_key },
      });
      db.tx(() => commRepo.update(comm.organization_id, comm.id, {
        status: 'SENT',
        attempts: comm.attempts + 1,
        provider_message_id: result.provider_message_id,
        sent_at: new Date().toISOString(),
        last_error: null,
        next_attempt_at: null,
      }));
      sent += 1;
    } catch (err) {
      const attempts = comm.attempts + 1;
      const exhausted = attempts >= config.maxSendAttempts;
      db.tx(() => commRepo.update(comm.organization_id, comm.id, {
        status: exhausted ? 'FAILED' : 'QUEUED',
        attempts,
        last_error: err.message,
        next_attempt_at: exhausted ? null : new Date(now.getTime() + backoffFor(attempts) * 1000).toISOString(),
      }));
      if (exhausted) failed += 1; else retried += 1;
      log.warn('email.send_failed', { communication_id: comm.id, attempts, exhausted, error: err.message });
    }
  }

  if (due.length) log.info('mailer.run', { considered: due.length, sent, retried, failed });
  return { considered: due.length, sent, retried, failed };
}
