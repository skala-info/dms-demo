// app.js — request lifecycle.
//
//   request id  ->  authenticate (API key -> organization)  ->  parse body
//   ->  route handler  ->  service (one transaction)  ->  envelope  ->  response
//
// The organization is derived from the credential and never from a path or query
// parameter, so a token cannot address another tenant.
import { Router, readBody, sendJson, sendProblem, ulid } from './core/http.js';
import { AppError, unauthenticated, notFound } from './core/errors.js';
import { orgs } from './repositories/index.js';
import { log } from './core/logging.js';
import { serveAsset } from './web/static.js';

import * as donorRoutes from './api/v1/donors.js';
import * as campaignRoutes from './api/v1/campaigns.js';
import * as donationRoutes from './api/v1/donations.js';
import * as receiptRoutes from './api/v1/receipts.js';
import * as communicationRoutes from './api/v1/communications.js';
import * as opsRoutes from './api/v1/ops.js';
import * as statsRoutes from './api/v1/stats.js';

const PUBLIC_PATHS = new Set(['/health']);

export function buildRouter() {
  const router = new Router();
  for (const mod of [opsRoutes, donorRoutes, campaignRoutes, donationRoutes, receiptRoutes, communicationRoutes, statsRoutes]) {
    mod.register(router);
  }
  return router;
}

export function createHandler() {
  const router = buildRouter();

  return async function handle(req, res) {
    const requestId = ulid();
    const url = new URL(req.url, 'http://internal');
    const started = Date.now();

    try {
      // The console's HTML, CSS and JS are public; everything it then asks for is not.
      // Assets are answered before authentication, the API is not.
      if (serveAsset(req, res, url.pathname)) return;

      const match = router.match(req.method, url.pathname);
      if (!match) throw notFound('Route');
      if (match.methodNotAllowed) {
        throw new AppError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed', `${req.method} is not allowed on this path.`);
      }

      let orgId = null;
      let actor = 'anonymous';
      if (!PUBLIC_PATHS.has(url.pathname)) {
        const header = req.headers.authorization || '';
        const key = header.startsWith('Bearer ') ? header.slice(7).trim() : null;
        const org = key ? orgs.byApiKey(key) : null;
        if (!org) throw unauthenticated();
        orgId = org.id;
        actor = req.headers['x-actor'] || 'api';
      }

      const body = ['POST', 'PATCH', 'PUT'].includes(req.method) ? await readBody(req) : {};
      const result = await match.route.handler({
        orgId, actor, params: match.params,
        query: Object.fromEntries(url.searchParams),
        body, headers: req.headers, requestId,
      });

      const payload = result.body && typeof result.body === 'object' && 'meta' in result.body
        ? { ...result.body, meta: { request_id: requestId, ...result.body.meta } }
        : result.body;

      sendJson(res, result.status || 200, payload, { 'X-Request-Id': requestId, ...(result.headers || {}) });
      log.debug('request', { method: req.method, route: match.route.pattern, status: result.status || 200, duration_ms: Date.now() - started, request_id: requestId });
    } catch (err) {
      sendProblem(res, err, url.pathname, requestId);
    }
  };
}
