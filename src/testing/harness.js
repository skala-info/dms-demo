// testing/harness.js — start the app in-process and talk to it over HTTP.
//
// Used by both `npm test` and `npm run demo`, so the demo exercises exactly the same
// path a real client would: auth, envelopes, problem+json, idempotency.
//
// The client deliberately uses node:http with keep-alive disabled rather than fetch():
// a pooled connection keeps the event loop alive and a test run would never exit.
import http from 'node:http';
import { createHandler } from '../app.js';
import { db } from '../db/store.js';
import { resetAndProvision } from '../db/seed.js';
import { emailPort, MemoryEmailAdapter } from '../integrations/email/index.js';

export async function startServer({ persist = false, org = {}, email = null } = {}) {
  const organization = resetAndProvision(org, { persist });
  const adapter = email ?? new MemoryEmailAdapter();
  emailPort.use(adapter);

  const server = http.createServer(createHandler());
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  return {
    org: organization,
    adapter,
    port,
    baseUrl: `http://127.0.0.1:${port}`,
    api: makeClient(port, organization.api_key),
    db,
    async close() {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

export function makeClient(port, apiKey) {
  function request(method, path, { body, headers = {}, auth = true } = {}) {
    const payload = body === undefined ? null : JSON.stringify(body);
    const outgoing = {
      'Content-Type': 'application/json',
      ...(auth && apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      ...headers,
    };
    if (payload !== null) outgoing['Content-Length'] = Buffer.byteLength(payload);

    return new Promise((resolve, reject) => {
      const req = http.request(
        { host: '127.0.0.1', port, path, method, headers: outgoing, agent: false },
        (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            resolve({
              status: res.statusCode,
              headers: res.headers,
              body: text ? JSON.parse(text) : null,
            });
          });
        },
      );
      req.on('error', reject);
      if (payload !== null) req.write(payload);
      req.end();
    });
  }

  return {
    request,
    get: (p, opts) => request('GET', p, opts),
    post: (p, body, opts) => request('POST', p, { body, ...opts }),
    patch: (p, body, opts) => request('PATCH', p, { body, ...opts }),
  };
}

/** POST a donation with a fresh Idempotency-Key. */
export const donate = (api, body, key = crypto.randomUUID()) =>
  api.post('/api/v1/donations', body, { headers: { 'Idempotency-Key': key } });

/** Drain the outbox and send the queued mail. */
export const runJobs = (api, body = {}) => api.post('/api/v1/jobs/run', body);
