// integrations/email/memory.js — test adapter. Captures every message in order.
import { EmailAdapter } from './base.js';
import { uuid } from '../../core/ids.js';

export class MemoryEmailAdapter extends EmailAdapter {
  constructor() { super(); this.sent = []; this.failuresBeforeSuccess = 0; }
  async send(message) {
    if (this.failuresBeforeSuccess > 0) {
      this.failuresBeforeSuccess -= 1;
      throw new Error('provider temporarily unavailable');
    }
    const id = `mem-${uuid()}`;
    this.sent.push({ ...message, provider_message_id: id, sent_at: new Date().toISOString() });
    return { provider_message_id: id };
  }
  clear() { this.sent = []; }
  to(address) { return this.sent.filter((m) => m.to === address); }
}
