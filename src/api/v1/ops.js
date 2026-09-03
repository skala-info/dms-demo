// api/v1/ops.js — health, the job runner, the event log and the audit trail.
import { runJobs } from '../../workers/index.js';
import { outbox, audit, orgs } from '../../repositories/index.js';
import { auditOut, eventOut } from '../presenters.js';
import { one, paginate } from '../../core/http.js';

/**
 * Newest first, deterministically.
 *
 * `occurred_at` is an ISO timestamp with millisecond resolution, and two entries written
 * inside one millisecond — a create and an update in the same request, say — compare
 * equal. A sort on the timestamp alone then leaves such a pair in insertion order, which
 * is oldest-first: the exact opposite of what this endpoint promises. Insertion order is
 * the tie-break, reversed, so a tie still reads newest-first.
 */
const newestFirst = (rows) => rows
  .map((row, index) => ({ row, index }))
  .sort((a, b) => b.row.occurred_at.localeCompare(a.row.occurred_at) || b.index - a.index)
  .map(({ row }) => row);

export function register(router) {
  router.get('/health', () => ({ status: 200, body: { status: 'ok', service: 'dms-demo1' } }));

  router.get('/api/v1/organization', ({ orgId }) => {
    const org = orgs.get(orgId);
    return {
      status: 200,
      body: one({
        id: org.id, type: 'organization', name: org.name, tax_id: org.tax_id,
        default_currency: org.default_currency, receipt_next_number: org.receipt_next_number,
      }),
    };
  });

  /**
   * Advance the world: drain the outbox into the notification consumer, then send the
   * queued mail. In production these are scheduled workers; exposing them as an endpoint
   * makes the demo and the tests deterministic instead of time-dependent.
   */
  router.post('/api/v1/jobs/run', async ({ orgId, body }) => {
    const run = await runJobs(orgId, {
      includeDigests: body.include_digests === true,
      digestIntervalDays: body.digest_interval_days ?? 7,
    });
    return { status: 200, body: one({ type: 'job_run', ...run }) };
  });

  router.get('/api/v1/events', ({ orgId, query }) => ({
    status: 200,
    body: paginate(
      newestFirst(outbox.list(orgId)).map(eventOut),
      query, '/api/v1/events',
    ),
  }));

  router.get('/api/v1/audit-entries', ({ orgId, query }) => ({
    status: 200,
    body: paginate(
      newestFirst(audit.list(orgId, (a) => (query.entity_id ? a.entity_id === query.entity_id : true)))
        .map(auditOut),
      query, '/api/v1/audit-entries',
    ),
  }));
}
