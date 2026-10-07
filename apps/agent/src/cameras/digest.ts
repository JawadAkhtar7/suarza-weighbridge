/**
 * HTTP Digest authentication, enough of it for an IP camera.
 *
 * Hikvision's snapshot endpoint answers Basic with a 401 and insists on
 * Digest, and `fetch` has no idea how to do it. The alternatives were adding
 * an HTTP client library to the agent — on a Windows PC where every extra
 * dependency is another thing `install.bat` can fail on, and it has failed
 * before — or writing the sixty lines the RFC actually asks for. This is the
 * sixty lines.
 *
 * Scope is deliberately narrow: MD5 with `qop=auth`, which is what these
 * cameras send. Anything else is rejected loudly rather than guessed at, so a
 * camera that wants something different fails with a message naming the
 * reason instead of a silent 401 loop.
 */

import { createHash, randomBytes } from 'node:crypto';

export interface DigestOptions {
  username: string;
  password: string;
  /** Abort if the camera has not answered in this long. */
  timeoutMs?: number;
}

export interface FetchedImage {
  body: Buffer;
  contentType: string;
}

const md5 = (value: string) => createHash('md5').update(value).digest('hex');

/** `a="b", c=d` → a Map. Values may or may not be quoted. */
function parseChallenge(header: string): Map<string, string> {
  const out = new Map<string, string>();
  // Split on commas that are not inside quotes.
  for (const part of header.replace(/^Digest\s+/i, '').match(/(?:[^,"]|"[^"]*")+/g) ?? []) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim().toLowerCase();
    const value = part.slice(eq + 1).trim().replace(/^"|"$/g, '');
    out.set(key, value);
  }
  return out;
}

function buildAuthorization(
  challenge: Map<string, string>,
  { username, password }: DigestOptions,
  method: string,
  uri: string,
): string {
  const realm = challenge.get('realm') ?? '';
  const nonce = challenge.get('nonce') ?? '';
  const opaque = challenge.get('opaque');
  const algorithm = (challenge.get('algorithm') ?? 'MD5').toUpperCase();
  const qop = challenge.get('qop');

  if (algorithm !== 'MD5') {
    throw new Error(`Camera asked for unsupported digest algorithm "${algorithm}"`);
  }

  const ha1 = md5(`${username}:${realm}:${password}`);
  const ha2 = md5(`${method}:${uri}`);

  const parts = [
    `username="${username}"`,
    `realm="${realm}"`,
    `nonce="${nonce}"`,
    `uri="${uri}"`,
    `algorithm=${algorithm}`,
  ];

  let response: string;
  if (qop) {
    // `qop` may be a list ("auth,auth-int"); we only do plain auth.
    const chosen = qop
      .split(',')
      .map((v) => v.trim())
      .find((v) => v === 'auth');
    if (!chosen) throw new Error(`Camera asked for unsupported digest qop "${qop}"`);

    const nc = '00000001';
    const cnonce = randomBytes(8).toString('hex');
    response = md5(`${ha1}:${nonce}:${nc}:${cnonce}:${chosen}:${ha2}`);
    parts.push(`qop=${chosen}`, `nc=${nc}`, `cnonce="${cnonce}"`);
  } else {
    response = md5(`${ha1}:${nonce}:${ha2}`);
  }

  parts.push(`response="${response}"`);
  if (opaque) parts.push(`opaque="${opaque}"`);
  return `Digest ${parts.join(', ')}`;
}

/**
 * GET a URL, answering a Digest challenge if one comes back.
 *
 * Two requests in the common case: the first earns the 401 that carries the
 * nonce, the second uses it. Cameras hand out a fresh nonce each time and do
 * not mind, and caching one across calls would mean tracking nonce counts for
 * a saving of a few milliseconds on a local network.
 */
export async function fetchWithDigest(
  url: string,
  options: DigestOptions,
): Promise<FetchedImage> {
  const { timeoutMs = 2500 } = options;
  const target = new URL(url);
  // The digest `uri` is the path and query exactly as sent, not the whole URL.
  const uri = `${target.pathname}${target.search}`;

  const get = (headers: Record<string, string> = {}) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    return fetch(url, { headers, signal: controller.signal }).finally(() =>
      clearTimeout(timer),
    );
  };

  let response = await get();

  if (response.status === 401) {
    const challenge = response.headers.get('www-authenticate');
    if (!challenge || !/^Digest/i.test(challenge)) {
      throw new Error('Camera rejected the credentials and did not offer digest auth');
    }
    // The body of the 401 is never read, and an unread body keeps the socket
    // open until the GC gets to it.
    await response.arrayBuffer().catch(() => undefined);

    response = await get({
      Authorization: buildAuthorization(parseChallenge(challenge), options, 'GET', uri),
    });
  }

  if (!response.ok) {
    throw new Error(`Camera returned ${response.status} ${response.statusText}`);
  }

  const body = Buffer.from(await response.arrayBuffer());
  if (body.byteLength === 0) throw new Error('Camera returned an empty image');

  return {
    body,
    contentType: response.headers.get('content-type') ?? 'image/jpeg',
  };
}
