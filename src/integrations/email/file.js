// integrations/email/file.js — writes each message to outbox/ as a readable .eml.
// This is what `npm run demo` uses so the generated mail can actually be opened.
import fs from 'node:fs';
import path from 'node:path';
import { EmailAdapter } from './base.js';
import { config } from '../../core/config.js';
import { uuid } from '../../core/ids.js';

export class FileEmailAdapter extends EmailAdapter {
  constructor(dir = config.outboxDir) { super(); this.dir = dir; }
  async send(message) {
    fs.mkdirSync(this.dir, { recursive: true });
    const id = uuid();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safeTo = message.to.replace(/[^a-z0-9@._-]/gi, '_');
    const file = path.join(this.dir, `${stamp}_${safeTo}.eml`);
    const body = [
      `From: ${message.from}`,
      `To: ${message.to}`,
      `Subject: ${message.subject}`,
      `Date: ${new Date().toUTCString()}`,
      `Message-ID: <${id}@dms.demo>`,
      'MIME-Version: 1.0',
      'Content-Type: text/html; charset=utf-8',
      '',
      message.html,
    ].join('\n');
    fs.writeFileSync(file, body);
    return { provider_message_id: `file-${id}`, file };
  }
}
