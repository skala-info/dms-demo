// core/events.js — transactional outbox.
//
// Domain events are inserted in the SAME transaction as the state change that produced
// them. A worker drains the outbox afterwards and dispatches to consumers. That gives
// exactly-once state with at-least-once delivery, so every consumer must be idempotent
// on `event.id`.
import { ulid } from './ids.js';

export const EVENT_TYPES = [
  'donor.registered',
  'donor.updated',
  'donation.posted',
  'donation.reversed',
  'campaign.milestone_reached',
  'campaign.goal_reached',
  'campaign.closed',
  'campaign.update_requested',
  'receipt.issued',
  'receipt.voided',
];

/** Insert an event into the outbox. Must be called inside a store transaction. */
export function publish(db, { organizationId, type, actor, data }) {
  if (!EVENT_TYPES.includes(type)) throw new Error(`Unknown event type ${type}`);
  const now = new Date().toISOString();
  return db.insert('outbox_event', {
    id: ulid(),
    organization_id: organizationId,
    type,
    occurred_at: now,
    actor: actor || 'system',
    version: 1,
    data,
    published_at: null,
    attempts: 0,
    created_at: now,
  });
}

/** Consumers call this to stay idempotent across at-least-once delivery. */
export function alreadyConsumed(db, eventId, consumer) {
  return Boolean(db.find('event_consumption', (r) => r.event_id === eventId && r.consumer === consumer));
}

export function markConsumed(db, eventId, consumer) {
  db.insert('event_consumption', { id: `${eventId}:${consumer}`, event_id: eventId, consumer, consumed_at: new Date().toISOString() });
}
