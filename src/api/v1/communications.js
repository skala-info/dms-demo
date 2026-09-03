// api/v1/communications.js — what was sent, what was suppressed, and why.
import { listCommunications } from '../../services/notifications.js';
import { communications as commRepo } from '../../repositories/index.js';
import { communicationOut } from '../presenters.js';
import { one, paginate } from '../../core/http.js';
import { notFound } from '../../core/errors.js';

export function register(router) {
  router.get('/api/v1/communications', ({ orgId, query }) => {
    const rows = listCommunications(orgId, {
      donorId: query.donor_id,
      status: query.status,
      templateKey: query.template_key,
    }).map((c) => communicationOut(c, { body: query.include_body === 'true' }));
    return { status: 200, body: paginate(rows, query, '/api/v1/communications') };
  });

  router.get('/api/v1/communications/:id', ({ orgId, params }) => {
    const comm = commRepo.get(orgId, params.id);
    if (!comm) throw notFound('Communication');
    return { status: 200, body: one(communicationOut(comm, { body: true })) };
  });
}
