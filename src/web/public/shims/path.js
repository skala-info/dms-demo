// shims/path.js — the handful of node:path calls demo1 makes, as plain string work.
const normalise = (value) => {
  const absolute = value.startsWith('/');
  const parts = [];
  for (const part of value.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') { if (parts.length && parts[parts.length - 1] !== '..') parts.pop(); else if (!absolute) parts.push('..'); continue; }
    parts.push(part);
  }
  return (absolute ? '/' : '') + parts.join('/');
};

export const sep = '/';
export const join = (...parts) => normalise(parts.filter(Boolean).join('/')) || '.';
export const resolve = (...parts) => {
  let out = '';
  for (const part of parts) out = part.startsWith('/') ? part : `${out}/${part}`;
  return normalise(out.startsWith('/') ? out : `/${out}`);
};
export const dirname = (value) => {
  const trimmed = normalise(value);
  const cut = trimmed.lastIndexOf('/');
  return cut <= 0 ? (trimmed.startsWith('/') ? '/' : '.') : trimmed.slice(0, cut);
};
export const basename = (value) => normalise(value).split('/').pop() || '';
export const extname = (value) => {
  const name = basename(value);
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? '' : name.slice(dot);
};

export default { sep, join, resolve, dirname, basename, extname };
