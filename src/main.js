// main.js — process entry point.
import http from 'node:http';
import { createHandler } from './app.js';
import { db } from './db/store.js';
import { provisionOrganization } from './db/seed.js';
import { config } from './core/config.js';
import { log } from './core/logging.js';

db.load();
if (db.table('organization').length === 0) {
  const org = provisionOrganization();
  log.info('organization.provisioned', { organization_id: org.id, api_key: org.api_key });
}

const server = http.createServer(createHandler());
server.listen(config.port, () => {
  const org = db.table('organization')[0];
  log.info('listening', { port: config.port, env: config.env, email_provider: config.emailProvider });
  process.stdout.write(`\nDMS demo1 on http://localhost:${config.port}\n  Console: http://localhost:${config.port}/  (open it in a browser)\n  API key: ${org.api_key}\n  Try: curl -H "Authorization: Bearer ${org.api_key}" http://localhost:${config.port}/api/v1/campaigns\n\n`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => { server.close(() => process.exit(0)); });
}
