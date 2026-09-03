// api/v1/stats.js — one read-only aggregate for the console's stats page.
import * as statsService from '../../services/stats.js';
import { statsOut } from '../presenters.js';
import { one } from '../../core/http.js';

export function register(router) {
  router.get('/api/v1/stats', ({ orgId, query }) => ({
    status: 200,
    body: one(statsOut(statsService.buildStats(orgId, { from: query.from || null, to: query.to || null }))),
  }));
}
