// shims/globals.js — the two Node globals the demo1 source expects, for the browser build.
//
// Loaded as a plain script BEFORE any module, because `Buffer` and `process` are globals
// rather than imports and must exist by the time core/config.js and core/http.js evaluate.
// Nothing here is a general-purpose polyfill: it covers exactly the calls demo1 makes.
(function () {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const toBase64 = (bytes) => {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  };
  const fromBase64 = (text) => {
    const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(binary, (c) => c.charCodeAt(0));
  };

  class Buf extends Uint8Array {
    toString(encoding = 'utf8') {
      if (encoding === 'hex') return [...this].map((b) => b.toString(16).padStart(2, '0')).join('');
      if (encoding === 'base64') return toBase64(this);
      if (encoding === 'base64url') return toBase64(this).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      return decoder.decode(this);
    }
  }

  Buf.from = (value, encoding) => {
    if (typeof value === 'string') {
      if (encoding === 'base64' || encoding === 'base64url') return new Buf(fromBase64(value));
      if (encoding === 'hex') return new Buf(value.match(/../g)?.map((h) => parseInt(h, 16)) ?? []);
      return new Buf(encoder.encode(value));
    }
    return new Buf(value);
  };
  Buf.concat = (chunks) => {
    const total = chunks.reduce((n, c) => n + c.length, 0);
    const out = new Buf(total);
    let offset = 0;
    for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.length; }
    return out;
  };
  Buf.byteLength = (value) => (typeof value === 'string' ? encoder.encode(value).length : value.length);

  globalThis.Buffer = globalThis.Buffer || Buf;

  // config.js reads process.env at module load; the console picks the in-memory adapters.
  globalThis.process = globalThis.process || {
    env: { ENVIRONMENT: 'browser', EMAIL_PROVIDER: 'memory', LOG_LEVEL: 'error' },
    stdout: { write: (line) => console.debug(String(line).trimEnd()) },
  };
})();
