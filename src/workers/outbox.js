// workers/outbox.js — drains the transactional outbox into the notification consumer.
//
// Delivery is at-least-once, so the consumer records an `event_consumption` row and
// skips anything it has already handled.
import { db } from '../db/store.js';
import { outbox } from '../repositories/index.js';
import { alreadyConsumed, markConsumed } from '../core/events.js';
import { handleEvent } from '../services/notifications.js';
import { log } from '../core/logging.js';

const CONSUMER = 'notifications';

export function publishOutbox({ maxPasses = 5 } = {}) {
  let dispatched = 0;
  let queued = 0;
  let suppressed = 0;

  for (let pass = 0; pass < maxPasses; pass += 1) {
    const pending = outbox.unpublished();
    if (pending.length === 0) break;

    for (const event of pending) {
      db.tx(() => {
        if (!alreadyConsumed(db, event.id, CONSUMER)) {
          for (const result of handleEvent(event)) {
            if (result.skipped) suppressed += 1; else queued += 1;
          }
          markConsumed(db, event.id, CONSUMER);
        }
        outbox.markPublished(event.id);
      });
      dispatched += 1;
    }
  }

  if (dispatched) log.info('outbox.drained', { dispatched, queued, suppressed });
  return { dispatched, queued, suppressed };
}
