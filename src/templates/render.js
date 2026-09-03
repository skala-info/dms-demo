// templates/render.js — a deliberately small, sandboxed template renderer.
//
// There is no `eval`, no filesystem access from inside a template, and no arbitrary
// attribute traversal: a template may only read the allow-listed context it was given.
// Supported syntax:
//   {{ a.b.c }}                     escaped value
//   {{{ a.b.c }}}                   raw value (already-trusted HTML only)
//   {{ a.b | upper }}               filters: upper, lower, title, pct, default("...")
//   {{#if a.b}} ... {{else}} ... {{/if}}
//   {{#each list}} {{ this.name }} {{@index}} {{/each}}
//
// A merge field that resolves to null/undefined renders the fallback ("" unless a
// `default` filter says otherwise) and is reported in `warnings` — it never renders
// the string "None" or "undefined".

const FILTERS = {
  upper: (v) => String(v).toUpperCase(),
  lower: (v) => String(v).toLowerCase(),
  title: (v) => String(v).replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase()),
  pct: (v) => `${v}%`,
};

const escapeHtml = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function resolve(ctx, path) {
  if (path === 'this') return ctx.this;
  if (path === '@index') return ctx['@index'];
  let cur = ctx;
  for (const part of path.split('.')) {
    if (cur === null || cur === undefined) return undefined;
    if (!Object.prototype.hasOwnProperty.call(cur, part)) return undefined;
    cur = cur[part];
  }
  return cur;
}

function applyFilters(value, filterSpec, warnings, path) {
  let out = value;
  let fallback = '';
  for (const raw of filterSpec) {
    const spec = raw.trim();
    const def = /^default\((?:"([^"]*)"|'([^']*)')\)$/.exec(spec);
    if (def) { fallback = def[1] ?? def[2] ?? ''; continue; }
    if (out === undefined || out === null || out === '') continue;
    const fn = FILTERS[spec];
    if (!fn) { warnings.push({ code: 'UNKNOWN_FILTER', field: path, filter: spec }); continue; }
    out = fn(out);
  }
  if (out === undefined || out === null || out === '') {
    if (out === undefined) warnings.push({ code: 'MISSING_MERGE_FIELD', field: path });
    return fallback;
  }
  return out;
}

function renderSection(tpl, ctx, warnings) {
  let out = '';
  let i = 0;
  const blockRe = /\{\{#(if|each)\s+([\w.@]+)\s*\}\}/g;

  while (i < tpl.length) {
    blockRe.lastIndex = i;
    const open = blockRe.exec(tpl);
    if (!open) { out += renderLeaf(tpl.slice(i), ctx, warnings); break; }

    out += renderLeaf(tpl.slice(i, open.index), ctx, warnings);
    const [, kind, path] = open;
    const bodyStart = open.index + open[0].length;
    const close = findClose(tpl, bodyStart, kind);
    if (close === -1) throw new Error(`Unclosed {{#${kind} ${path}}} block`);
    const body = tpl.slice(bodyStart, close.start);
    const value = resolve(ctx, path);

    if (kind === 'if') {
      const [truthy, falsy] = splitElse(body);
      const isTruthy = Array.isArray(value) ? value.length > 0 : Boolean(value);
      out += renderSection(isTruthy ? truthy : falsy, ctx, warnings);
    } else {
      const items = Array.isArray(value) ? value : [];
      items.forEach((item, index) => {
        out += renderSection(body, { ...ctx, this: item, '@index': index }, warnings);
      });
    }
    i = close.end;
  }
  return out;
}

function findClose(tpl, from, kind) {
  const re = new RegExp(`\\{\\{(#${kind}\\s+[\\w.@]+|/${kind})\\s*\\}\\}`, 'g');
  re.lastIndex = from;
  let depth = 1;
  let m;
  while ((m = re.exec(tpl)) !== null) {
    if (m[1].startsWith('#')) depth += 1;
    else if (--depth === 0) return { start: m.index, end: m.index + m[0].length };
  }
  return -1;
}

function splitElse(body) {
  const m = /\{\{else\}\}/.exec(body);
  return m ? [body.slice(0, m.index), body.slice(m.index + m[0].length)] : [body, ''];
}

function renderLeaf(chunk, ctx, warnings) {
  return chunk
    .replace(/\{\{\{\s*([\w.@]+)\s*\}\}\}/g, (_, path) => {
      const v = resolve(ctx, path);
      if (v === undefined) warnings.push({ code: 'MISSING_MERGE_FIELD', field: path });
      return v ?? '';
    })
    .replace(/\{\{\s*([\w.@]+)\s*((?:\|[^}]+)?)\}\}/g, (_, path, filters) => {
      const specs = filters ? filters.split('|').slice(1) : [];
      const raw = resolve(ctx, path);
      return escapeHtml(applyFilters(raw, specs, warnings, path));
    });
}

/** @returns {{html:string, warnings:Array}} */
export function render(template, context) {
  const warnings = [];
  const html = renderSection(template, { ...context, this: undefined }, warnings);
  return { html, warnings };
}

/** Plain-text alternative, derived from the rendered HTML. Every email ships both. */
export function htmlToText(html) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n')
    .replace(/<li>/gi, '  - ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
