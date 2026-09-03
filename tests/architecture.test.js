// tests/architecture.test.js — the layering rule, enforced by test rather than by memory.
//
//   api -> services -> domain -> repositories -> db
//
// `web/` sits outside that chain entirely: it serves static files and nothing else.
//
// A layer may only import from layers below it. In particular `domain/` is pure: it may
// not touch the store, the repositories, or any integration.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');

const LAYERS = ['api', 'services', 'repositories', 'db', 'domain', 'core', 'integrations', 'workers', 'templates', 'web', 'testing'];

/** What each layer is allowed to import from. `core` is cross-cutting and always allowed. */
const ALLOWED = {
  domain: ['core'],
  repositories: ['core', 'db', 'domain'],
  services: ['core', 'db', 'domain', 'repositories', 'templates', 'integrations'],
  workers: ['core', 'db', 'domain', 'repositories', 'services', 'integrations'],
  api: ['core', 'db', 'domain', 'repositories', 'services', 'workers'],
  // The console serves files. It reaches the data the same way curl does: over HTTP.
  web: ['core'],
  templates: ['core'],
  integrations: ['core'],
  db: ['core'],
  core: ['core'],
  testing: LAYERS,
};

function* jsFiles(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* jsFiles(full);
    else if (entry.name.endsWith('.js')) yield full;
  }
}

const layerOf = (file) => {
  const rel = path.relative(src, file);
  const first = rel.split(path.sep)[0];
  return LAYERS.includes(first) ? first : null;
};

test('no module imports from a layer it is not allowed to see', () => {
  const violations = [];

  for (const file of jsFiles(src)) {
    const from = layerOf(file);
    if (!from) continue;
    const source = fs.readFileSync(file, 'utf8');
    for (const m of source.matchAll(/from\s+'([^']+)'/g)) {
      const spec = m[1];
      if (!spec.startsWith('.')) continue;
      const target = layerOf(path.resolve(path.dirname(file), spec));
      if (!target || target === from) continue;
      if (!ALLOWED[from].includes(target)) {
        violations.push(`${path.relative(src, file)} (${from}) imports ${target}/`);
      }
    }
  }

  assert.deepEqual(violations, [], `layering violations:\n${violations.join('\n')}`);
});

test('the domain layer is pure: no store, no repositories, no integrations', () => {
  const offenders = [];
  for (const file of jsFiles(path.join(src, 'domain'))) {
    const source = fs.readFileSync(file, 'utf8');
    if (/from\s+'[^']*(db\/store|repositories|integrations)/.test(source)) {
      offenders.push(path.relative(src, file));
    }
  }
  assert.deepEqual(offenders, []);
});

test('nothing outside services/notifications.js talks to the email port directly', () => {
  const offenders = [];
  for (const file of jsFiles(src)) {
    const rel = path.relative(src, file);
    if (rel.startsWith('integrations') || rel.startsWith('testing') || rel === path.join('workers', 'mailer.js')) continue;
    if (/emailPort/.test(fs.readFileSync(file, 'utf8'))) offenders.push(rel);
  }
  assert.deepEqual(offenders, [], 'the mailer worker is the only sender; everything else queues a communication');
});
