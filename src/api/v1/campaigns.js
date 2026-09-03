// api/v1/campaigns.js — campaigns, funds, progress, and manual progress updates.
import * as campaignsService from '../../services/campaigns.js';
import { campaigns as campaignRepo, funds as fundRepo } from '../../repositories/index.js';
import { campaignOut, progressOut, fundOut } from '../presenters.js';
import { one, paginate } from '../../core/http.js';
import { notFound } from '../../core/errors.js';
import { formatMoney } from '../../core/money.js';

export function register(router) {
  router.post('/api/v1/funds', ({ orgId, actor, body }) => ({
    status: 201,
    body: one(fundOut(campaignsService.createFund(orgId, body, actor))),
  }));

  router.get('/api/v1/funds', ({ orgId, query }) => ({
    status: 200,
    body: paginate(fundRepo.list(orgId).map(fundOut), query, '/api/v1/funds'),
  }));

  router.post('/api/v1/campaigns', ({ orgId, actor, body }) => {
    const campaign = campaignsService.createCampaign(orgId, body, actor);
    return { status: 201, body: one(campaignOut(campaign)), headers: { Location: `/api/v1/campaigns/${campaign.id}` } };
  });

  router.get('/api/v1/campaigns', ({ orgId, query }) => {
    const rows = campaignRepo
      .list(orgId, (c) => (query.status ? c.status === query.status : true))
      .sort((a, b) => a.code.localeCompare(b.code))
      .map(campaignOut);
    return { status: 200, body: paginate(rows, query, '/api/v1/campaigns') };
  });

  router.get('/api/v1/campaigns/:id', ({ orgId, params }) => {
    const campaign = campaignRepo.get(orgId, params.id);
    if (!campaign) throw notFound('Campaign');
    return { status: 200, body: one(campaignOut(campaign)) };
  });

  router.get('/api/v1/campaigns/:id/progress', ({ orgId, params }) => ({
    status: 200,
    body: one(progressOut(campaignsService.getProgress(orgId, params.id))),
  }));

  /** Who has given to this campaign, and how much. */
  router.get('/api/v1/campaigns/:id/donors', ({ orgId, params }) => {
    const campaign = campaignRepo.get(orgId, params.id);
    if (!campaign) throw notFound('Campaign');
    const rows = campaignsService.campaignDonors(orgId, params.id).map((e) => ({
      donor_id: e.donor.id,
      display_name: e.donor.display_name,
      email: e.donor.email,
      donation_count: e.donation_count,
      total_amount: formatMoney(e.total_minor, campaign.currency),
      currency: campaign.currency,
      receives_progress_updates: e.donor.progress_updates_opt_in && !e.donor.no_email,
    }));
    return { status: 200, body: { data: rows, meta: { count: rows.length, total: rows.length, has_more: false } } };
  });

  /** Queue a progress update to every donor on this campaign, right now. */
  router.post('/api/v1/campaigns/:id/send-update', ({ orgId, actor, params }) => {
    const result = campaignsService.requestUpdate(orgId, params.id, { actor, trigger: 'MANUAL' });
    return {
      status: 202,
      body: one({ type: 'campaign_update', campaign_id: params.id, event_id: result.event_id, progress: progressOut(result.progress) }),
    };
  });

  router.post('/api/v1/campaigns/:id/close', ({ orgId, actor, params, body }) => ({
    status: 200,
    body: one(campaignOut(campaignsService.closeCampaign(orgId, params.id, { actor, reason: body.reason || null }))),
  }));
}
