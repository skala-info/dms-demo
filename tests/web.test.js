// tests/web.test.js — the operator console is served, and serving it opens no doors.
//
// The console is static files and nothing more: it must be reachable without a
// credential, it must not reach outside its own directory, and it must not make the API
// any less closed than it was.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startServer } from '../src/testing/harness.js';

/** The harness client parses JSON; the console serves HTML, so ask for the raw bytes. */
function raw(port, path, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method, agent: false }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({
        status: res.statusCode,
        type: res.headers['content-type'],
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('the console is served at / without a credential', async (t) => {
  const h = await startServer();
  t.after(() => h.close());

  const page = await raw(h.port, '/');
  assert.equal(page.status, 200);
  assert.equal(page.type, 'text/html; charset=utf-8');
  assert.match(page.body, /<title>DMS demo1/);
  assert.match(page.body, /\/ui\/app\.js/);

  for (const [path, type] of [['/ui/app.js', 'text/javascript; charset=utf-8'], ['/ui/styles.css', 'text/css; charset=utf-8']]) {
    const asset = await raw(h.port, path);
    assert.equal(asset.status, 200, path);
    assert.equal(asset.type, type, path);
    assert.ok(asset.body.length > 0, path);
  }

  // /ui and /ui/ are the same page.
  assert.equal((await raw(h.port, '/ui')).status, 200);
  assert.equal((await raw(h.port, '/ui/')).status, 200);
});

test('the console cannot be used to read anything outside its own directory', async (t) => {
  const h = await startServer();
  t.after(() => h.close());

  for (const path of ['/ui/%2e%2e/static.js', '/ui/%2e%2e%2f%2e%2e%2fdb/store.js', '/ui/../package.json', '/ui/nope.js']) {
    const res = await raw(h.port, path);
    assert.equal(res.status, 404, path);
    assert.doesNotMatch(res.body, /provisionOrganization|dms-demo1"|api_key/, path);
  }
});

test('serving the console leaves the API exactly as closed as it was', async (t) => {
  const h = await startServer();
  t.after(() => h.close());

  // Static serving runs before authentication; it must not answer for API paths.
  const unauthenticated = await raw(h.port, '/api/v1/donors');
  assert.equal(unauthenticated.status, 401);
  assert.equal(unauthenticated.type, 'application/problem+json; charset=utf-8');

  // Only GET/HEAD reach the asset handler; a POST to / is still an unknown route.
  const posted = await raw(h.port, '/', 'POST');
  assert.equal(posted.status, 404);
  assert.equal(posted.type, 'application/problem+json; charset=utf-8');

  // A HEAD for the page returns the headers and no body.
  const head = await raw(h.port, '/', 'HEAD');
  assert.equal(head.status, 200);
  assert.equal(head.body, '');
});
