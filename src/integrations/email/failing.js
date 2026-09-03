// integrations/email/failing.js — always rejects. Exercises the retry/dead-letter path.
import { EmailAdapter } from './base.js';

export class FailingEmailAdapter extends EmailAdapter {
  async send() { throw new Error('provider rejected the message'); }
}
