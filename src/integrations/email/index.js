// integrations/email/index.js — adapter selection + a swappable singleton for tests.
import { config } from '../../core/config.js';
import { ConsoleEmailAdapter } from './console.js';
import { FileEmailAdapter } from './file.js';
import { MemoryEmailAdapter } from './memory.js';
import { FailingEmailAdapter } from './failing.js';

const build = (name) => {
  switch (name) {
    case 'console': return new ConsoleEmailAdapter();
    case 'memory': return new MemoryEmailAdapter();
    case 'failing': return new FailingEmailAdapter();
    case 'file':
    default: return new FileEmailAdapter();
  }
};

let adapter = build(config.emailProvider);

export const emailPort = {
  send: (message) => adapter.send(message),
  current: () => adapter,
  use(next) { adapter = next; return adapter; },
  reset() { adapter = build(config.emailProvider); return adapter; },
};

export { MemoryEmailAdapter, FailingEmailAdapter, ConsoleEmailAdapter, FileEmailAdapter };
