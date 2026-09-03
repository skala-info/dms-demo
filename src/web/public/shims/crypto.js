// shims/crypto.js — the three node:crypto calls demo1 makes, on top of WebCrypto.
export const randomUUID = () => (globalThis.crypto.randomUUID
  ? globalThis.crypto.randomUUID()
  : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (globalThis.crypto.getRandomValues(new Uint8Array(1))[0]) % 16;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  }));

export const randomBytes = (size) => Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(size)));

/**
 * `hashBody` uses an HMAC to tell "same Idempotency-Key, different body" from a genuine
 * retry. WebCrypto's HMAC is async and the call site is synchronous, so this is a plain
 * synchronous digest (FNV-1a, 128 bits over four lanes) instead.
 *
 * That is sound for what the value is *for*: the digest is only ever compared against
 * another digest produced by this same runtime, never stored across systems or treated as
 * a security boundary. Node keeps the real HMAC.
 */
export const createHmac = () => {
  let payload = '';
  const api = {
    update(text) { payload += text; return api; },
    digest() {
      const lanes = [0x811c9dc5, 0x01000193, 0x811c9dc5 ^ 0x5bf03635, 0x9e3779b9];
      for (let lane = 0; lane < 4; lane += 1) {
        let hash = lanes[lane];
        for (let i = 0; i < payload.length; i += 1) {
          hash ^= payload.charCodeAt((i + lane) % payload.length);
          hash = Math.imul(hash, 0x01000193) >>> 0;
        }
        lanes[lane] = hash >>> 0;
      }
      return lanes.map((n) => n.toString(16).padStart(8, '0')).join('');
    },
  };
  return api;
};

export default { randomUUID, randomBytes, createHmac };
