// api/v1/donors.js — donor registration and preferences.
import * as donorsService from '../../services/donors.js';
import * as donationsService from '../../services/donations.js';
import { listCommunications } from '../../services/notifications.js';
import { donorOut, summaryOut, donationOut, communicationOut } from '../presenters.js';
import { one, paginate } from '../../core/http.js';
import { orgs, allocations as allocRepo } from '../../repositories/index.js';

export function register(router) {
  router.post('/api/v1/donors', ({ orgId, actor, body, query }) => {
    const donor = donorsService.registerDonor(orgId, body, {
      actor,
      allowDuplicate: query.allow_duplicate === 'true',
      welcomeCampaignId: body.welcome_campaign_id || null,
    });
    return { status: 201, body: one(donorOut(donor)), headers: { Location: `/api/v1/donors/${donor.id}`, ETag: `"${donor.version}"` } };
  });

  router.get('/api/v1/donors', ({ orgId, query }) => ({
    status: 200,
    body: paginate(donorsService.listDonors(orgId, { q: query.q }).map(donorOut), query, '/api/v1/donors'),
  }));

  router.get('/api/v1/donors/:id', ({ orgId, params }) => {
    const donor = donorsService.getDonor(orgId, params.id);
    return { status: 200, body: one(donorOut(donor)), headers: { ETag: `"${donor.version}"` } };
  });

  router.patch('/api/v1/donors/:id', ({ orgId, actor, params, body, headers }) => {
    const ifMatch = headers['if-match'] ? headers['if-match'].replace(/"/g, '') : null;
    const donor = donorsService.updateDonor(orgId, params.id, body, { actor, expectedVersion: ifMatch });
    return { status: 200, body: one(donorOut(donor)), headers: { ETag: `"${donor.version}"` } };
  });

  router.get('/api/v1/donors/:id/summary', ({ orgId, params }) => {
    const org = orgs.get(orgId);
    return { status: 200, body: one(summaryOut(donorsService.getSummary(orgId, params.id), org.default_currency)) };
  });

  router.get('/api/v1/donors/:id/donations', ({ orgId, params, query }) => {
    donorsService.getDonor(orgId, params.id);
    const rows = donationsService
      .listDonations(orgId, { donorId: params.id })
      .map((d) => donationOut(d, allocRepo.forDonation(orgId, d.id)));
    return { status: 200, body: paginate(rows, query, `/api/v1/donors/${params.id}/donations`) };
  });

  // The donor's communication timeline: what we sent, what we suppressed and why.
  router.get('/api/v1/donors/:id/communications', ({ orgId, params, query }) => {
    donorsService.getDonor(orgId, params.id);
    const rows = listCommunications(orgId, { donorId: params.id })
      .map((c) => communicationOut(c, { body: query.include_body === 'true' }));
    return { status: 200, body: paginate(rows, query, `/api/v1/donors/${params.id}/communications`) };
  });
}
