// integrations/email/console.js — development adapter. Prints, never sends.
import { EmailAdapter } from './base.js';
import { uuid } from '../../core/ids.js';

export class ConsoleEmailAdapter extends EmailAdapter {
  async send(message) {
    process.stdout.write(
      `\n--- EMAIL ---\nTo: ${message.to}\nFrom: ${message.from}\nSubject: ${message.subject}\n\n${message.text}\n-------------\n`,
    );
    return { provider_message_id: `console-${uuid()}` };
  }
}
