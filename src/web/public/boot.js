// boot.js — start the console, with or without a server behind it.
//
// Served by `npm start`, there is a real Node process on /api/v1 and this file gets out of
// the way. Served as static files (Netlify, GitHub Pages, a file:// folder), there is no
// server at all — so demo1's OWN request handler is run here, in the page, and `fetch` is
// pointed at it. Not a mock: the router, the services, the domain rules, the receipts, the
// outbox and the email templates are the same modules `npm start` loads. Only the store's
// backing (memory instead of a JSON file) and the email adapter (memory instead of disk)
// differ, and both were already swappable.
//
// Each visitor therefore gets a private, freshly seeded copy of the demo, and a reload
// resets it.
import { registerFile } from './shims/fs.js';

const TEMPLATE_FILES = [
  'layout.html', '_progress.html', 'welcome.html', 'donation_thank_you.html',
  'donation_reversed.html', 'campaign_milestone.html', 'campaign_goal_reached.html',
  'campaign_closed.html', 'campaign_progress_digest.html',
];

/** Load the console itself, which is a classic script rather than a module. */
const startConsole = () => new Promise((resolve, reject) => {
  const script = document.createElement('script');
  script.src = '/ui/app.js';
  script.onload = resolve;
  script.onerror = () => reject(new Error('could not load /ui/app.js'));
  document.body.appendChild(script);
});

/** Is a real demo1 server answering, or are we on our own? */
async function serverIsLive() {
  try {
    const response = await fetch('/health', { headers: { Accept: 'application/json' } });
    if (!response.ok) return false;
    const body = await response.json();
    return body && body.service === 'dms-demo1';
  } catch {
    return false;
  }
}

/** Adapt one fetch Request onto the node:http-shaped handler demo1 already has. */
function nodeAdapter(handle) {
  return async function respond(input, init = {}) {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url, location.origin);
    const bodyText = request.method === 'GET' || request.method === 'HEAD' ? '' : await request.text();

    const headers = {};
    request.headers.forEach((value, key) => { headers[key.toLowerCase()] = value; });

    const req = {
      method: request.method,
      url: url.pathname + url.search,
      headers,
      // core/http.js readBody() consumes the request as an async iterable of chunks.
      async *[Symbol.asyncIterator]() { if (bodyText) yield Buffer.from(bodyText); },
    };

    return new Promise((resolve) => {
      let status = 200;
      let outHeaders = {};
      const res = {
        writeHead(code, sent) { status = code; outHeaders = sent || {}; return res; },
        end(payload) {
          const text = payload === undefined || payload === null ? '' : String(payload);
          resolve(new Response(text || null, { status, headers: outHeaders }));
        },
      };
      handle(req, res);
    });
  };
}

async function startInBrowser() {
  // The templates are the only files demo1 reads at runtime; hand them to the fs shim.
  const sources = await Promise.all(TEMPLATE_FILES.map(async (file) => {
    const response = await fetch(`/src/templates/${file}`);
    if (!response.ok) throw new Error(`template ${file} is not published (${response.status})`);
    return [file, await response.text()];
  }));
  for (const [file, contents] of sources) registerFile(file, contents);

  // Absolute paths, because this file is served at /ui/boot.js while the source it pulls
  // in lives under /src — a relative specifier would resolve against the served URL, not
  // the directory on disk. These run only when no server answered, which is exactly when
  // the whole folder is published as static files.
  const [{ createHandler }, { db }, { provisionOrganization }] = await Promise.all([
    import('/src/app.js'),
    import('/src/db/store.js'),
    import('/src/db/seed.js'),
  ]);

  // No disk to flush to, and no mail to post: the in-memory email adapter is selected by
  // EMAIL_PROVIDER in the globals shim, the same way every other environment picks one.
  db.persist = false;
  const organization = provisionOrganization();

  const handler = nodeAdapter(createHandler());
  const passthrough = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const path = new URL(
      typeof input === 'string' ? input : input.url,
      location.origin,
    ).pathname;
    const ours = path.startsWith('/api/') || path === '/health';
    return ours ? handler(input, init) : passthrough(input, init);
  };

  const { seedDemo } = await import('./seed.js');
  await seedDemo(organization.api_key);
  return organization;
}

const banner = (text, tone) => {
  const el = document.getElementById('mode-banner');
  if (!el) return;
  el.textContent = text;
  el.className = `mode-banner ${tone}`;
  el.hidden = false;
};

if (await serverIsLive()) {
  await startConsole();
} else {
  try {
    await startInBrowser();
    banner('Running entirely in your browser — a private demo dataset, reset on reload.', 'ok');
  } catch (error) {
    banner(`Could not start the in-browser demo: ${error.message}`, 'bad');
    console.error(error);
  }
  await startConsole();
}
