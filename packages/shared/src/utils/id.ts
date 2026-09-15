/** Record IDs. UUID v4 is the sync key — see brief §7.4 (idempotent upsert). */

/**
 * Minimal Web Crypto surface. Declared locally rather than pulling in the DOM
 * or Node lib: this package is consumed by the browser PWAs, the Node agent
 * and the Node server, and none of them should have to agree on a global.
 */
interface MinimalCrypto {
  randomUUID?: () => string;
  getRandomValues?: <T extends Uint8Array>(array: T) => T;
}

function getCrypto(): MinimalCrypto | undefined {
  return (globalThis as { crypto?: MinimalCrypto }).crypto;
}

export function newId(): string {
  const c = getCrypto();
  if (c?.randomUUID) return c.randomUUID();

  // Fallback for the rare runtime without randomUUID (an older Node on the
  // weighbridge PC, or a browser on a non-secure origin). Still v4-shaped.
  const bytes = new Uint8Array(16);
  if (c?.getRandomValues) {
    c.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // variant 10
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidId(value: string): boolean {
  return UUID_REGEX.test(value);
}
