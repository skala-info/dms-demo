// api/v1/receipts.js — the receipt register.
import * as receiptsService from '../../services/receipts.js';
import { receiptOut } from '../presenters.js';
import { one, paginate } from '../../core/http.js';

export function register(router) {
  router.get('/api/v1/receipts', ({ orgId, query }) => ({
    status: 200,
    body: paginate(receiptsService.register(orgId, { taxYear: query.tax_year }).map(receiptOut), query, '/api/v1/receipts'),
  }));

  router.get('/api/v1/receipts/:id', ({ orgId, params }) => ({
    status: 200,
    body: one(receiptOut(receiptsService.getReceipt(orgId, params.id))),
  }));

  router.post('/api/v1/receipts/:id/void', ({ orgId, actor, params, body }) => ({
    status: 200,
    body: one(receiptOut(receiptsService.voidReceipt(orgId, params.id, { actor, reason: body.reason || 'Correction' }))),
  }));
}
