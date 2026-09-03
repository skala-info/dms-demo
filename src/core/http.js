// core/http.js — a tiny router over node:http. No framework, no dependencies.
import { AppError, notFound as notFoundError, badRequest, internal } from './errors.js';
import { ulid, encodeCursor, decodeCursor } from './ids.js';
import { config } from './config.js';
import { log } from './logging.js';

export class Router {
  constructor() { this.routes = []; }

  add(method, pattern, handler) {
    const names = [];
    const regex = new RegExp(
      '^' + pattern.replace(/:[A-Za-z_]+/g, (m) => { names.push(m.slice(1)); return '([^/]+)'; }) + '/?$',
    );
    this.routes.push({ method, regex, names, handler, pattern });
    return this;
  }

  get(p, h) { return this.add('GET', p, h); }
  post(p, h) { return this.add('POST', p, h); }
  patch(p, h) { return this.add('PATCH', p, h); }

  match(method, pathname) {
    let pathMatched = false;
    for (const route of this.routes) {
      const m = route.regex.exec(pathname);
      if (!m) continue;
      pathMatched = true;
      if (route.method !== method) continue;
      const params = Object.fromEntries(route.names.map((n, i) => [n, decodeURIComponent(m[i + 1])]));
      return { route, params };
    }
    return pathMatched ? { methodNotAllowed: true } : null;
  }
}

export async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return {};
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};
  try { return JSON.parse(raw); }
  catch { throw badRequest('BAD_REQUEST', 'Request body is not valid JSON.'); }
}

export function sendJson(res, status, payload, headers = {}) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    ...headers,
  });
  res.end(body);
}

export function sendProblem(res, err, instance, requestId) {
  const appError = err instanceof AppError ? err : internal(config.env === 'development' ? err.message : undefined);
  if (!(err instanceof AppError)) log.error('unhandled_error', { error: err.message, stack: err.stack, request_id: requestId });
  const body = JSON.stringify(appError.toProblem(instance, requestId), null, 2);
  res.writeHead(appError.status, {
    'Content-Type': 'application/problem+json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'X-Request-Id': requestId,
  });
  res.end(body);
}

/** Envelope for a single resource. */
export const one = (data, meta = {}) => ({ data, meta });

/**
 * Cursor pagination. Offset pagination is forbidden: cursors encode the last id seen.
 * The caller passes an already-sorted array.
 */
export function paginate(rows, query, path) {
  const limit = Math.min(Number.parseInt(query.limit, 10) || config.defaultLimit, config.maxLimit);
  let start = 0;
  if (query.cursor) {
    const decoded = decodeCursor(query.cursor);
    if (!decoded || !decoded.after) throw badRequest('INVALID_CURSOR', 'The cursor is not valid for this query.');
    const idx = rows.findIndex((r) => r.id === decoded.after);
    if (idx === -1) throw badRequest('INVALID_CURSOR', 'The cursor refers to a record that is no longer in this result set.');
    start = idx + 1;
  }
  const page = rows.slice(start, start + limit);
  const hasMore = start + limit < rows.length;
  const params = new URLSearchParams({ ...query });
  if (hasMore && page.length) params.set('cursor', encodeCursor({ after: page[page.length - 1].id }));
  return {
    data: page,
    meta: { count: page.length, total: rows.length, has_more: hasMore },
    links: { next: hasMore && page.length ? `${path}?${params}` : null, prev: null },
  };
}

export { ulid, notFoundError };
