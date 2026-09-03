// web/static.js — the operator console's static assets.
//
// The API is the product; this is a thin console served from the same process so that
// `npm start` gives you something to look at as well as something to curl. It is its own
// layer: it may read `core/` and nothing else, and it never reaches a service — the page
// it serves talks to /api/v1 over HTTP exactly like any other client.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
};

/**
 * Map a URL path to a file inside `public/`, or null if it is not ours to serve.
 *
 *   /            -> index.html
 *   /ui, /ui/    -> index.html
 *   /ui/app.js   -> app.js
 *
 * The resolved path is checked to be inside `public/` so that `/ui/../../db/store.js`
 * resolves to nothing rather than to source code.
 */
export function resolveAsset(pathname) {
  try {
    let rel;
    if (pathname === '/' || pathname === '/ui' || pathname === '/ui/') rel = 'index.html';
    else if (pathname.startsWith('/ui/')) rel = decodeURIComponent(pathname.slice('/ui/'.length));
    else return null;

    const full = path.resolve(publicDir, rel);
    if (full !== publicDir && !full.startsWith(publicDir + path.sep)) return null;
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) return null;
    return full;
  } catch {
    return null;
  }
}

/** Serve the asset if this request is for one. Returns whether it answered the request. */
export function serveAsset(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  const file = resolveAsset(pathname);
  if (!file) return false;

  const body = fs.readFileSync(file);
  res.writeHead(200, {
    'Content-Type': CONTENT_TYPES[path.extname(file)] || 'application/octet-stream',
    'Content-Length': body.length,
    // The console is a development tool; never let a stale bundle survive a restart.
    'Cache-Control': 'no-store',
  });
  res.end(req.method === 'HEAD' ? undefined : body);
  return true;
}
