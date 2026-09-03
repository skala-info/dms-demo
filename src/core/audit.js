// core/audit.js — X-I2: every mutating operation writes an audit entry with actor,
// timestamp, entity, operation and a before/after diff of the changed fields.
import { uuid } from './ids.js';

function diff(before, after) {
  const changed = {};
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  for (const k of keys) {
    const b = before ? before[k] : undefined;
    const a = after ? after[k] : undefined;
    if (JSON.stringify(b) !== JSON.stringify(a)) changed[k] = { before: b ?? null, after: a ?? null };
  }
  return changed;
}

export function writeAudit(db, { organizationId, actor, entityType, entityId, operation, before, after, context }) {
  return db.insert('audit_entry', {
    id: uuid(),
    organization_id: organizationId,
    actor: actor || 'system',
    entity_type: entityType,
    entity_id: entityId,
    operation,
    changes: diff(before, after),
    context: context || null,
    occurred_at: new Date().toISOString(),
  });
}
