// scripts/seed.js — put the console's demo dataset into demo1/data/db.json.
//
// `npm start` provisions an empty organisation and nothing else, and it will not re-seed a
// database that already has one — so after the demo content changes, this is what refreshes
// a local copy. The dataset is the SAME definition the browser build seeds itself with
// (src/web/public/seed.js), so the hosted demo and a local `npm start` show the same world.
import { startServer } from '../src/testing/harness.js';
import { seedDemo } from '../src/web/public/seed.js';

const h = await startServer({ persist: true });
process.stdout.write(`seeding ${h.org.name}…\n`);

const result = await seedDemo(h.org.api_key, h.baseUrl);
const campaigns = (await h.api.get('/api/v1/campaigns?limit=50')).body.data;

await h.close();

process.stdout.write(`\n  ${h.org.name} — ${result.donors} donors, ${result.donations} donations\n`);
for (const campaign of campaigns) {
  process.stdout.write(`  ${campaign.code.padEnd(7)} ${campaign.name.padEnd(34)} ${campaign.status}\n`);
}
process.stdout.write('\nWritten to data/db.json. Run `npm start` and open http://localhost:3000/\n\n');
