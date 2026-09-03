// workers/digest.js — the periodic campaign progress update.
//
// Donors hear from an active campaign on a cadence even when nothing dramatic happened,
// so progress reporting is not purely milestone-driven.
import { campaigns as campaignRepo } from '../repositories/index.js';
import { requestUpdate, campaignDonors } from '../services/campaigns.js';
import { log } from '../core/logging.js';

export function runCampaignDigests(orgId, { intervalDays = 7, now = new Date() } = {}) {
  const cutoff = new Date(now.getTime() - intervalDays * 86400000).toISOString();
  const due = campaignRepo.list(orgId, (c) =>
    c.status === 'ACTIVE' && (!c.last_digest_at || c.last_digest_at <= cutoff));

  const requested = [];
  for (const campaign of due) {
    // No donors yet means no one to inform; do not burn a digest slot on silence.
    if (campaignDonors(orgId, campaign.id).length === 0) continue;
    requestUpdate(orgId, campaign.id, { actor: 'job:campaign_digest', trigger: 'SCHEDULED' });
    requested.push(campaign.id);
  }
  if (requested.length) log.info('digest.requested', { count: requested.length });
  return { considered: due.length, requested };
}
