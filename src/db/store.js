// db/store.js — the whole persistence layer.
//
// demo1 keeps the *shape* of the production design (one row set per table, every row
// tenant-scoped, one transaction per request) but swaps PostgreSQL for a single JSON
// document held in memory and flushed to disk. Everything above this file is written as
// if it were talking to a real database, so replacing this module is the only change
// needed to move to Postgres.
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../core/config.js';

export const COLLECTIONS = [
  'organization',
  'fund',
  'campaign',
  'donor',
  'giving_summary',
  'donation',
  'allocation',
  'receipt',
  'communication',
  'outbox_event',
  'event_consumption',
  'audit_entry',
  'idempotency_key',
  'job_run',
];

function emptyData() {
  return Object.fromEntries(COLLECTIONS.map((c) => [c, []]));
}

class Store {
  constructor() {
    this.data = emptyData();
    this.file = config.dataFile;
    this.persist = true;
    this._depth = 0;
    this._snapshot = null;
  }

  /** Load from disk, or start empty. */
  load() {
    if (this.persist && fs.existsSync(this.file)) {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.data = { ...emptyData(), ...parsed };
    }
    return this;
  }

  /** Wipe everything (tests, and `npm run demo`). */
  reset({ persist = this.persist } = {}) {
    this.data = emptyData();
    this.persist = persist;
    this._depth = 0;
    this._snapshot = null;
    if (persist) this.flush();
    return this;
  }

  flush() {
    if (!this.persist) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }

  /**
   * One transaction per request. Nested calls join the outer transaction
   * (services never commit on their own — see docs/demo1/05-architecture.md §4).
   */
  tx(fn) {
    if (this._depth === 0) this._snapshot = structuredClone(this.data);
    this._depth += 1;
    try {
      const result = fn(this);
      this._depth -= 1;
      if (this._depth === 0) { this._snapshot = null; this.flush(); }
      return result;
    } catch (err) {
      this._depth -= 1;
      if (this._depth === 0) { this.data = this._snapshot; this._snapshot = null; }
      throw err;
    }
  }

  table(name) {
    const rows = this.data[name];
    if (!rows) throw new Error(`Unknown collection ${name}`);
    return rows;
  }

  insert(name, row) {
    this.table(name).push(row);
    return row;
  }

  get(name, id) {
    return this.table(name).find((r) => r.id === id) || null;
  }

  find(name, pred) {
    return this.table(name).find(pred) || null;
  }

  filter(name, pred) {
    return this.table(name).filter(pred);
  }

  update(name, id, patch) {
    const row = this.get(name, id);
    if (!row) return null;
    Object.assign(row, patch, { updated_at: new Date().toISOString() });
    return row;
  }
}

export const db = new Store();
