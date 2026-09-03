// api/v1/donations.js — recording and reversing donations.
import { db } from '../../db/store.js';
import * as donationsService from '../../services/donations.js';
import { allocations as allocRepo } from '../../repositories/index.js';
import { donationOut, receiptOut, progressOut } from '../presenters.js';
import { checkIdempotency } from '../../core/idempotency.js';
import { one, paginate } from '../../core/http.js';
import { badRequest } from '../../core/errors.js';

const ENDPOINT = 'POST /api/v1/donations';

export function register(router) {
  /**
   * Creating money REQUIRES an Idempotency-Key: a retried request must never produce a
   * second donation, a second receipt number, or a second thank-you email.
   */
  router.post('/api/v1/donations', ({ orgId, actor, body, query, headers }) => {
    const key = headers['idempotency-key'];
    if (!key) {
      throw badRequest('IDEMPOTENCY_KEY_REQUIRED', 'POST /api/v1/donations requires an Idempotency-Key header.');
    }

    const check = db.tx(() => checkIdempotency(db, { organizationId: orgId, key, endpoint: ENDPOINT, body }));
    if (check.replay) {
      return { status: 201, body: check.response, headers: { 'Idempotency-Replayed': 'true' } };
    }

    const result = donationsService.recordDonation(orgId, body, {
      actor,
      allowDuplicate: query.allow_duplicate === 'true',
    });

    const payload = one({
      ...donationOut(result.donation, result.allocations),
      receipt: result.receipt ? receiptOut(result.receipt) : null,
      campaign_progress: Object.values(result.progress).map(progressOut),
    });
    db.tx(() => check.reserve && check.reserve(payload));

    return { status: 201, body: payload, headers: { Location: `/api/v1/donations/${result.donation.id}` } };
  });

  router.get('/api/v1/donations', ({ orgId, query }) => {
    const rows = donationsService
      .listDonations(orgId, { donorId: query.donor_id, campaignId: query.campaign_id, status: query.status })
      .map((d) => donationOut(d, allocRepo.forDonation(orgId, d.id)));
    return { status: 200, body: paginate(rows, query, '/api/v1/donations') };
  });

  router.get('/api/v1/donations/:id', ({ orgId, params }) => {
    const { donation, allocations } = donationsService.getDonation(orgId, params.id);
    return { status: 200, body: one(donationOut(donation, allocations)) };
  });

  /** A posted donation is immutable; correction is reversal, never an edit or a delete. */
  router.post('/api/v1/donations/:id/reverse', ({ orgId, actor, params, body }) => {
    const result = donationsService.reverseDonation(orgId, params.id, { actor, reason: body.reason || 'Correction' });
    return {
      status: 200,
      body: one({
        ...donationOut(result.donation, allocRepo.forDonation(orgId, params.id)),
        campaign_progress: Object.values(result.progress).map(progressOut),
      }),
    };
  });
}
